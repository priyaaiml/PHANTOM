from __future__ import annotations

import asyncio
import socket

import pytest

import core.proxy_engine as proxy_engine
from core.proxy_engine import ProxyEngine, ProxyError


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def test_start_waits_for_listener_and_stop_clears_status():
    async def run():
        engine = ProxyEngine()
        port = _free_port()
        result = await engine.start(host="127.0.0.1", port=port)

        assert result == {"status": "running", "host": "127.0.0.1", "port": port}
        assert engine.status()["running"] is True
        _, writer = await asyncio.open_connection("127.0.0.1", port)
        writer.close()
        await writer.wait_closed()
        await engine.stop()
        assert engine.status()["running"] is False

    asyncio.run(run())


class _FakeAddonManager:
    def __init__(self, proxyserver):
        self.proxyserver = proxyserver

    def add(self, _addon):
        pass

    def get(self, name):
        return self.proxyserver if name == "proxyserver" else None


class _FakeProxyserver:
    def __init__(self, addresses=()):
        self.addresses = addresses

    def listen_addrs(self):
        return self.addresses


class _FakeMaster:
    def __init__(self, _options, *, with_termlog, with_dumper, addresses=(), error=None):
        self.addons = _FakeAddonManager(_FakeProxyserver(addresses))
        self.exited = asyncio.Event()
        self.error = error

    async def run(self):
        await self.exited.wait()
        if self.error:
            raise self.error

    def shutdown(self):
        self.exited.set()


def test_start_times_out_if_listener_never_becomes_ready(monkeypatch):
    monkeypatch.setattr(proxy_engine, "DumpMaster", _FakeMaster)
    monkeypatch.setattr(proxy_engine, "PROXY_STARTUP_TIMEOUT_S", 0.02)
    monkeypatch.setattr(proxy_engine, "PROXY_STARTUP_POLL_INTERVAL_S", 0.005)

    async def run():
        engine = ProxyEngine()
        with pytest.raises(ProxyError, match="listener was not ready"):
            await engine.start(host="127.0.0.1", port=8080)
        assert engine.status()["running"] is False
        assert engine._master is None
        assert engine._task is None

    asyncio.run(run())


def test_start_surfaces_task_failure(monkeypatch):
    class FailedMaster(_FakeMaster):
        async def run(self):
            raise RuntimeError("bind failed")

    monkeypatch.setattr(proxy_engine, "DumpMaster", FailedMaster)

    async def run():
        engine = ProxyEngine()
        with pytest.raises(ProxyError, match="bind failed"):
            await engine.start(host="127.0.0.1", port=8080)
        assert engine.status()["running"] is False
        assert engine._master is None
        assert engine._task is None

    asyncio.run(run())


def test_start_converts_master_sys_exit_to_proxy_error(monkeypatch):
    """mitmproxy's errorcheck addon calls sys.exit() on bind failure; that must
    surface as ProxyError instead of escaping the event loop and killing the app."""

    class ExitingMaster(_FakeMaster):
        async def run(self):
            raise SystemExit(1)

    monkeypatch.setattr(proxy_engine, "DumpMaster", ExitingMaster)

    async def run():
        engine = ProxyEngine()
        with pytest.raises(ProxyError, match="exited during startup"):
            await engine.start(host="127.0.0.1", port=8080)
        assert engine.status()["running"] is False
        assert engine._master is None
        assert engine._task is None

    asyncio.run(run())


def test_stop_releases_port_allowing_restart_on_same_port():
    """mitmproxy keeps its listeners bound after the master exits; stop() must
    release the port so the proxy can be restarted on the same address."""

    async def run():
        engine = ProxyEngine()
        port = _free_port()
        await engine.start(host="127.0.0.1", port=port)
        await engine.stop()
        assert engine.status()["running"] is False

        # Re-binding the same port immediately must succeed.
        await engine.start(host="127.0.0.1", port=port)
        assert engine.status()["running"] is True
        await engine.stop()

    asyncio.run(run())


def test_unexpected_task_exit_clears_running_status(monkeypatch):
    monkeypatch.setattr(
        proxy_engine,
        "DumpMaster",
        lambda *args, **kwargs: _FakeMaster(
            *args, **kwargs, addresses=[("127.0.0.1", 8080)]
        ),
    )

    async def run():
        engine = ProxyEngine()
        await engine.start(host="127.0.0.1", port=8080)
        master = engine._master
        master.exited.set()
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert engine.status()["running"] is False
        assert engine.status()["host"] is None
        assert engine.status()["port"] is None

    asyncio.run(run())
