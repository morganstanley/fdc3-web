/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import { BridgingTypes } from '@finos/fdc3';
import { AgentRegistry } from '../agent-registry.js';
import { Logger } from '../logger.js';
import { createBridgeErrorResponseMessage, createBridgeResponseMessage } from '../message.factory.js';
import { RecordedResult } from './pending-requests.js';

interface RelayEntry {
    originator: string;
    target: string;
    timer: ReturnType<typeof setTimeout>;
}

/**
 * raiseIntentResultResponse has no request of its own - it is a later, unsolicited message
 * correlated purely by the original raiseIntentRequest's requestUuid, arriving from the *target*
 * agent (not the originator) at some point after the immediate raiseIntentResponse. This table has
 * a lifetime measured in minutes rather than the seconds PendingRequests deals with, and a
 * completely different settlement shape (relay one message, not collate N), which is why it is kept
 * separate rather than folded into PendingRequests.
 */
export class IntentResultRelay {
    private readonly entries = new Map<string, RelayEntry>();

    constructor(
        private readonly registry: AgentRegistry,
        private readonly ttlMs: number,
        private readonly logger: Logger,
    ) {}

    /** Opened at forward time (when raiseIntentRequest is sent to its target), not on phase-1
     *  success - see dropOnPhase1Error for why phase 1 settling as an error must tear this down. */
    public open(requestUuid: string, originator: string, target: string): void {
        const timer = setTimeout(() => this.onTimeout(requestUuid), this.ttlMs);
        this.entries.set(requestUuid, { originator, target, timer });
    }

    public relay(requestUuid: string, result: RecordedResult): void {
        const entry = this.entries.get(requestUuid);

        if (entry == null) {
            this.logger.debug(
                `Dropping raiseIntentResultResponse for unknown or already-settled request ${requestUuid}`,
            );
            return;
        }

        clearTimeout(entry.timer);
        this.entries.delete(requestUuid);
        this.deliver(entry.originator, entry.target, requestUuid, result);
    }

    /**
     * The fdc3-web client's correlator rejects every pending entry under a requestUuid on any
     * error-shaped response - so the moment the bridge sends an error-shaped raiseIntentResponse (or
     * synthesizes one from a phase-1 timeout/disconnect), the originator's late listener for this
     * requestUuid is already dead. Relaying a result after that would be pointless (nothing is
     * listening) and is dropped silently rather than sent.
     */
    public dropOnPhase1Error(requestUuid: string): void {
        const entry = this.entries.get(requestUuid);

        if (entry != null) {
            clearTimeout(entry.timer);
            this.entries.delete(requestUuid);
        }
    }

    /** If the disconnected agent was the *target* of a live entry, the originating app would
     *  otherwise wait out the full relay TTL for a result that can never arrive - send it an error
     *  immediately instead. If it was the *originator*, there is no one left to deliver to. */
    public handleAgentDisconnected(agentName: string): void {
        for (const [requestUuid, entry] of [...this.entries.entries()]) {
            if (entry.target === agentName) {
                clearTimeout(entry.timer);
                this.entries.delete(requestUuid);
                this.deliver(entry.originator, entry.target, requestUuid, { err: 'AgentDisconnected' });
            } else if (entry.originator === agentName) {
                clearTimeout(entry.timer);
                this.entries.delete(requestUuid);
            }
        }
    }

    private onTimeout(requestUuid: string): void {
        const entry = this.entries.get(requestUuid);

        if (entry == null) {
            return;
        }

        this.entries.delete(requestUuid);
        this.deliver(entry.originator, entry.target, requestUuid, { err: 'ResponseToBridgeTimedOut' });
    }

    private deliver(originator: string, target: string, requestUuid: string, result: RecordedResult): void {
        const session = this.registry.getByName(originator);

        if (session == null) {
            return;
        }

        const message: BridgingTypes.BridgeResponseMessage | BridgingTypes.BridgeErrorResponseMessage =
            'ok' in result
                ? createBridgeResponseMessage('raiseIntentResultResponse', result.ok, requestUuid)
                : createBridgeErrorResponseMessage(
                      'raiseIntentResultResponse',
                      result.err,
                      requestUuid,
                      [{ desktopAgent: target }],
                      [result.err],
                  );

        session.connection.send(message);
    }
}
