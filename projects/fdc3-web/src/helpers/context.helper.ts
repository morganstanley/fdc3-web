/* Morgan Stanley makes this available to you under the Apache License,
 * Version 2.0 (the "License"). You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0.
 * See the NOTICE file distributed with this work for additional information
 * regarding copyright ownership. Unless required by applicable law or agreed
 * to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions
 * and limitations under the License. */

import type { ContextHandler, ContextType } from '@finos/fdc3';

/**
 * Converts implementation addContextListener parameters to those required by fdc3 addContextListener method
 * @param handlerOrContextType is either handler for context received on channel or type of context being listened for
 * @param optionalContextHandler is handler for context received on channel, depending on version of signature used
 * @returns type of context that context listener will listen for, and handler that will be called when context of that type is received
 */
export function resolveContextType(
    handlerOrContextType: ContextHandler | null | ContextType,
    optionalContextHandler?: ContextHandler,
): { contextType: ContextType | null; contextHandler: ContextHandler } {
    const contextType = typeof handlerOrContextType === 'string' ? handlerOrContextType : null;
    const contextHandler = typeof handlerOrContextType === 'function' ? handlerOrContextType : optionalContextHandler;
    if (contextHandler == null) {
        //function overloading should prevent this from happening but we need this check for type checking
        throw new Error('Context handler must be defined');
    }
    return { contextType, contextHandler };
}
