# A multi-origin test harness

This is the working example behind the docs: a Lit host that owns the root agent, apps in iframes or popups, an app-directory server and an API explorer.

```text
localhost:4300  Root app + initial apps
localhost:4301  Apps on another simulated origin
localhost:4302  More test apps
localhost:4299  FINOS v2 App Directory endpoint
```

## Run it

```bash
npm ci
npm start
```

Open http://localhost:4300/root-app.html. Use "Add App" to launch another directory record, select an app's header to choose where a nested app opens, and enable "Open in Window" when you want a separate window.

The harness includes a FINOS Workbench local directory alongside its local HTTP directory. That gives the host mixed remote and local sources, just like the [App Directory guide](../guides/app-directory.md).

## Root setup, from root-app.ts

```ts
const agent = await new DesktopAgentFactory().createRoot({
    rootAppId: 'test-harness-root-app',
    uiProvider: agentPromise => Promise.resolve(new AppResolverComponent(agentPromise, document)),
    appDirectoryEntries: getAppDirectoryUrls(),
    applicationStrategies: [this],
    backoffRetry: { maxAttempts: 5, baseDelay: 500 },
});
```

The root itself implements open, select and close strategies. Child apps call getAgent with no failover, discover the root with the WCP handshake, then use getInfo to establish their identity.

## Inspect APIs without writing a new app

The default app has controls for intent listeners, broadcasting, context listeners, user and private channels, app opening, metadata and a generic API explorer. The latter accepts exact arguments and displays structured callback and result information.

Use it with the [Channels](../guides/channels.md), [Intents](../guides/intents.md) and [Private channels](../guides/private-channels.md) guides to try the patterns shown there.

## Source

- [Root host and agent factory](https://github.com/morganstanley/fdc3-web/blob/main/projects/test-harness/src/root-app/root-app.ts)
- [Connected child application](https://github.com/morganstanley/fdc3-web/blob/main/projects/test-harness/src/default-app/default-app.ts)
- [Harness application records](https://github.com/morganstanley/fdc3-web/blob/main/projects/test-harness/src/server/assets/test-harness.config.json)
- [Harness README](https://github.com/morganstanley/fdc3-web/blob/main/projects/test-harness/README.md)
