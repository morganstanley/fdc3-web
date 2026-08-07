# @morgan-stanley/fdc3-web-bridging-server

An [FDC3 Desktop Agent Bridge](https://fdc3.finos.org/docs/agent-bridging/spec) server, implementing
the bridge side of the protocol that the `@morgan-stanley/fdc3-web` Desktop Agent's `bridge` option
connects to. See `BRIDGING_SERVER_DESIGN.md` in this project for the full design.

## Running

```bash
npx nx serve fdc3-web-bridging-server
```

Starts a WebSocket bridge listening on `127.0.0.1`, scanning the standard bridging port range
(4475-4575) for a free port.

## Timeout configuration

If you change the per-family response timeouts, keep this ordering intact, or a bridged
`raiseIntent` will surface a confusing generic timeout instead of a meaningful error:

```
target agent's intent-listener timeout  <  bridge's raiseIntent phase-1 timeout  <  originating agent's response timeout - headroom
```
