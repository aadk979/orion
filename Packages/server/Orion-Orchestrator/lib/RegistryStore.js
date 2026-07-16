/**
 * RegistryStore — crash-safe persistence for the NodeRegistry.
 *
 * The registry is the orchestrator's memory of WHO its nodes are (identity,
 * last status, alert history). Without persistence, an orchestrator restart
 * forgets every node until each one happens to reconnect. This store snapshots
 * the registry to a JSON file (atomic tmp+rename write, debounced) and rehydrates
 * it on boot — rehydrated nodes come back marked OFFLINE with reason
 * 'orch-restart' until they prove liveness again, so stale knowledge is never
 * mistaken for current truth.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from 'r-sync';

const REGISTRY_FILE_NAME = 'orion_orch.internal.registry.json';
const SCHEMA_VERSION = 1;
const DEFAULT_DEBOUNCE_MS = 2_000;
/** Cap persisted alert history per node (full in-memory history stays larger) */
const PERSISTED_ALERTS_PER_NODE = 10;

class RegistryStore {

    constructor(config = {}) {
        this.filePath = path.resolve(config.directory || process.cwd(), config.fileName || REGISTRY_FILE_NAME);
        this.debounceMs = config.debounceMs ?? DEFAULT_DEBOUNCE_MS;

        this._debounceTimer = null;
        this._pendingSnapshotFn = null;
        this._writing = Promise.resolve();
    }

    /** Loads persisted node records; returns [] on first boot or corruption. */
    async load() {
        try {
            const raw = await fs.readFile(this.filePath, 'utf8');
            const parsed = JSON.parse(raw);

            if (parsed?.schemaVersion !== SCHEMA_VERSION || !Array.isArray(parsed.nodes)) {
                logger.warn(`RegistryStore: incompatible or corrupt registry file (${this.filePath}) — starting fresh`);
                return [];
            }

            return parsed.nodes;
        } catch (err) {
            if (err.code !== 'ENOENT') {
                logger.warn(`RegistryStore: could not read ${this.filePath} (${err.message}) — starting fresh`);
            }
            return [];
        }
    }

    /**
     * Debounced persist. `snapshotFn` is called at write time so the freshest
     * registry state wins when multiple updates coalesce.
     */
    schedulePersist(snapshotFn) {
        this._pendingSnapshotFn = snapshotFn;

        if (this._debounceTimer) return;
        this._debounceTimer = setTimeout(() => {
            this._debounceTimer = null;
            const fn = this._pendingSnapshotFn;
            this._pendingSnapshotFn = null;
            if (fn) this._write(fn()).catch(err => logger.warn(`RegistryStore: persist failed — ${err.message}`));
        }, this.debounceMs);
    }

    /** Immediate persist (shutdown path) — flushes any pending debounce. */
    async flush(snapshotFn) {
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
            this._debounceTimer = null;
            this._pendingSnapshotFn = null;
        }
        await this._write(snapshotFn());
    }

    async _write(nodes) {
        // Serialize writes so a slow disk can't interleave tmp files
        this._writing = this._writing.then(async () => {
            const payload = JSON.stringify({
                schemaVersion: SCHEMA_VERSION,
                savedAt: Math.floor(Date.now() / 1000),
                nodes: nodes.map(n => ({
                    workerId: n.workerId,
                    hello: n.hello,
                    lastStatusAt: n.lastStatusAt,
                    lastSeen: n.lastSeen,
                    alerts: (n.alerts || []).slice(-PERSISTED_ALERTS_PER_NODE)
                }))
            });

            const tmpPath = `${this.filePath}.tmp`;
            await fs.writeFile(tmpPath, payload, 'utf8');
            await fs.rename(tmpPath, this.filePath);
        });
        return this._writing;
    }
}

export { RegistryStore, REGISTRY_FILE_NAME };
