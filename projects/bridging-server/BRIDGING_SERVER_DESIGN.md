# FDC3 Desktop Agent Bridging — Server (`projects/bridging-server`)

## Context

The **client** half of [FDC3 Desktop Agent Bridging](https://fdc3.finos.org/docs/agent-bridging/spec)
is complete on this branch (`projects/fdc3-web/src/bridge/`, see `AGENT_BRIDGING_DESIGN.md`). It can
connect to a bridge, but there is no bridge to connect to — so nothing in the feature is runnable or
provably interoperable end-to-end.

This plan adds the **bridge itself**: a Node WebSocket server that accepts connections from N Desktop
Agents, assigns them names, and routes/collates all 13 request types and 7 response types between
them. A partial PoC exists at
`/home/coder/jspe/js-platform/hackathon/cli/fdc3-websocket-server/server.ts` (findIntent only) and is
used as a roadmap reference, not a base — it has bugs this plan explicitly fixes (see "PoC bugs
not inherited").

Outcome: `nx serve bridging-server` starts a real bridge; two browser windows of the test harness
opened with `?bridge=true` interoperate through it; and an in-process interop test proves the real
client and real server agree on the wire format.

Decisions already taken with the user: **publishable** npm package; **unit + interop** tests;
test-harness bridging opt-in via a **URL parameter** (off by default).

---

## Wire facts the server is designed against

Verified by reading the client. Each of these silently breaks the client if violated:

- Client connects to bare `ws://127.0.0.1:<port>` (no path), scanning **4475–4575** ascending.
- Client sends nothing on open — the server must send `hello` **unprompted**.
- Every forwarded request must carry `typeof meta.source.desktopAgent === 'string'`, set **by the
  bridge** (`isBridgeRequestMessage`). *This is the PoC's central bug — it sets a top-level
  `desktopAgent` instead, so every PoC-forwarded request is silently dropped.*
- Every response must carry both `meta.requestUuid` **and** `meta.responseUuid`, plus a
  `meta.timestamp` that revives to a `Date` (i.e. an **ISO string** on the wire).
- Success vs. error responses share the same `type`; the only discriminator is
  `typeof payload.error === 'string'`.
- `connectedAgentsUpdate` requires `Array.isArray(payload.allAgents)`. The client adopts its name only
  when `meta.requestUuid === <its handshake requestUuid> && payload.addAgent != null`. It **never
  reads `removeAgent`** — departures are detected purely by absence from `allAgents`, so **every**
  update must carry the full current roster.
- `authenticationFailed` **must** include a `payload` object — the client dereferences
  `payload.message` inside a voided async handler, so omitting it throws an unhandled rejection and
  wedges the client on that port permanently.
- Client await timeouts: **15000 ms** for every request family, **300000 ms** for the late
  `raiseIntentResultResponse`. All bridge-side timeouts must sit under these.
- The client's correlator keys only on `requestUuid` and rejects **all** pending entries under that
  uuid on any error-shaped response — so an error-shaped `raiseIntentResponse` also kills the
  pending phase-2 result listener.

Payload fields the client reads: `findIntentResponse` → `payload.appIntent.apps`;
`findIntentsByContextResponse` → `payload.appIntents`; `findInstancesResponse` →
`payload.appIdentifiers`; `getAppMetadataResponse` → `payload.appMetadata`; `openResponse` →
`payload.appIdentifier`; `raiseIntentResponse` → `payload.intentResolution`;
`raiseIntentResultResponse` → `payload.intentResult`.

---

## Architecture

**No dependency on `@morgan-stanley/fdc3-web`.** The helpers worth reusing (`parseBridgeMessage`,
the predicates) are only reachable through a barrel that also pulls in `agent/`, `get-agent/` and
`window.helper` — a browser-oriented surface that is a real hazard to load in a Node daemon.
Runtime deps are exactly `@finos/fdc3` (types only, for `BridgingTypes`) and `ws`. The ~40 lines of
`message.serialization.ts` are duplicated deliberately.

The server also needs **mirror-image predicates**, not the client's: an inbound *agent* request has
no `meta.source.desktopAgent` (the bridge sets it), and `AgentRequestMetadata.source` is fully
optional — so `isBridgeRequestMessage` would reject every legitimate inbound message.

`@morgan-stanley/fdc3-web` **is** imported by `src/interop.spec.ts` only. `tsconfig.lib.json`
excludes `**/*.spec.ts`, so it stays out of the shipped build and out of `package.json`.

### Two-kind classification (not three)

Broadcast-vs-targeted is a property of the *message* (`meta.destination`), not of the family. So
there are only two kinds: `request` (has a response type) and `fanout` (has none). Recipient
selection is a runtime computation, and **collation over a 1-element recipient set degenerates to
pass-through-with-stamping** — so `open`/`raiseIntent`/`getAppMetadata` need zero special-case code.

The per-family knowledge lives in one exhaustive table, `src/routing/request-routes.ts`, typed as a
**mapped type over `BridgingTypes.RequestMessageType`** so a missing or excess key is a compile error
in exactly one place. Each entry carries its own error union — the schema genuinely differs
(`open` is `OpenErrorResponsePayload`, which notably does **not** include `'NoAppsFound'`; the rest
are `FindInstancesErrors`) — which catches off-spec error strings at compile time.

Route fields: `kind`, `responseType`, `destinationRequired`, `requiresSourceApp`, `timeoutKey`,
`collate(parts, request)`, `timeoutError`, `unknownAgentError`, and `updatesChannelsState`
(`broadcastRequest` only — `PrivateChannel.broadcast` must **not** touch `channelsState`).

### Router flow

1. Not handshaken → drop + WARN, keep socket open (see edge cases).
2. `isHandshake` → handshake path (valid only from `awaiting-handshake`).
3. `isAgentResponseMessage` → response path. **Check `type` before `requestUuid`** — a
   `raiseIntentResultResponse` shares the `requestUuid` of the `raiseIntentRequest` and must not be
   swallowed as a duplicate phase-1 response. *This is the highest-probability bug in the server.*
4. Not a request → drop + WARN.
5. Rebuild `meta` from scratch (never spread the agent's `meta`): fresh `timestamp`,
   `source: { ...message.meta.source, desktopAgent: <session name> }`, `destination` only if present.
   Rebuilding is what guarantees the `meta.source.desktopAgent` invariant and prevents an agent
   leaking a stale `responseUuid` onto a forwarded request. **Never trust an agent-supplied
   `source.desktopAgent`** — always overwrite from the socket, or agents can impersonate each other.
6. `fanout` → update `channelsState` if the route says so, send to every agent **except** the
   originator, return (no response type exists).
7. `request` → recipients = targeted agent, or all-except-originator; open a pending entry (and, for
   `raiseIntentRequest`, a phase-2 relay entry **at forward time**); forward.

### Collation

Stamping happens **per-part, before merging** — merging first would make apps from different agents
indistinguishable. All six stamps are load-bearing, not cosmetic: `AppDirectory` merges local+remote
by concatenation with no dedupe, relying on "remote entries carry `desktopAgent`, local ones don't",
and an unstamped returned identifier makes the originating agent try to resolve a remote app locally.

| response | merged field | rule |
|---|---|---|
| `findIntentResponse` | `appIntent` | `{ intent, apps: flatMap(stamped) }`; stamp `apps[].desktopAgent` |
| `findIntentsByContextResponse` | `appIntents` | merge by `intent.name` (case-sensitive, first `IntentMetadata` wins, DEBUG-log conflicts); stamp `appIntents[].apps[].desktopAgent` |
| `findInstancesResponse` | `appIdentifiers` | flatMap; stamp each |
| `getAppMetadataResponse` | `appMetadata` | `parts[0]`; stamp `.desktopAgent` |
| `openResponse` | `appIdentifier` | `parts[0]`; stamp `.desktopAgent` |
| `raiseIntentResponse` | `intentResolution` | `parts[0]`; stamp `.source.desktopAgent` |
| `raiseIntentResultResponse` | `intentResult` | relayed, not collated; **no stamp** (`IntentResult` has no `desktopAgent` field) |

Iterate in **recipient-enumeration order, not response-arrival order** — this makes collated output
deterministic given a fixed roster, so specs assert exact arrays instead of sorting.

`meta.sources` / `errorSources` / `errorDetails` are built from one
`Map<agentName, {ok} | {err}>` so the parallel arrays cannot drift. **Omit the keys entirely when
empty** rather than emitting `[]`.

Emit `BridgeErrorResponseMessage` iff `recipients.length > 0 && successes.length === 0` — *not*
simply "all errored", because the zero-recipient case must not error. `payload.error` = the single
distinct error if they agree, else the first non-timeout entry, else `'ResponseToBridgeTimedOut'`.

### Timeouts

`'ResponseToBridgeTimedOut'` (not `'ApiTimeout'`) is the right `errorDetails` value for a
non-responding agent — it is a member of all three relevant unions, and the bridge cannot know
whether the underlying FDC3 call timed out.

| family | default | why |
|---|---|---|
| the four discovery families | 5000 ms | target work is in-memory `directory.getLocal*`; headroom for a cold app-directory fetch |
| `openRequest`, `raiseIntentRequest` phase 1 | 12000 ms | target launches an app and awaits a listener; the bridge timeout is the only bound |
| `raiseIntentResultResponse` relay TTL | 290000 ms | just under the client's 300000 ms, so the *bridge* produces the error with a meaningful code |
| handshake (`hello` → `handshake`) | 10000 ms | required; see edge cases |

A `RESPONSE_HEADROOM_MS = 3000` constant plus a construction-time assertion that every request
timeout is `<= clientResponseTimeoutMs - headroom` turns a misconfiguration into a startup failure
instead of a mysterious client-side `ApiTimeout`.

**One required client-side change** (`projects/fdc3-web/src/agent/desktop-agent.ts:713`):
`raiseIntentFromRemote` calls `awaitIntentListener(app, intent)` without a timeout, so it uses the
**15000 ms** default — equal to the entire budget the bridge has to answer the originator. No
bridge-side phase-1 timeout can be correct while that holds. Pass a shorter timeout (10000 ms) so a
slow target returns a meaningful `IntentDeliveryFailed` *before* the bridge's 12000 ms cutoff. The
ordering constraint (`target listener timeout < bridge phase-1 timeout < originator response
timeout − headroom`) is not derivable from either side alone and gets documented in the server README.

Out of scope but worth knowing: `passContextToOpenedApp` (`desktop-agent.ts:1392`) awaits a context
listener with **no timeout at all** (there is an existing `//TODO`). The bridge's 12 s `open` timeout
is currently the only bound on a bridged `open` with context. Not fixed here.

### Edge cases

| case | behaviour |
|---|---|
| zero other agents, collate-able request | **empty success response** (`apps: []`), no error — `collate` is total over `parts === []`, so there is no separate branch. Erroring would warn on every `findIntent` in the common single-agent topology. |
| targeted request, destination not connected | immediate `BridgeErrorResponse`, `'DesktopAgentNotFound'`, `errorSources: [{desktopAgent: <requested>}]`. No pending entry, no timer. |
| agent responds twice | first wins, structurally: `if (!outstanding.delete(name)) return`. DEBUG, not WARN — the usual cause is the bridge already timed it out. |
| responder disconnects | record `'AgentDisconnected'` and settle **immediately** rather than waiting out the timer (mirrors the client's own correlator). |
| originator disconnects | discard the collation silently; revalidate the originator is still registered immediately before sending. If it was the *target* of a live relay entry, send an error-shaped `raiseIntentResultResponse` (`'AgentDisconnected'`) so the originating app doesn't wait out 300 s. |
| unknown `requestUuid` | silent DEBUG no-op, never respond. Four legitimate causes, including responses to a request whose originator has gone — so this must not be a WARN. |
| request before handshake | drop + WARN, **keep the socket open**. The message is unactionable (no name to stamp). Do *not* send `authenticationFailed` (the client would `reset()` past this port) and do *not* close (the client would tight-loop the port scan — the ≥5 s pause only applies after a full range sweep). |
| no handshake within 10 s of `hello` | close the socket. Required: the client's per-port budget is 750 ms, so a client whose timer expires as `hello` lands abandons the socket without handshaking or always closing cleanly. |
| second handshake on a connected socket | ignore + WARN — re-assigning a name mid-flight corrupts every outstanding correlation. |
| duplicate `requestedName` | deterministic `name`, `name-1`, `name-2`… (first free integer). Deterministic so specs can assert it. Trim/reject empty, cap length, treat as opaque. |
| `raiseIntentResultResponse` after phase 1 errored | drop at DEBUG. The client already killed the late listener when the error-shaped response arrived, so relaying is pointless. Delete the relay entry the instant phase 1 settles as an error. |
| unparseable JSON / missing `meta` / unknown `type` | drop + WARN; cannot respond (no `requestUuid`). Count consecutive parse failures per socket, close after ~10. |
| known type, valid uuid, fails shape check | **respond** with the family's error response, `'MalformedMessage'` (or `'MalformedContext'` where the failure is about `payload.context`). The only malformed case where responding is possible. |

Payload validation stays **shallow** — `payload` is an object and the family's required top-level
fields exist. Do not deep-validate `Context`: the destination agent is the authority and
`BridgeInboundRouter` already returns `'MalformedContext'` itself. Two implementations would diverge.

### channelsState

Store `Map<channelId, Map<context.type, {context, seq}>>` with a monotonic `seq`, so
"one Context per type per channel" is guaranteed by the Map key and "most recent first" by sorting on
`seq` descending — neither can be violated by a caller. `Context` carries no timestamp, so the bridge's
observation order is the *only* global ordering authority; the `seq` counter is that assertion.

- Updated from **every** `broadcastRequest` (before fan-out, regardless of recipient count — else a
  single-agent bridge accumulates nothing and the second joiner gets empty state). Never from
  `PrivateChannel.broadcast`.
- Merged from each handshake **oldest-first** (reverse the incoming array, which is most-recent-first)
  so its internal order is preserved. **Existing federation state wins** for a known
  `(channelId, type)`: the bridge's entry was derived from an observed broadcast and is what every
  connected agent already holds, whereas a joiner's may be arbitrarily stale. Unknown types are added
  as the oldest entries — a strict improvement with no displacement.

Send **two** messages on join: to the joiner, `{allAgents: <full roster>, addAgent: <name>,
channelsState: <merged>}` with `meta.requestUuid` = **the joiner's handshake requestUuid**; to
everyone else, the same minus `channelsState` and with a fresh `responseUuid`. Merge the joiner's
state in *before* building, so it gets its own state back plus the federation's. On departure, one
broadcast with `{allAgents: <remaining>, removeAgent}` and a **freshly generated** `requestUuid` —
never reuse a stored handshake uuid, or one refactor away an agent silently re-adopts a name.

Two independent auth concerns, which the PoC conflates by hardcoding `authRequired: false`:
`hello.payload.authRequired` + validating `handshake.payload.authToken` (agent → bridge), and
`hello.payload.authToken` (bridge → agent, checked by the client's `validateBridgeAuthToken`).
Separate config keys, separate paths.

### Transport seam

The client's `IBridgeTransport` is a single-connection *client* abstraction and doesn't transpose.
Two levels instead, with **serialization inside the transport** (as `WebSocketBridgeTransport` already
does) so the router only ever sees objects with a revived `Date`:

```ts
interface IAgentConnection {
    readonly id: string;                                       // lets the registry hold a pre-handshake socket
    send(message: unknown): void;
    subscribe(cb: (message: unknown) => void): Subscription;
    onClose(cb: () => void): Subscription;
    close(code?: number, reason?: string): void;
}
interface IServerTransport {
    listen(): Promise<{ port: number }>;
    onConnection(cb: (connection: IAgentConnection) => void): Subscription;
    close(): Promise<void>;
}
```

`FakeServerTransport` exposes `simulateConnection()`, and each fake connection gives `receive(obj)`,
`sent`, `sentWire(i)` (round-tripped through serialize+parse, copying
`bridge-transport.fake.ts:69` — this is what makes "the real client would accept this" assertable)
and `simulateClose()`.

---

## Files

```
projects/bridging-server/
  .eslintrc.mjs  index.ts  package.json  project.json  README.md
  tsconfig.lib.json  tsconfig.spec.json  vitest.config.ts
  src/
    index.ts                     barrel (BridgingServer, contracts, constants)
    contracts.ts                 IServerTransport, IAgentConnection, Subscription, BridgingServerOptions
    constants.ts                 DEFAULT_PORT 4475, timeouts, VERSION, DEFAULT_AGENT_NAME
    logger.ts                    level-filtered, stdout/stderr
    message.serialization.ts     serialize + meta.timestamp revival (duplicated deliberately)
    type-predicate.helper.ts     isHandshake / isAgentRequestMessage / isAgentResponseMessage / isAgentErrorResponse
    message.factory.ts           hello, authenticationFailed, connectedAgentsUpdate, BridgeRequest/Response/ErrorResponse
    agent-session.ts             per-socket state machine
    agent-registry.ts            name allocation, name<->session maps, roster snapshot
    channels-state.ts            merged user/app channel state
    connection-handshake.ts      hello -> handshake -> auth -> register -> broadcast; handshake timeout
    routing/
      request-routes.ts          the exhaustive mapped-type table
      collate.ts                 pure merge + stamp (stamping folded in, not its own file)
      pending-requests.ts        outstanding-responder sets + phase-1 timers (no merging)
      intent-result-relay.ts     phase-2 table + TTL (separate: 5-min lifetime vs 12-s)
      message-router.ts          classify -> forward -> settle
    bridging-server.ts           composition root; start() / close()
    websocket-server-transport.ts  the only file importing 'ws'
    server-transport.fake.ts
    cli-options.ts               argv/env parsing, pure
    main.ts                      3 lines; coverage-excluded
    interop.spec.ts              real client <-> real server
```

Each `src/**/*.ts` gets a co-located `*.spec.ts` (repo convention), Apache header, `.js` relative
import extensions.

### Repo touchpoints

- **`package.json` (new)** — `@morgan-stanley/fdc3-web-bridging-server`, version `0.17.0` to match
  the others, `dependencies: { ws }`, `peerDependencies: { @finos/fdc3 }`, a `bin` entry
  (`fdc3-web-bridging-server` → `main.js`), `engines.node`.
- **`project.json` (new)** — mirrors `messaging-provider` (`build`: `@nx/js:tsc`; `generate-docs`;
  `type-check-specs`; `build:release: {}`). `generate-docs` and `type-check-specs` are **required**,
  not optional: `nx.json` `targetDefaults["build:release"]` depends on both, so omitting them breaks
  CI. Plus a `serve` target (`@nx/js:node` + an `@nx/esbuild:esbuild` `build-node`, following
  `test-harness`).
- **`vitest.config.ts` (new)** — spreads `shared/vitest.config.ts` then overrides
  `environment: 'node'` (the shared config is `jsdom`) and adds `**/main.ts` to the coverage
  `exclude` (contained here rather than editing the shared config).
- **Root `package.json`** — add `ws` and `@types/ws` to devDependencies. `ws` is currently present in
  `node_modules` only as a transitive dev dep of jsdom and is undeclared; `@types/ws` is absent
  entirely.
- **Root `tsconfig.json`** — add the `@morgan-stanley/fdc3-web-bridging-server` → `dist/...` path.
- **`nx.json`** — add `projects/bridging-server/` to `release.version.manifestRootsToUpdate`.
- **`.github/workflows/create-release.yml`** — add the fourth `cd dist/<project> && npm publish` step.
- **`projects/fdc3-web/src/agent/desktop-agent.ts:713`** — pass a 10000 ms timeout to
  `awaitIntentListener` (see Timeouts).
- **`projects/test-harness/src/root-app/root-app.ts`** — a `?bridge=true` URL param, following the
  existing `openInWindowDefault` convention in `settings-panel.ts:36`: a module-level
  `getBridgeParams(): BridgeParams | undefined` returning `undefined` unless the param is `'true'`,
  spread into the `createRoot` call as `...(bridge != null ? { bridge } : {})` so the no-param path
  is byte-identical to today. Both windows request the same name
  (`test-harness-root-app`), so the server's collision suffixing is exercised for free.
- **READMEs** — new `projects/bridging-server/README.md` (running it, options, the timeout ordering
  constraint); a line in the root `README.md` project list and in `projects/test-harness/README.md`
  for the `?bridge=true` param.

The test-harness `serve` target is deliberately **not** changed to also launch the bridge — the user
asked only for the URL param, and `nx serve bridging-server` in a second terminal keeps the coupling
out. Without the server running the client simply port-scans harmlessly.

### PoC bugs not inherited

Top-level `desktopAgent` instead of `meta.source.desktopAgent` (fatal); `meta.sources` listing all
agents regardless of who answered; no `errorSources`/`errorDetails` at all; `Math.random()` name
suffixing; `intent` metadata rebuilt as `{name}`, discarding `displayName`;
`newAgentName` captured in the connection closure so response dispatch only ever matched that
socket's own name; no timeouts on anything but findIntent; `Promise.all` over serial awaits.

---

## Verification

1. `npx nx test bridging-server` — unit specs. Coverage thresholds are **85% on all four metrics,
   enforced on every run**, so this is a gate, not a report. The bulk comes from a table-driven grid:
   6 request families × {all-success, partial-error, all-error, all-timeout, zero-recipients,
   unknown-destination} plus 7 fanout families × {reaches others, never echoes originator}, driven
   through `bridging-server.ts` with `FakeServerTransport` and a 3-agent roster and `vi.useFakeTimers()`.
   `collate.ts`, `channels-state.ts`, `message.factory.ts`, the predicates, the serialization,
   `agent-registry.ts` and `cli-options.ts` are pure and tested directly.
2. `websocket-server-transport.spec.ts` uses an injected `WebSocketServerFactory` for unit tests
   **plus** 3–4 real-socket tests against a real `WebSocketServer` on port 0 with a real `ws` client.
   This is the one place a mock would hide a real bug — e.g. binding `0.0.0.0` instead of
   `127.0.0.1`, or a `Buffer` frame sailing past `parseBridgeMessage`, which early-returns
   non-strings unchanged.
3. `src/interop.spec.ts` — the compatibility proof. Needs a `// @vitest-environment jsdom` docblock
   (the client's `createRoot` needs a DOM) and an in-memory loopback presenting `IBridgeTransport` to
   the client and `IAgentConnection` to the server, **serializing and parsing in both directions** so
   timestamp revival is genuinely exercised. Two real agents built via
   `new DesktopAgentFactory().createRoot({ rootAppId, appDirectoryEntries: [<LocalAppDirectory>], bridge: { transportFactory } })`
   — local directories, so no HTTP. Assertions: both handshake and get distinct names; each sees the
   other in `allAgents`; `findIntent`/`findIntentsByContext`/`findInstances`/`getAppMetadata` from A
   return B's apps stamped with `desktopAgent: <B>`; a `broadcast` on a user channel from A is
   observable via B's channel context; and `raiseIntent` from A at an app hosted by B resolves and
   delivers the phase-2 result. If driving a real cross-agent intent handler in-process proves
   impractical, the phase-2 relay stays covered by the router unit tests and the interop spec keeps
   the rest.
4. `npx nx run bridging-server:type-check-specs`, `npm run lint`.
5. **Whole-repo regression** (the fdc3-web edit at `desktop-agent.ts:713` and the test-harness edit
   both need this): `npm run test` and `npm run build` at the repo root, not just the new project.
6. **Manual end-to-end**: `nx serve bridging-server` in one terminal, `npm start` in another, then
   open `http://localhost:4200/index.html?bridge=true` in two browser windows. Expect the server log
   to show two agents joining with distinct names, and a `findIntent` in one window to surface the
   other window's apps. Also confirm that opening **without** `?bridge=true` produces zero bridge
   traffic.

## Sequencing

1. **Scaffolding + primitives** — project configs, `contracts.ts`, `constants.ts`, `logger.ts`,
   `message.serialization.ts`, `type-predicate.helper.ts`, `message.factory.ts`. All pure, all
   independently testable.
2. **Connection lifecycle** — `agent-session.ts`, `agent-registry.ts`, `channels-state.ts`,
   `connection-handshake.ts`, `server-transport.fake.ts`. At this point a client can connect,
   handshake and be named, with no routing.
3. **Routing** — `request-routes.ts`, `collate.ts`, `pending-requests.ts`,
   `intent-result-relay.ts`, `message-router.ts`, `bridging-server.ts`. The bulk of the test grid.
4. **Real transport + entry point** — `websocket-server-transport.ts`, `cli-options.ts`, `main.ts`,
   `serve` target.
5. **Integration** — the `desktop-agent.ts:713` timeout change, `interop.spec.ts`, the test-harness
   `?bridge=true` param, READMEs, and the release/CI touchpoints.

Steps 1–3 are provable with no sockets and no browser; step 5 is what makes the feature real.
