/**
 * CommandDispatcher — request/response semantics over R_Sync's one-way events.
 *
 * R_Sync only offers fire-and-forget events in each direction. The dispatcher
 * turns an orchestrator → node COMMAND event plus the node's COMMAND_RESULT
 * reply into a single awaited promise, correlated by a cryptographically random
 * commandId and bounded by a timeout.
 */

import { ClusterEvents, buildCommandEnvelope } from './protocol.js';

const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;

class CommandDispatcher {

    /**
     * @param {(workerId, eventName, data) => Promise} sendFn - transport send (R_Sync.sendTo)
     * @param {() => string} idFn - commandId generator
     */
    constructor(sendFn, idFn) {
        this._sendFn = sendFn;
        this._idFn = idFn;
        this._pending = new Map();
    }

    get pendingCount() {
        return this._pending.size;
    }

    execute(workerId, action, args = {}, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS) {
        const commandId = this._idFn();

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this._pending.delete(commandId);
                reject(new Error(`Command "${action}" (${commandId}) to ${workerId} timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            this._pending.set(commandId, { resolve, reject, timer, workerId, action });

            this._sendFn(workerId, ClusterEvents.COMMAND, buildCommandEnvelope(commandId, action, args))
                .catch(err => {
                    // Transport failed before the node ever saw the command —
                    // fail fast instead of waiting out the timeout.
                    const entry = this._pending.get(commandId);
                    if (!entry) return;
                    clearTimeout(entry.timer);
                    this._pending.delete(commandId);
                    reject(err);
                });
        });
    }

    /**
     * Routes an inbound COMMAND_RESULT envelope to its awaiting caller.
     * Returns false when the result is unknown/expired (late reply after
     * timeout, or a reply from a node the command was never sent to).
     */
    resolveResult(workerId, resultData) {
        const entry = this._pending.get(resultData?.commandId);
        if (!entry) return false;

        // A COMMAND_RESULT must come back from the exact node the command was
        // issued to — a different (compromised or misbehaving) node must not be
        // able to answer on another node's behalf.
        if (entry.workerId !== workerId) return false;

        clearTimeout(entry.timer);
        this._pending.delete(resultData.commandId);
        entry.resolve({ workerId, ...resultData });
        return true;
    }

    /** Rejects every in-flight command — used on orchestrator shutdown. */
    clear(reason = 'Dispatcher cleared') {
        for (const [commandId, entry] of this._pending) {
            clearTimeout(entry.timer);
            entry.reject(new Error(`${reason} (command ${entry.action}/${commandId} to ${entry.workerId})`));
        }
        this._pending.clear();
    }
}

export { CommandDispatcher, DEFAULT_COMMAND_TIMEOUT_MS };
