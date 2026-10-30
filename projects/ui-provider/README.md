# FDC3 UI Provider Plugin

The FDC3 UI Provider plugin is a powerful addition to the FDC3 library that enhances the user experience by providing a Resolver UI and a colored channel selector UI.

## Resolver UI
The Resolver UI allows users to easily select the target application for an Intent or Context. It simplifies the process of choosing the appropriate application to handle specific actions, improving efficiency and user satisfaction.

## Colored Channel Selector UI
The UI Provider plugin also includes a colored channel selector UI. This feature enables multiple applications to share broadcast context events. Users can easily identify and interact with different channels, enhancing collaboration and communication within the FDC3 ecosystem.

## Customizable Componentry
The UI Provider componentry is built with Lit, a lightweight and efficient web component library. It is fully customizable, allowing developers to seamlessly integrate it with their applications. The UI can be easily themed to match the host application's aesthetics, ensuring a consistent and cohesive user experience.

## Example Usage

To configure the `AppResolverComponent` on the `DesktopAgent` when calling `DesktopAgentFactory.createRoot`, follow these steps:

1. Import the necessary modules:
```typescript
import { DesktopAgentFactory, DesktopAgent } from '@morgan-stanley/fdc3-web';

const desktopAgentFactory = new DesktopAgentFactory();
```

2. Configure the `DesktopAgent` with the `AppResolverComponent`:
```typescript
const fdc3 = desktopAgentFactory.createRoot('my-application',
    (agent: DesktopAgent) => Promise.resolve(new AppResolverComponent(document, agent))
    )
```

5. The user will now be presented a Resolver UI to resolve intents within your application.
