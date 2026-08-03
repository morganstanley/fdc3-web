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
import { isContextLike } from './type-predicate.helper.js';

interface ChannelEntry {
    context: BridgingTypes.Context;
    seq: number;
}

/**
 * The bridge's merged view of user/app channel state (private channels are excluded - see the
 * schema note on ConnectionStep3HandshakePayload.channelsState), handed to newly-joining agents in
 * connectedAgentsUpdate.
 *
 * Storing one Context per (channelId, context.type), keyed by a monotonic seq, makes both schema
 * invariants structural rather than defensive: "one Context per type per channel" falls out of the
 * Map key, and "most recent first" falls out of sorting by seq. Context carries no timestamp of its
 * own, so the bridge's own observation order is the only global ordering authority - seq is that
 * assertion made concrete.
 */
export class ChannelsState {
    private readonly channels = new Map<string, Map<string, ChannelEntry>>();
    private seq = 0;
    /**
     * A second, always-non-positive axis for handshake-merged entries, kept strictly separate from
     * `seq` (which starts at 1 and only grows via applyBroadcast) so a merged entry can never be
     * mistaken for real, bridge-observed activity - see mergeFromHandshake.
     */
    private historicalSeq = 0;

    /** Called for every broadcastRequest (never PrivateChannel.broadcast), before fan-out. */
    public applyBroadcast(channelId: unknown, context: unknown): void {
        if (typeof channelId !== 'string' || !isContextLike(context)) {
            return;
        }

        const channel = this.channels.get(channelId) ?? new Map<string, ChannelEntry>();
        this.channels.set(channelId, channel);
        channel.set(context.type, { context: context as BridgingTypes.Context, seq: ++this.seq });
    }

    /**
     * Merges a joining agent's own channelsState in. Existing federation state wins for a
     * (channelId, type) the bridge already knows - it was derived from an observed broadcast and is
     * what every connected agent already holds, whereas the joiner's copy may be arbitrarily stale.
     * Unknown types are added as the oldest entries - a strict improvement with no displacement.
     *
     * Each newly-adopted context is assigned `base - index`, where `index` is its position in the
     * incoming (already most-recent-first) array and `base` is a running total that only decreases
     * across calls. That preserves the incoming array's own relative order and guarantees every
     * merged value is <= 0, and therefore always sorts behind any real (>= 1) applyBroadcast entry,
     * however many broadcasts have or haven't happened yet.
     */
    public mergeFromHandshake(incoming: Record<string, BridgingTypes.Context[]> | undefined): void {
        if (incoming == null) {
            return;
        }

        for (const [channelId, contexts] of Object.entries(incoming)) {
            if (!Array.isArray(contexts)) {
                continue;
            }

            const channel = this.channels.get(channelId) ?? new Map<string, ChannelEntry>();
            this.channels.set(channelId, channel);

            const base = this.historicalSeq;

            contexts.forEach((context, index) => {
                if (!isContextLike(context) || channel.has(context.type)) {
                    return;
                }

                channel.set(context.type, { context, seq: base - index });
            });

            this.historicalSeq = base - contexts.length;
        }
    }

    public toWireFormat(): Record<string, BridgingTypes.Context[]> {
        const result: Record<string, BridgingTypes.Context[]> = {};

        for (const [channelId, entries] of this.channels) {
            result[channelId] = [...entries.values()].sort((a, b) => b.seq - a.seq).map(entry => entry.context);
        }

        return result;
    }
}
