// Committed template. Copy this file to `gipsy.orion.config.js` (gitignored via
// the repo's `gipsy.*` convention) in this same folder and fill in real values —
// never commit real DB credentials or public URLs here.

import {
    listTodosHandler,
    createTodoHandler,
    updateTodoHandler,
    deleteTodoHandler
} from './todos/TodosHandlers.js';

const configuration = {
    app: {
        port: process.env.PORT || 3900,
        appName: 'Todos Demo',
        serviceID: '3e4c9f7a-2b1d-4f6e-9a3c-8d7b5e2f1a90'
    },
    utilities: {
        logToFile: true,
        auditTrailSystem: {
            enabled: false
        },
        accessControl: {
            // Kept disabled so the demo only needs email/password — no SMTP
            // credentials required to run this end-to-end test.
            deviceAuthorization: 'DISABLED',
            captcha: 'DISABLED'
        },
        onUserCreation: () => {},
        ephemeralDB: {
            provider: 'LOCAL_DB'
        },
        // Joins this node to a live Orion-Orchestrator process. See
        // Packages/apps/Todos-App/orchestrator/start.js — `cluster` must match
        // exactly, and orchestratorIp/orchestratorPort must point at wherever
        // that process is running (127.0.0.1 when both run on the same box).
        clusterLink: {
            enabled: true,
            cluster: 'todos-demo',
            orchestratorIp: '127.0.0.1',
            orchestratorPort: 55321,
            publicIp: '127.0.0.1',
            port: 55322,
            requireOrchestrator: false
        }
    },
    db: {
        provider: 'POSTGRES',
        credentials: {
            host: 'localhost',
            database: 'todos_orion',
            user: 'CHANGE_ME',
            password: 'CHANGE_ME'
        }
    },
    api: {
        customEndpoints: [
            { path: '/todos', requireAuth: true, method: 'GET', callback: listTodosHandler },
            { path: '/todos', requireAuth: true, method: 'POST', callback: createTodoHandler },
            { path: '/todos/:id', requireAuth: true, method: 'PATCH', callback: updateTodoHandler },
            { path: '/todos/:id', requireAuth: true, method: 'DELETE', callback: deleteTodoHandler }
        ],
        customMiddlewares: [],
        slug: ''
    },
    client: {
        // Origin(s) the static client is served from. Must match exactly
        // (scheme + host + port) or CORS/cookies will fail. Add the EC2
        // public-IP origin here for the live test.
        urls: ['http://localhost:8080'],
        runTimeUpdateAllowed: true,
        persistentUpdateAllowed: true
    },
    server: {
        // Change to http://<EC2-public-ip>:3900 for the live test.
        urls: ['http://localhost:3900'],
        selfUrl: 'http://localhost:3900'
    },
    tokens: {
        lifespans: {
            accessTokens: '15m',
            refreshTokens: '7d',
            resourceTokens: '1h'
        },
        securityTier: 2
    },
    authMethods: {
        emailPassword: true,
        passkey: false,
        OAuth: {},
        allowedEmailDomains: ['*']
    }
};

export { configuration };
