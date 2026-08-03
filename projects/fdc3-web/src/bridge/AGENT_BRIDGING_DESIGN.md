# FDC3 Desktop Agent Bridging

## Context

This repo (`fdc3-web`) implements the FDC3 Desktop Agent spec but has never implemented
[Desktop Agent Bridging](https://fdc3.finos.org/docs/agent-bridging/spec) — the optional protocol
that lets a Desktop Agent connect over a WebSocket to a "Desktop Agent Bridge" process so its apps
can discover, raise intents on, open, and share context/channels with apps hosted by *other*
Desktop Agents running on the same machine. `@finos/fdc3` 2.2.3 (already installed) re-exports the
full `BridgingTypes` schema, so no type-duplication (the `fdc3-next/` pattern used for FDC3 3.0
staging) is needed — only the runtime implementation is missing.

A prior hackathon proof-of-concept
(`/home/coder/jspe/js-platform/hackathon/projects/fdc3-web/src/bridge/agent-bridge.proxy.ts`)
implements roughly 20% of one message flow (`findIntent`) and is useful purely as a style/roadmap
reference — it has known correctness bugs (retry-delay flooring inverted, listeners leak, no
timeouts, handshake `addAgent` misattribution bug) that this plan fixes rather than inherits.

Goal: implement **all** bridging message flows (13 request types / 7 response types, both
directions) as an **opt-in** feature — a root agent with no `bridge` factory param behaves exactly
as today, byte-for-byte, with zero new network activity. Verification is via vitest unit tests with
an injectable fake transport (no real bridge server).

---

## Architecture summary

```
projects/fdc3-web/src/
  contracts.ts              + BridgeParams, IBridgeTransport, BridgeTransportFactory (public, consumer-facing)
  contracts.internal.ts     + RemoteAppIdentifier, IRemoteAppSource, IChannelBridge, IDesktopAgentBridge
  constants.ts               + BRIDGE.{DEFAULT_PORT_RANGE, CONNECTION_TIMEOUT_MS, REQUEST_TIMEOUT_MS, RECONNECT_DELAY_MS}
  helpers/
    app-identity.helper.ts   + isRemoteAppIdentifier
    bridging-type-predicate.helper.ts   (new) all BridgingTypes predicates
    app-directory-applications.helper.ts  getImplementationMetadata gains optionalFeatures override param
  app-directory/directory.ts        local/merged split + remote discovery merge (§2)
  channel/channel-message-handler.ts  channel-state sync + broadcast/private-channel forwarding (§3)
  agent/desktop-agent.ts             outbound delegation + inbound raiseIntent serving (§4)
  agent/desktop-agent.factory.ts     constructs & wires the bridge (§6)
  messaging/root-message-publisher.ts  WCP5 getInfo() parity fix (§4.5)
  bridge/                            (new folder) — the bridge client itself (§5)
```

**Dependency direction (important, keeps this testable):** `app-directory/`, `channel/`, `agent/`,
`messaging/` depend only on the three interfaces in `contracts.internal.ts` — they never import
`bridge/`. `bridge/` is the one module allowed to import concrete `agent/` types
(`DesktopAgentImpl`, `ChannelMessageHandler`), because it is wired up last, in the factory. This
mirrors the existing `IRootPublisher` boundary pattern and means every seam outside `bridge/` is
unit-testable with a small `ts-mocking-bird` mock of `IDesktopAgentBridge`, and `bridge/` itself is
unit-testable by constructing a real `DesktopAgentImpl` (as `desktop-agent.spec.ts` already does).

**The opt-in invariant is structural, not defensive.** Every new branch is gated on an
optional collaborator being non-null (`this.bridge`, `directory.remoteAppSource`,
`channelMessageHandler.bridge`). With no `bridge` param on `RootDesktopAgentFactoryParams`, nothing
is ever assigned, so every new branch is unreachable — existing behaviour is unchanged and the
~1000 existing tests need no modification (only additive `describe('bridging')` blocks).

---

## 1. Public contracts

### `contracts.ts`

```ts
export type BridgeConnectionState = 'disconnected' | 'connecting' | 'connected';
export type Subscription = { unsubscribe: () => void };

/** Moves JSON payloads only; never interprets them. Mirrors IRootMessagingProvider's role. */
export interface IBridgeTransport {
    readonly state: BridgeConnectionState;
    connect(): void;
    send(message: unknown): void;
    subscribe(callback: (message: unknown) => void): Subscription;
    onStateChange(callback: (state: BridgeConnectionState) => void): Subscription;
    /** Bridge rejected us (auth). Drop this socket but keep scanning. */
    reset(): void;
    /** Permanent teardown: closes the socket, clears all timers, stops retrying. */
    close(): void;
}

export type BridgeTransportFactory = () => Promise<IBridgeTransport>;

export type BridgeParams = {
    /** Defaults to rootAppId. */
    requestedName?: string;
    portRange?: [number, number];
    /** Substitutes the transport — this is how unit tests avoid real WebSockets. */
    transportFactory?: BridgeTransportFactory;
    authToken?: string;
    validateBridgeAuthToken?: (authToken: string | undefined) => boolean | Promise<boolean>;
    responseTimeoutMs?: number;
    intentResultTimeoutMs?: number;
    reconnectDelayMs?: number;
};
```

Add `bridge?: BridgeParams;` to `RootDesktopAgentFactoryParams` (after `logLevels`). Add to
`constants.ts`:

```ts
export const BRIDGE = {
    DEFAULT_HOST: '127.0.0.1',
    DEFAULT_PORT_RANGE: [4475, 4575] as [number, number],
    RETRY_PAUSE_MS: 5000,          // spec: pause >=5s after exhausting the port range
    PORT_CONNECT_TIMEOUT_MS: 750,
    RESPONSE_TIMEOUT_MS: 15000,    // aligned with the existing intent-listener timeout
    INTENT_RESULT_TIMEOUT_MS: 300000,
} as const;
```

### `contracts.internal.ts`

Three interfaces, implemented by one class in `bridge/`, consumed narrowly by each collaborator:

```ts
export type RemoteAppIdentifier = AppIdentifier & { desktopAgent: string };

/** Read-only remote app discovery. Every method resolves — never rejects, never hangs past the
 *  configured timeout — so callers can degrade to local-only results unconditionally. */
export interface IRemoteAppSource {
    readonly agentName: string | undefined;
    findIntent(intent: Intent, context?: Context, resultType?: string): Promise<AppMetadata[]>;
    findIntentsByContext(context: Context, resultType?: string): Promise<AppIntent[]>;
    findInstances(app: AppIdentifier): Promise<AppMetadata[]>;
    getAppMetadata(app: AppIdentifier): Promise<AppMetadata | undefined>;
}

/** Fire-and-forget channel forwarding. Must not throw/reject — local fan-out must never depend on
 *  the bridge being up. */
export interface IChannelBridge {
    readonly agentName: string | undefined;
    broadcast(channelId: string, context: Context, source: FullyQualifiedAppIdentifier): void;
    privateChannelBroadcast(channelId: string, context: Context, source: FullyQualifiedAppIdentifier, desktopAgents: string[]): void;
    privateChannelOnAddContextListener(channelId: string, contextType: string | null, source: FullyQualifiedAppIdentifier, desktopAgents: string[]): void;
    privateChannelOnUnsubscribe(channelId: string, contextType: string | null, source: FullyQualifiedAppIdentifier, desktopAgents: string[]): void;
    privateChannelOnDisconnect(channelId: string, source: FullyQualifiedAppIdentifier, desktopAgents: string[]): void;
    privateChannelEventListenerAdded(channelId: string, listenerType: PrivateChannelEventTypes | null, source: FullyQualifiedAppIdentifier, desktopAgents: string[]): void;
    privateChannelEventListenerRemoved(channelId: string, listenerType: PrivateChannelEventTypes | null, source: FullyQualifiedAppIdentifier, desktopAgents: string[]): void;
}

export interface IDesktopAgentBridge extends IRemoteAppSource, IChannelBridge {
    raiseIntent(params: { intent: Intent; context: Context; app: RemoteAppIdentifier; source: FullyQualifiedAppIdentifier })
        : Promise<{ intentResolution: BrowserTypes.IntentResolution; result: Promise<BrowserTypes.IntentResult> }>;
    open(params: { app: RemoteAppIdentifier; context?: Context; source: FullyQualifiedAppIdentifier }): Promise<AppIdentifier>;
    /** Delivers the result a local app produced for a raiseIntent that arrived from the bridge. */
    publishIntentResult(requestUuid: string, originatingApp: RemoteAppIdentifier, intentResult: BrowserTypes.IntentResult): void;
}
```

`helpers/app-identity.helper.ts` gains:

```ts
export function isRemoteAppIdentifier(app: AppIdentifier | undefined, localAgentName: string | undefined): app is RemoteAppIdentifier {
    return app?.desktopAgent != null && app.desktopAgent !== localAgentName;
}
```

---

## 2. `AppDirectory` — remote discovery merge

**Local/merged split** (mechanical rename + thin wrapper, needed both so inbound requests get a
local-only path and so internal callers don't fan out to the bridge N times):

| existing public method | renamed to (local-only) | new merged wrapper (same name/signature as before) |
|---|---|---|
| `getAppIntent` | `getLocalAppIntent` | `getAppIntent` |
| `getAppIntentsForContext` | `getLocalAppIntentsForContext` | `getAppIntentsForContext` |
| `getAppInstances` | `getLocalAppInstances` | `getAppInstances` (gains optional `desktopAgent` param) |
| `getAppMetadata` | `getLocalAppMetadata` | `getAppMetadata` |

All **internal** callers (`getAppsForIntent`, `getInstancesForIntent`, the loop inside
`getAppIntentsForContext`) must be repointed to the `getLocal*` variants — otherwise the local scan
itself would fan out to the bridge per candidate app.

New field, assigned post-construction by `DesktopAgentImpl.connectBridge` (mirrors how
`rootMessagePublisher.requestMessageHandler` is assigned after construction today):

```ts
public remoteAppSource?: IRemoteAppSource;

private async fromRemote<T>(fallback: T, lookup: (source: IRemoteAppSource) => Promise<T>): Promise<T> {
    if (this.remoteAppSource == null) return fallback;
    return lookup(this.remoteAppSource).catch(err => { this.log('Remote app lookup failed', LogLevel.WARN, err); return fallback; });
}
```

Merge points (local-first, no dedupe needed — remote entries always carry `desktopAgent`, local
ones never do, so identifiers can't collide):

```ts
public async getAppIntent(intent, context?, resultType?): Promise<AppIntent> {
    const local = await this.getLocalAppIntent(intent, context, resultType);
    const remote = await this.fromRemote([], s => s.findIntent(intent, context, resultType));
    return { ...local, apps: [...local.apps, ...remote] };
}
// getAppIntentsForContext: merge arrays by intent.name (mergeAppIntents helper) — a remote-only
//   intent must still appear, since getIntentsForContext only scans the local directory.
// getAppInstances(appId, desktopAgent?): concat local + remote; undefined only when both empty.
// getAppMetadata(app): if isRemoteAppIdentifier(app, remoteAppSource?.agentName) → remote only;
//   else local, falling back to remote only on a local miss.
```

**`getValidatedAppIdentifier`** currently rejects anything not in the local directory
(`ResolveError.TargetAppUnavailable`). Add an early-out immediately after identifier resolution: if
`isRemoteAppIdentifier(appIdentifier, this.remoteAppSource?.agentName)` and the appId is a
`FullyQualifiedAppId`, return it as-is (the hosting agent validates it, not us). `getKnownFullyQualifiedAppId`
itself is **not** touched — it's a pure local-directory index used by `removeDisconnectedApp` etc.,
and must stay local-only.

**`resolveAppForIntent`**: add an early-out between the string-reject and the
`isFullyQualifiedAppIdentifier` branch — a remote-targeted app skips the resolver UI and is returned
as-is (the destination agent resolves and launches it). `resolveAppForContext` needs no such
early-out (there is no bridging `raiseIntentForContext` message — the intent is always chosen
locally from the merged `appIntents`; only the resulting `raiseIntent` may cross the bridge).

---

## 3. `ChannelMessageHandler` — channel state + broadcast/private-channel forwarding

New field on the existing `PrivateChannelInfo` type: `sharedWithAgents: string[]` (initialised `[]`
in `onCreatePrivateChannelRequest`) — the record of which remote agents a given private channel has
been shared with. **Purely local private channels generate zero bridge traffic**; user/app channels
are always forwarded (bridging broadcasts them to all agents, untargeted).

```ts
public bridge?: IChannelBridge;   // assigned by DesktopAgentImpl.connectBridge

/** Handshake step 3 payload / resync source. User + app channels only, never private. */
public getChannelsState(): { [channelId: string]: Context[] } { /* mostRecent first per type */ }

/** Adopts ConnectionStep6's merged channelsState. Merges into existing history (doesn't replace),
 *  applied oldest-first so state[0] ends up as mostRecent. No broadcastEvents are replayed. */
public applyChannelsState(state: { [channelId: string]: Context[] }): void { /* ... */ }

/** Marks a private channel as shared with a remote agent — called when a raiseIntent result (in
 *  either direction) hands over a PrivateChannel. Adopts the channel if not yet known locally. */
public markPrivateChannelShared(channel: BrowserTypes.Channel, desktopAgent: string): void { /* ... */ }
```

**Outbound forwarding**: give the four shared event publishers (`publishBroadcastEvent`,
`publishPrivateChannelOnAddContextListenerEvent`, `publishPrivateChannelOnUnsubscribeEvent`,
`publishPrivateChannelOnDisconnectEvent`) a final `forwardToBridge: boolean` param, `true` from the
local-request handlers, `false` from every `applyRemote*`/replay call site. Hooking the *publishers*
rather than only the request handlers matters because `publishPrivateChannelOnUnsubscribeEvent` is
also called from `cleanupDisconnectedProxy` — missing that would mean a remote peer never learns a
local app on a shared private channel disconnected. Two handlers with no existing publisher to
piggyback on (`onPrivateChannelAddEventListenerRequest`/`onPrivateChannelUnsubscribeEventListenerRequest`)
get a direct call to `bridge?.privateChannelEventListenerAdded/Removed(...)` when
`sharedWithAgents` is non-empty.

**Inbound apply methods** (called by `bridge/`'s inbound router, never forward back out):

```ts
public applyRemoteBroadcast(channelId: string, context: Context, source: AppIdentifier): void {
    this.publishBroadcastEvent(channelId, context, source, false);
    this.addContextToChannelHistory(channelId, context);
}
public applyRemotePrivateChannelOnAddContextListener(channelId, contextType, desktopAgent): void
public applyRemotePrivateChannelOnUnsubscribe(channelId, contextType, desktopAgent): void
public applyRemotePrivateChannelOnDisconnect(channelId, desktopAgent): void
public applyRemotePrivateChannelEventListenerAdded(channelId, listenerType, desktopAgent): void   // no local fan-out, updates sharedWithAgents only
public applyRemotePrivateChannelEventListenerRemoved(channelId, listenerType, desktopAgent): void // same
```

One method (`applyRemoteBroadcast`) serves both the `broadcastRequest` and
`privateChannelBroadcastRequest` bridging messages, since `publishBroadcastEvent`/
`addContextToChannelHistory` already dispatch across user/app/private by channelId — no allowed-list
check on the private-channel path (authorisation was established when the channel was shared).

**Remote agent disconnect** (fired when `ConnectionStep6ConnectedAgentsUpdate.removeAgent` arrives):

```ts
public cleanupDisconnectedAgent(desktopAgent: string): void {
    // for every private channel shared with this agent: drop it from sharedWithAgents and
    // publish a privateChannelOnDisconnectEvent to local listeners (forwardToBridge: false).
    // Unlike cleanupDisconnectedProxy, user/app channel context HISTORY IS NOT purged (the
    // bridge's merged state remains authoritative), and there is no currentUserChannels/
    // contextListeners cleanup (no remote entries exist in those maps in this design).
}
```

---

## 4. `DesktopAgentImpl` — outbound delegation + inbound serving

### 4.1 Wiring

```ts
private bridge: IDesktopAgentBridge | undefined;
public readonly channelMessageHandler: ChannelMessageHandler;   // was private — bridge/ reads/writes it

public connectBridge(bridge: IDesktopAgentBridge): void {
    this.bridge = bridge;
    this.directory.remoteAppSource = bridge;
    this.channelMessageHandler.bridge = bridge;
}

private isRemoteApp(app?: AppIdentifier): app is RemoteAppIdentifier {
    return this.bridge != null && isRemoteAppIdentifier(app, this.bridge.agentName);
}
```

### 4.2 Outbound: `onRaiseIntentRequest` / `onRaiseIntentForContext` / `onOpenRequest`

Each gains one branch, placed **after** app resolution but **before** any local
open/select/awaitIntentListener side effect (so a remote target never burns the 15s local
intent-listener timeout or triggers `returnOrLaunchAppInstance`):

```ts
// inside onRaiseIntentRequest, right after `appIdentifier` is resolved and non-null:
if (this.isRemoteApp(appIdentifier)) {
    return this.delegateRaiseIntent(requestMessage, requestMessage.payload.intent, appIdentifier, source);
}

// inside onRaiseIntentForContext, right after the resolutionResponse null-check:
if (this.isRemoteApp(resolutionResponse.app)) {
    return this.delegateRaiseIntent(requestMessage, resolutionResponse.intent, resolutionResponse.app, source);
}

// inside onOpenRequest, right after the malformed-context check, before getAppDirectoryApplication:
if (this.isRemoteApp(requestMessage.payload.app)) {
    return this.delegateOpen(requestMessage, requestMessage.payload.app, source);
}
```

`delegateRaiseIntent` calls `this.bridge.raiseIntent(...)`, publishes the immediate
`raiseIntentResponse`/`raiseIntentForContextResponse` with the bridge's `intentResolution` (falling
back to `ResolveError.IntentDeliveryFailed`/whatever `FindInstancesErrors` value the bridge threw),
then attaches `.then(...)` to the returned `result` promise to publish a later
`raiseIntentResultResponse` to the *same* originating `source`/`requestUuid` — this reuses the
existing `createResponseMessage`/`publishResponseMessage` pair with **no new correlation state**,
because the originating app and requestUuid are already captured in the closure (unlike the
same-agent path, there's no need for the `generateUUUrl`/`decodeUUUrl` encoding here). If the
result carries a `channel`, call `channelMessageHandler.markPrivateChannelShared(channel,
app.desktopAgent)` first.

`delegateOpen` calls `this.bridge.open(...)` and publishes `openResponse` with the returned
identifier or a mapped `OpenError`. It deliberately **skips** `passContextToOpenedApp` — the
context was sent to the bridge in the request payload, and the *remote* agent is responsible for
delivering it to the app it opened; calling it here would hang forever waiting for a context
listener that will never register locally.

### 4.3 Inbound: what's actually needed

Four of the seven inbound message families need **zero new code** on `DesktopAgentImpl` — the
bridge's inbound router (in `bridge/`) calls `agent.directory.getLocal*` directly (these are
already public from the §2 split). `open` is served by the **existing public** `agent.open(app,
context)` (it loops back through `onOpenRequest`, and the target is local by construction so the
remote branch above is never taken). Only `raiseIntent` needs a new method, because the existing
public `raiseIntent()` (a) returns a live `PrivateChannel` proxy bound to the *root* app rather than
the wire `IntentResult` shape the bridge needs to relay, and (b) attributes the request to the root
app instead of the real remote originator (visible to the target's intent handler via
`IntentMetadata.source`).

```ts
/** Raises an intent on a local app on behalf of a remote agent. The target app is always fully
 *  specified by the bridging schema (AppDestinationIdentifier.desktopAgent is required), so no
 *  resolver runs and no re-fan-out to the bridge is possible. */
public async raiseIntentFromRemote(params: {
    requestUuid: string; intent: Intent; context: Context; app: AppIdentifier; originatingApp: RemoteAppIdentifier;
}): Promise<BrowserTypes.IntentResolution> {
    const app = await this.returnOrLaunchAppInstance(params.app, params.context);
    await this.awaitIntentListener(app, params.intent);
    this.rootMessagePublisher.publishEvent(
        createEvent<BrowserTypes.IntentEvent>('intentEvent', {
            intent: params.intent,
            context: params.context,
            raiseIntentRequestUuid: generateUUUrl(params.originatingApp, params.requestUuid),
            originatingApp: params.originatingApp,
        }),
        [app],
    );
    return { intent: params.intent, source: app };
}
```

Reusing `generateUUUrl`/`decodeUUUrl` here (rather than inventing new state) is deliberate: the
local app's eventual result arrives through the ordinary `intentResultRequest` path, which has no
other correlation mechanism — this is exactly the problem UUUrl already solves for the same-agent
case. The one addition is in `onIntentResultRequest`, inserted right after `decodeUUUrl` and
**before** the existing `isFullyQualifiedAppIdentifier` guard (a remote originator may have no
`instanceId`):

```ts
if (raiseIntentSource != null && isRemoteAppIdentifier(raiseIntentSource.payload, this.bridge?.agentName)) {
    if (requestMessage.payload.intentResult.channel != null) {
        this.channelMessageHandler.markPrivateChannelShared(requestMessage.payload.intentResult.channel, raiseIntentSource.payload.desktopAgent);
    }
    this.bridge?.publishIntentResult(raiseIntentSource.uuid, raiseIntentSource.payload, requestMessage.payload.intentResult);
    return;
}
```

**Loop-prevention, stated precisely** (this is what makes "all 13 message types" safe rather than a
recursion risk):
1. *Routing*: delegation happens iff `this.bridge != null` and the target's `desktopAgent` differs
   from our assigned name. Inbound requests from the bridge always name a concrete local app
   (schema-guaranteed for `open`/`raiseIntent`; discovery requests have no app field at all).
2. *Discovery*: inbound `find*`/`getAppMetadata` are served exclusively via `getLocal*` — the merged
   (`getAppIntent` etc.) methods are only reachable from `onRequestMessage`, i.e. only from local
   apps. This is what stops a 3-agent bridge from infinitely re-forwarding a discovery query.
3. *Channels*: `applyRemote*` methods call the publishers with `forwardToBridge: false` — structural,
   not conventional.

### 4.4 `DesktopAgentBridging` flag

`getImplementationMetadata` (`helpers/app-directory-applications.helper.ts`) gains a third param:

```ts
export function getImplementationMetadata(
    appIdentifier: FullyQualifiedAppIdentifier,
    applicationMetadata?: AppMetadata,
    optionalFeatures?: Partial<ImplementationMetadata['optionalFeatures']>,
): ImplementationMetadata { /* spreads optionalFeatures over the existing defaults incl. DesktopAgentBridging: false */ }
```

Two call sites must agree:
- `onGetInfoRequest` (`desktop-agent.ts`): pass `{ DesktopAgentBridging: this.bridge != null }`.
- `RootMessagePublisher` (used for the WCP5 handshake response) needs to know bridging-enabled-ness
  too — pass it as a third constructor param from `createRoot` (`factoryParams.bridge != null`),
  since it's immutable for the agent's lifetime and known before `RootMessagePublisher` is
  constructed.

---

## 5. `bridge/` — the new module

```
projects/fdc3-web/src/bridge/
  bridge-message.serialization.ts   serialize/parse + Date revival for meta.timestamp
  bridge-message.factory.ts         message construction (mirrors helpers/messages.helper.ts style)
  bridge-identity.helper.ts         local <-> bridging identifier mapping (source/destination rules)
  bridge-error.helper.ts            thrown value -> family error enum, with a fallback per call site
  websocket-bridge-transport.ts     WebSocketBridgeTransport implementing IBridgeTransport (spec step 1)
  bridge-connection.ts              BridgeConnection: spec steps 2-6 (hello/handshake/authFailed/connectedAgentsUpdate)
  bridge-message-correlator.ts      requestUuid -> pending response(s), with timeouts and cleanup
  bridge-outbound.ts                the 13 outbound sends (6 request/response + 7 fire-and-forget)
  bridge-inbound.ts                 routes the 13 inbound BridgeRequest types to the agent
  desktop-agent-bridge.ts           DesktopAgentBridge — composition root, implements IDesktopAgentBridge
  bridge-transport.fake.ts          FakeBridgeTransport test double (excluded from lib build & coverage)
  index.ts                         barrel: IBridgeTransport re-export point, WebSocketBridgeTransport, DesktopAgentBridge
  *.spec.ts                        one per file above
```

Every file: verbatim Apache-2.0 MS header, `.js` extensions on relative imports (existing repo
convention).

### 5.1 Facts that drive the design (verified against the installed schema)

- `OpenAgentRequestPayload.app`, `RaiseIntentAgentRequestPayload.app`, `GetAppMetadataAgentRequestPayload.app`
  all require `desktopAgent` — these three outbound flows are always targeted. `findIntent`/
  `findIntentsByContext`/`broadcast` have no app field — always broadcast to all agents.
  `findInstances` may optionally target one agent.
- `BridgeRequestMetadata.source` is always required and always carries `desktopAgent` — every
  inbound request self-identifies its origin agent.
- Success vs error responses share the same `type` string; the only reliable discriminator is
  `payload.error` being a string. `BridgeErrorResponseMessageMeta` always requires `errorSources` +
  `errorDetails` (used only when *every* connected agent errored); a success `BridgeResponse` may
  still carry partial `errorSources`/`errorDetails` alongside real results from some agents.
- **`raiseIntentResultResponse` has no matching request type at all** — it's a later, unsolicited
  message correlated by the *original* `raiseIntentRequest`'s `requestUuid`. The correlator must
  support two listeners under one `requestUuid` (an immediate one for `raiseIntentResponse`, a late
  one for `raiseIntentResultResponse`) without the first's resolution tearing down the second.
- All `meta.timestamp` fields are typed `Date`; JSON over the wire gives strings. **Timestamp
  revival on parse is mandatory** or every predicate asserting `instanceof Date` silently fails.
  This was the single most likely thing to miss and is worth flagging in review.
- jsdom ships a real `WebSocket` that opens real sockets — the `WebSocketFactory` must be injected
  lazily (evaluated inside `connect()`, not captured at construction), so importing/constructing the
  transport never touches the network, and no spec can accidentally open one.

### 5.2 `websocket-bridge-transport.ts`

Implements spec Step 1: scan `host:port` across `portRange` (default `127.0.0.1:4475-4575`), a
`BRIDGE.PORT_CONNECT_TIMEOUT_MS` per-port budget so one filtered port can't stall the whole scan,
and a `>= BRIDGE.RETRY_PAUSE_MS` pause after exhausting the range (**use `Math.max`, not
`Math.min`** — the PoC capped rather than floored this, violating the spec's "at least 5 seconds").
On a clean `onclose` after having been open, retry the last-good port first before resuming the
scan. `reset()` (used after `authenticationFailed`) advances past the current port rather than
retrying it immediately, to avoid hot-looping against a bridge that just rejected us. `close()` is
permanent teardown: clears all timers, detaches all socket handlers, stops retrying.

### 5.3 `bridge-connection.ts`

Implements spec Steps 2-6. On `hello`: optionally validate the bridge's `authToken` via
`params.validateBridgeAuthToken` if supplied (if not supplied, log WARN and proceed — refusing to
connect by default would make the out-of-the-box config useless against a bridge the consumer
already trusts); send `handshake` with `implementationMetadata`/`channelsState` gathered via
`Promise.all` (not serial awaits — a PoC bug). **Critical correctness fix over the PoC**: correlate
`connectedAgentsUpdate` against the handshake's own `requestUuid` to distinguish *our* `addAgent`
(our assigned name) from a later broadcast about a different agent joining — the PoC adopted
`addAgent` from every update, so a second agent joining would silently rename us, corrupting every
subsequent `meta.source.desktopAgent` we stamp. Track `allAgents` and fire
`onRemoteAgentDisconnected(name)` for `removeAgent`, and also for any name present in a previous
`allAgents` snapshot but absent from a new one (covers an implicit drop with no explicit
`removeAgent`). On `authenticationFailed` or the transport going `'disconnected'`: clear assigned
name, fire `onRemoteAgentDisconnected` for every previously-known agent, and (for
`authenticationFailed`) call `transport.reset()`.

### 5.4 `bridge-message-correlator.ts`

`Map<requestUuid, Set<PendingEntry>>` — the **Set** (not one entry per uuid, the PoC's bug) is what
makes "immediate response now, late response later" work for `raiseIntent`. Every removal path
(resolve / reject / timeout / explicit cancel / correlator close) goes through one `remove()` that
also clears the timer, so nothing leaks. Rejects with `'ApiTimeout'` on a per-entry timeout (default
`BRIDGE.RESPONSE_TIMEOUT_MS`, overridable per call — `raiseIntent`'s late listener uses
`BRIDGE.INTENT_RESULT_TIMEOUT_MS`, a generous safety net since a real intent handler may take
minutes). Rejects everything pending with `'AgentDisconnected'` immediately when the transport goes
`'disconnected'`, rather than waiting out the timeout.

### 5.5 `bridge-identity.helper.ts` / `bridge-error.helper.ts` / `bridge-message.factory.ts`

Small, independently-tested pure-function files: mapping a `FullyQualifiedAppIdentifier` + our
agent name to a bridging `source`/`destination`; mapping a thrown value to a family error enum with
a documented per-call-site fallback (e.g. `findIntent`→`NoAppsFound`, `open`→`AppNotFound`,
`raiseIntentResult`→`IntentHandlerRejected`); and message-construction helpers mirroring
`helpers/messages.helper.ts`'s existing style (`meta` built once, `destination` only assigned when
present, so specs can assert exact objects with no stray `undefined` keys).

### 5.6 `bridge-outbound.ts` — the 13 outbound sends

Six request/response methods (`findIntent`, `findIntentsByContext`, `findInstances`,
`getAppMetadata`, `open`, `raiseIntent`) register correlation **before** calling `transport.send`,
reject with `'NotConnectedToBridge'` when the connection isn't up, and return the bridge's
`sources`/`errorSources`/`errorDetails` collation arrays alongside the payload — **merging a
collated bridge response with the local result is the caller's job** (`AppDirectory`/
`DesktopAgentImpl`), not this module's, since only the caller knows the local half.

`raiseIntent` is the one non-uniform flow: it registers **two** correlator listeners under the same
`requestUuid` before sending — one for the immediate `raiseIntentResponse`
(`intentResolution`), one for the later `raiseIntentResultResponse` (the `result` promise returned
to the caller) — and cancels the late listener if the immediate one fails.

Seven fire-and-forget methods (`broadcast` + 6 `PrivateChannel.*`) log+return when disconnected
rather than throwing, and — as a defensive backstop, structurally, even though the integration
layer should never call them this way — drop anything whose `source.desktopAgent` doesn't match our
own assigned name (loop guard).

### 5.7 `bridge-inbound.ts` — the 13 inbound handlers

One exhaustive `switch (message.type)` with a `handleNever` default, same shape as
`DesktopAgentImpl.onRequestMessage`. Six request/response cases call the agent
(`agent.directory.getLocal*` for the four discovery flows, `agent.open(...)` for open,
`agent.raiseIntentFromRemote(...)` for raiseIntent — see §4.3) and send back a success or mapped
error response. `raiseIntentRequest` is two-phase: send `raiseIntentResponse` immediately, then
**without awaiting** attach to the returned result to send a follow-up `raiseIntentResultResponse`
(or its error form) once the local app resolves — this is a second, independent message on the same
`requestUuid`, not a request/response pair. Seven fire-and-forget cases delegate to
`agent.channelMessageHandler.applyRemote*` and send nothing back (no response type exists for
these). `agent` here is the concrete `DesktopAgentImpl` — `bridge/` is the one module allowed to
depend on it directly (see architecture summary), which avoids inventing a duplicate facade
interface for four members that already exist as public API.

### 5.8 `desktop-agent-bridge.ts` — composition root

```ts
export class DesktopAgentBridge implements IDesktopAgentBridge {
    public static async create(params: { agent: DesktopAgentImpl; params: BridgeParams; logLevels?: GetAgentLogLevels }): Promise<DesktopAgentBridge>;
    public connect(): void;
    public close(): void;
    public get agentName(): string | undefined;
    // + the IDesktopAgentBridge methods, delegating to BridgeOutboundGateway
}
```

Builds (in order) the transport (`params.bridge.transportFactory?.() ?? new WebSocketBridgeTransport(...)`),
`BridgeConnection`, `BridgeMessageCorrelator`, `BridgeInboundRouter` (wired to `agent`), then the
outbound gateway — subscribers attached before `connect()` is ever called, so nothing can arrive
unhandled. Wires `connection.onRemoteAgentDisconnected(name => agent.channelMessageHandler.cleanupDisconnectedAgent(name))`.
`getImplementationMetadata()` for the handshake is derived from `agent.getInfo()` with `appMetadata`
stripped (the bridging handshake shape has no such field — sending it would leak our root app's
identity to every bridged agent, a PoC bug). `getChannelsState()`/`adoptChannelsState()` for the
handshake and step-6 resync delegate straight to `agent.channelMessageHandler`.

### 5.9 Predicates

New `helpers/bridging-type-predicate.helper.ts` (barrel-exported from `helpers/index.ts`, same
convention as existing FDC3 predicates): base shape checks (`isBridgeRequestMessage`,
`isBridgeResponseMessage`, `isBridgeErrorResponseMessage`, discriminating success vs error by
`typeof payload.error === 'string'`), the three connection-step predicates, the seven per-family
response predicates, and an exhaustive-switch `isRaiseIntentResultError`. Requires adding `export`
to the existing (currently unexported) `neverCheck` helper in `finos-type-predicate.helper.ts` so
the exhaustiveness trick can be reused.

### 5.10 Test double & barrel

`bridge/bridge-transport.fake.ts` — `FakeBridgeTransport implements IBridgeTransport` recording
`sent` messages and exposing `receive(message)`/`setState(state)` test-driver methods. Excluded
from `tsconfig.lib.json` and coverage config (two small config edits) so it ships to no consumer.
`bridge/index.ts` exports only `IBridgeTransport`'s companions actually needed by consumers
(`WebSocketBridgeTransport`, `DesktopAgentBridge`) — `BridgeConnection`, the correlator, the
gateways, and all the small helpers stay module-private. One new line in `src/index.ts`.

---

## 6. `DesktopAgentFactory.createRoot` wiring

```ts
const agent = new DesktopAgentImpl({ /* unchanged */ });
agentResolve(agent);

if (factoryParams.bridge != null) {
    const bridge = await DesktopAgentBridge.create({
        agent,
        params: { requestedName: factoryParams.rootAppId, ...factoryParams.bridge },
        logLevels: factoryParams.logLevels,
    });
    agent.connectBridge(bridge);
    bridge.connect();   // NOT awaited — a missing/slow bridge must never delay agent creation
}
```

The bridge is constructed **after** the agent (unlike `AppDirectory`/`uiProvider`, which need the
`agentPromise` trick because they're built *before* the agent exists) — so it takes the concrete
`DesktopAgentImpl` directly with no `Promise<DesktopAgent>` indirection, which matters because
several `IDesktopAgentBridge` methods sit on synchronous hot paths (every broadcast). During the
window before the handshake completes, `bridge.agentName` is `undefined`, so any explicitly
foreign-targeted call correctly delegates and gets `'NotConnectedToBridge'` back — no special-casing
needed. `RootMessagePublisher` gets a third constructor param, `bridgingEnabled: boolean =
factoryParams.bridge != null` (for the WCP5 `getInfo()` parity fix in §4.4); the existing
`rootMessagePublisherFactory` test hook gains an optional third argument, backward compatible with
existing 2-arg callers.

---

## 7. Test plan

Fully unit-tested with `FakeBridgeTransport`/`Mock.create<IDesktopAgentBridge>()`
(`@morgan-stanley/ts-mocking-bird`, per the repo's existing convention) — no real WebSocket, no dev
bridge server.

- **`app-directory/directory.spec.ts`** (new `describe('bridging')`): each of the four merge points
  (local+remote concatenation, remote-only intents surfaced, local-first ordering); degrade to
  local-only when the remote source rejects/is absent; `getLocal*` never consult the remote source
  (guards the internal-caller fan-out regression); `getValidatedAppIdentifier`/`resolveAppForIntent`
  accept a foreign-`desktopAgent` target without hitting the resolver.
- **`agent/desktop-agent.spec.ts`** (new `describe('bridging')`): `connectBridge` wires all three
  collaborators; a remote-targeted `raiseIntentRequest`/`raiseIntentForContextRequest`/`openRequest`
  delegates to the bridge instead of local resolution/open strategies/the 15s listener wait; the
  later `result`/`raiseIntentResultResponse` is relayed to the correct originating app/requestUuid;
  `raiseIntentFromRemote` publishes `intentEvent` with the remote `originatingApp` and returns the
  resolution; `onIntentResultRequest` routes a remote-originated result to
  `bridge.publishIntentResult` instead of the local path; `getInfo()` reports
  `DesktopAgentBridging` correctly with/without a bridge; **explicit no-bridge-invariant test**: the
  same remote-targeted requests behave exactly as today when no bridge is connected.
- **`channel/channel-message-handler.spec.ts`** (new `describe('bridging')`): `getChannelsState`/
  `applyChannelsState` round-trip (ordering, merge-not-replace, no event replay);
  broadcast/private-channel forwarding only when `sharedWithAgents` is non-empty, and never from the
  listener-replay code path; `applyRemote*` methods fan out locally and call **zero** bridge methods
  (explicit `wasNotCalled()` assertions — this is the loop-prevention regression test);
  `cleanupDisconnectedAgent` notifies local listeners on shared channels without purging user/app
  channel history.
- **`agent/desktop-agent.factory.spec.ts`**: `bridge` param constructs and connects the bridge via
  the injected `transportFactory`, without awaiting the handshake; no `bridge` param constructs
  nothing and leaves all existing assertions unchanged.
- **`helpers/app-directory-applications.helper.spec.ts`**: `getImplementationMetadata` override
  param leaves the existing default-`false` assertions untouched.
- **New `bridge/*.spec.ts`** (one per file in §5): port-scan/backoff/reconnect state machine
  (including the `Math.max` retry-floor fix and per-port connect timeout) with fake timers and a
  hand-rolled `FakeWebSocket`; the `connectedAgentsUpdate`/handshake-`requestUuid` correlation fix
  (second agent joining must not rename us); correlator two-listeners-per-uuid behaviour for
  `raiseIntent`, timeout and disconnect-rejection paths; message-factory exact-object assertions;
  identity/error helper mapping tables; outbound gateway exact wire-JSON per flow plus
  degraded/disconnected behaviour; inbound router table-driven happy/error path across all 13
  types plus the raiseIntent two-phase send-order assertion.

**Commands**: `npx nx test fdc3-web`, `npm run lint`, `npx nx run fdc3-web:type-check-specs`.

---

## 8. Sequencing

1. **Contracts + AppDirectory** — `contracts.ts`/`contracts.internal.ts` additions, `BRIDGE`
   constants, `isRemoteAppIdentifier`, the local/merged split and four merge points, the
   `getValidatedAppIdentifier`/`resolveAppForIntent` early-outs. Fully testable with a fake
   `IRemoteAppSource`; no `bridge/` code exists yet.
2. **ChannelMessageHandler** — `sharedWithAgents`, publisher `forwardToBridge` signature change,
   `getChannelsState`/`applyChannelsState`, `markPrivateChannelShared`, the six `applyRemote*`
   methods, `cleanupDisconnectedAgent`. Fake `IChannelBridge`.
3. **DesktopAgentImpl** — `connectBridge`, `isRemoteApp`, the three outbound branches +
   `delegateRaiseIntent`/`delegateOpen`, `raiseIntentFromRemote`, the `onIntentResultRequest`
   branch, the `getInfo()` flag, `RootMessagePublisher`'s third constructor param.
4. **`bridge/` module** — built against the now-frozen interfaces from steps 1-3, then factory
   wiring last.

Steps 1-3 are independently shippable and reviewable, each provable via the existing suite staying
green plus additive `describe('bridging')` blocks — "no `bridge` param ⇒ zero behavioural change" is
directly tested at every layer, not just asserted.

---

## 9. Known spec ambiguities (recommended pragmatic choices, not blocking)

- **Bridge auth token verification** (`hello.payload.authRequired`): honour
  `validateBridgeAuthToken` if supplied; otherwise warn and proceed (refusing by default breaks the
  common case of a trusted bridge).
- **FDC3 version mismatch** in `hello`: warn and continue; per-message schema mismatches will
  surface as real errors anyway.
- **Reconnect port ordering**: retry the last-successful port first, then resume scanning — rejoining
  the same bridge is the overwhelmingly common case.
- **`PrivateChannel.*` targeting**: `destination` is optional in the schema; broadcast to all agents
  when the integration layer doesn't specify one. Wasteful but correct, and narrowable later once
  remote channel participants are tracked more precisely.
- **`raiseIntentResultResponse` timeout**: a generous 5-minute safety net only (an intent handler may
  legitimately take minutes of user interaction) — the correlator rejects immediately on transport
  disconnect regardless, which is the case that matters in practice.
