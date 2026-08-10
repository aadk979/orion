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
            // ── Encryption at rest for encryptable fields (today: TOTP 2FA
            //    secrets; the registry is designed to grow).
            //
            // Orion uses envelope encryption: a data encryption key (DEK) that
            // it generates and stores WRAPPED, protected by a key encryption
            // key (KEK) that lives wherever you point `provider`.
            //
            // provider — one of:
            //   'INLINE_KEY'         key below, single-instance deployments ONLY
            //   'AWS_KMS'            region, keyId
            //   'GCP_KMS'            projectId, location, keyRing, keyName
            //   'AZURE_KEY_VAULT'    vaultUrl, keyName
            //   'HASHICORP_VAULT'    address, keyName, token | roleId+secretId
            //   'HCP_VAULT'          as above, plus namespace: 'admin'
            //   'OPENBAO'            address, keyName, token | roleId+secretId
            //   'HCP_VAULT_SECRETS'  organizationId, projectId, appName, secretName  (needs explicitAllow)
            //   'AKEYLESS'           keyName, accessId, accessKey                     (needs explicitAllow)
            //   'INFISICAL'          keyId, clientId, clientSecret, baseUrl           (needs explicitAllow)
            //
            // Providers not on the internally-verified list are DISABLED until
            // `explicitAllow: true` is set here — the same gate the OAuth
            // toolkit applies to its untested providers.
            //
            // In CLUSTER mode 'INLINE_KEY' is refused: a symmetric key copied
            // into every node cannot be revoked, rotated or audited. Without a
            // vault, encryptable fields deactivate — TOTP stops being offered
            // and enrolled users fall back to the email one-time code. Nobody
            // is locked out, and nothing is stored in plaintext.
            provider: 'INLINE_KEY',

            // INLINE_KEY only. At least 32 chars: `openssl rand -base64 48`.
            key: 'CHANGE_ME',

            // Set when migrating from the pre-vault inline key to a vault: it
            // lets Orion read rows sealed with the old key and re-seal them on
            // the next DEK rotation. Remove once rotation reports 0 stale rows.
            // legacyKey: 'THE_OLD_KEY',

            // Per-call ceiling on vault requests (ms). Default 10000.
            // timeoutMs: 10_000,

            // Make an absent or unusable configuration FATAL at boot instead of
            // deactivating encryptable fields. Recommended in production.
            // required: true

            // This block is structurally validated at boot: unknown keys are
            // rejected with a suggested correction, so a typo cannot silently
            // disable encryption. Reachability problems still degrade.

            // AWS_KMS example — credentials fall back to the environment, then
            // the ECS task role, then the EC2 instance role:
            // provider: 'AWS_KMS',
            // region: 'eu-west-1',
            // keyId: 'arn:aws:kms:eu-west-1:111122223333:key/1234abcd-…'
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
        },
        // Batch mailing — this node's share of orchestrator-driven mail blasts.
        // Off by default; a node with it disabled simply declines assignments
        // and the orchestrator gives that group to someone else.
        //
        // The credentials are DELIBERATELY separate from `mail` below. Bulk mail
        // and password-reset mail should never share a sender reputation, a
        // provider quota, or a throttle: a blast that gets the account rate
        // limited must not be able to stop users signing in.
        //
        // Requires the mailing grants from the orchestrator's
        // sql/worker-grants.example.sql — this node writes its own delivery
        // records rather than reporting every send upstream.
        batchMailer: {
            enabled: false,
            mail: {
                service: 'gmail', // or host/port/secure for explicit SMTP
                email: 'CHANGE_ME',
                password: 'CHANGE_ME',
                from: 'Todos <bulk@example.com>'
            },
            // Sliding send budget. The orchestrator overrides this per
            // assignment, so the cluster-wide setting is the one that governs.
            ratePerWindow: 15,
            rateWindowMs: 120000,
            // Per-recipient attempts before the address is dead-lettered.
            maxAttempts: 3,
            backoffBaseMs: 5000,
            // Consecutive transport-level failures that mean "the mail server is
            // down, not the addresses" — the group is handed back rather than
            // burned through.
            consecutiveFailureAbort: 10
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
        securityTier: 4,

        // Proof-of-possession binding (RFC 9449 DPoP).
        //
        //   'none' — tokens are bearer credentials. Anyone holding one can use
        //            it, from anywhere.
        //   'dpop' — tokens are bound to a non-extractable key held by the
        //            client, and every request must carry a signature from it.
        //            A token lifted from storage, a log or a backup is inert.
        //
        // The client SDK must be configured to match: pass the same value as
        // `tokens.binding` to the Orion constructor. A bound server refuses
        // requests without a proof; an unbound server ignores proofs it is sent.
        // Turning this on invalidates existing sessions once — they re-authenticate
        // and come back bound.
        binding: 'dpop',

        // Server-side key for device-fingerprint digests. REQUIRED at
        // securityTier 3 and above; the server refuses to boot without it.
        //
        // Must be a stable random value of at least 32 characters and IDENTICAL
        // on every node. If each process invents its own, fingerprints stop
        // matching after any restart and across every node, which pushes all
        // traffic into step-up authentication.
        //
        // Generate one with:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
        fingerprintDigestKey: process.env.ORION_FINGERPRINT_DIGEST_KEY
    },

    // ── Shared Signals Framework (OpenID SSF) + CAEP ────────────────────────
    //
    // Access tokens are valid until they expire. Orion re-checks its own state
    // on every request, so a revocation takes effect here immediately — but a
    // DOWNSTREAM service holding a token minted by this issuer keeps honouring
    // it until expiry. Shared Signals is the standard way to tell those services
    // that something changed, so access evaluation becomes continuous.
    //
    // Orion transmits CAEP events as RFC 8417 Security Event Tokens:
    //   session-revoked, credential-change, token-claims-change,
    //   assurance-level-change, device-compliance-change
    //
    // Delivery is RFC 8935 (push) or RFC 8936 (poll). Receivers manage their own
    // subscription through the stream endpoint and verify SETs against the JWKS.
    sharedSignals: {
        enabled: false,

        // Every SET's `iss` and every subject identifier is built from this.
        // Defaults to server.selfUrl. Receivers key their trust on it, so it
        // must be stable.
        issuer: process.env.ORION_SSF_ISSUER,

        // Guards stream creation. A caller who can create a stream can have
        // every revocation in the system forwarded to an endpoint they control,
        // so this is required (min 32 chars) whenever the feature is on.
        managementToken: process.env.ORION_SSF_MANAGEMENT_TOKEN,

        // Issuers whose inbound events this deployment will ACT on. An `iss`
        // claim alone never establishes trust — it only selects which entry
        // here to verify against.
        //
        //   'https://idp.example.com': {
        //       jwksUri: 'https://idp.example.com/jwks',
        //       audience: 'https://auth.example.com'
        //   }
        trustedIssuers: {},

        // Local development only. SETs name users and describe their security
        // state, so plaintext delivery endpoints are refused by default.
        allowInsecureDelivery: false
    },
    authMethods: {
        emailPassword: true,
        passkey: true,
        OAuth: {},
        allowedEmailDomains: ['*']
    }
};

export { configuration };
