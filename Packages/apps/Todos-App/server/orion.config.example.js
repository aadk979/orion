// Committed template. Copy this file to `gipsy.orion.config.js` (gitignored via
// the repo's `gipsy.*` convention) in this same folder and fill in real values —
// never commit real DB credentials, mail passwords, or public URLs here.
//
// This template runs the FULL security surface: captcha/no-auth bot gate,
// device authorization, passkey + TOTP 2FA, audit trail (MySQL), and a shared
// Redis ephemeral store so JWT signing keys are cluster-wide (a token from any
// node validates on any node). Device-auth / TOTP / passkey all email an OTP,
// so working SMTP credentials are REQUIRED — Orion-core force-disables those
// methods at boot if `mail` is absent.

import { listTodosHandler, createTodoHandler, updateTodoHandler, deleteTodoHandler } from './todos/TodosHandlers.js';

const configuration = {
    app: {
        port: process.env.PORT || 3900,
        appName: 'Todos Demo',
        serviceID: '3e4c9f7a-2b1d-4f6e-9a3c-8d7b5e2f1a90'
    },
    utilities: {
        logToFile: true,
        rateLimiter: {
            // Coarse per-IP flood breaker mounted at the very top of the
            // middleware chain, BEFORE body parsing — the pre-parse complement
            // to the deeper policy-driven per-actor limiter. Enabled by default;
            // set enabled:false to remove it. Trips only on gross volume.
            floodGuard: {
                enabled: true,
                windowMs: 60_000, // rolling window (ms)
                max: 1000 // max requests per IP per window
            }
        },
        auditTrailSystem: {
            // Requires a reachable MySQL server. Appends a signed WAL to
            // logs/ and mirrors to MySQL for tamper-evident forensic logging.
            // host/user/password are REQUIRED when enabled — Orion-core
            // refuses to boot on missing credentials rather than fall back
            // to defaults.
            enabled: true,
            host: 'CHANGE_ME',
            user: 'orion_audit',
            password: 'CHANGE_ME',
            database: 'orion_audit'
        },
        databaseJanitor: {
            // Global TTL sweep of expired tokens/devices and abandoned auth-flow
            // rows (OAuth, device-auth, step-up, captcha, password-reset).
            // Advisory-locked: exactly one cluster node sweeps per cycle.
            // All keys optional — these are the defaults.
            enabled: true,
            intervalMs: 900_000, // 15 minutes
            batchSize: 5000 // rows deleted per statement (bounds lock time)
        },
        dataEncryption: {
            // Encryption-at-rest key for TOTP 2FA secrets (AES-256-GCM,
            // sha256-derived — any high-entropy string works). Without it,
            // secrets are stored in plaintext and a warning is logged.
            // Rotating this key invalidates already-sealed secrets, so treat
            // it like a signing key: set once, back it up.
            key: 'CHANGE_ME'
        },
        accessControl: {
            // Device authorization emails a one-time code on first sign-in from
            // a new device; captcha is the no-auth-token bot gate.
            deviceAuthorization: 'ENABLED',
            captcha: 'ENABLED'
        },
        dataIntegrity: { dip: 'ENABLED' },
        safeMode: 'ENABLED',
        onUserCreation: () => {},
        ephemeralDB: {
            // REDIS shares signing keys across the cluster (true multi-node auth).
            provider: 'REDIS',
            credentials: {
                host: 'CHANGE_ME',
                port: 6379,
                password: 'CHANGE_ME'
            }
        },
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
            host: 'CHANGE_ME',
            database: 'todos_orion',
            user: 'todos_app',
            password: 'CHANGE_ME'
            // Optional pool tuning (defaults shown). Any other keys are passed
            // straight through to pg.Pool (e.g. ssl: { rejectUnauthorized: true }).
            // poolMax: 20,               // per-node connections — mind PG max_connections × cluster size
            // statementTimeoutMs: 30000  // kills runaway queries before they wedge the pool
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
        slug: '',
        // Plain static asset hosting (opt-in). Serves any file under `directory`
        // the way a normal web server would: GET /styles.css → ./public/styles.css.
        // Distinct from ORAS (/resource-access-oras), which is token/query-gated.
        // Served before the auth/header stack, so browser fetches need no orion-* headers.
        static: {
            enabled: false,
            directory: 'public', // relative to cwd (or an absolute path)
            options: {
                dotfiles: 'ignore', // never serve .env/.git/etc.
                index: false, // no implicit directory index
                maxAge: '1h'
            }
        }
    },
    client: {
        urls: ['https://CHANGE_ME'],
        runTimeUpdateAllowed: true,
        persistentUpdateAllowed: true
    },
    server: {
        urls: ['https://CHANGE_ME'],
        selfUrl: 'https://CHANGE_ME'
    },
    mail: {
        // Required for device-auth, TOTP, passkey, and password reset (all send
        // an email OTP). A Gmail App Password works with service: 'gmail'.
        email: 'CHANGE_ME',
        password: 'CHANGE_ME',
        service: 'gmail'
    },
    tokens: {
        lifespans: {
            accessTokens: '15m',
            refreshTokens: '7d',
            resourceTokens: '1h'
        },
        securityTier: 4
    },
    authMethods: {
        emailPassword: true,
        passkey: true,
        OAuth: {},
        allowedEmailDomains: ['*']
    }
};

export { configuration };
