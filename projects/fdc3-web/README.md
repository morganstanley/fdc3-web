# FDC3 Library

The FDC3 library is a powerful tool for building interoperable financial desktop applications based on the FINOS defined standard. It provides a set of APIs and protocols that enable seamless communication and data sharing between different applications within the financial ecosystem.

## Features

- **Contextual Data Sharing**: The FDC3 library allows applications to share context data, such as instrument details, user preferences, and workspace layouts, with other applications in a consistent and efficient manner.

- **Intent-based Communication**: With FDC3, applications can communicate with each other using intents, which represent high-level user actions. This enables applications to discover and launch relevant functionality in other applications, enhancing user productivity.

- **App Directory**: The library includes an app directory that provides a centralized registry of financial applications. Developers can leverage this directory to discover and integrate with other applications in the ecosystem.

## Example Usage

```typescript
import { DesktopAgentFactory } from '@morgan-stanley/fdc3-web';
import { rootWindowMessagingProviderFactory } from '@morgan-stanley/fdc3-web-messaging-provider';

const desktopAgentFactory = new DesktopAgentFactory();

// If in the root window of the application create the Root Desktop Agent
const fdc3 = desktopAgentFactory.createRoot('my-application', rootWindowMessagingProviderFactory)
```

```typescript
import { DesktopAgentFactory } from '@morgan-stanley/fdc3-web';
import { iframeMessagingProviderFactory } from '@morgan-stanley/fdc3-web-messaging-provider';

const desktopAgentFactory = new DesktopAgentFactory();

// If in the child window or Iframe of the application create a Proxy Desktop Agent
const fdc3 = desktopAgentFactory.createProxy('my-child-application', iframeMessagingProviderFactory)
```

```typescript
// Launch an application with a specific intent
fdc3.open('chart', { instrument: 'AAPL' });

// Share context data with other applications
fdc3.broadcast({ instrument: 'AAPL', timeframe: '1D' });

// Subscribe to context updates from other applications
fdc3.subscribe('instrument', (context) => {
    console.log('Received instrument update:', context);
});
```

## Development and Contribution

To contribute to the FDC3 library and its plugins, follow these steps:

1. Fork the repository on GitHub.
2. Clone the forked repository to your local machine.
3. Install the required dependencies using `npm install`.
4. Make your changes and ensure that the full build is executing successfully with `npm run build:release`.
5. Submit a pull request with your changes, providing a clear description of the modifications made.

We welcome contributions from the community and appreciate your efforts in improving the FDC3 library.
