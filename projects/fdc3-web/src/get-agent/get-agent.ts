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
    GetAgentLogLevels,
    GetAgentParams,
    GetAgentType,
    LogLevel,
} from '@finos/fdc3';
import { DesktopAgentFactory } from '../agent/index.js';
import { DEFAULT_AGENT_DISCOVERY_TIMEOUT, FDC3_READY_EVENT } from '../constants.js';
import { IProxyMessagingProvider } from '../contracts.js';
import {
    createLogger,
    discoverProxyCandidates,
    generateHelloMessage,
    generateValidateIdentityMessage,
    isWCPHandshake,
    isWCPSuccessResponse,
} from '../helpers/index.js';
import { DefaultProxyMessagingProvider } from '../messaging-provider/index.js';

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

    const existingAgent = await Promise.race([
        waitForPreloadAgent(params?.timeoutMs),
        waitForProxyAgent(params?.identityUrl, params),
    ]);

    //TODO: look for details of existing agent in session storage

    if (existingAgent != null) {
        return existingAgent;
    }

    if (typeof params?.failover === 'function') {
        proxyLog(`calling failover function`, LogLevel.INFO);
        // a failover function has been provided.
        const failoverResult = await params.failover(params);

        if (failoverResult instanceof Window) {
            proxyLog(`failover function returned a window`, LogLevel.INFO);
            return Promise.reject(`Failover Window result not currently supported`);
        }

        proxyLog(`Failover function created agent`, LogLevel.INFO);

        return failoverResult;
    }

    proxyLog(`rejecting as no agent found and no failover function provided`, LogLevel.ERROR);
    return Promise.reject(AgentError.AgentNotFound);
};

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
 * Attempts to locate a parent DesktopAgent and establish communication with it
 */
async function waitForProxyAgent(identityUrl?: string, params?: GetAgentParams): Promise<DesktopAgent> {
    connectionLog(`waitForProxyAgent called`, LogLevel.DEBUG);
    const candidates = discoverProxyCandidates();

    windowHelloListeners = [];

    const helloMessage = generateHelloMessage(identityUrl);

    connectionLog(`${candidates.length} candidates found`, LogLevel.DEBUG, candidates);

    const messagePort = await Promise.race(candidates.map(candidate => attemptHandshake(helloMessage, candidate)));
    connectionLog(`messagePort received`, LogLevel.DEBUG);

    cleanUp();

    return createProxyAgent(helloMessage.meta.connectionAttemptUuid, messagePort, identityUrl, params?.logLevels);
}

/**
 * Sets up communication with root DesktopAgent by performing handshake and creating a new ProxyDesktopAgent
 */
async function createProxyAgent(
    connectionAttemptUuid: string,
    messagePort: MessagePort,
    identityUrl?: string,
    logLevels?: GetAgentLogLevels,
): Promise<DesktopAgent> {
    connectionLog(`createProxyAgent called`, LogLevel.DEBUG, { connectionAttemptUuid, identityUrl });
    const messagingProvider = new DefaultProxyMessagingProvider(messagePort);
    const appValidationResponse = await performAppValidation(messagingProvider, connectionAttemptUuid, identityUrl);

    const proxyAgent = new DesktopAgentFactory().createProxy({
        appIdentifier: {
            appId: appValidationResponse.payload.appId,
            instanceId: appValidationResponse.payload.instanceId,
        },
        messagingProviderFactory: () => Promise.resolve(messagingProvider),
        logLevels: logLevels,
    });

    connectionLog(`proxy agent created`, LogLevel.DEBUG, proxyAgent);

    return proxyAgent;
}

/**
 * Sends a WebConnectionProtocol4ValidateAppIdentity to root agent and waits for the response
 */
function performAppValidation(
    messagingProvider: IProxyMessagingProvider,
    connectionAttemptUuid: string,
    identityUrl?: string,
): Promise<BrowserTypes.WebConnectionProtocol5ValidateAppIdentitySuccessResponse> {
    connectionLog(`performAppValidation called`, LogLevel.DEBUG, { connectionAttemptUuid, identityUrl });
    const validateIdentityMessage = generateValidateIdentityMessage(connectionAttemptUuid, identityUrl);

    const responsePromise = new Promise<BrowserTypes.WebConnectionProtocol5ValidateAppIdentitySuccessResponse>(
        resolve => {
            messagingProvider.addResponseHandler(message => {
                if (
                    isWCPSuccessResponse(message.payload) &&
                    validateIdentityMessage.meta.connectionAttemptUuid === message.payload.meta.connectionAttemptUuid
                ) {
                    connectionLog(`app validation response received`, LogLevel.DEBUG, message.payload);
                    resolve(message.payload);
                }
                //TODO: handle error response
            });
        },
    );

    messagingProvider.sendMessage({
        payload: validateIdentityMessage,
    });

    return responsePromise;
}

/**
 * Tries to establish communication with specified window
 * If communication is established a MessagePort is returned
 * @param window
 */
function attemptHandshake(
    helloMessage: BrowserTypes.WebConnectionProtocol1Hello,
    candidate: Window,
): Promise<MessagePort> {
    return new Promise<MessagePort>(resolve => {
        if (windowHelloListeners == null) {
            // if there is no array to record our listeners for later tidy up assume that an agent has already been located and return
            return;
        }

        const eventListener = (event: MessageEvent): void => {
            //TODO: handle WebConnectionProtocol2LoadURL messages as well
            if (
                isWCPHandshake(event.data) &&
                event.data.meta.connectionAttemptUuid === helloMessage.meta.connectionAttemptUuid &&
                event.ports[0] != null
            ) {
                connectionLog(`handshake response received`, LogLevel.INFO);
                resolve(event.ports[0]);
            }
        };
        candidate.postMessage(helloMessage, { targetOrigin: '*' });

        // keep track of event listeners
        windowHelloListeners.push(eventListener);
        window.addEventListener('message', eventListener);
    });
}

/**
 * used for testing so that we can run getAgent() more than once
 * this is an internal function and is deliberately not exported in the barrel
 */
export function resetCachedPromise(): void {
    agentPromise = undefined;
}
