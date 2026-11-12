# Intents

An intent expresses an action without hard-coding an application. fdc3-web matches the intent and context against App Directory records, then uses its application strategies and resolver to launch or select a handler.

## Raise an intent

The harness's raiseIntent method awaits both the resolution and its result. A result can be context or a Channel, including a PrivateChannel.

```ts
const agent = await getAgent();
const resolution = await agent.raiseIntent('ViewChart', {
    type: 'fdc3.instrument',
    id: { ticker: 'AAPL' },
});

console.log('Handled by:', resolution.source);
const result = await resolution.getResult();
```

Await getResult inside your error handling. The harness distinguishes Channel results using the library's isChannel and isPrivateChannel type predicates. Other results are context objects.

## Handle an intent

Use an intent listener to receive context and return a result. This condensed version retains the harness's logic:

```ts
const returnedContext = {
    type: 'ms.test-harness.raiseIntentResult',
    raisedIntent: 'ViewAnalysis',
    selectedApp: 'app-1-root',
};

await agent.addIntentListener('ViewAnalysis', async context => {
    console.log('Received intent context:', context);
    return returnedContext;
});
```

An async handler can return context or a channel. A PrivateChannel result supports a two-way exchange after the initial request; see the [private-channel example](../examples/private-channels.md).

## Choose a handler by context

raiseIntentForContext asks for a suitable intent without naming it:

```ts
const resolution = await agent.raiseIntentForContext({ type: 'fdc3.contact' });
console.log(resolution.intent, resolution.source);
const result = await resolution.getResult();
```

You can inspect possible handlers with findIntent and findIntentsByContext. The optional AppResolverComponent lets a user select an app and, where appropriate, a running instance.

## Declare support in the App Directory

The test harness App Directory declares ViewChart with fdc3.instrument among the intents listened for by app-1-root. Other apps declare different intents and contexts, giving a useful local example of resolver choices. The raising app's interop.intents.raises section describes what it can raise.

```json
{
    "appId": "app-1-root",
    "interop": {
        "intents": {
            "listensFor": {
                "ViewChart": { "contexts": ["fdc3.instrument"] }
            }
        }
    }
}
```

See the complete [app opening and intent example](../examples/applications.md), the live harness instructions in [Getting started](../getting-started.md), or the [FINOS intent specification](https://fdc3.finos.org/docs/intents/spec).
