# Getting started

`@morgan-stanley/fdc3-web` brings the FINOS FDC3 Desktop Agent API to browser-based applications. Apps connect to an existing agent by default; a host application can also provide a root agent as a failover.

## Install

Install the agent library and its FDC3 API types. Add the UI provider when you want the supplied intent resolver and channel selector.

```bash
npm install @morgan-stanley/fdc3-web @finos/fdc3
npm install @morgan-stanley/fdc3-web-ui-provider
```

@finos/fdc3 is a peer dependency of @morgan-stanley/fdc3-web.

## Connect an application

For an app running in a child window or frame, getAgent uses the FDC3 Web Connection Protocol to find a parent agent:

```ts
import { getAgent } from '@morgan-stanley/fdc3-web';

const agent = await getAgent();
const info = await agent.getInfo();

console.log(info.appMetadata);
```

This is the pattern used by the test harness's default app. Usually you should call getAgent once and share the result: the first call's parameters win, and later calls return the same promise.

## Provide a root agent

When no existing agent is found, the host's failover can create one. Supply a rootAppId, App Directory entries and application strategies to control how your host opens and selects apps.

```ts
import { DesktopAgentFactory, getAgent } from '@morgan-stanley/fdc3-web';
import { AppResolverComponent } from '@morgan-stanley/fdc3-web-ui-provider';

const agent = await getAgent({
    failover: () =>
        new DesktopAgentFactory().createRoot({
            rootAppId: 'my-root-app',
            uiProvider: agentPromise => Promise.resolve(new AppResolverComponent(agentPromise, document)),
            appDirectoryEntries: ['https://apps.example.com/v2/apps'],
            applicationStrategies: [myOpenStrategy, mySelectStrategy],
        }),
});
```

The example URL is illustrative: replace it with an FDC3 v2 App Directory your host can access. See [App Directory](guides/app-directory.md) for local records and [Examples](examples/applications.md) for the complete opening strategy used by the harness.

> getAgent looks for a preload agent and a proxy before invoking failover. A preload exposed as window.fdc3 is also supported.

### The two UI components

The optional UI provider exports AppResolverComponent and ChannelSelectorComponent. AppResolverComponent supplies user-driven intent resolution. ChannelSelectorComponent supplies user-channel selection. They are intended for the main window, rather than background frames or popups.

## Explore a working setup

Run the test harness to try apps on several origins without building an integration first:

```bash
git clone https://github.com/morganstanley/fdc3-web.git
cd fdc3-web
npm ci
npm start
```

Open http://localhost:4300/root-app.html. The harness can open apps in frames or new windows, raise and handle intents, create channels and inspect API calls. Its code is the source for every example on this site.

## Next steps

- Learn about [Desktop Agents](guides/desktop-agent.md) and the Web Connection Protocol.
- Share context with [Channels](guides/channels.md), or start an action with [Intents](guides/intents.md).
- Discover apps through an [App Directory](guides/app-directory.md).
- Look up exact signatures in the generated [API reference](api/modules.md).
