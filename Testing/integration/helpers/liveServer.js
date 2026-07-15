/**
 * Live-server harness helper for integration tests.
 *
 * Integration tests are opt-in. They run only when BOTH are true:
 *   1. process.env.ORION_INTEGRATION === '1'
 *   2. a systemConfig is available (from integration/gipsy.orion.config.js)
 *
 * Until then, `integrationEnabled()` returns a reason string and tests skip.
 */

import fs from 'node:fs';
import path from 'node:path';

const CONFIG_PATH = path.resolve(import.meta.dirname, '..', 'gipsy.orion.config.js');

/**
 * @returns {{ ok: true, systemConfig: object } | { ok: false, reason: string }}
 */
export async function integrationEnabled() {
    if (process.env.ORION_INTEGRATION !== '1') {
        return { ok: false, reason: 'set ORION_INTEGRATION=1 to run integration tests' };
    }
    if (!fs.existsSync(CONFIG_PATH)) {
        return {
            ok: false,
            reason: `missing ${path.basename(CONFIG_PATH)} (copy gipsy.orion.config.example.js and fill it in)`
        };
    }
    try {
        const mod = await import(CONFIG_PATH);
        const systemConfig = mod.systemConfig ?? mod.default;
        if (!systemConfig) return { ok: false, reason: 'config module must export `systemConfig`' };
        return { ok: true, systemConfig };
    } catch (e) {
        return { ok: false, reason: `failed to load config: ${e.message}` };
    }
}

/**
 * Boots Orion against the provided systemConfig and returns a handle.
 * Kept intentionally thin — flesh out once backing services exist.
 *
 * @param {object} systemConfig
 * @param {object} [startConfig]
 */
export async function bootOrion(systemConfig, startConfig) {
    // Chdir into a scratch dir first so logger/errors.json side effects stay contained.
    const scratch = path.resolve(import.meta.dirname, '..', 'gipsy.integration-artifacts', `pid-${process.pid}`);
    fs.mkdirSync(scratch, { recursive: true });
    process.chdir(scratch);

    const { initiateServer } = await import(
        '../../../Packages/server/Orion-core/index.js'
    );

    const server = await initiateServer(startConfig, systemConfig);
    return {
        server,
        async close() {
            // initiateServer wires GracefulShutdownSystem; prefer its teardown if exposed.
            if (server && typeof server.close === 'function') {
                await new Promise(resolve => server.close(resolve));
            }
        }
    };
}
