# Open, select and resolve apps

The host decides how to open an app. The root-agent factory doesn't assume popup windows: strategies let it use the host's UI, window management and instance tracking.

## 1. Decide whether your strategy can open the app

RootApp implements IOpenApplicationStrategy. For web apps, isWebAppDetails checks the details shape before the strategy accepts the record:

```ts
public async canOpen(params: ApplicationStrategyParams): Promise<boolean> {
  return params.appDirectoryRecord.type === 'web' &&
    isWebAppDetails(params.appDirectoryRecord.details);
}
```

## 2. Open a window or frame

RootApp reads its "Open in Window" control. For a popup it calls window.open, then waits for a connectionAttemptUuid from the new app:

```ts
const windowProxy = window.open(url, '_blank', 'popup');
if (windowProxy == null) throw new Error('Window was null');

params.appReadyPromise.then(identity => {
    this.windowLookup[identity.instanceId] = windowProxy;
});

return new Promise(resolve => {
    const subscriber = subscribeToConnectionAttemptUuids(window, windowProxy, connectionAttemptUuid => {
        subscriber.unsubscribe();
        resolve(connectionAttemptUuid);
    });
});
```

Returning the UUID lets the agent finish identifying the newly opened instance. appReadyPromise supplies its final appId and instanceId. For an iframe the same harness updates its Lit state, waits for the iframe's window, and subscribes in exactly the same way.

## 3. Focus an existing instance

The select strategy uses the instanceId recorded by appReadyPromise:

```ts
public async canSelectApp(params: SelectApplicationStrategyParams): Promise<boolean> {
  return this.windowLookup[params.appIdentifier.instanceId] != null;
}

public async selectApp(params: SelectApplicationStrategyParams): Promise<void> {
  const appWindow = this.windowLookup[params.appIdentifier.instanceId];
  appWindow?.focus();
}
```

The resolver can therefore offer an existing app rather than always opening a new one. hostManifests can identify a singleton app; see [App Directory](../guides/app-directory.md).

## 4. Let a user resolve intents

Passing AppResolverComponent as the uiProvider supplies a UI-driven IAppResolver to the root factory. From the calling app, intents still look like this:

```ts
const resolution = await agent.raiseIntent('ViewChart', {
    type: 'fdc3.instrument',
});
const result = await resolution.getResult();
```

The test harness describes ViewChart and fdc3.instrument in its app records, so this is a real local workflow. Use [the harness guide](host.md) to run it, or adapt the snippets with your own imports and tracked state.

## Source

[RootApp and its strategy implementations](https://github.com/morganstanley/fdc3-web/blob/main/projects/test-harness/src/root-app/root-app.ts) contain the full iframe branch, error handling, nested-app flow and close strategy. Code above is excerpted from that file; no separate browser connection implementation is needed in your app.
