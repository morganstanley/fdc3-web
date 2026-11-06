# Exchange context over a private channel

The test-harness app exposes every part of this flow: create a channel, return one from an intent, listen for context, observe lifecycle events and disconnect.

## Start a channel

The harness's createPrivateChannel method is deliberately small:

```ts
const agent = await getAgent();
const privateChannel = await agent.createPrivateChannel();

this.currentChannels[privateChannel.id] = privateChannel;
this.anyPrivateChannels = true;
```

Keep a reference to the returned PrivateChannel in your app. It has an agent-assigned id rather than one supplied by the caller.

## Listen for context and events

Context listeners follow the standard Channel API. All context types can be selected by passing null:

```ts
await privateChannel.addContextListener(null, (context, metadata) => {
    console.log('Private context:', context, metadata);
});

await privateChannel.addEventListener('disconnect', event => {
    console.log('Disconnected:', event);
});
```

In the harness, addPrivateChannelEventListener treats the UI's "all events" selection as null and subscribes with:

```ts
await privateChannel.addEventListener(eventType, (...args) => {
    this.log('Received Event:', args);
});
```

Here eventType is narrowed by the exported isPrivateChannelEventTypes helper, or null for all events.

## Return it from an intent

The harness checks its selected private channel inside its intent listener. If one is selected, the listener returns that channel instead of the default result context:

```ts
await agent.addIntentListener(intent, async (...args) => {
    this.log('Received Intent:', args);

    if (this.selectedPrivateChannel.value != '') {
        return Object.entries(this.currentChannels).find(([id]) => id === this.selectedPrivateChannel.value)?.[1];
    }

    return {
        type: 'ms.test-harness.raiseIntentResult',
        raisedIntent: intent,
        selectedApp: this.appIdentifier?.appId,
    };
});
```

The caller receives it through resolution.getResult(). isPrivateChannel narrows the result before it broadcasts or subscribes. The harness uses the exported isChannel helper to recognise both ordinary Channel and PrivateChannel results.

## Disconnect

```ts
if (privateChannel.type === 'private') {
    await privateChannel.disconnect();
    delete this.currentChannels[privateChannel.id];
}
```

The harness drops the channel from its local lookup when the exchange is over. Also unsubscribe context and event listeners your application no longer needs.

## Source

[DefaultApp private-channel methods and intent handling](https://github.com/morganstanley/fdc3-web/blob/main/projects/test-harness/src/default-app/default-app.ts) and [end-to-end channel tests](https://github.com/morganstanley/fdc3-web/blob/main/projects/test-harness-e2e/src/tests/private-channels.spec.ts) provide the exact implementation and tested behaviour behind this guide.
