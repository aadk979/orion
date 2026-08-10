/**
 * Example systemConfig for the integration harness.
 *
 * Copy this file to `gipsy.orion.config.js` (git-ignored) and fill in real
 * values for your throwaway Postgres/Redis instances. NEVER commit real
 * credentials — the `gipsy.` copy is ignored precisely so you don't.
 *
 * The shape below is a STARTING POINT. Cross-check it against what
 * `initiateServer(startConfig, systemConfig)` and `handleOnStartConfiguration`
 * actually read (see Packages/server/Orion-core/lib/Server/), and against the
 * compendium doc `21-Error-Registry-and-Config.md`, then adjust.
 */

export const systemConfig = {
    // Public API namespace prefix; endpoints live under /<apiSlug>/alpine/api/v1/...
    apiSlug: '',

    api: {
        maxPayloadSize: '10mb'
    },

    utilities: {
        logToFile: false,

        // Custom end-user roles. Read from utilities.userRoles.allowedUserRoles —
        // a top-level `allowedUserRoles` is NOT read and is silently ignored.
        // Uppercased and trimmed at boot. Omit the whole `userRoles` block to
        // keep the standard USER/ADMIN set; a non-array or empty array fails the
        // boot. Note this list REPLACES the standard set when a role is assigned
        // with customRolesAllowed: true, so keep USER/ADMIN listed if you still
        // want to assign them that way.
        userRoles: {
            allowedUserRoles: ['USER', 'ADMIN']
        }

        // Cluster link — join an Orion-Orchestrator control plane (see
        // Packages/server/Orion-Orchestrator/README.md). Disabled by default.
        // clusterLink: {
        //     enabled: true,
        //     cluster: 'orion-prod',            // must match the orchestrator's cluster name
        //     orchestratorIp: '127.0.0.1',
        //     orchestratorPort: 55321,
        //     publicIp: '127.0.0.1',            // address the orchestrator can reach this node on
        //     port: 55322,                      // local M2M port (NOT the public API port)
        //     statusReportIntervalMs: 60000,    // full status snapshots
        //     flagWatchIntervalMs: 2000,        // fast alert watcher (alert latency ceiling; 0 = off)
        //     memoryPressureThresholdPercent: 80,
        //     reRegisterAfterFailures: 3,       // tunnel desync self-healing (0 = off)
        //     allowRemoteControl: true,         // execute orchestrator commands via OrionSystemsControl
        //     requireOrchestrator: false        // true = fail boot if orchestrator is unreachable
        // }
    },

    // Allowed browser origins (validated by Validator.validateClientUrls)
    allowedClientUrls: ['http://localhost:3000'],
    allowedEmailDomains: [], // empty = allow any well-formed domain

    // Persistent store — Postgres
    database: {
        type: 'postgres',
        host: '127.0.0.1',
        port: 5432,
        user: 'postgres',
        password: 'orion',
        database: 'orion_test'
    },

    // Ephemeral store — Redis (or in-memory fallback)
    ephemeral: {
        type: 'memory', // 'redis' | 'memory'
        redis: { host: '127.0.0.1', port: 6379 }
    }

    // ...secrets, token tiers, captcha, OAuth providers, mail transport, etc.
    // Add these as you flesh out the corresponding integration tests.
};

export default systemConfig;
