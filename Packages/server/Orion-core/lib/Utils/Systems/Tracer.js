// tracer.js
// Development and debugging use only

import { AsyncLocalStorage } from "async_hooks";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { generateId } from "../valueGenerator";

const asyncLocalStorage = new AsyncLocalStorage();
const TRACES_DIR = join(process.cwd(), "traces");

class Tracer {
    constructor(active) {
        this.active = active;

        if (this.active) {
            mkdirSync(TRACES_DIR, { recursive: true });
        }
    }

    generateTraceId() {
        return generateId("TRACE", 32);
    }

    // ─── File I/O ────────────────────────────────────────────────────────────────

    _tracePath(traceId) {
        return join(TRACES_DIR, `${traceId}.json`);
    }

    _readTrace(traceId) {
        const path = this._tracePath(traceId);
        if (!existsSync(path)) return null;
        return JSON.parse(readFileSync(path, "utf-8"));
    }

    _writeTrace(traceId, data) {
        writeFileSync(this._tracePath(traceId), JSON.stringify(data, null, 2), "utf-8");
    }

    // ─── Public API ───────────────────────────────────────────────────────────────

    /**
     * Starts a new trace context. Call this at the entry point of a request.
     * Creates the trace file and runs `fn` inside the AsyncLocalStorage context.
     *
     * @param {Function} fn - The async function representing the request lifecycle.
     * @returns {Promise<any>}
     */
    async run(fn) {
        if (!this.active) return fn();

        const traceId = this.generateTraceId();

        this._writeTrace(traceId, {
            traceId,
            startTime: new Date().toISOString(),
            startMs: Date.now(),
            calls: [],
        });

        return asyncLocalStorage.run({ traceId }, fn);
    }

    /**
     * Records a function call into the current trace file.
     * Automatically picks up the traceId from AsyncLocalStorage.
     *
     * @param {string} fnName     - Name of the function being traced.
     * @param {Object} [metadata] - Any additional data to attach to this call.
     */
    trace(fnName, metadata = {}) {
        if (!this.active) return;

        const store = asyncLocalStorage.getStore();

        if (!store) {
            console.warn(`[Tracer] trace() called outside of a run() context (fn: ${fnName})`);
            return;
        }

        const { traceId } = store;
        const data = this._readTrace(traceId);

        if (!data) {
            console.warn(`[Tracer] No trace file found for traceId: ${traceId}`);
            return;
        }

        data.calls.push({
            fnName,
            timestamp: new Date().toISOString(),
            elapsedMs: Date.now() - data.startMs,
            metadata,
        });

        this._writeTrace(traceId, data);
    }

    /**
     * Returns the current traceId from AsyncLocalStorage.
     *
     * @returns {string|null}
     */
    getCurrentTraceId() {
        return asyncLocalStorage.getStore()?.traceId ?? null;
    }

    /**
     * Prints a formatted summary of a trace file to the console.
     *
     * @param {string} traceId
     */
    printTrace(traceId) {
        if (!this.active) return;

        const data = this._readTrace(traceId);

        if (!data) {
            console.warn(`[Tracer] No trace file found for traceId: ${traceId}`);
            return;
        }

        console.group(`[Tracer] ${traceId}`);
        console.log(`File:    ${this._tracePath(traceId)}`);
        console.log(`Started: ${data.startTime}`);
        console.log(`Calls (${data.calls.length}):`);

        data.calls.forEach((call, i) => {
            console.log(
                `  ${i + 1}. [+${call.elapsedMs}ms] ${call.fnName}`,
                Object.keys(call.metadata).length ? call.metadata : ""
            );
        });

        console.groupEnd();
    }
}

export const tracer = new Tracer(process.env.NODE_ENV !== "production");