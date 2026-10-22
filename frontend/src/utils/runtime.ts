/**
 * PHANTOM runs in two very different shapes, and conflating them makes the UI lie.
 *
 * - LOCAL: the UI, the backend and mitmproxy all run on this machine, so the
 *   proxy status shown here describes the proxy this browser can actually use.
 * - REMOTE: the UI is served from a host and reads a backend somewhere else.
 *   Every request count, finding and timing on screen belongs to *that* backend's
 *   database. The proxy listening on 127.0.0.1 on your own machine is not part
 *   of it and its captures never appear here.
 */
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export function isLocalRuntime(): boolean {
  if (typeof location === 'undefined') return false
  return LOCAL_HOSTNAMES.has(location.hostname)
}
