# fdc3-web

![Lifecycle Incubating](https://badgen.net/badge/Lifecycle/Incubating/yellow)
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
      appDirectoryUrls: ['http://localhost:4299/v2/apps'],
      openStrategies: [{
        canOpen: (params: OpenApplicationStrategyParams) => { /* define whether an app should open */ },
        open: (params: OpenApplicationStrategyParams) => { /* define how an app should open */ }
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
  appDirectoryUrls: ['http://localhost:4299/v2/apps'],
});

// Fetch available applications
import { getAppDirectoryApplications } from '@morgan-stanley/fdc3-web';
const apps = await getAppDirectoryApplications('http://localhost:4299/v2/apps');
```

For more advanced usage, see the [test-harness](./projects/test-harness/README.md) example app.

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
