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
import { ResponsePart } from './collate.js';
import { RequestRoute } from './request-routes.js';

export type RecordedResult = { ok: Record<string, any> } | { err: BridgingTypes.ResponseErrorDetail };

interface PendingEntry {
    requestUuid: string;
    route: RequestRoute;
    request: BridgingTypes.AgentRequestMessage;
    originator: string;
    /** Fixed at open() time, in recipient-enumeration order - this is what makes the eventual
     *  collated response deterministic given a fixed roster. */
    recipients: string[];
    outstanding: Set<string>;
    results: Map<string, RecordedResult>;
    timer: ReturnType<typeof setTimeout>;
}

/**
 * Owns the "wait for N agents to answer requestUuid, then collate" state machine shared by every
 * request/response family (kind: 'request' in request-routes.ts) - collation over a single
 * recipient degenerates to pass-through, so a targeted request (open/raiseIntent/getAppMetadata) and
 * a broadcast one (findIntent/findIntentsByContext) go through exactly the same code here.
 *
 * Does not itself decide *who* the recipients are, or short-circuit an unknown destination - see
 * message-router.ts. Only owns what happens once recipients are known: the timer(s), duplicate/late
 * response rejection, disconnect handling, and building the final response.
 */
export class PendingRequests {
    private readonly entries = new Map<string, PendingEntry>();

    constructor(
        private readonly registry: AgentRegistry,
        private readonly logger: Logger,
    ) {}

    /**
     * `recipients.length === 0` (the zero-other-agents case for a broadcast-style family) settles
     * immediately with the route's own empty collation - never an error, since no agent has failed.
     */
    public open(params: {
        requestUuid: string;
        route: RequestRoute;
        request: BridgingTypes.AgentRequestMessage;
        originator: string;
        recipients: string[];
    }): void {
        if (params.recipients.length === 0) {
            const payload = params.route.collate([], params.request);
            this.deliver(
                params.originator,
                createBridgeResponseMessage(params.route.responseType, payload, params.requestUuid),
            );
            return;
        }

        const entry: PendingEntry = {
            requestUuid: params.requestUuid,
            route: params.route,
            request: params.request,
            originator: params.originator,
            recipients: params.recipients,
            outstanding: new Set(params.recipients),
            results: new Map(),
            timer: setTimeout(() => this.onTimeout(params.requestUuid), params.route.timeoutMs),
        };

        this.entries.set(params.requestUuid, entry);
    }

    /** First response for a given (requestUuid, agentName) wins; anything after is a late/duplicate
     *  no-op, logged at DEBUG since the usual cause is the bridge already having timed the agent out. */
    public recordResponse(requestUuid: string, agentName: string, result: RecordedResult): void {
        const entry = this.entries.get(requestUuid);

        if (entry == null) {
            this.logger.debug(
                `Ignoring response from ${agentName} for unknown or already-settled request ${requestUuid}`,
            );
            return;
        }

        if (!entry.outstanding.delete(agentName)) {
            this.logger.debug(`Ignoring late or duplicate response from ${agentName} for request ${requestUuid}`);
            return;
        }

        entry.results.set(agentName, result);

        if (entry.outstanding.size === 0) {
            this.settle(entry);
        }
    }

    /**
     * A disconnected agent is resolved immediately rather than waiting out its timer (mirrors the
     * fdc3-web client's own correlator on transport disconnect). If the disconnected agent was the
     * *originator* of a still-outstanding request, the whole collation is discarded silently - there
     * is no one left to deliver a response to, and the already-forwarded requests will still be
     * answered by their targets, which must land on the unknown-requestUuid no-op path.
     */
    public handleAgentDisconnected(agentName: string): void {
        for (const entry of [...this.entries.values()]) {
            if (entry.originator === agentName) {
                this.discard(entry);
                continue;
            }

            if (entry.outstanding.delete(agentName)) {
                entry.results.set(agentName, { err: 'AgentDisconnected' });

                if (entry.outstanding.size === 0) {
                    this.settle(entry);
                }
            }
        }
    }

    private onTimeout(requestUuid: string): void {
        const entry = this.entries.get(requestUuid);

        if (entry == null) {
            return;
        }

        for (const agentName of entry.outstanding) {
            entry.results.set(agentName, { err: 'ResponseToBridgeTimedOut' });
        }

        entry.outstanding.clear();
        this.settle(entry);
    }

    private settle(entry: PendingEntry): void {
        this.entries.delete(entry.requestUuid);
        clearTimeout(entry.timer);

        // the originator may have disconnected while this collation was still outstanding - revalidate
        // immediately before sending rather than relying solely on the close-time discard above.
        if (this.registry.getByName(entry.originator) == null) {
            return;
        }

        this.deliver(entry.originator, buildResponse(entry));
    }

    private discard(entry: PendingEntry): void {
        this.entries.delete(entry.requestUuid);
        clearTimeout(entry.timer);
    }

    private deliver(originator: string, message: unknown): void {
        this.registry.getByName(originator)?.connection.send(message);
    }
}

function buildResponse(
    entry: PendingEntry,
): BridgingTypes.BridgeResponseMessage | BridgingTypes.BridgeErrorResponseMessage {
    const successes: ResponsePart[] = [];
    const sources: BridgingTypes.DesktopAgentIdentifier[] = [];
    const errorSources: BridgingTypes.DesktopAgentIdentifier[] = [];
    const errorDetails: BridgingTypes.ResponseErrorDetail[] = [];

    for (const agentName of entry.recipients) {
        const result = entry.results.get(agentName);

        if (result == null) {
            continue;
        }

        if ('ok' in result) {
            successes.push({ desktopAgent: agentName, payload: result.ok });
            sources.push({ desktopAgent: agentName });
        } else {
            errorSources.push({ desktopAgent: agentName });
            errorDetails.push(result.err);
        }
    }

    if (successes.length === 0) {
        return createBridgeErrorResponseMessage(
            entry.route.responseType,
            selectAggregateError(errorDetails),
            entry.requestUuid,
            errorSources,
            errorDetails,
        );
    }

    const payload = entry.route.collate(successes, entry.request);

    return createBridgeResponseMessage(entry.route.responseType, payload, entry.requestUuid, {
        sources,
        errorSources,
        errorDetails,
    });
}

/** All identical -> that value (the common case for a targeted family, which degenerates to
 *  passing through the one target's own error); else the first non-timeout entry, to preserve the
 *  most informative signal; else (all timeouts) 'ResponseToBridgeTimedOut'. */
function selectAggregateError(errorDetails: BridgingTypes.ResponseErrorDetail[]): BridgingTypes.ResponseErrorDetail {
    if (new Set(errorDetails).size === 1) {
        return errorDetails[0];
    }

    return errorDetails.find(error => error !== 'ResponseToBridgeTimedOut') ?? 'ResponseToBridgeTimedOut';
}
