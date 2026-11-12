# App Directory

The App Directory describes apps an agent can discover, launch and use for intent resolution. Records hold identity, display details, app type and launch details. Their interop metadata declares intents and supported context.

## Remote and local directories

A root agent accepts remote endpoint strings and local records together. This local web app shape is used by the harness's default directories:

```ts
import { createWebAppDirectoryEntry, DesktopAgentFactory, getAgent } from '@morgan-stanley/fdc3-web';

const agent = await getAgent({
    failover: () =>
        new DesktopAgentFactory().createRoot({
            rootAppId: 'my-root-app',
            appDirectoryEntries: [
                'http://localhost:4299/v2/apps',
                {
                    host: 'fdc3.finos.org',
                    apps: [
                        createWebAppDirectoryEntry(
                            'fdc3-workbench',
                            'https://fdc3.finos.org/toolbox/fdc3-workbench/',
                            'FDC3 Workbench',
                        ),
                    ],
                },
            ],
            applicationStrategies: [myOpenStrategy, mySelectStrategy],
        }),
});
```

The localhost endpoint is the directory included with this repo's harness; it isn't an endpoint installed by the package. applicationStrategies can be omitted if your integration uses its own launch flow, but the root needs a strategy able to open any web apps it resolves.

## Describing an app

Web records include type: web and details.url. The interop section supports intents, user channels and app channels. For example:

```json
{
    "appId": "app-1-root",
    "title": "App-1-root.com",
    "type": "web",
    "details": { "url": "http://localhost:4300/app-a.html" },
    "interop": {
        "intents": {
            "listensFor": {
                "ViewChart": { "contexts": ["fdc3.instrument"] }
            }
        }
    }
}
```

This record comes from test-harness.config.json. An intent can also declare resultType, including channel, to describe what its listener returns.

## Live updates and retries

A local directory's optional updates AsyncIterator accepts one AppDirectoryApplication or an array. Use it to add or update records without rebuilding the root agent. Remote directory loading has exponential-backoff retry settings:

```ts
backoffRetry: {
  maxAttempts: 5, // total attempts, including the first
  baseDelay: 500, // milliseconds; subsequent delays double
}
```

These are the exact retry values in the harness's root app. The public AppDirectory type also exposes the loaded applications and loadDirectoryPromise for integrations that need them.

## Host-specific options

hostManifests passes host-specific instructions to application strategies. Set MorganStanley.fdc3-web.singleton to true to indicate an app that shouldn't have duplicate instances offered in the resolver. A strategy can also read its own manifestKey to find custom settings.

Continue to [opening apps with strategies](../examples/applications.md) or browse [App Directory contracts](../api/interfaces/AppDirectoryApplication.md) in the API reference.
