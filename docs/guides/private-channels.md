# Private channels

A PrivateChannel connects two apps for a focused exchange. It includes the usual channel context API plus lifecycle events that let either app respond to subscriptions and disconnection.

## Create and share a channel

An app can create a private channel directly, but a common workflow is to return one from an intent handler:

```ts
await agent.addIntentListener('StartConversation', async context => {
    const channel = await agent.createPrivateChannel();

    await channel.addContextListener(null, message => {
        console.log('Received:', message);
    });

    return channel;
});
```

The caller resolves the intent as usual, then checks the result. This is the channel branch from the test harness:

```ts
import { getAgent, isPrivateChannel } from '@morgan-stanley/fdc3-web';

const agent = await getAgent();
const resolution = await agent.raiseIntent('StartConversation', {
    type: 'fdc3.contact',
    id: { email: 'person@example.com' },
});
const result = await resolution.getResult();

if (isPrivateChannel(result)) {
    await result.addContextListener(null, context => {
        console.log('Received:', context);
    });
    await result.broadcast({ type: 'fdc3.message', text: 'Hello' });
}
```

The example address is only a placeholder, not a directory record. Choose an intent, context and handler declared by your own App Directory.

## Listen for connection changes

Listen for specific events, or pass null to receive all of them:

| Event              | What it tells you                         |
| ------------------ | ----------------------------------------- |
| addContextListener | The other party added a context listener. |
| unsubscribe        | A context listener was removed.           |
| disconnect         | The other party disconnected.             |

```ts
await privateChannel.addEventListener('addContextListener', event => {
    console.log('Ready for:', event.details?.contextType);
});

await privateChannel.addEventListener('disconnect', () => {
    // Stop broadcasting and release associated resources.
});
```

## Disconnect cleanly

Call disconnect when the exchange is complete, and unsubscribe listeners when they are no longer needed. The harness removes its own channel reference after disconnecting. If a window closes without explicitly disconnecting, the root can notify other participants that the app has gone away.

The channel implementation checks the private channel's ID before delivering its events, keeping separate conversations isolated. Direct event listeners use the standard FDC3 listener unsubscribe method.

For a source-backed walkthrough, see [Private channel examples](../examples/private-channels.md), the [API reference](../api/modules.md), and the [FDC3 private-channel specification](https://fdc3.finos.org/docs/api/ref/PrivateChannel).
