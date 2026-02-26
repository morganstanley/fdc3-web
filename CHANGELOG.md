## 0.11.2 (2026-02-26)

Fixed several minor bugs to pass conformance tests

## 0.11.1 (2026-02-17)

### Updated

 * updated versions of dependencies to be a version range

## 0.11.0 (2026-02-12)

### Changed

 * Make `appDirectoryRecord` optional in `ISelectApplicationStrategy` function calls

 ### Fixed

 * Unqualified and cross-domain `appId` resolution now follows the FDC3 [Fully-Qualified AppId](https://fdc3.finos.org/docs/next/api/spec#fully-qualified-appids) resolution algorithm. An unqualified `appId` (e.g. `my-app`) or a fully-qualified `appId` from a different hostname (e.g. `my-app@other-host`) will now be matched against known directory entries by their unqualified portion. This affects `resolveAppForIntent`, `getAppInstances`, `getAppMetadata`, `getAppDirectoryApplication`, and `removeDisconnectedApp`.
 * `getAppInstances` now returns instances from all matching fully-qualified app IDs when multiple directory sources define the same unqualified `appId`.

## 0.10.0 (2026-01-23)

### Breaking

 * `IOpenApplicationStrategy.open()` and `IOpenApplicationStrategy.canOpen()` now take a single parameter argument rather than multiple parameters

was:

```ts
export type OpenApplicationStrategyParams = {
    appDirectoryRecord: Omit<AppDirectoryApplication, 'hostManifests'>;
    agent: DesktopAgent;
    manifest?: unknown;
};

canOpen(params: OpenApplicationStrategyParams, context?: Context): Promise<boolean>;

open(params: OpenApplicationStrategyParams, appReadyPromise: Promise<FullyQualifiedAppIdentifier>, context?: Context): Promise<string>;
```

now:

```ts
export type OpenApplicationStrategyParams = {
    appDirectoryRecord: Omit<AppDirectoryApplication, 'hostManifests'>;
    agent: DesktopAgent;
    /**
     * manifest from the app directory record identified by the strategy's manifestKey
     */
    manifest?: unknown;
    context?: Context;
};

export type OpenApplicationStrategyResolverParams = OpenApplicationStrategyParams & {
    appReadyPromise: Promise<FullyQualifiedAppIdentifier>;
};

canOpen(params: OpenApplicationStrategyParams): Promise<boolean>;


open(params: OpenApplicationStrategyResolverParams): Promise<string>;
```

### Added

 * `appReadyPromise` property added to `IOpenApplicationStrategy.open()` function. This promise resolves when the application that is being opened is ready and has had an `instanceId` assigned
 * Singleton app support added. If an application is marked as a singleton it will not appear in the `New Instance` section of the app resolver if an instance already exists. This means that the user cannot open more than one instance of an app using the app resolver as a result of a `raiseIntent` or `raiseIntentForContext` call. Add an entry to `hostManifests` within your app directory record to enable this:

 ```json
{
    "title": "My App",
    "appId": "my-app",
    "type": "web",
    "details": {
        "url": "http://localhost:4302/app-b.html"
    },
    "hostManifests": {
        "MorganStanley.fdc3-web": {
            "singleton": true
        }
    }
}
 ```
  * `applicationStrategies` parameter in `RootDesktopAgentFactoryParams` now accepts `(IOpenApplicationStrategy | ISelectApplicationStrategy)[]` instead of just `IOpenApplicationStrategy[]`
 * `ISelectApplicationStrategy` - new interface for selecting/focusing existing application instances. This allows strategies to restore minimised windows or bring windows to the front. Define strategies with `canSelectApp()` and `selectApp()` methods:

 ```ts
export interface ISelectApplicationStrategy {
    manifestKey?: string;
    canSelectApp(params: SelectApplicationStrategyParams): Promise<boolean>;
    selectApp(params: SelectApplicationStrategyParams): Promise<void>;
}
 ```

 ### Changed

  * IAppResolver  implementations no longer have to return an `FullyQualifiedAppIdentifier`. Instead they can just return an `AppIdentifier`. If a non-qualified identifier is returned the Desktop Agent will handle the responsibility of opening a new instance of that app.

## 0.9.2 (2025-12-01)

 - stop listening for heartbeat messages when a goodbye message is received from a child app.

## 0.9.1 (2025-11-24)

 - ensure that it is safe to add the same app to the directory multiple times without losing registered instances of that app

## 0.9.0 (2025-11-13)

### Breaking

 - Locally defined app directories must now define a full `AppDirectoryApplication` Object.
 - `LocalAppDirectoryEntry` removed

### Added

 - `createWebAppDirectoryEntry`, a helper function to make it easier to create Web app directory entries:

 ```ts
getAgent({
    failover: () =>
        new DesktopAgentFactory().createRoot({
            rootAppId: 'test-harness-root-app',
            appDirectoryEntries: [
                {
                    host: 'example.com',
                    apps: [ createWebAppDirectoryEntry('local-app-id', 'https://example.com/someApp', 'Local App' ) ]
                },
            ],
        }),
});
```

## 0.8.1 (2025-10-29)

Added support for passing multiple local apps to app directory through `updates` AsyncIterator

## 0.8.0 (2025-10-29)

Support added for adding and updating local app directory records after creation of the app directory:

```ts
let addAppToDirectory: ((value: LocalAppDirectoryEntry) => void) | undefined;

const updates: AsyncIterator<LocalAppDirectoryEntry> = {
    next: async () =>
        new Promise<IteratorResult<LocalAppDirectoryEntry>>(resolve => {
            addAppToDirectory = value => resolve({ done: false, value });
        }),
};

getAgent({
    failover: () =>
        new DesktopAgentFactory().createRoot({
            rootAppId: 'test-harness-root-app',
            appDirectoryEntries: [
                {
                    host: 'example.com',
                    apps: [
                        {
                            appId: 'local-app-id',
                            title: 'Local App',
                            url: 'https://example.com/someApp',
                        },
                    ],
                    updates,
                },
            ],
        }),
});
```

## 0.7.0 (2025-10-21)

### Breaking

Locally defined app directories force the app directory host to be specified separately to ensure all apps in the same directory have the same host for the fully qualified id.

```ts
getAgent({
    failover: () =>
        new DesktopAgentFactory().createRoot({
            rootAppId: 'test-harness-root-app',
            appDirectoryEntries: [
                [
                    {
                        appId: 'local-app-id',
                        title: 'Local App',
                        url: 'https://example.com/someApp',
                    },
                ],
            ],
        }),
});
```

becomes:

```ts
getAgent({
    failover: () =>
        new DesktopAgentFactory().createRoot({
            rootAppId: 'test-harness-root-app',
            appDirectoryEntries: [
                {
                    host: "example.com",
                    apps: [
                        {
                            appId: 'local-app-id',
                            title: 'Local App',
                            url: 'https://example.com/someApp',
                        },
                ]
                },
            ],
        }),
});
```

### Changed

Implemented a better url comparison function for verifying app identity against app directory. This function now considers all aspects of the url including query params, hash and path segments. This allows apps on the same host to be differentiated:

```
http://myhost.com/pathOne/pathTwo?appId=appOne
http://myhost.com/pathOne/pathTwo?appId=appTwo
http://myhost.com/pathOne/pathTwo?appId=appOne#additionalModifier
http://myhost.com/pathOne/pathTwo/pathThree?appId=appOne
```
all of these urls can be defined as separate apps in the app directory.

## 0.6.0 (2025-10-07)

### Added:

`IOpenApplicationStrategy` now accepts the optional associated context object for window opening as params on the `canOpen` and `open` functions

## 0.5.0 (2025-10-03)

### Breaking:

`appDirectoryUrls` in `RootDesktopAgentFactoryParams` has been renamed to `appDirectoryEntries`:

```ts
new DesktopAgentFactory().createRoot({
    appDirectoryUrls: ['http://localhost:4299/v2/apps'],
}),
```

becomes:

```ts
new DesktopAgentFactory().createRoot({
    appDirectoryEntries: ['http://localhost:4299/v2/apps'],
}),
```

### Added:

Added for support for locally defined App Directories to eliminate the need to host an app directory on a server:

```ts
getAgent({
    failover: () =>
        new DesktopAgentFactory().createRoot({
            rootAppId: 'test-harness-root-app',
            appDirectoryEntries: [
                [
                    {
                        appId: 'local-app-id',
                        title: 'Local App',
                        url: 'https://example.com/someApp',
                    },
                ],
            ],
        }),
});
```

## 0.4.0 (2025-10-01)

Root app id is no longer resolved from the app directory but instead is passed in to the root app constructor:

```ts
getAgent({
    failover: () =>
        new DesktopAgentFactory().createRoot({
            rootAppId: 'test-harness-root-app' // can also pass a fully qualified id: test-harness-root-app@host.com
        }),
});
```

This makes it possible to run the container app without an app directory as this is no longer required to resolve the appId.

## 0.3.5 (2025-09-26)

Fixed generated package.json by removing incorrect module entry

## 0.3.4 (2025-08-08)

When handshake messages are not responded to by applications after 3 attempts that application is removed from the app resolver.
When an application is closed a WCP6Goodbye message is sent to the root agent and the application is removed from the app resolver.

## 0.3.3 (2025-08-04)

Fixed bugs around open strategies. Strategies that return `false` from `canOpen` are now correctly skipped and not used to open windows.

## 0.3.2 (2025-06-26)

 - Fixed a bug with `createRoot` that did not correctly pass the `identityUrl` to the `rootMessagePublisher`
 - Changed the `getAppDirectoryApplicationsImpl` to not append `/v2/apps` to app directory urls to allow non standard urls to be used

## 0.3.1 (2025-06-03)

Fixed a bug with `app-resolver.default` and `app-resolver.component` that did not automatically select an unqualified app id when there was only 1 suitable app available.

## 0.3.0 (2025-05-16)

### 🚀 Features

- Implemented heartbeat functionality for Desktop Agent
- **logging:** Enhance logging functionality with configurable log levels
- Added recursive back-off retry to App Directory loading logic 
- **build** Migrate from Jest to Vitest for testing framework 
- **build** Refactor mono repo config to use Nx targets rather than npm scripts
- **build** Type check spec files as part of build 
- **build** Optimize test harness build 
- **build** ESLint 9 Upgrade
- **dependencies** Updated to @finos/fdc3 2.2.0 release

### 🩹 Fixes

- Removed unbalanced parenthesis from error message and test for unknown channelId
- **documentation** Updated documentation links to point to the correct FDC3 specifications 

## 0.2.4 (2025-03-11)

Updated to @finos/fdc3 2.2.0-beta.3 release.

## 0.2.3 (2025-03-09)

Updated dependencies with Dependabot.

## 0.2.2 (2025-03-04)

This was a version bump only, there were no code changes.