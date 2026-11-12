# Channels

Channels give applications a way to exchange context: a typed object describing something such as an instrument, contact or trade. Listening and broadcasting are separate operations, and your app's current user channel controls broadcasts made directly on the agent.

## User channels

An app joins one of the channels returned by the agent, listens on its current channel, then broadcasts context:

```ts
const agent = await getAgent();
const channels = await agent.getUserChannels();

if (channels[0]) await agent.joinUserChannel(channels[0].id);

const listener = await agent.addContextListener('fdc3.instrument', (context, metadata) => {
    console.log('Instrument:', context, 'Source:', metadata?.source);
});

await agent.broadcast({
    type: 'fdc3.instrument',
    id: { ticker: 'AAPL' },
});

await agent.leaveCurrentChannel();
await listener.unsubscribe();
```

The Desktop Agent can provide channel selection UI through the optional ChannelSelectorComponent. What the end user sees is controlled by your host integration.

## App channels

Use a named app channel when participating apps need a shared channel other than the current user channel. getOrCreateChannel returns the existing channel or creates it.

```ts
const channel = await agent.getOrCreateChannel('orders');

await channel.addContextListener('fdc3.instrument', context => {
    console.log(context.id?.ticker);
});

await channel.broadcast({
    type: 'fdc3.instrument',
    id: { ticker: 'MSFT' },
});
```

The latest context can be retrieved with channel.getCurrentContext(), optionally restricted to a context type. This follows the FDC3 Channel contract rather than the implementation's private internals.

## Private channels

Private channels provide point-to-point communication and lifecycle events, so producers can stop publishing when their counterpart goes away. Create one directly, or return it from an intent handler as the intent result.

```ts
const privateChannel = await agent.createPrivateChannel();

const events = await privateChannel.addEventListener('disconnect', () => {
    console.log('The other application disconnected');
});

await privateChannel.addContextListener(null, context => {
    console.log('Private context:', context);
});

// When you're finished:
await events.unsubscribe();
await privateChannel.disconnect();
```

Unlike user or app channels, private channels report addContextListener, unsubscribe and disconnect events. See [Private channels](private-channels.md) for the intent-result pattern used in the harness.

_Examples follow the FDC3 DesktopAgent API and the test harness's Channels UI. FDC3 defines the semantics for context delivery and channel types._
