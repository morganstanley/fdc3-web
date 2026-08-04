/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { BridgingTypes, Context, GetAgentLogLevels, LogLevel } from '@finos/fdc3';
import { BridgeConnectionState, IBridgeTransport, Subscription } from '../contracts.js';
import {
    createLogger,
    generateUUID,
    isBridgingAuthenticationFailed,
    isBridgingConnectedAgentsUpdate,
    isBridgingHello,
    LoggerFunction,
} from '../helpers/index.js';
import { createHandshakeMessage } from './bridge-message.factory.js';

export type ChannelsState = { [channelId: string]: Context[] };

export type BridgeConnectionParams = {
    transport: IBridgeTransport;
    /** Desktop Agent name requested from the bridge. */
    requestedName: string;
    authToken?: string;
    validateBridgeAuthToken?: (authToken: string | undefined) => boolean | Promise<boolean>;
    getImplementationMetadata: () => Promise<BridgingTypes.ConnectingAgentImplementationMetadata>;
    getChannelsState: () => ChannelsState;
    adoptChannelsState: (state: ChannelsState) => void;
    onRemoteAgentDisconnected: (desktopAgent: string) => void;
    logLevels?: GetAgentLogLevels;
};

/**
 * Implements Desktop Agent Bridging connection Steps 2-6
 * (https://fdc3.finos.org/docs/agent-bridging/spec): validates `hello`, sends `handshake`, adopts
 * the assigned agent name and merged channel state from `connectedAgentsUpdate`, and notifies on
 * remote agent departures (explicit or implicit).
 */
export class BridgeConnection {
    private readonly log: LoggerFunction;
    private assignedName: string | undefined;
    private handshakeRequestUuid: string | undefined;
    private knownAgents = new Set<string>();
    private messageSubscription: Subscription | undefined;

    constructor(private readonly params: BridgeConnectionParams) {
        this.log = createLogger(BridgeConnection, 'connection', params.logLevels);
    }

    /** The name assigned to this agent by the bridge, or undefined until the handshake completes. */
    public get agentName(): string | undefined {
        return this.assignedName;
    }

    public connect(): void {
        this.messageSubscription = this.params.transport.subscribe(message => void this.onMessage(message));
        this.params.transport.onStateChange(state => this.onTransportStateChange(state));
        this.params.transport.connect();
    }

    public close(): void {
        this.messageSubscription?.unsubscribe();
    }

    private onTransportStateChange(state: BridgeConnectionState): void {
        if (state === 'disconnected') {
            this.handleDisconnected();
        }
    }

    private handleDisconnected(): void {
        this.assignedName = undefined;
        this.handshakeRequestUuid = undefined;

        const departed = [...this.knownAgents];
        this.knownAgents.clear();
        departed.forEach(desktopAgent => this.params.onRemoteAgentDisconnected(desktopAgent));
    }

    private async onMessage(message: unknown): Promise<void> {
        if (isBridgingHello(message)) {
            await this.handleHello(message);
            return;
        }

        if (isBridgingAuthenticationFailed(message)) {
            this.log(`Authentication failed: ${message.payload.message ?? 'unknown reason'}`, LogLevel.ERROR);
            this.handleDisconnected();
            // advance past the port that just rejected us - avoids hot-looping against it
            this.params.transport.reset();
            return;
        }

        if (isBridgingConnectedAgentsUpdate(message)) {
            this.handleConnectedAgentsUpdate(message);
        }
    }

    private async handleHello(message: BridgingTypes.ConnectionStep2Hello): Promise<void> {
        this.log(`Received hello from bridge v${message.payload.desktopAgentBridgeVersion}`, LogLevel.DEBUG);

        if (message.payload.authRequired) {
            const validate = this.params.validateBridgeAuthToken;

            if (validate != null) {
                const valid = await validate(message.payload.authToken);

                if (!valid) {
                    this.log('Bridge auth token failed validation', LogLevel.ERROR);
                    this.params.transport.reset();
                    return;
                }
            } else {
                // no validator configured - trust the bridge rather than refuse to connect by default
                this.log('Bridge requires authentication but no validateBridgeAuthToken was configured', LogLevel.WARN);
            }
        }

        const [implementationMetadata, channelsState] = await Promise.all([
            this.params.getImplementationMetadata(),
            Promise.resolve(this.params.getChannelsState()),
        ]);

        this.handshakeRequestUuid = generateUUID();

        this.params.transport.send(
            createHandshakeMessage(this.handshakeRequestUuid, {
                implementationMetadata,
                requestedName: this.params.requestedName,
                channelsState,
                ...(this.params.authToken != null ? { authToken: this.params.authToken } : {}),
            }),
        );
    }

    private handleConnectedAgentsUpdate(message: BridgingTypes.ConnectionStep6ConnectedAgentsUpdate): void {
        // correlating on the handshake's own requestUuid is what distinguishes OUR addAgent (our
        // assigned name) from a later broadcast about a different agent joining - adopting addAgent
        // unconditionally would let a second agent joining silently rename us
        const isOurHandshakeReply =
            message.meta.requestUuid === this.handshakeRequestUuid && message.payload.addAgent != null;

        if (isOurHandshakeReply) {
            this.assignedName = message.payload.addAgent;
            this.log(`Connected to Desktop Agent Bridge as '${this.assignedName}'`, LogLevel.INFO);

            if (message.payload.channelsState != null) {
                this.params.adoptChannelsState(message.payload.channelsState);
            }
        }

        const updatedAgents = new Set(
            message.payload.allAgents
                .map(agent => agent.desktopAgent)
                .filter(desktopAgent => desktopAgent !== this.assignedName),
        );

        const departed = [...this.knownAgents].filter(desktopAgent => !updatedAgents.has(desktopAgent));
        this.knownAgents = updatedAgents;

        departed.forEach(desktopAgent => this.params.onRemoteAgentDisconnected(desktopAgent));
    }
}
