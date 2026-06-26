/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import {
    AgentError,
    BrowserTypes,
    DesktopAgent,
    DesktopAgentDetails,
    GetAgentParams,
    GetAgentType,
    LogLevel,
    WebDesktopAgentType,
} from '@finos/fdc3';
import { DesktopAgentFactory } from '../agent/index.js';
import { DEFAULT_AGENT_DISCOVERY_TIMEOUT, FDC3_READY_EVENT } from '../constants.js';
import { IProxyMessagingProvider } from '../contracts.js';
import {
    createLogger,
    discoverProxyCandidates,
    generateHelloMessage,
    generateValidateIdentityMessage,
    getDesktopAgentDetails,
    isWCPFailedResponse,
    isWCPHandshake,
    isWCPLoadUrl,
    isWCPSuccessResponse,
    setDesktopAgentDetails,
} from '../helpers/index.js';
import { DefaultProxyMessagingProvider } from '../messaging-provider/index.js';

/**
 * Details of an established Desktop Agent Proxy connection, gathered during the discovery step of
 * the Web Connection Protocol and consumed by the identity validation step.
 */
type ProxyConnection = {
    messagePort: MessagePort;
    handshake: BrowserTypes.WebConnectionProtocol3Handshake;
    agentType: WebDesktopAgentType;
    /** URL loaded into a hidden iframe to establish the connection (WCP2LoadUrl / persisted reconnection). */
    agentUrl?: string;
};

/**
 * subsequent calls to getAgent just return this promise.
 * The first call to get agent "wins" and it's parameters are used to create the agent.
 * any parameters on subsequent calls are ignored
 */
let agentPromise: Promise<DesktopAgent> | undefined;

/**
 * Function used to retrieve an FDC3 Desktop Agent API instance, which
 * supports the discovery of a Desktop Agent Preload (a container-injected
 * API implementation) or a Desktop Agent Proxy (a Browser-based Desktop Agent
 * running in another window or frame). Finally, if no Desktop Agent is found,
 * a failover function may be supplied by app allowing it to start or otherwise
 * connect to a Desktop Agent (e.g. by loading a proprietary adaptor that
 * returns a `DesktopAgent` implementation or by creating a window or iframe of
 * its own that will provide a Desktop Agent Proxy.
 *
 * @param {GetAgentParams} params Optional parameters object, which
 * may include a URL to use for the app's identity, other settings
 * that affect the behavior of the getAgent() function and a `failover`
 * function that should be run if a Desktop Agent is not detected.
 *
 * @returns A promise that resolves to a DesktopAgent implementation or
 * rejects with an error message from the `AgentError` enumeration if unable to
 * return a Desktop Agent implementation.
 *
 * @example
 * const fdc3 = await getAgent();
 *
 * // OR
 *
 * getAgent({
 *     identityUrl: "https://example.com/path?param=appName#example",
 *     channelSelector: false,
 *     intentResolver: false
 * }).then((fdc3) => {
 *     //do FDC3 stuff here
 * };
 */
export const getAgent: GetAgentType = async (params?: GetAgentParams): Promise<DesktopAgent> => {
    if (agentPromise != null) {
        if (params != null) {
            console.warn(`Parameters passed to getAgent ignored`, params);
            console.warn(
                `Only the parameters called to the first invocation of getAgent are used. After that the same promise is returned to all invocations`,
            );
        }

        return agentPromise;
    }

    agentPromise = getAgentImpl(params);

    return agentPromise;
};

// Default loggers - will be configured with user options when getAgent is called
let connectionLog = createLogger(getAgent, 'connection');
let proxyLog = createLogger(getAgent, 'proxy');

const getAgentImpl: GetAgentType = async (params?: GetAgentParams): Promise<DesktopAgent> => {
    // Configure logging based on params if available
    if (params?.logLevels) {
        // Create new loggers with custom settings
        connectionLog = createLogger(getAgent, 'connection', params.logLevels);
        proxyLog = createLogger(getAgent, 'proxy', params.logLevels);
    }

    proxyLog(`getAgent called with params:`, LogLevel.DEBUG, params);

    const identityUrl = params?.identityUrl ?? window.location.href;

    // WCP Step 1.1: Check SessionStorage for details of a prior connection (e.g. before a navigation
    // or refresh event). When present these are used to reconnect to the same agent and reclaim the
    // same instanceId, and to limit discovery to the previously used mechanism.
    const storedDetails = getDesktopAgentDetails(identityUrl);
    if (storedDetails != null) {
        connectionLog(`found persisted DesktopAgentDetails for ${identityUrl}`, LogLevel.DEBUG, storedDetails);
    }

    const existingAgent = await discoverAgent(identityUrl, params, storedDetails);

    if (existingAgent != null) {
        return existingAgent;
    }

    if (typeof params?.failover === 'function') {
        return runFailover(identityUrl, params, storedDetails);
    }

    proxyLog(`rejecting as no agent found and no failover function provided`, LogLevel.ERROR);
    return Promise.reject(AgentError.AgentNotFound);
};

/**
 * Attempts to discover a Desktop Agent, limiting the discovery mechanism to the one previously used
 * when reconnecting (per WCP step 1.2).
 */
async function discoverAgent(
    identityUrl: string,
    params: GetAgentParams | undefined,
    storedDetails: DesktopAgentDetails | undefined,
): Promise<DesktopAgent | undefined> {
    switch (storedDetails?.agentType) {
        case WebDesktopAgentType.Preload:
            return waitForPreloadAgent(params?.timeoutMs);
        case WebDesktopAgentType.ProxyParent:
        case WebDesktopAgentType.ProxyUrl:
            return waitForProxyAgent(identityUrl, params, storedDetails);
        default:
            // No (or non-discovery) prior connection - look for both interface types in parallel.
            return Promise.race([
                waitForPreloadAgent(params?.timeoutMs),
                waitForProxyAgent(identityUrl, params, storedDetails),
            ]);
    }
}

// timeout reference so we can clean it up later
let fdc3ReadyTimeOut: number | undefined;

// We keep a reference to the event handler here so we can unsubscribe from any function
let onFdc3Ready: (() => void) | undefined;

/**
 * This function is called when we have resolved an agent interface
 * It removes all event listeners and clears all timeouts
 */
function cleanUp(): void {
    connectionLog(`cleanUp called`, LogLevel.DEBUG);
    if (fdc3ReadyTimeOut != null) {
        clearTimeout(fdc3ReadyTimeOut);
    }

    if (onFdc3Ready != null) {
        window.removeEventListener(FDC3_READY_EVENT, onFdc3Ready);
    }

    if (windowHelloListeners != null) {
        windowHelloListeners.forEach(listener => {
            window.removeEventListener('message', listener);
        });
    }

    windowHelloListeners = undefined;
}

/**
 * This function returns the desktop agent at window.fdc3 if it has been set.
 * If it has not been set it waits for the fdc3Ready event and then returns window.fdc3
 * If no event is received then undefined is returned after the timeout which defaults to 750ms
 */
function waitForPreloadAgent(optionalTimeout?: number): Promise<DesktopAgent | undefined> {
    connectionLog(`waitForPreloadAgent called`, LogLevel.DEBUG);
    if (window.fdc3 != null) {
        return Promise.resolve(window.fdc3);
    }

    const timeoutInMs = optionalTimeout ?? DEFAULT_AGENT_DISCOVERY_TIMEOUT;

    return new Promise((resolve, reject) => {
        // timeout after 5 seconds if fdc3 ready event not fired
        fdc3ReadyTimeOut = setTimeout(() => {
            connectionLog(`timed out looking for existing agent`, LogLevel.INFO);
            cleanUp();
            resolve(undefined);
        }, timeoutInMs) as any; // Typed as any as Typescript gets confused between nodejs types and browser types

        onFdc3Ready = () => {
            cleanUp();

            if (window.fdc3 != null) {
                resolve(window.fdc3);
            } else {
                connectionLog(`reject as window.fdc3 is null when fdc3 ready fired`, LogLevel.ERROR);

                reject(AgentError.AgentNotFound);
            }
        };

        window.addEventListener('fdc3Ready', onFdc3Ready);
    });
}

// keep track of window listeners so we can remove them later
let windowHelloListeners: ((event: MessageEvent) => void)[] | undefined;

/**
 * Attempts to locate a parent DesktopAgent and establish communication with it.
 * Resolves to undefined if no Desktop Agent Proxy is discovered within the timeout, allowing the
 * caller to fall back to a failover function or reject with AgentNotFound.
 */
async function waitForProxyAgent(
    identityUrl: string,
    params?: GetAgentParams,
    storedDetails?: DesktopAgentDetails,
): Promise<DesktopAgent | undefined> {
    connectionLog(`waitForProxyAgent called`, LogLevel.DEBUG);

    windowHelloListeners = windowHelloListeners ?? [];

    const helloMessage = generateHelloMessage(identityUrl, {
        channelSelector: params?.channelSelector,
        intentResolver: params?.intentResolver,
    });

    const connection = await discoverProxyConnection(helloMessage, params, storedDetails);

    if (connection == null) {
        connectionLog(`no Desktop Agent Proxy discovered within timeout`, LogLevel.INFO);
        return undefined;
    }

    connectionLog(`messagePort received`, LogLevel.DEBUG);

    cleanUp();

    return createProxyAgent(helloMessage.meta.connectionAttemptUuid, connection, identityUrl, params, storedDetails);
}

/**
 * Discovers a Desktop Agent Proxy connection, racing all candidate parent windows/frames against a
 * discovery timeout. If the persisted details indicate a previously loaded agent URL, discovery is
 * skipped and the URL is loaded directly into a hidden iframe (per WCP step 1.2).
 */
function discoverProxyConnection(
    helloMessage: BrowserTypes.WebConnectionProtocol1Hello,
    params?: GetAgentParams,
    storedDetails?: DesktopAgentDetails,
): Promise<ProxyConnection | undefined> {
    const timeoutInMs = params?.timeoutMs ?? DEFAULT_AGENT_DISCOVERY_TIMEOUT;

    return new Promise<ProxyConnection | undefined>((resolve, reject) => {
        const timeout = setTimeout(() => resolve(undefined), timeoutInMs) as any;

        const onConnected = (connection: ProxyConnection): void => {
            clearTimeout(timeout);
            resolve(connection);
        };
        const onError = (error: unknown): void => {
            clearTimeout(timeout);
            reject(error);
        };

        if (storedDetails?.agentUrl != null) {
            // Reconnecting to a previously loaded agent URL - skip discovery and load it directly.
            connectToAgentUrl(helloMessage, storedDetails.agentUrl).then(onConnected, onError);
            return;
        }

        const candidates = discoverProxyCandidates();
        connectionLog(`${candidates.length} candidates found`, LogLevel.DEBUG, candidates);

        // Accept the first candidate to complete a handshake. Non-responding candidates simply never
        // resolve and are cleaned up when the discovery timeout fires.
        candidates.forEach(candidate => connectToProxyTarget(helloMessage, candidate).then(onConnected, onError));
    });
}

/**
 * Establishes communication with a single candidate window/frame.
 * Sends a WCP1Hello and resolves once a WCP3Handshake (with MessagePort) is received. If the
 * candidate instead responds with a WCP2LoadUrl, the supplied URL is loaded into a hidden iframe and
 * the handshake is completed against the iframe.
 */
async function connectToProxyTarget(
    helloMessage: BrowserTypes.WebConnectionProtocol1Hello,
    candidate: Window,
): Promise<ProxyConnection> {
    const response = await awaitWcpResponse(helloMessage, candidate);

    if (isWCPHandshake(response.data)) {
        return { messagePort: response.ports[0], handshake: response.data, agentType: WebDesktopAgentType.ProxyParent };
    }

    // WCP2LoadUrl: load the provided URL into a hidden iframe and restart the protocol against it.
    connectionLog(`WCP2LoadUrl received, loading agent URL into hidden iframe`, LogLevel.INFO);
    return connectToAgentUrl(
        helloMessage,
        (response.data as BrowserTypes.WebConnectionProtocol2LoadURL).payload.iframeUrl,
    );
}

/**
 * Loads an agent URL into a hidden iframe and completes the WCP handshake against it.
 */
async function connectToAgentUrl(
    helloMessage: BrowserTypes.WebConnectionProtocol1Hello,
    agentUrl: string,
): Promise<ProxyConnection> {
    const iframeWindow = await loadHiddenIframe(agentUrl);

    // Only a WCP3Handshake is valid here - a hidden agent iframe must not send another WCP2LoadUrl.
    const response = await awaitWcpResponse(helloMessage, iframeWindow, true);

    return {
        messagePort: response.ports[0],
        handshake: response.data as BrowserTypes.WebConnectionProtocol3Handshake,
        agentType: WebDesktopAgentType.ProxyUrl,
        agentUrl,
    };
}

/**
 * Posts a WCP1Hello to the target window and resolves with the first correct response.
 * Correct responses are WCP3Handshake (with a MessagePort) or, unless handshakeOnly is set,
 * WCP2LoadUrl - both must quote the connectionAttemptUuid from the original WCP1Hello.
 */
function awaitWcpResponse(
    helloMessage: BrowserTypes.WebConnectionProtocol1Hello,
    targetWindow: Window,
    handshakeOnly: boolean = false,
): Promise<MessageEvent> {
    return new Promise<MessageEvent>(resolve => {
        if (windowHelloListeners == null) {
            // if there is no array to record our listeners assume a connection has already been made
            return;
        }

        const eventListener = (event: MessageEvent): void => {
            if (event.data?.meta?.connectionAttemptUuid !== helloMessage.meta.connectionAttemptUuid) {
                return;
            }

            if (isWCPHandshake(event.data) && event.ports[0] != null) {
                connectionLog(`handshake response received`, LogLevel.INFO);
                resolve(event);
            } else if (!handshakeOnly && isWCPLoadUrl(event.data)) {
                connectionLog(`load url response received`, LogLevel.INFO);
                resolve(event);
            }
        };

        // keep track of event listeners
        windowHelloListeners.push(eventListener);
        window.addEventListener('message', eventListener);

        targetWindow.postMessage(helloMessage, { targetOrigin: '*' });
    });
}

/**
 * Creates a hidden iframe pointing at the supplied URL, resolving with its contentWindow once loaded.
 * Rejects with AgentError.ErrorOnConnect if the iframe fails to provide a contentWindow.
 */
function loadHiddenIframe(url: string): Promise<WindowProxy> {
    return new Promise<WindowProxy>((resolve, reject) => {
        const iframe = document.createElement('iframe');
        iframe.onload = () => {
            if (iframe.contentWindow != null) {
                resolve(iframe.contentWindow);
            } else {
                reject(AgentError.ErrorOnConnect);
            }
        };
        iframe.onerror = () => reject(AgentError.ErrorOnConnect);
        iframe.src = url;
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.visibility = 'hidden';
        iframe.ariaHidden = 'true';
        document.body.appendChild(iframe);
    });
}

/**
 * Runs the application supplied failover function (per WCP step 1.2, sub-step 6).
 * The function may resolve to a DesktopAgent (returned directly) or a WindowProxy (against which the
 * WCP handshake is restarted). Any other result rejects with AgentError.InvalidFailover.
 */
async function runFailover(
    identityUrl: string,
    params: GetAgentParams,
    storedDetails: DesktopAgentDetails | undefined,
): Promise<DesktopAgent> {
    proxyLog(`calling failover function`, LogLevel.INFO);
    const failoverResult = await params.failover!(params);

    if (failoverResult instanceof Window) {
        proxyLog(`failover function returned a window, restarting WCP handshake against it`, LogLevel.INFO);

        windowHelloListeners = windowHelloListeners ?? [];
        const helloMessage = generateHelloMessage(identityUrl, {
            channelSelector: params.channelSelector,
            intentResolver: params.intentResolver,
        });

        // Restart the handshake against the supplied window, bounded by the discovery timeout. A
        // window that never completes the handshake rejects with ErrorOnConnect (per WCP step 1.2).
        const connection = await withTimeout(
            connectToProxyTarget(helloMessage, failoverResult),
            params.timeoutMs ?? DEFAULT_AGENT_DISCOVERY_TIMEOUT,
            AgentError.ErrorOnConnect,
        );
        cleanUp();

        return createProxyAgent(
            helloMessage.meta.connectionAttemptUuid,
            { ...connection, agentType: WebDesktopAgentType.Failover },
            identityUrl,
            params,
            storedDetails,
        );
    }

    if (isDesktopAgent(failoverResult)) {
        proxyLog(`Failover function created agent`, LogLevel.INFO);
        return failoverResult;
    }

    proxyLog(`failover function returned an unsupported result type`, LogLevel.ERROR, failoverResult);
    return Promise.reject(AgentError.InvalidFailover);
}

/**
 * Rejects with the supplied error if the wrapped promise does not settle within timeoutMs.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, error: unknown): Promise<T> {
    return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(error), timeoutMs))]);
}

/**
 * Type guard distinguishing a DesktopAgent returned by a failover function from other (invalid)
 * return values. A WindowProxy is handled separately before this is reached, so any non-null object
 * is treated as a DesktopAgent and anything else (null, primitives) is an invalid failover result.
 */
function isDesktopAgent(value: unknown): value is DesktopAgent {
    return value != null && typeof value === 'object';
}

/**
 * Sets up communication with root DesktopAgent by validating identity and creating a new ProxyDesktopAgent
 */
async function createProxyAgent(
    connectionAttemptUuid: string,
    connection: ProxyConnection,
    identityUrl: string,
    params?: GetAgentParams,
    storedDetails?: DesktopAgentDetails,
): Promise<DesktopAgent> {
    connectionLog(`createProxyAgent called`, LogLevel.DEBUG, { connectionAttemptUuid, identityUrl });
    const messagingProvider = new DefaultProxyMessagingProvider(connection.messagePort);
    const appValidationResponse = await performAppValidation(
        messagingProvider,
        connectionAttemptUuid,
        identityUrl,
        storedDetails,
    );

    const proxyAgent = new DesktopAgentFactory().createProxy({
        appIdentifier: {
            appId: appValidationResponse.payload.appId,
            instanceId: appValidationResponse.payload.instanceId,
        },
        messagingProviderFactory: () => Promise.resolve(messagingProvider),
        logLevels: params?.logLevels,
    });

    // Inject any channel selector / intent resolver UIs the Desktop Agent asked us to provide.
    injectUserInterfaces(connection.handshake);

    // WCP Step 3: persist connection details so a subsequent navigation/refresh can reconnect.
    setDesktopAgentDetails({
        agentType: connection.agentType,
        identityUrl,
        actualUrl: window.location.href,
        agentUrl: connection.agentUrl,
        appId: appValidationResponse.payload.appId,
        instanceId: appValidationResponse.payload.instanceId,
        instanceUuid: appValidationResponse.payload.instanceUuid,
    });

    connectionLog(`proxy agent created`, LogLevel.DEBUG, proxyAgent);

    return proxyAgent;
}

/**
 * Injects hidden iframes for the channel selector / intent resolver UIs when the Desktop Agent
 * supplies a URL for them in the WCP3Handshake. A boolean `true` indicates the reference UI should
 * be used; as no default reference UI URL is bundled, this is logged and skipped.
 */
function injectUserInterfaces(handshake: BrowserTypes.WebConnectionProtocol3Handshake): void {
    injectUserInterface('channel selector', handshake.payload.channelSelectorUrl);
    injectUserInterface('intent resolver', handshake.payload.intentResolverUrl);
}

function injectUserInterface(name: string, url: boolean | string): void {
    if (typeof url === 'string') {
        connectionLog(`injecting ${name} UI iframe`, LogLevel.DEBUG, url);
        loadHiddenIframe(url).catch(error => connectionLog(`failed to load ${name} UI iframe`, LogLevel.ERROR, error));
    } else if (url === true) {
        connectionLog(`${name} reference UI requested but no default URL is configured; skipping`, LogLevel.WARN);
    }
}

/**
 * Sends a WebConnectionProtocol4ValidateAppIdentity to root agent and waits for the response.
 * Resolves with the success response, or rejects with AgentError.AccessDenied if the Desktop Agent
 * rejects the app's identity (WCP5ValidateAppIdentityFailedResponse).
 */
function performAppValidation(
    messagingProvider: IProxyMessagingProvider,
    connectionAttemptUuid: string,
    identityUrl?: string,
    storedDetails?: DesktopAgentDetails,
): Promise<BrowserTypes.WebConnectionProtocol5ValidateAppIdentitySuccessResponse> {
    connectionLog(`performAppValidation called`, LogLevel.DEBUG, { connectionAttemptUuid, identityUrl });
    const validateIdentityMessage = generateValidateIdentityMessage(
        connectionAttemptUuid,
        identityUrl,
        storedDetails?.instanceId,
        storedDetails?.instanceUuid,
    );

    const responsePromise = new Promise<BrowserTypes.WebConnectionProtocol5ValidateAppIdentitySuccessResponse>(
        (resolve, reject) => {
            messagingProvider.addResponseHandler(message => {
                const payload = message.payload;

                if (
                    isWCPSuccessResponse(payload) &&
                    payload.meta.connectionAttemptUuid === validateIdentityMessage.meta.connectionAttemptUuid
                ) {
                    connectionLog(`app validation response received`, LogLevel.DEBUG, payload);
                    resolve(payload);
                } else if (
                    isWCPFailedResponse(payload) &&
                    payload.meta.connectionAttemptUuid === validateIdentityMessage.meta.connectionAttemptUuid
                ) {
                    connectionLog(`app validation failed`, LogLevel.ERROR, payload);
                    reject(AgentError.AccessDenied);
                }
            });
        },
    );

    messagingProvider.sendMessage({
        payload: validateIdentityMessage,
    });

    return responsePromise;
}

/**
 * used for testing so that we can run getAgent() more than once
 * this is an internal function and is deliberately not exported in the barrel
 */
export function resetCachedPromise(): void {
    agentPromise = undefined;
}
