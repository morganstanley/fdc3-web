/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { BridgingTypes, GetAgentLogLevels, LogLevel } from '@finos/fdc3';
import { BRIDGE } from '../constants.js';
import { BridgeConnectionState, IBridgeTransport, Subscription } from '../contracts.js';
import {
    createLogger,
    isBridgeErrorResponseMessage,
    isBridgeResponseMessage,
    LoggerFunction,
} from '../helpers/index.js';

type PendingEntry = {
    typeCheck: (value: any) => boolean;
    resolve: (value: any) => void;
    reject: (error: BridgingTypes.ResponseErrorDetail) => void;
    timeoutId: ReturnType<typeof setTimeout>;
};

export type BridgeMessageCorrelatorParams = {
    transport: IBridgeTransport;
    responseTimeoutMs?: number;
    logLevels?: GetAgentLogLevels;
};

/**
 * Correlates outbound bridge requests with their eventual response(s) by requestUuid. A single
 * requestUuid may have more than one waiting caller registered against it - this is what makes
 * raiseIntent's two-phase response (an immediate raiseIntentResponse, followed much later by an
 * unsolicited raiseIntentResultResponse correlated by the same requestUuid) possible without one
 * settling tearing down the other.
 */
export class BridgeMessageCorrelator {
    private readonly log: LoggerFunction;
    private readonly pending = new Map<string, Set<PendingEntry>>();
    private readonly messageSubscription: Subscription;
    private readonly stateSubscription: Subscription;

    constructor(private readonly params: BridgeMessageCorrelatorParams) {
        this.log = createLogger(BridgeMessageCorrelator, 'connection', params.logLevels);
        this.messageSubscription = params.transport.subscribe(message => this.onMessage(message));
        this.stateSubscription = params.transport.onStateChange(state => this.onStateChange(state));
    }

    /**
     * Resolves on the (possibly collated) success response to requestUuid, even when the response
     * carries partial errorSources/errorDetails. Rejects with the BridgeErrorResponse's payload.error,
     * or with 'ApiTimeout' if no response arrives within timeoutMs.
     */
    public awaitResponse<T extends BridgingTypes.BridgeResponseMessage>(
        requestUuid: string,
        typeCheck: (value: any) => value is T,
        timeoutMs?: number,
    ): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            this.register(
                requestUuid,
                typeCheck,
                resolve,
                reject,
                timeoutMs ?? this.params.responseTimeoutMs ?? BRIDGE.RESPONSE_TIMEOUT_MS,
            );
        });
    }

    /**
     * Registers a listener for a LATER, unsolicited response against the same requestUuid (e.g.
     * raiseIntentResultResponse). Must be registered before the request is sent, alongside an
     * awaitResponse() call for the immediate response.
     */
    public awaitLateResponse<T extends BridgingTypes.BridgeResponseMessage>(
        requestUuid: string,
        typeCheck: (value: any) => value is T,
        timeoutMs: number,
    ): { promise: Promise<T>; cancel: () => void } {
        let entry: PendingEntry | undefined;

        const promise = new Promise<T>((resolve, reject) => {
            entry = this.register(requestUuid, typeCheck, resolve, reject, timeoutMs);
        });

        return {
            promise,
            cancel: () => {
                if (entry != null) {
                    this.remove(requestUuid, entry);
                }
            },
        };
    }

    public close(): void {
        this.messageSubscription.unsubscribe();
        this.stateSubscription.unsubscribe();
        this.rejectAll('AgentDisconnected');
    }

    private register(
        requestUuid: string,
        typeCheck: (value: any) => boolean,
        resolve: (value: any) => void,
        reject: (error: BridgingTypes.ResponseErrorDetail) => void,
        timeoutMs: number,
    ): PendingEntry {
        const entries = this.pending.get(requestUuid) ?? new Set<PendingEntry>();
        this.pending.set(requestUuid, entries);

        const entry: PendingEntry = {
            typeCheck,
            resolve,
            reject,
            timeoutId: setTimeout(() => this.settleReject(requestUuid, entry, 'ApiTimeout'), timeoutMs),
        };

        entries.add(entry);

        return entry;
    }

    private remove(requestUuid: string, entry: PendingEntry): void {
        clearTimeout(entry.timeoutId);

        const entries = this.pending.get(requestUuid);
        entries?.delete(entry);

        if (entries != null && entries.size === 0) {
            this.pending.delete(requestUuid);
        }
    }

    private settleReject(requestUuid: string, entry: PendingEntry, error: BridgingTypes.ResponseErrorDetail): void {
        this.remove(requestUuid, entry);
        entry.reject(error);
    }

    private rejectAll(error: BridgingTypes.ResponseErrorDetail): void {
        for (const [requestUuid, entries] of [...this.pending.entries()]) {
            for (const entry of [...entries]) {
                this.settleReject(requestUuid, entry, error);
            }
        }
    }

    private onMessage(message: unknown): void {
        if (isBridgeErrorResponseMessage(message)) {
            const entries = this.pending.get(message.meta.requestUuid);

            if (entries == null) {
                return;
            }

            // isBridgeErrorResponseMessage already asserted payload.error is a string
            const error = message.payload.error as BridgingTypes.ResponseErrorDetail;

            for (const entry of [...entries]) {
                this.settleReject(message.meta.requestUuid, entry, error);
            }
            return;
        }

        if (!isBridgeResponseMessage(message)) {
            return;
        }

        if (message.meta.errorSources != null && message.meta.errorSources.length > 0) {
            this.log(
                'Response partially failed - some connected agents errored or timed out',
                LogLevel.WARN,
                message.meta.errorSources,
                message.meta.errorDetails,
            );
        }

        const entries = this.pending.get(message.meta.requestUuid);

        if (entries == null) {
            return;
        }

        for (const entry of [...entries]) {
            if (entry.typeCheck(message)) {
                this.remove(message.meta.requestUuid, entry);
                entry.resolve(message);
            }
        }
    }

    private onStateChange(state: BridgeConnectionState): void {
        if (state === 'disconnected') {
            this.rejectAll('AgentDisconnected');
        }
    }
}
