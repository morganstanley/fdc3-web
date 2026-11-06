# Desktop Agents

A Desktop Agent is the common interface an app uses to discover other apps, exchange context and launch workflows. The FDC3 API means the calling app doesn't need to know which application will handle each request.

## Root and proxy agents

A root agent owns the App Directory, channel state and app-instance registry. Proxy agents run in child windows or frames and communicate with the root. fdc3-web supports different browser origins, so each participating app doesn't have to share a server.

```text
Root window / Desktop Agent
  ├── Application strategies · App Directory · intent resolver
  ├── User and app channels · private channel state
  └── Proxy connections over the Web Connection Protocol
        ├── App in an iframe
        ├── App in a new window
        └── App on another origin
```

The root agent writes its API to window.fdc3 and dispatches fdc3Ready when no API is already present. Connected proxy agents use the same discovery and notification mechanism unless dontSetWindowFdc3 is set on createProxy.

## Discovery with getAgent

getAgent tries two forms of existing agent:

1. A preload agent at window.fdc3, or one announced by fdc3Ready.
2. A proxy discovered among eligible frames and windows through the Web Connection Protocol hello and handshake messages.

If neither succeeds, it invokes the supplied failover function. Without a failover it rejects with AgentError.AgentNotFound. The handshake includes an app identity check with the root, which associates the new connection with a directory record and a running instance.

```ts
const agent = await getAgent({
    identityUrl: window.location.href,
    logLevels: { connection: LogLevel.INFO, proxy: LogLevel.WARN },
});
```

The exported LogLevel values make verbosity explicit; both are optional. See the [factory example](../examples/host.md) for root setup including log levels.

## Application lifecycle

The root delegates app opening and selection to the host through strategies. A host can open a new window, use an iframe, focus an existing instance and close app resources it owns. A separate new-instance strategy is notified whenever an app completes its connection handshake, even when the app opened itself.

Window-based applications get a distinct instanceId. Apps can retrieve their identity and implementation details using getInfo, look up other instances with findInstances, and target an instance when opening or raising an intent.

Continue with [application examples](../examples/applications.md), or read the [FDC3 Web Connection Protocol](https://fdc3.finos.org/docs/spec/latest/wcp/) for the standard behind the connection mechanism.

_Architecture derived from get-agent.ts, desktop-agent.factory.ts and the test harness. The library also exposes lower-level factories for custom integrations; see the [API reference](../api/classes/DesktopAgentFactory.md)._
