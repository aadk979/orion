# 🛰️ Orion Alpine

**A production-grade, modular authentication framework for Node.js.**

Orion Alpine is a full-stack authentication and authorization system designed to take an application from zero to production-ready auth with a single configuration file. It ships as a monorepo containing a server-side framework (published to npm as `@aadharsh/orion-alpine-x934x`), a browser-side client SDK, and a complete integration test harness with a Next.js reference app.

> ⚠️ **Beta** — Orion is in active development (v1.0.x). APIs are stabilising through live testing via the **SP Forms** and **ClientTest** projects.

---

## Table of Contents

- [Features](#-features)
- [Architecture Overview](#-architecture-overview)
- [Repository Structure](#-repository-structure)
- [Getting Started](#-getting-started)
  - [Prerequisites](#prerequisites)
  - [Server Setup](#1-server-setup)
  - [Client SDK Build](#2-client-sdk-build)
  - [Running the Test Environment](#3-running-the-test-environment)
- [Configuration Reference](#-configuration-reference)
- [Authentication Methods](#-authentication-methods)
- [Security Systems](#-security-systems)
- [Database Adapters](#-database-adapters)
- [Middleware Pipeline](#-middleware-pipeline)
- [Client SDK](#-client-sdk)
- [API Endpoints](#-api-endpoints)
- [Internal Systems](#-internal-systems)
- [License](#-license)

---

## ✨ Features

| Category | Capabilities |
|---|---|
| **Auth Methods** | Email/Password, WebAuthn Passkeys (registration + authentication), TOTP 2FA, OAuth 2.0 / OIDC (Google, GitHub, Slack, Discord, Microsoft) |
| **Token Management** | Asymmetric JWT signing with automatic key rotation, configurable tier-based security levels (1–4), access / refresh / resource token triad |
| **Device Security** | Device Identity Profiling (DIP), device authorization flows via email or passkey or TOTP, device fingerprinting and remembered-device system |
| **Secrets Management** | On-disk encrypted secrets vaults for token signing keys, signature secrets, and volatile secrets with automatic rotation |
| **Audit Trail** | Append-only, cryptographically signed Write-Ahead Log (WAL) with Ed25519 integrity verification |
| **Captcha** | Built-in custom captcha system (image-based) — no third-party dependency required |
| **Databases** | Pluggable persistent (MongoDB, Firestore, PostgreSQL) and ephemeral (Redis, in-memory) database adapters |
| **Mail** | Nodemailer-based transactional emails with templated HTML (verification, password reset, device authorization) |
| **Security Hardening** | Helmet, HPP, CORS, rate limiting, origin verification, request encryption/decryption, Joi-based request validation, XSS sanitization, compression |
| **Client SDK** | Isomorphic browser SDK bundled via esbuild + Terser with SHA-256 integrity hash, automatic DIP caching, IndexedDB-backed vault |
| **Observability** | Structured logger with file output, memory monitoring system, error tracker with persistent error dump |

---

## 🏗 Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                        Client (Browser)                       │
│                                                               │
│   Orion SDK  ←→  OrionVault (IndexedDB)  ←→  DIP Cache       │
│       │                                                       │
│       ▼                                                       │
│   API Interface  ──────────  HTTPS  ──────────────────────┐   │
└───────────────────────────────────────────────────────────┐│──┘
                                                            ││
┌───────────────────────────────────────────────────────────┘│──┐
│                     Orion Server (Express 5)                │  │
│                                                             ▼  │
│  ┌─ Middleware Pipeline ──────────────────────────────────┐    │
│  │  Rate Limiter → JSON Parser → CORS → Helmet → HPP     │    │
│  │  → Cookie Parser → Compression → Request Metadata      │    │
│  │  → Server Status → Resource Access → Origin Verifier   │    │
│  │  → Header Parser → Auth Middleware → DIP Middleware     │    │
│  │  → Decryptor → Data Validator → Device Scanner         │    │
│  └────────────────────────────────────────────────────────┘    │
│                          │                                     │
│                          ▼                                     │
│  ┌─ Core Systems ────────────────────────────────────┐        │
│  │  Token Manager   │  Secrets Manager  │  OAuth Kit │        │
│  │  Account Manager │  Audit Trail      │  Captcha   │        │
│  │  Device Auth     │  Step-Up Auth     │  Mailer    │        │
│  └───────────────────────────────────────────────────┘        │
│                          │                                     │
│           ┌──────────────┼──────────────┐                     │
│           ▼              ▼              ▼                     │
│     ┌──────────┐  ┌───────────┐  ┌──────────┐               │
│     │ MongoDB  │  │ Firestore │  │ Postgres │  (Persistent)  │
│     └──────────┘  └───────────┘  └──────────┘               │
│           ┌──────────────┼──────────────┐                     │
│           ▼              ▼                                    │
│     ┌──────────┐  ┌──────────────┐                           │
│     │  Redis   │  │  In-Memory   │  (Ephemeral)              │
│     └──────────┘  └──────────────┘                           │
└──────────────────────────────────────────────────────────────┘
```

---

## 📁 Repository Structure

```
orion/
├── Packages/
│   ├── server/
│   │   └── Orion-core/               # The core server framework (npm package)
│   │       ├── index.js              # Package entry — re-exports all public APIs
│   │       └── lib/
│   │           ├── Server/
│   │           │   ├── initiateServer.js        # Bootstrap: Express app, middleware, DB, secrets
│   │           │   ├── onStartConfigurations.js  # Startup routines (key generation, config validation)
│   │           │   ├── Endpoints/index.js        # Route definitions for all auth endpoints
│   │           │   ├── Middleware/                # 11 middleware modules (auth, DIP, device, etc.)
│   │           │   └── Response/response.js      # Standardised response builder
│   │           ├── Utils/
│   │           │   ├── Core/
│   │           │   │   ├── AccountManagment/     # Sign-up, sign-in, passkeys, TOTP, password reset
│   │           │   │   ├── TokenManagement/      # Access, refresh, resource token lifecycle
│   │           │   │   ├── SecurityManagment/    # Device auth, DIP, step-up auth, cookie reset
│   │           │   │   ├── OAuth/                # Provider toolkit, redirect URL generation, callbacks
│   │           │   │   └── ResourceAccessManagment/  # Callback & directory-based resource serving
│   │           │   ├── Databases/
│   │           │   │   ├── PersitantDatabases/   # MongoDB, Firestore, PostgreSQL adapters
│   │           │   │   └── EphemeralDatabases/   # Redis, local in-memory adapters
│   │           │   ├── Systems/                  # Audit trail, error tracker, memory monitor,
│   │           │   │                             # secrets crypto, token/signature/volatile managers
│   │           │   ├── Mail/                     # Mailer, mail constructor, HTML templates
│   │           │   ├── GlobalAccessPoint.js      # Singleton service locator for runtime state
│   │           │   ├── logger.js                 # Structured logger (console + file)
│   │           │   ├── CryptoFunctions.js        # Hashing, HMAC, AES, RSA, ECDH utilities
│   │           │   └── ...                       # Validators, encoders, cron, sanitizer, etc.
│   │           ├── Errors/                       # Categorised error code definitions
│   │           ├── General/EndpointSchema.js     # Joi schemas for every API endpoint
│   │           └── orion.meta.js                 # Version, status, internal file name constants
│   │
│   └── client/                       # Browser-side SDK source
│       ├── lib/
│       │   ├── Root.js               # `Orion` class — singleton SDK entry point
│       │   ├── API-Handlers/         # Per-feature API call wrappers (sign-in, OAuth, passkey, etc.)
│       │   ├── Flows/                # Complex multi-step flows (Device Authorization, Step-Up Auth)
│       │   ├── Utils/                # API interface, crypto module, vault (IndexedDB), DIP cache,
│       │   │                         # captcha renderer, encoders, auth headers
│       │   └── DipCacheManager.js    # Client-side DIP configuration cache
│       ├── sdkBuilder.js             # esbuild + Terser build script → dist/orion.beta.sdk.js
│       ├── fileWatcher.js            # Dev-mode file watcher for auto-rebuild on change
│       └── dist/                     # Compiled SDK output
│
├── ClientTest/                       # Full integration test environment
│   ├── app/                          # Next.js 16 reference frontend (React 19, Tailwind 4)
│   │   └── src/                      # Pages, components, Lib (SDK integration code)
│   └── server/                       # Test backend using Orion-core
│       ├── index.js                  # Server entry point — imports and starts Orion
│       ├── orion.config.js           # Full example configuration (MongoDB, Redis, OAuth providers)
│       └── db/                       # Sample app-level data layer (e.g. todos with SQLite)
│
├── Testing/                          # Lightweight static file test server
│   ├── server.js                     # Express static server on port 5502
│   ├── assets/                       # Compiled SDK + test HTML pages
│   └── Server/                       # Alternate test server with full Orion config
│       ├── index.js
│       ├── orion.config.js
│       └── errorCodeScanner.js       # Utility to scan and dump all error codes
│
├── experimentals/                    # Design documents and schema proposals
│   ├── analysis_report.md            # Current data model analysis
│   ├── schema_proposal.sql           # PostgreSQL migration schema
│   └── models/                       # Data model explorations
│
├── .gitignore
├── .prettierrc.json
├── jsconfig.json                     # ESNext module resolution, strict types
└── README.md                         # ← You are here
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** ≥ 18.x
- **npm** ≥ 9.x
- A persistent database: **MongoDB**, **Firestore**, or **PostgreSQL**
- *(Optional)* An ephemeral database: **Redis** (falls back to local in-memory)

### 1. Server Setup

Install the core package in your project:

```bash
npm install @aadharsh/orion-alpine-x934x
```

Create a configuration file and start the server:

```js
// server.js
import { initiateServer, logger } from '@aadharsh/orion-alpine-x934x';
import { configuration } from './orion.config.js';

const main = async () => {
    const server = await initiateServer(undefined, configuration);
    server.app.listen(configuration.app.PORT, () => {
        logger.info('Server is running on port ' + configuration.app.PORT);
    });
};

main();
```

### 2. Client SDK Build

From the `Packages/client/` directory:

```bash
npm install
node sdkBuilder.js
```

This outputs `orion.beta.sdk.js` to `dist/`, `Testing/assets/`, and `ClientTest/app/public/`.

For development with auto-rebuild on file changes:

```bash
node fileWatcher.js
```

### 3. Running the Test Environment

**Backend** (from `ClientTest/server/`):

```bash
npm install
node index.js
```

**Frontend** (from `ClientTest/app/`):

```bash
npm install
npm run dev
```

The Next.js app runs on `http://localhost:3000` and connects to the Orion server on port `3495`.

---

## ⚙ Configuration Reference

The configuration object passed to `initiateServer()` defines all behaviour. Below is the full schema:

```js
const configuration = {
    app: {
        PORT: 3495,                              // Server port
        appName: "My App",                       // Display name (used in emails, logs)
        serviceID: "uuid-string",                // Unique service identifier
    },
    utilities: {
        logToFile: true,                         // Write logs to disk
        auditTrailSystem: {
            enabled: true,                       // Enable append-only audit WAL
            password: "encryption-password"       // WAL encryption password
        },
        systemSecurity: {
            deviceAuthorization: "ENABLED",       // "ENABLED" | "DISABLED"
            dip: "ENABLED",                       // Device Identity Profiling
            captcha: "ENABLED"                    // Custom captcha system
        },
        onUserCreation: (user) => { },           // Hook called after account creation
        ephemeralDB: {
            provider: "REDIS",                   // "REDIS" | "LOCAL_MEMORY"
            credentials: { host, password, PORT }
        }
    },
    db: {
        provider: "MONGO-DB",                    // "MONGO-DB" | "FIRESTORE" | "POSTGRES"
        credentials: {
            uri: "mongodb://localhost:27017/Orion"
        }
    },
    api: {
        slug: "my-app",                          // Optional URL prefix for all routes
        maxPayloadSize: "10mb",                  // Express body parser limit
        customEndpoints: [
            { path: "/api/todos", requireAuth: true, method: "GET", callback: handler }
        ],
        customMiddlewares: [
            { applyAll: true, callback: (req, res, next) => next() },
            { applyAll: false, pathsToApply: ["/api/todos"], callback: myMiddleware }
        ]
    },
    client: {
        urls: ["http://localhost:3000"],          // Allowed client origins (CORS)
        runTimeUpdateAllowed: true,               // Allow runtime CORS updates
        persistantUpdateAllowed: true             // Persist CORS updates to disk
    },
    server: {
        urls: ["http://localhost:3495"],          // Trusted server origins
        myUrl: "http://localhost:3495"            // This server's public URL
    },
    mail: {
        email: "noreply@example.com",            // Sender address
        password: "app-password",                // SMTP app password
        service: "gmail"                         // Nodemailer transport service
    },
    tokens: {
        lifespans: {
            accessTokens: "15m",                 // Access token TTL
            refreshTokens: "7d",                 // Refresh token TTL
            resourceTokens: "1h"                 // Resource token TTL
        },
        security_tier: 4                         // 1–4, controls signing algorithm strength
    },
    authMethods: {
        emailPassword: true,                     // Enable email/password auth
        passkey: true,                           // Enable WebAuthn passkey auth
        oAuth: {
            google: { clientId, clientSecret, redirectUri },
            github: { clientId, clientSecret, redirectUri },
            slack:  { clientId, clientSecret, redirectUri },
            discord: { clientId, clientSecret, redirectUri },
            microsoft: { clientId, clientSecret, redirectUri, explicitAllow: true }
        },
        allowedEmailDomains: ["*"]               // Restrict sign-up to specific domains
    }
};
```

---

## 🔐 Authentication Methods

### Email & Password
Standard registration and login with bcrypt password hashing, email domain restriction, and password strength validation via `zxcvbn`.

### WebAuthn Passkeys
Full FIDO2/WebAuthn support via `@simplewebauthn/server`:
- **Registration** — generate options, complete registration, store credential
- **Authentication** — challenge-response sign-in
- **Passkey-based sign-up** — create account using only a passkey (no password)

### TOTP (Time-Based One-Time Password)
Standard 2FA via authenticator apps:
- Generate TOTP secret with QR code
- Verify and enable TOTP
- Initiate / complete 2FA method removal

### OAuth 2.0 / OIDC
Supports multiple providers via `openid-client`:
- **Google**, **GitHub**, **Slack**, **Discord**, **Microsoft**
- Automatic provider discovery, PKCE support
- Server-side redirect URL generation и callback handling
- Account linking for existing users

---

## 🛡 Security Systems

### Device Identity Profiling (DIP)
Fingerprints client devices using browser characteristics and caches the profile. The server validates device identity on every request and can trigger step-up authentication for unrecognised devices.

### Device Authorization
When an unrecognised device attempts to authenticate, Orion initiates a device authorization flow:
- Email-based verification code
- Passkey-based device authorization
- TOTP-based device authorization

### Step-Up Authentication
Multi-step verification flow for sensitive operations, supporting passkey and TOTP challenges.

### Request Encryption
Client-server payload encryption using ECDH key exchange with AES-GCM, ensuring request bodies are encrypted in transit beyond TLS.

### Captcha System
Custom server-generated image captcha with no external dependencies. Generates visual challenges, hashes answers, and validates responses through a two-step transaction flow.

### Audit Trail System
Append-only Write-Ahead Log (WAL) with Ed25519 cryptographic signatures for tamper evidence. Each entry is chained to the previous, creating a verifiable audit history. Configurable with password-based encryption.

---

## 🗄 Database Adapters

All database adapters implement a common interface (`set`, `get`, `update`, `delete`, `findByField`):

| Type | Provider | Module |
|---|---|---|
| **Persistent** | MongoDB | `PersitantDatabases/mongoDB.js` |
| **Persistent** | Firestore | `PersitantDatabases/firestore.js` |
| **Persistent** | PostgreSQL | `PersitantDatabases/postgres.js` |
| **Ephemeral** | Redis | `EphemeralDatabases/redis.js` |
| **Ephemeral** | Local Memory | `EphemeralDatabases/localMemoryDB.js` |

Ephemeral databases are used for storing temporary data like CAPTCHA state, volatile secrets, and session data. If Redis is not configured, the system transparently falls back to the in-memory adapter.

---

## 🔗 Middleware Pipeline

Every request passes through a carefully ordered middleware stack:

| Order | Middleware | Purpose |
|---|---|---|
| 1 | Rate Limiter | Configurable request throttling |
| 2 | JSON Parser | Body parsing with size limit |
| 3 | URL Encoded Parser | Form data support |
| 4 | CORS | Origin verification with dynamic allowlist |
| 5 | Helmet | Security headers |
| 6 | HPP | HTTP parameter pollution prevention |
| 7 | Cookie Parser | Cookie extraction and parsing |
| 8 | Compression | Response compression (threshold: 1KB) |
| 9 | Server Utilities | Internal utility injection |
| 10 | Request Metadata | Attach IP, user-agent, geo data to request context |
| 11 | Server Status | Check if server is in lockdown mode |
| 12 | Resource Access | Handle resource token-based access |
| 13 | Origin Verifier | Validate request origin against allowlist |
| 14 | Header Parser | Extract and validate custom Orion headers |
| 15 | Auth Middleware | Token verification, session validation, user hydration |
| 16 | DIP Middleware | Device identity profiling verification |
| 17 | Decryptor | Decrypt ECDH-encrypted request payloads |
| 18 | Data Validator | Joi schema validation per endpoint |
| 19 | Device Scanner | Device authorization gate for unrecognised devices |

---

## 📦 Client SDK

The Orion Client SDK is a browser-side JavaScript module that handles all auth flows:

### Installation

Include the built SDK in your frontend:

```html
<script type="module">
    import { Orion } from '/orion.beta.sdk.js';

    const orion = new Orion({
        serverUrl: 'http://localhost:3495',
        slug: 'my-app'
    });

    await orion.initialize();
</script>
```

### API

```js
// Auth state listener
orion.authState((state) => {
    console.log(state.signedIn, state.loading);
});

// Email/Password
await orion.signUpUser(email, password);
await orion.signInUser(email, password);
await orion.signOutUser();

// Passkeys
await orion.signUpWithPasskey(email);
await orion.signInWithPasskey(email);
await orion.registerPasskey();

// OAuth
await orion.generateOAuthRedirectURLAndRedirect('google');
await orion.handleOAuthCallback();

// TOTP 2FA
const { qrCodeUrl, secret } = await orion.setupTOTP();
await orion.verifyAndEnableTOTP(totpCode);

// 2FA Management
await orion.initiate2FAMethodRemoval('totp');
await orion.complete2FAMethodRemoval(code);

// Profile
const profile = await orion.getUserProfile();
```

### SDK Internals

| Module | Role |
|---|---|
| `Root.js` | Singleton `Orion` class — all public methods |
| `OrionVault.js` | IndexedDB-backed secure token and session storage |
| `DipCacheManager.js` | Caches DIP configuration to reduce server round-trips |
| `CryptoModule.js` | Client-side ECDH key exchange, AES-GCM encryption |
| `Captcha.js` | Renders and manages the custom captcha challenge flow |
| `Api.js` / `Api-2.js` | HTTP fetch wrappers with auth header injection |
| `Authorisation.js` | Auth header construction from vault tokens |
| `Flows/` | Multi-step flows: Device Authorization, Step-Up Auth |

---

## 🌐 API Endpoints

All endpoints are namespaced under `/{namespace}/api/v1/`. Below are the core routes:

### Authentication
| Method | Path | Auth Required | Description |
|---|---|---|---|
| POST | `/action/sign-up-user` | No-Auth Token | Create a new account |
| POST | `/action/sign-in-user` | No-Auth Token | Sign in with email/password |
| POST | `/action/sign-out-user` | Access Token | Sign out and revoke tokens |
| POST | `/action/get-current-auth-state` | Access Token | Check current session state |

### Passkeys
| Method | Path | Auth Required | Description |
|---|---|---|---|
| POST | `/action/generate-passkey-registration-options` | Access Token | Get WebAuthn registration challenge |
| POST | `/action/complete-passkey-registration` | Access Token | Complete passkey registration |
| POST | `/action/generate-passkey-authentication-options` | No-Auth Token | Get WebAuthn auth challenge |
| POST | `/action/sign-in-with-passkey-authentication` | No-Auth Token | Sign in with passkey |
| POST | `/action/generate-passkey-sign-up-options` | No-Auth Token | Get sign-up-via-passkey challenge |
| POST | `/action/complete-passkey-sign-up` | No-Auth Token | Complete passkey-based sign-up |

### OAuth
| Method | Path | Auth Required | Description |
|---|---|---|---|
| POST | `/action/get-o-auth-redirect-url` | No-Auth Token | Generate OAuth provider redirect URL |
| POST | `/action/handle-o-auth-callback` | No-Auth Token | Process OAuth callback with auth code |

### Security & Device
| Method | Path | Auth Required | Description |
|---|---|---|---|
| POST | `/action/configure-dip` | No-Auth Token | Retrieve DIP configuration |
| POST | `/action/authorize-me` | Pending Auth | Submit device authorization code |
| POST | `/action/send-device-authorization-email` | Pending Auth | Trigger device authorization email |
| POST | `/action/authorize-device-with-passkey` | Pending Auth | Authorize device via passkey |
| POST | `/action/authorize-device-with-totp` | Pending Auth | Authorize device via TOTP |
| POST | `/request/available-2fa-methods` | Pending Auth | List 2FA methods for step-up auth |
| POST | `/request/encryption-request-key` | No-Auth Token | Request ECDH public key for payload encryption |

### Captcha
| Method | Path | Auth Required | Description |
|---|---|---|---|
| POST | `/request/have-no-auth-token` | None | Check if no-auth token exists |
| POST | `/action/generate-no-auth-token-transaction` | None | Start captcha challenge transaction |
| POST | `/action/generate-no-auth-token` | None | Submit captcha answer, receive no-auth token |

### TOTP
| Method | Path | Auth Required | Description |
|---|---|---|---|
| POST | `/action/generate-totp-secret` | Access Token | Generate TOTP secret + QR code |
| POST | `/action/verify-and-enable-totp` | Access Token | Verify code and enable TOTP 2FA |

---

## 🔧 Internal Systems

### GlobalAccessPoint
A singleton service locator that holds runtime references to the database, configuration, logger, secrets managers, OAuth toolkit, audit trail, and server state. Accessible throughout the server codebase.

### Token Secrets Manager
Manages RSA/ECDSA key pairs for JWT signing. Keys are stored encrypted on disk and rotated based on configurable security tiers (1–4). Separate key stores exist for access, refresh, and resource tokens.

### Signature Secrets Manager
Manages HMAC signing keys for request signature verification, stored encrypted on disk with automatic rotation.

### Volatile Secrets Manager
Generates and rotates ephemeral cryptographic keys used for short-lived operations (like CAPTCHA transactions and key exchange).

### Memory Monitoring System
Tracks Node.js heap usage and can trigger alerts or garbage collection hints when memory pressure is detected. Purges sensitive configuration data from memory after server startup.

### Error Tracker System
Captures, categorises, and persists errors to a JSON dump file for post-mortem analysis.

---

## 📜 License

MIT — see [package.json](Packages/server/Orion-core/package.json) for details.

**Author:** Kalivaradhan Aadharsh

