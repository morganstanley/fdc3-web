# fdc3-web

![Lifecycle Incubating](https://img.shields.io/badge/Lifecycle-Incubating-yellow)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![CI](https://github.com/morganstanley/fdc3-web/actions/workflows/build.yml/badge.svg)](https://github.com/morganstanley/fdc3-web/actions/workflows/build.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/morganstanley/fdc3-web/badge)](https://securityscorecards.dev/viewer/?uri=github.com/morganstanley/fdc3-web)

## Installation

```shell
npm install @morgan-stanley/fdc3-web
npm install @morgan-stanley/fdc3-web-ui-provider
npm install @morgan-stanley/fdc3-web-messaging-provider
```

## Usage

Below are common usage patterns for the `@morgan-stanley/fdc3-web` library, including code examples for agent access, intents, channels, and App Directory setup. These examples are based on real usage in the test-harness app.

### Accessing the FDC3 Agent

#### In the Root Window

```js
import { DesktopAgentFactory, getAgent } from '@morgan-stanley/fdc3-web';
import { LogLevel } from '@finos/fdc3';
import { AppResolverComponent } from '@morgan-stanley/fdc3-web-ui-provider';

const agent = await getAgent({
  failover: () =>
    new DesktopAgentFactory().createRoot({
      uiProvider: agent => Promise.resolve(new AppResolverComponent(agent, document)),
      appDirectoryEntries: ['http://localhost:4299/v2/apps'],
      applicationStrategies: [{
        canOpen: (params: OpenApplicationStrategyParams, context?: Context) => { /* define whether an app should open */ },
        open: (params: OpenApplicationStrategyParams, context?: Context) => { /* define how an app should open */ }
      }],
    }),
  // Control logging levels
  logLevels: {
    connection: LogLevel.INFO,  // Controls connection/handshake related logs
    proxy: LogLevel.WARN,       // Controls agent/proxy related logs
  }
});
```

#### In a Proxy/Child Window

```js
import { getAgent } from '@morgan-stanley/fdc3-web';

// This will attempt to establish a connection using the FDC3 Web Connection Protocol
// given the URL of this Desktop Agent Proxy 
const agent = await getAgent();
```

### Raising and Handling Intents

#### Raise an Intent

```js
const context = { type: 'fdc3.instrument', id: { ticker: 'AAPL' } };
const resolution = await agent.raiseIntent('ViewChart', context);
```

#### Add an Intent Listener

```js
await agent.addIntentListener('ViewChart', async context => {
  // Handle the intent
  console.log('Received context:', context);
});
```

### Working with Channels

#### Join a Channel

```js
const channel = await agent.getOrCreateChannel('myChannel');
await channel.join();
```

#### Broadcast Context on a Channel

```js
await channel.broadcast({ type: 'fdc3.instrument', id: { ticker: 'MSFT' } });
```

#### Listen for Context on a Channel

```js
channel.addContextListener('fdc3.instrument', context => {
  console.log('Received instrument context:', context);
});
```

### App Directory Setup

To enable app discovery and intent resolution, provide App Directory URLs when initializing the agent in the root window:

```js
const agent = await getAgent({
  appDirectoryEntries: ['http://localhost:4299/v2/apps'],
});
```

App directories can also be defined locally and pass as an array of Local App Definitions. Here we define a remote app directory that is loaded from the url and a local app directory where we pass app definitions:

```js
const agent = await getAgent({
  appDirectoryEntries: [
    'http://localhost:4299/v2/apps',
    [{ appId: 'fdc3-workbench', url: 'https://fdc3.finos.org/toolbox/fdc3-workbench/', title: 'FDC3 Workbench' }],
    ],
});
```

For more advanced usage, see the [test-harness](./projects/test-harness/README.md) example app.

#### Local App Directories with Live Updates

Local app directories can receive live updates via an async iterator. This is useful for dynamically adding or updating app definitions at runtime:

```ts
const updates: AsyncIterator<AppDirectoryApplication | AppDirectoryApplication[]>;

const agent = await getAgent({
  failover: () =>
    new DesktopAgentFactory().createRoot({
      appDirectoryEntries: [
        {
          host: 'my-domain.com',
          apps: [
            { appId: 'static-app', title: 'Static App', type: 'web', details: { url: 'https://example.com/static' } }
          ],
          updates,
        }
      ],
    }),
});
```

### Singleton Apps

Apps can be configured as singletons to prevent multiple instances from being opened. When the intent resolver UI is displayed, singleton apps with an active instance will not appear in the "Open New" section. Users can only select the existing instance.

Configure singleton behavior via the `hostManifests` property in your app directory entry:

```ts
{
  appId: 'my-singleton-app',
  title: 'My Singleton App',
  type: 'web',
  details: { url: 'https://example.com/singleton' },
  hostManifests: {
    'MorganStanley.fdc3-web': { singleton: true }
  }
}
```

## Custom Application Strategies

Application strategies control how apps are opened and selected. There are two types of strategies:

### Open Application Strategy

Defines how new app instances are launched. Implement `IOpenApplicationStrategy`:

```js
import { subscribeToConnectionAttemptUuids } from "@morgan-stanley/fdc3-web";

const customOpenStrategy = {
  manifestKey: 'MyCustomManifest', // Optional: key to extract from hostManifests
  
  canOpen: async (params) => {
    // Return true if this strategy can open the app
    return params.appDirectoryRecord.type === 'web';
  },
  
  open: async (params) => {
    const newWindow = window.open(params.appDirectoryRecord.details.url);
    // return connectionAttemptUUID received from new window
    return new Promise(resolve => {
        const subscriber = subscribeToConnectionAttemptUuids(
            window, // the current window
            newWindow,
            connectionAttemptUuid => {
                subscriber.unsubscribe();

                resolve(connectionAttemptUuid);
            },
        );
    });
  }
};
```

### Select Application Strategy

Defines how existing app instances are focused or brought to the foreground. Implement `ISelectApplicationStrategy`:

```js
const customSelectStrategy = {
  manifestKey: 'MyCustomManifest', // Optional: key to extract from hostManifests
  
  canSelectApp: async (params) => {
    // Return true if this strategy can select/focus the app
    return true;
  },
  
  selectApp: async (params) => {
    // Focus or bring the existing app instance to the foreground
    // params.appIdentifier contains the instanceId of the target app
  }
};
```

Pass strategies when creating the root agent:

```js
const agent = await getAgent({
  failover: () =>
    new DesktopAgentFactory().createRoot({
      applicationStrategies: [customOpenStrategy, customSelectStrategy],
    }),
});
```

Strategies are evaluated in order. The first strategy where `canOpen()` or `canSelectApp()` returns `true` will be used.

## Backoff Retry for App Directory Loading

When loading remote app directories, the agent can retry failed requests with exponential backoff:

```js
const agent = await getAgent({
  failover: () =>
    new DesktopAgentFactory().createRoot({
      appDirectoryEntries: ['https://my-app-directory.com/v2/apps'],
      backoffRetry: {
        maxAttempts: 5,    // Maximum number of retry attempts (default: 3)
        baseDelay: 500     // Initial delay in ms, doubles with each retry (default: 250)
      }
    }),
});
```

With `baseDelay: 500` and `maxAttempts: 5`, retries would occur at approximately 500ms, 1000ms, 2000ms, and 4000ms intervals.

### Controlling Logging Levels

The `getAgent` function accepts a `logLevels` parameter that allows fine-grained control over logging behavior:

```js
const agent = await getAgent({
  // other parameters...
  logLevels: {
    connection: LogLevel.INFO,  // Controls connection/handshake related logs
    proxy: LogLevel.WARN,       // Controls agent/proxy related logs
  }
});
```

Available log levels from `@finos/fdc3` are:

- `LogLevel.DEBUG` - Most verbose logging
- `LogLevel.INFO` - Standard information logging
- `LogLevel.WARN` - Warnings only
- `LogLevel.ERROR` - Errors only
- `LogLevel.NONE` - No logging

## Development Notes

- `lib` - The actual implementation of the fdc3 code. This library will be published for use in other applications.
- `messaging-provider` - A messaging provider for the fdc3 library. This is an implementation of the messaging-provider interface that provides communications between frames and windows, including in other domains. This will be published for use in other applications.
- `ui-provider` - A UI provider for the fdc3 library. This provides a Resolver and Channel Selector. This will be published for use in other applications.
- `test-harness` - A Lit app for testing local messaging between different apps working in the same context. Will depend on `lib`.

For most development running `npm start` will be sufficient to test implementation and cross-frame / cross origin communication. This will build and run `test-harness`.

### Commands

```bash

# Clean install all package dependencies
npm ci

# build all projects
npm run build

# Test all projects
npm run test

# Checks the code for lint errors
npm run lint 

# Run a full build (Compile, Tests, Lint)
npm run build:release

# test a single project
npx nx test fdc3-web 

# test a single project in watch mode
npx nx test fdc3-web --watch

# watch tests across all projects
npm run test:watch

```

### Development setup

We recommend using VSCode for the best development experience. We also recommend installing the following extensions

- ESLint
- Code Spell Checker

 If you wish to use another editors there are no known restrictions.
