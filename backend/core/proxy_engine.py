"""Proxy engine — in-process mitmproxy lifecycle (research.md D1)."""
from __future__ import annotations

import asyncio

from mitmproxy import options as mp_options
from mitmproxy.tools.dump import DumpMaster

import config
from api.websocket import broadcast
from core.proxy_addon import PhantomAddon
from db import database
from utils.logger import get_logger

log = get_logger(__name__)

PROXY_STARTUP_TIMEOUT_S = 5.0
PROXY_STARTUP_POLL_INTERVAL_S = 0.05


class ProxyError(RuntimeError):
    pass


class ProxyEngine:
    def __init__(self) -> None:
        self.addon = PhantomAddon()
        self._master: DumpMaster | None = None
        self._task: asyncio.Task | None = None
        self.running = False
        self.host: str | None = None
        self.port: int | None = None

    async def start(self, host: str | None = None, port: int | None = None) -> dict:
        if self.running:
            raise ProxyError(f"proxy already running on {self.host}:{self.port}")
        host = host or config.PROXY_HOST
        port = int(port or config.PROXY_PORT)

        opts = mp_options.Options(
            listen_host=host,
            listen_port=port,
            confdir=str(config.MITMPROXY_CONFDIR),
        )
        master = DumpMaster(opts, with_termlog=False, with_dumper=False)
        master.addons.add(self.addon)
        self._master = master
        self._task = asyncio.create_task(self._run_master(master), name="phantom-proxy")
        self._task.add_done_callback(self._on_task_done)

        deadline = asyncio.get_running_loop().time() + PROXY_STARTUP_TIMEOUT_S
        while True:
            if self._task.done():
                exc = self._task.exception() if not self._task.cancelled() else None
                await self._cleanup_failed_start(master, self._task)
                detail = f" ({exc})" if exc else ""
                raise ProxyError(
                    f"proxy failed to start on {host}:{port}{detail} — "
                    "check the port is free and try another port"
                )

            proxyserver = master.addons.get("proxyserver")
            if proxyserver and proxyserver.listen_addrs():
                break

            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                await self._cleanup_failed_start(master, self._task)
                raise ProxyError(
                    f"proxy failed to start on {host}:{port} — "
                    f"listener was not ready within {PROXY_STARTUP_TIMEOUT_S:g} seconds"
                )
            await asyncio.sleep(min(PROXY_STARTUP_POLL_INTERVAL_S, remaining))

        # No await between readiness and publishing the running state: the
        # task's done callback can then reliably clear it if startup exits.
        self.running = True
        self.host, self.port = host, port
        log.info("proxy listening on %s:%s", host, port)
        await broadcast("proxy_status", {"running": True, "host": host, "port": port})
        return {"status": "running", "host": host, "port": port}

    async def _run_master(self, master: DumpMaster) -> None:
        """Run the master, converting mitmproxy's startup ``sys.exit`` into ProxyError.

        mitmproxy's errorcheck addon calls ``sys.exit(1)`` when the listener fails
        to bind (e.g. port in use). ``SystemExit`` raised inside an asyncio task is
        re-raised out of the event loop by ``Task.__step``, which would terminate the
        whole backend. Translate it so only this task fails.
        """
        try:
            await master.run()
        except SystemExit as exc:
            raise ProxyError(f"proxy exited during startup (code {exc.code})") from None

    async def _stop_listeners(self, master: DumpMaster | None) -> None:
        """Close mitmproxy's listening sockets.

        mitmproxy's proxyserver addon does not close its listeners when the master
        exits, and mitmproxy keeps a global reference to the master, so without this
        the listen port would stay bound after ``stop()`` and block a restart.
        """
        if master is None:
            return
        try:
            proxyserver = master.addons.get("proxyserver")
        except Exception:
            return
        servers = getattr(proxyserver, "servers", None)
        if servers is None:
            return
        try:
            await asyncio.wait_for(servers.update([]), timeout=5)
        except Exception:
            log.exception("error while stopping proxy listeners")

    async def _cleanup_failed_start(
        self, master: DumpMaster, task: asyncio.Task
    ) -> None:
        try:
            master.shutdown()
        except Exception:
            log.exception("error while cleaning up failed proxy startup")
        if not task.done():
            try:
                await asyncio.wait_for(asyncio.shield(task), timeout=1)
            except asyncio.TimeoutError:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
            except asyncio.CancelledError:
                pass
            except Exception:
                log.exception("proxy task failed during failed-start cleanup")
        await self._stop_listeners(master)
        self._master = None
        self._task = None

    def _on_task_done(self, task: asyncio.Task) -> None:
        if task is not self._task or not self.running:
            return

        self.running = False
        self.host = self.port = None
        self._master = None
        self._task = None
        self.addon.drop_all()

        if task.cancelled():
            log.warning("proxy task was cancelled unexpectedly")
        elif exc := task.exception():
            log.error(
                "proxy task exited unexpectedly",
                exc_info=(type(exc), exc, exc.__traceback__),
            )
        else:
            log.warning("proxy task exited unexpectedly")

        asyncio.create_task(
            broadcast("proxy_status", {"running": False, "host": None, "port": None})
        )

    async def stop(self) -> dict:
        if not self.running or self._master is None:
            self.running = False
            return {"status": "stopped"}
        host, port = self.host, self.port
        master, task = self._master, self._task
        self.running = False
        try:
            master.shutdown()
        except Exception:
            log.exception("error while shutting down proxy master")
        if task:
            try:
                await asyncio.wait_for(asyncio.shield(task), timeout=5)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                task.cancel()
            except Exception:
                log.exception("proxy run task ended with error")
        await self._stop_listeners(master)
        self._master = None
        self._task = None
        self.addon.drop_all()
        self.host = self.port = None
        log.info("proxy stopped (was %s:%s)", host, port)
        await broadcast("proxy_status", {"running": False, "host": None, "port": None})
        return {"status": "stopped"}

    def status(self) -> dict:
        return {
            "running": self.running,
            "host": self.host,
            "port": self.port,
            "requests_captured": self.addon.captured_count,
            "intercept_enabled": self.addon.intercept_enabled,
            "intercept_queue_size": len(self.addon.held),
        }

    async def load_intercept_settings(self) -> None:
        """Restore intercept state from Settings.

        The toggle used to mutate memory only, so a running backend could report
        intercept "on" while the Settings table said "off" — and an intercept left
        on with an empty filter holds *every* request, which looks like a dead
        proxy. Loading it here makes /status, the Intercept panel and the
        "Intercept on at startup" setting agree, and survive a restart.
        """
        try:
            rows = await database.fetch_all(
                "SELECT key, value FROM settings"
                " WHERE key IN ('intercept_enabled', 'intercept_filter')"
            )
        except Exception:
            log.exception("could not load intercept settings; leaving intercept off")
            return
        values = {r["key"]: r["value"] for r in rows}
        self.addon.intercept_enabled = str(values.get("intercept_enabled", "")).lower() == "true"
        self.addon.intercept_filter = values.get("intercept_filter") or ""
        if not self.addon.intercept_enabled:
            self.addon.drop_all()
        log.info(
            "intercept restored: enabled=%s filter=%r",
            self.addon.intercept_enabled,
            self.addon.intercept_filter,
        )

    def ensure_ca(self) -> None:
        """Generate the CA via mitmproxy's CertStore without running the proxy."""
        from mitmproxy.certs import CertStore

        config.ensure_data_dir()
        CertStore.from_store(str(config.MITMPROXY_CONFDIR), "mitmproxy", 2048)


_engine: ProxyEngine | None = None


def get_proxy_engine() -> ProxyEngine:
    global _engine
    if _engine is None:
        _engine = ProxyEngine()
    return _engine
