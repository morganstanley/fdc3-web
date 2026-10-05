# FDC3 3.0 browser automation

Run from the repository root:

```sh
npm ci
npx playwright install chromium
npx nx e2e test-harness-e2e
npm run test:e2e:report
```

Use `npx nx e2e test-harness-e2e --grep=raiseIntent` for a subset, `--headed` to see the browser, or `npm run test:e2e:ui` for Playwright's interactive runner. `npm run test:e2e` and `npx nx e2e test-harness` are shortcuts for the same target. The separate `test-harness-e2e` project owns test execution and depends on the harness; the harness target is only a convenience alias. Type checking: `npx tsc -p projects/test-harness-e2e/tsconfig.json`.

`npm run build:release` requires this E2E target to pass. Nx builds the harness and type-checks the browser tests before running Playwright, and shares one E2E execution across all release targets. Install Chromium using the command above before a local release build; on Linux, `npx playwright install --with-deps chromium` also installs required system libraries. Both CI workflows perform that installation before `build:release`, so a failing browser test blocks the build and release publishing.

The configuration starts the harness and app-directory servers, including built apps on different origins (ports 4300–4305). Ports 4200 and 4299 are also required. Outside CI an existing harness server can be reused; stop it after changing harness code so that cross-origin apps are rebuilt. Each test gets a fresh browser context and desktop agent. The suite controls the app-directory response to provide deterministic applications; it does not mock FDC3 APIs or messages. Chromium is the initial browser target. The Nx target disables Node 24's native environment proxy handling for the Playwright process (`NODE_USE_ENV_PROXY=0`). Playwright handles proxies itself, and its configuration adds localhost bypasses while preserving existing exclusions. This prevents local readiness checks being sent through the corporate proxy without a custom launcher.

HTML reports contain named helper steps, exact API arguments, callbacks, and assertions. Failures retain a screenshot, video and trace in `test-results/`. Tests locate controls by `automation-id` and apps by their iframe's `data-app-url`, including an instance index for duplicate apps. They do not read arbitrary div text, use private implementation objects, or sleep to wait for message delivery.

The app-frame helpers, automation IDs and HTML reporting are adapted from the agent-bridging work (#389), which is not yet merged. This suite tests a single desktop agent across application origins; it does not need or start the bridge server.

## API explorer

Each harness app now includes an expandable **FDC3 API explorer**. Choose a method, enter a JSON argument array, and run it. The result is displayed as structured JSON. A saved result name retains the actual Channel, Listener or IntentResolution in that app so subsequent calls can target it. Array results use names such as `channels.0`.

- `{"$ref":"channel"}` passes a saved object as an argument or handler result.
- `{"$undefined":true}` passes explicit undefined. An absent array entry at the end is omitted entirely; `null` remains null.
- `{"$handler":"received"}` records each callback and returns void.
- `{"$handler":"received","returns":{"type":"fdc3.nothing"}}` records callbacks and returns a promise of that result.
- `{"$handler":"received","rejects":"example"}` returns a rejected promise.

`connection.html` provides the same explorer without automatically connecting, allowing first-call `getAgent` options to be exercised. The explorer does not implement any FDC3 behavior; it invokes the same public agent used by the rest of the harness.

## Coverage matrix

Source: the FDC3 3.0 API reference (DesktopAgent, Channel, PrivateChannel, GetAgent and Types). These are the current 3.0 docs, not the versioned 2.x docs.

| API                                                          | Variations and assertions                                                                                                                                   | Spec                                                         |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `getAgent`                                                   | First call with omitted/empty options, timeout, identity URL, UI flags, dontSetWindowFdc3, log levels and unused failover; cached calls; no agent available | get-agent, applications                                      |
| `getInfo`                                                    | Implementation version/provider and calling app identity                                                                                                    | applications                                                 |
| `getAppMetadata`                                             | App ID alone and exact app instance                                                                                                                         | applications                                                 |
| `findInstances`                                              | Running, unopened, newly opened and closed apps                                                                                                             | applications                                                 |
| `open`                                                       | Context omitted, null, supplied; metadata with and without context; cross-origin delivery and returned instance; unknown app                                | applications                                                 |
| `close`                                                      | Calling iframe is destroyed and disappears from instance discovery                                                                                          | applications                                                 |
| `findIntent`                                                 | Context omitted/supplied; result type supplied with and without context; unknown intent; incompatible result type                                           | intents, regressions                                         |
| `findIntentsByContext`                                       | Result type omitted/supplied; incompatible result type                                                                                                      | intents, regressions                                         |
| `addIntentListener`                                          | Register, invoke, conflict, unsubscribe and re-register                                                                                                     | intents                                                      |
| `addIntentListenerWithContext`                               | Single type, multiple types, disjoint registrations and conflicts                                                                                           | intents                                                      |
| `raiseIntent`                                                | Optional arguments omitted; context null/undefined/nothing; app or instance target; newInstance omitted/null/false/true; metadata; unavailable targets      | intents, applications, errors                                |
| `raiseIntentForContext`                                      | App omitted/null/specified, instance specified; newInstance omitted/null/false/true; metadata; resolver selection; unavailable targets                      | intents, applications, errors                                |
| `getResult`                                                  | Void, Context, ContextWithMetadata unwrapping, app Channel, PrivateChannel, rejected handler                                                                | intents, result-metadata                                     |
| `getResultMetadata`                                          | Context, wrapped context with custom metadata, void and channel results; source, timestamp, trace ID; repeated reads                                        | result-metadata, regressions                                 |
| `getUserChannels`                                            | IDs, user type and display metadata                                                                                                                         | channels                                                     |
| `getCurrentChannel`                                          | Initially null, joined channel and null after leave                                                                                                         | channels                                                     |
| `joinUserChannel`, `leaveCurrentChannel`                     | Join, repeated join/leave, unknown channel, membership events and context replay                                                                            | channels, listener-edge-cases                                |
| `DesktopAgent.broadcast`                                     | With/without metadata; actual delivery and provenance; malformed context; no membership                                                                     | channels, errors, listener-edge-cases                        |
| `DesktopAgent.addContextListener`                            | Null, single type, type array; unsubscribe; invalid arrays; existing-context replay and channel switching                                                   | channels, listener-edge-cases                                |
| `DesktopAgent.addEventListener`                              | Null, userChannelChanged, contextCleared; unsubscribe                                                                                                       | channels, listener-edge-cases                                |
| `getOrCreateChannel`                                         | Creation and shared identity across apps; private-channel access denied                                                                                     | channels, private-channels                                   |
| `Channel.broadcast`                                          | App/user/private channels, metadata omitted/supplied, delivery and cached state; malformed context                                                          | channels, private-channels, errors                           |
| `Channel.addContextListener`                                 | Null/single/array filters; unsubscribe; no replay; invalid arrays; overlapping listeners                                                                    | channels, private-channels, listener-edge-cases, regressions |
| `Channel.getCurrentContext`, `getCurrentContextWithMetadata` | All channel kinds; empty channel, latest context, named type, missing type; provenance                                                                      | channels                                                     |
| `Channel.clearContext`                                       | All channel kinds; type supplied/omitted, other types preserved, context and metadata removed, events, no stale replay                                      | channels, private-channels, listener-edge-cases              |
| `Channel.addEventListener`                                   | Null and contextCleared; unsubscribe                                                                                                                        | channels                                                     |
| `createPrivateChannel`                                       | Unique identities, private type, sharing through intent results, access control                                                                             | private-channels                                             |
| `PrivateChannel.addEventListener`                            | Null, addContextListener, unsubscribe, disconnect, contextCleared                                                                                           | private-channels                                             |
| `PrivateChannel.disconnect`                                  | Remote lifecycle notification after real channel use                                                                                                        | private-channels                                             |
| `Listener.unsubscribe`                                       | Context, intent, agent event, channel event and private event listeners                                                                                     | channels, intents, private-channels                          |

The matrix covers each documented public function and its optional-argument forms. It is not a claim of full FDC3 conformance: bridge behavior, signed-message cryptographic verification, preload adaptors, successful failover into another agent, popup policies and every possible argument cross-product are outside this suite.

## Regression coverage

The five implementation gaps identified by the original suite are fixed. The six tests that exposed them now run as ordinary assertions, with no `test.fail` annotations:

- Overlapping channel subscriptions deliver each broadcast once per local handler.
- Both intent-discovery functions apply `resultType` filters to directory apps and running instances. No matching apps produces `NoAppsFound`, as required by the 3.0 docs.
- Rejected or throwing intent handlers produce `IntentHandlerRejected`; both `getResult()` and `getResultMetadata()` reject.
- The agent generates intent-result trace IDs while preserving other app-provided result metadata.
- `getAgent({ dontSetWindowFdc3: true })` leaves `window.fdc3` unset and does not fire `fdc3Ready`.

The regression names retain their original GAP identifiers for traceability. For handler failures, this implementation uses an optional `error` field on its internal `intentResultRequest` payload because the current upstream DACP schema has no handler-failure field. Successful result requests retain the standard payload, and the agent forwards errors in the standard `raiseIntentResultResponse` error field. Receiving handler failures through a third-party proxy requires equivalent protocol support.
