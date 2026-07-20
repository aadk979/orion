# Orion — End-to-End Deployment Guide

This is the single, from-scratch guide for a team standing up the Orion stack on
their own infrastructure: clone the repo, provision the backing services, wire
up one or more authentication nodes, run the cluster control plane, put every
operator behind policy, and go live. It covers **every feature, option, and
configuration key** the stack exposes and links out to the per-package
references for the deepest details.

> **What Orion is.** A batteries-included authentication framework (`Orion-core`)
> that any Node/Express app embeds for signup, sign-in, sessions, tokens, 2FA,
> device authorization, OAuth, abuse defense, and audit — plus a cluster
> **control plane** (`Orion-Orchestrator`) that supervises a fleet of those
> nodes and a **PBAC system-admin plane** (panel + API + CLI) that governs human
> access to the control plane itself. `R_Sync` is the encrypted machine-to-machine
> transport underneath the control plane. The `Todos-App` is a complete worked
> example that exercises the whole thing.

---

## Table of contents

1. [Architecture at a glance](#1-architecture-at-a-glance)
2. [Repository layout](#2-repository-layout)
3. [Prerequisites](#3-prerequisites)
4. [Clone and install](#4-clone-and-install)
5. [Provision the backing services](#5-provision-the-backing-services)
6. [The `gipsy.*` secrets convention](#6-the-gipsy-secrets-convention)
7. [Configure an authentication node (Orion-core)](#7-configure-an-authentication-node-orion-core)
8. [Full configuration reference](#8-full-configuration-reference)
9. [Run a single node (fastest path)](#9-run-a-single-node-fastest-path)
10. [Run a multi-node cluster](#10-run-a-multi-node-cluster)
11. [The cluster control plane (Orion-Orchestrator)](#11-the-cluster-control-plane-orion-orchestrator)
12. [The system-admin plane — PBAC panel, API, CLI](#12-the-system-admin-plane--pbac-panel-api-cli)
13. [The client SDK](#13-the-client-sdk)
14. [Exposing services (TLS, tunnels, reverse proxy)](#14-exposing-services-tls-tunnels-reverse-proxy)
15. [End-to-end reference deployment (4 nodes on AWS)](#15-end-to-end-reference-deployment-4-nodes-on-aws)
16. [Operating the fleet day-to-day](#16-operating-the-fleet-day-to-day)
17. [Testing](#17-testing)
18. [Upgrades and redeploys](#18-upgrades-and-redeploys)
19. [Security checklist before you go live](#19-security-checklist-before-you-go-live)
20. [Troubleshooting](#20-troubleshooting)

---

## 1. Architecture at a glance

```
                          ┌───────────────────────────────────────────────┐
                          │           ORION-ORCHESTRATOR (1 per cluster)   │
   operators              │  ┌─────────────────────────────────────────┐  │
   ───────────▶  PBAC ────┼─▶│ System-admin plane: panel (GUI) + /api + │  │
   (panel / CLI)  auth    │  │ orionctl CLI, magic-link + TOTP, PBAC,   │  │
                          │  │ immutable audit  ── Postgres (orch_*)    │  │
                          │  └─────────────────────────────────────────┘  │
                          │  Policy engine · consensus · health · escala- │
                          │  tions · command dispatch · node registry     │
                          └───────────────────┬───────────────────────────┘
                        R_Sync encrypted M2M  │ (ECDH + AES-256-GCM + Ed25519)
              ┌───────────────────────┬───────┴───────────┬───────────────────┐
              ▼                       ▼                   ▼                   ▼
      ┌───────────────┐      ┌───────────────┐   ┌───────────────┐   (N nodes)
      │  ORION-CORE   │      │  ORION-CORE   │   │  ORION-CORE   │
      │  auth node #1 │      │  auth node #2 │   │  auth node #3 │
      │  Express API  │      │  Express API  │   │  Express API  │
      └──────┬────────┘      └──────┬────────┘   └──────┬────────┘
             │      shared backing services (reachable by every node)        │
             └─────────────┬──────────────┬───────────────┬─────────────────┘
                           ▼              ▼               ▼
                     PostgreSQL       Redis           MySQL
                   (users, tokens,  (shared JWT    (tamper-evident
                    devices, app)   signing keys)   audit trail)
```

- **Every auth node is identical** and stateless between requests — they share
  state through the backing services. A JWT minted by any node validates on any
  node because signing keys are shared over Redis.
- **The orchestrator is optional** for a single node but is what makes a fleet a
  cluster: health, consensus, fleet-wide commands, and the governed admin plane.
- **The system-admin plane** is optional and lives inside the orchestrator; it
  is how humans (via GUI or CLI) drive the cluster under policy, with an
  immutable audit trail.

---

## 2. Repository layout

```
orion/
├── DEPLOYMENT.md                     ← you are here
├── Packages/
│   ├── server/
│   │   ├── Orion-core/               Auth framework embedded by your app  (npm: @aadharsh/orion-alpine-x934x)
│   │   ├── Orion-Orchestrator/       Cluster control plane + system-admin plane  (npm: orion-orch)
│   │   │   ├── bin/orionctl.js       System-admin CLI
│   │   │   ├── gui/                  Next.js panel (static export in gui/out, committed)
│   │   │   ├── lib/SystemAdmin/      PBAC plane (DB, models, PBAC engine, auth, audit, HTTP)
│   │   │   └── sql/worker-grants.example.sql
│   │   └── R_sync/                   Encrypted M2M transport  (npm: r-sync)
│   ├── client/                       Browser SDK (orion.beta.sdk.js)
│   └── apps/
│       └── Todos-App/                Complete worked example (server + orchestrator + client)
└── Testing/                          node:test suite (no install step)
```

Deep-dive references (read these for exhaustive per-subsystem detail):

| Topic                                      | File                                                     |
| ------------------------------------------ | -------------------------------------------------------- |
| Cluster control plane + system-admin plane | `Packages/server/Orion-Orchestrator/README.md`           |
| Encrypted M2M transport                    | `Packages/server/R_sync/README.md`                       |
| Worked example, local + EC2 run            | `Packages/apps/Todos-App/README.md`                      |
| Full auth config template (annotated)      | `Packages/apps/Todos-App/server/orion.config.example.js` |
| Test suite                                 | `Testing/README.md`                                      |

---

## 3. Prerequisites

| Requirement    | Version                                           | Notes                                                                                                                                       |
| -------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Node.js**    | ≥ 18.18 (20 LTS recommended; suite runs on 20–25) | `node -v`                                                                                                                                   |
| **PostgreSQL** | 13+ (verified on 16)                              | Users, tokens, devices, app data, and the `orch_*` admin tables                                                                             |
| **Redis**      | 6+                                                | **Only required for multi-node** — shares JWT signing keys fleet-wide                                                                       |
| **MySQL**      | 8+                                                | **Only if** the tamper-evident audit trail is enabled                                                                                       |
| **SMTP creds** | —                                                 | **Required** if you enable email/password, device-auth, TOTP, passkey, or password reset (all send email OTPs). A Gmail App Password works. |
| Build tools    | `build-essential`/Xcode CLT                       | For native modules (`bcrypt`, `canvas`) if no prebuilt binary matches your platform                                                         |

You do **not** need Docker, a bundler, or any global npm tooling. The system-admin
GUI ships pre-built (`gui/out` is committed) — no Next.js build is required to run it.

---

## 4. Clone and install

```bash
git clone <your-fork-or-mirror-url> orion
cd orion
```

Dependencies are per-package (there is no root workspace). Installing an app or
Orion-core pulls in `orion-orch` and `r-sync` automatically via their `file:`
links. For the reference app:

```bash
# Orion-core (auth framework) — the app imports it by relative path
cd Packages/server/Orion-core && npm install

# Orchestrator + system-admin plane (only if you'll run the control plane)
cd ../Orion-Orchestrator && npm install

# R_Sync is pulled in transitively; install directly only if hacking on it
cd ../R_sync && npm install
```

> Use `npm install --omit=dev` on servers to skip dev tooling.

---

## 5. Provision the backing services

You need these reachable from **every** auth node. On one box or managed
services — Orion doesn't care, as long as the nodes can connect.

### PostgreSQL (required)

```bash
sudo -u postgres createuser todos_app -P        # prompts for a password
sudo -u postgres createdb   todos_orion -O todos_app
```

Orion-core creates and migrates its own tables on first boot (versioned,
checksummed, advisory-locked migrations — safe to run concurrently across the
fleet). The `todos_app` user must be able to `CREATE TABLE` in its database.

If you enable the [system-admin plane](#12-the-system-admin-plane--pbac-panel-api-cli),
its `orch_*` tables live in the **same** database by default (separate migration
ledger and advisory lock, so they never collide with Orion-core's). To enforce
the "workers read, orchestrator writes" rule at the database, apply
`Packages/server/Orion-Orchestrator/sql/worker-grants.example.sql` (adjust role
names first).

### Redis (required for multi-node)

Any Redis with a password. This is what makes a token minted on node #2 valid on
node #3 — the signing-key managers fan out over Redis. A single node can skip
Redis (it falls back to in-process key storage), but **the moment you run more
than one node you must use Redis** or cross-node token validation fails.

### MySQL (optional — audit trail)

Only if `utilities.auditTrailSystem.enabled: true`. Create a database and user
with write access; Orion-core builds the tamper-evident `audit_trail` schema
itself. Omit the whole block to disable and append audit events to a local
signed WAL file instead.

### SMTP / mail (required for most auth methods)

Device authorization, TOTP setup, passkey flows, and password reset all email a
one-time code. Without `mail` credentials, Orion-core **force-disables** those
methods at boot. A Gmail account with an App Password and `service: 'gmail'`
works out of the box.

---

## 6. The `gipsy.*` secrets convention

**Any file whose name starts with `gipsy.` is git-ignored.** This is the repo's
convention for everything that must never be committed: real configs,
credentials, keys, logs, deploy artifacts, throwaway scripts.

- Committed template: `server/orion.config.example.js`
- Your real config: `server/gipsy.orion.config.js` ← git-ignored, edit this

The Todos server literally refuses to boot without `gipsy.orion.config.js` and
tells you to copy the template. Keep every secret behind a `gipsy.` name (or an
environment variable) and you can never accidentally commit one.

---

## 7. Configure an authentication node (Orion-core)

```bash
cd Packages/apps/Todos-App/server
cp orion.config.example.js gipsy.orion.config.js
# edit gipsy.orion.config.js — every CHANGE_ME must be filled in
```

The template at `Packages/apps/Todos-App/server/orion.config.example.js` is
fully annotated and runs the **complete** security surface. Minimum to get a
node up: `db.credentials`, `mail`, `client.urls`, `server.urls`/`selfUrl`, and
(for multi-node) `ephemeralDB` (Redis) + `clusterLink`.

A node is booted by passing that configuration object to `initiateServer()`:

```js
import { initiateServer, logger } from '../../../server/Orion-core/index.js';
import { configuration } from './gipsy.orion.config.js';

const server = await initiateServer(undefined, configuration);
server.app.listen(configuration.app.port); // server.app is a standard Express app
```

`server.app` is a normal Express instance — serve it over HTTP for local dev, or
wrap it in `https.createServer(tlsCreds, server.app)` for TLS (the reference app
auto-detects `server.cert` / `server.key` in its folder).

---

## 8. Full configuration reference

Every key of the Orion-core configuration object, grouped. Optional blocks can
be omitted entirely to disable the feature.

### `app` — identity & port

| Key         | Type   | Notes                                             |
| ----------- | ------ | ------------------------------------------------- |
| `port`      | number | API listen port (default `3900` in the example)   |
| `appName`   | string | Shown in emails, cluster hello, logs              |
| `serviceID` | string | Stable unique ID for this service across restarts |

### `utilities` — subsystems

**`logToFile`** `boolean` — mirror logs to `logs/`.

**`rateLimiter.floodGuard`** — coarse per-IP breaker mounted _before_ body
parsing (the shallow complement to the deep per-actor limiter).
`{ enabled: true, windowMs: 60000, max: 1000 }`. Set `enabled:false` to remove.

**`auditTrailSystem`** — tamper-evident, hash-chained audit to MySQL + a signed
local WAL. `{ enabled, host, user, password, database }`. **Credentials are
required when enabled** — the node refuses to boot on missing values rather than
silently degrade. Omit the block to disable (events still append to the local
WAL).

**`databaseJanitor`** — cluster-wide TTL sweep of expired tokens/devices and
abandoned auth-flow rows. Advisory-locked so exactly one node sweeps per cycle.
`{ enabled: true, intervalMs: 900000, batchSize: 5000 }` (defaults shown).

**`dataEncryption.key`** — AES-256-GCM key (sha256-derived; any high-entropy
string) that seals TOTP secrets at rest. Without it, secrets are stored
plaintext and a warning logs. **Rotating it invalidates already-sealed secrets** —
set once, back it up.

**`accessControl`** — `{ deviceAuthorization: 'ENABLED'|'DISABLED', captcha: 'ENABLED'|'DISABLED' }`.
Device auth emails a one-time code on first sign-in from a new device; captcha is
the no-auth-token bot gate.

**`dataIntegrity.dip`** — `'ENABLED'|'DISABLED'`. Data-integrity protection layer.

**`safeMode`** — `'ENABLED'|'DISABLED'`. When on, mutating security operations
require an explicit config change + restart; the orchestrator cannot override a
safe-mode refusal remotely.

**`onUserCreation`** — `(user) => {}` hook fired when an account is created.

**`ephemeralDB`** — the shared ephemeral store.
`{ provider: 'REDIS', credentials: { host, port, password } }`. **Required for
multi-node** (shares JWT signing keys). Single node can omit it.

**`clusterLink`** — connect this node to the orchestrator. See
[§11](#11-the-cluster-control-plane-orion-orchestrator) and the orchestrator
README for the full table.
`{ enabled, cluster, orchestratorIp, orchestratorPort, publicIp, port, requireOrchestrator, allowRemoteControl, statusReportIntervalMs, flagWatchIntervalMs, memoryPressureThresholdPercent, reRegisterAfterFailures }`.

### `db` — persistent store

`{ provider: 'POSTGRES', credentials: { host, database, user, password, poolMax?, statementTimeoutMs?, ...pgPoolOpts } }`.
Extra keys pass straight through to `pg.Pool` (e.g. `ssl: { rejectUnauthorized: true }`).
Mind `poolMax` × cluster size against Postgres `max_connections`.

### `api` — your routes & static hosting

| Key                   | Notes                                                                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `customEndpoints[]`   | `{ path, method, requireAuth, callback }`. Parameterized paths (`/todos/:id`) are matched segment-aware.                                                                                 |
| `customMiddlewares[]` | Express middleware run in the auth pipeline                                                                                                                                              |
| `slug`                | Path prefix for all custom endpoints                                                                                                                                                     |
| `static`              | Opt-in plain static hosting: `{ enabled, directory, options: { dotfiles, index, maxAge } }`. Served before the auth stack — no `orion-*` headers needed. Distinct from token-gated ORAS. |

### `client` / `server` — CORS & issuer allowlists

- `client.urls[]` — allowed browser origins (CORS). `runTimeUpdateAllowed` /
  `persistentUpdateAllowed` let the orchestrator push new URLs at runtime.
- `server.urls[]` — every node's public API URL (all nodes list all URLs so a
  token's `iss` validates cluster-wide). `selfUrl` — this node's own URL.

### `mail` — SMTP

`{ email, password, service }` (e.g. `service: 'gmail'` with an App Password), or
explicit SMTP host/port. **Required** for any email-OTP method.

### `tokens` — lifespans & security tier

- `lifespans` — `{ accessTokens: '15m', refreshTokens: '7d', resourceTokens: '1h' }`.
- `securityTier` — how tightly tokens bind to the client context:

    | Tier | Binds the token to…                               |
    | ---- | ------------------------------------------------- |
    | 1    | Baseline (audited issuance)                       |
    | 2    | + IP range                                        |
    | 3    | + device fingerprint                              |
    | 4    | + IP range **and** device fingerprint (strictest) |

    Higher tiers reject a stolen token replayed from a different network/device,
    at the cost of legitimate re-auth when a user's IP or device changes.

### `authMethods` — enabled sign-in methods

```js
authMethods: {
    emailPassword: true,
    passkey: true,               // WebAuthn; force-disabled without mail creds
    OAuth: {                     // per-provider; empty {} disables OAuth
        google:   { clientId, clientSecret, redirectUri },
        github:   { clientId, clientSecret, redirectUri },
    },
    allowedEmailDomains: ['*']   // or ['example.com', 'corp.io']
}
```

Built-in OAuth providers: **google, github, discord, slack, microsoft,
facebook, amazon, twitter, linkedin, reddit, spotify** — this fixed registry
is the full set (config-defined custom providers are not supported). Slack
uses **"Sign in with Slack" (OIDC)** — your Slack app must be configured with
the `openid email profile` scopes, not the legacy `identity.*` ones. Apple is
**not supported** (its form_post callback and JWT client secret don't fit the
standard code flow).

---

## 9. Run a single node (fastest path)

The simplest possible deployment — one auth node, no cluster, no orchestrator.

1. Provision **Postgres** and **SMTP** (skip Redis/MySQL).
2. Copy and fill `gipsy.orion.config.js`. Set `ephemeralDB` — you may omit it for
   a single node; leave `clusterLink.enabled: false`.
3. Point `client.urls`, `server.urls`, and `selfUrl` at your real URLs.

```bash
cd Packages/apps/Todos-App/server
node index.js          # boots, migrates Postgres, serves the API
```

Serve the static client separately (any web server):

```bash
cd ../client
# edit config.js: SERVER_URL = 'https://<your-api-url>'
python3 -m http.server 8080
```

Open the client, sign up, sign in, use the app. Done.

---

## 10. Run a multi-node cluster

Add nodes by running more Orion-core instances that share the **same** Postgres,
**same** Redis, and (optionally) same MySQL. Key rules:

1. **Redis is mandatory.** Every node points `ephemeralDB` at the same Redis so
   signing keys are shared — a token from any node validates on all nodes.
2. **List all URLs in every config.** Each node's `server.urls` must contain the
   public URL of _every_ node (so cross-node `iss` validation passes);
   `selfUrl` is that node's own URL. `client.urls` should list every client
   origin.
3. **Give each node a unique `serviceID`, `appName`, and `publicIp`/`port`** for
   its cluster link.
4. **Enable `clusterLink`** on each and point it at the orchestrator (next
   section). With `requireOrchestrator: false`, nodes serve auth traffic even if
   the orchestrator is down and retry registration with backoff.

That's it — start each node the same way. They discover each other's shared
state automatically; the orchestrator gives you the fleet-wide view and control.

---

## 11. The cluster control plane (Orion-Orchestrator)

Run **one** orchestrator per cluster. It supervises nodes over R_Sync encrypted
tunnels: registry, health state machine (`FORMING → HEALTHY → DEGRADED →
INCIDENT`), fleet consensus votes, declarative alert→reaction policies,
escalations, and awaitable remote commands.

Minimal orchestrator process:

```js
import { OrionOrchestrator, ClusterCommands, ConsensusTopics } from 'orion-orch';

const orch = new OrionOrchestrator({
    cluster: 'todos-demo', // nodes must present the SAME name
    publicIp: '127.0.0.1', // address nodes reach it on
    port: 55321,
    nodeStaleAfterSeconds: 120
    // persistence, health, consensus, policies, escalations, systemAdmin ...
});

orch.onClusterStateChange((state, prev, ev) => console.log(`${prev} → ${state}`));
await orch.start();
```

On each node's config, enable the link:

```js
utilities: {
    clusterLink: {
        enabled: true,
        cluster: 'todos-demo',
        orchestratorIp: '10.0.0.5', orchestratorPort: 55321,
        publicIp: '10.0.0.21',      // this node's M2M callback address
        port: 55322,
        requireOrchestrator: false, // true = refuse to boot without the orchestrator
        allowRemoteControl: true    // false = reject all remote commands
    }
}
```

Full orchestrator config table, the command allowlist, consensus topics, policy
engine, and the R_Sync security model are documented in
**`Packages/server/Orion-Orchestrator/README.md`**. Programmatic operations:

```js
await orch.getClusterStatus(); // merged fleet view
await orch.lockCluster(); // reject all API traffic fleet-wide
await orch.proposeConsensus(ConsensusTopics.NODE_HEALTHY);
await orch.command(workerId, ClusterCommands.GET_STATUS);
await orch.declareIncident('DB failover');
await orch.resolveIncident('done');
```

---

## 12. The system-admin plane — PBAC panel, API, CLI

Without this, anyone who can reach the orchestrator process has total, unaudited
governance. Enabling it puts every human operator behind **policy**, **magic-link

- mandatory TOTP** auth (password + TOTP for the one root admin), and an
  **immutable, hash-chained audit trail** — with a web panel, a JSON API, and the
  `orionctl` CLI all speaking the same policy-guarded surface.

### Enable it

Pass a `systemAdmin` block to `OrionOrchestrator`. Reuse your Postgres and SMTP
credentials:

```js
new OrionOrchestrator({
    cluster: 'todos-demo',
    publicIp: '127.0.0.1',
    port: 55321,
    systemAdmin: {
        enabled: true,
        database: { host, port: 5432, database: 'todos_orion', user: 'todos_app', password },
        rootAdmin: { email: 'you@example.com', initialPassword: '<min-12-chars>' }, // FIRST boot only
        http: { host: '0.0.0.0', port: 55330, secureCookies: true, trustProxy: true, theme: 'modern' },
        baseUrl: 'https://panel.example.com', // this panel's own public URL (for magic links)
        mail: { service: 'gmail', email, password, from: email, appName: 'Orion Orchestrator' }
    }
});
```

The reference orchestrator (`Packages/apps/Todos-App/orchestrator/start.js`)
reads all of this from environment variables so no secrets are committed — set
`SYSTEM_ADMIN_ENABLED=true` plus `SA_DB_*`, `SA_ROOT_*`, `SA_HTTP_*`,
`SA_BASE_URL`, `SA_MAIL_*` at launch (keep them in a git-ignored
`gipsy.launch-orch.sh`).

**Panel theme.** `http.theme` picks the panel's look: `modern` (default —
light, Apple-style, roomy) or `classic` (dense MySQL Workbench-style: gray
chrome, sharp rectangles, 11px type, zebra grids, status bar). `ORION_GUI_THEME`
sets the same thing from the environment; the config key wins. Both themes are
compiled into the shipped `gui/out` bundle and the attribute is stamped per
request, so switching is a **restart, not a GUI rebuild**.

```bash
ORION_GUI_THEME=classic node orchestrator/start.js
```

### What it does

- **Root admin** — created from config on the **first boot only**. Password +
  TOTP; first login forces a password rotation and TOTP enrollment. Root holds
  total governance (bypasses PBAC) and is the only account that can
  create/suspend/delete admins and manage policies, groups, and attachments.
- **System admins** — passwordless. Sign-in is a single-use, short-lived,
  emailed magic link **plus a required TOTP layer**; the account stays `pending`
  and cannot act until enrollment completes. Each governs the cluster strictly
  within the policies attached to them — no more, no less.
- **PBAC policies** — IAM-style JSON (`version`, `statements[]` of
  `effect/actions/resources`). Deny overrides, default deny, effective policy =
  direct + group attachments. Node commands are individually grantable
  (`cluster:command:server:lock` on `node:<workerId>`). A managed
  `default-read-only` policy is seeded and auto-attached to new admins.
- **Immutable audit** — every API request (PBAC denials included) and auth/
  governance event is hash-chained in `orch_admin_audit`; the table rejects
  `UPDATE`/`DELETE` at the database level. `GET /api/audit/verify` (root)
  re-walks the chain. **Both sides** audit: each worker also records every
  incoming orchestrator command, scoped to the admin who issued it.
- **Worker read-only rule** — the orchestrator is the only writer of `orch_*`
  data; apply `sql/worker-grants.example.sql` to grant workers SELECT-only.

### The GUI (orch panel)

A statically-exported Next.js app shipped **inside** the package (`gui/out` is
committed — no build tooling needed). `AdminServer` serves it same-origin next to
`/api/*` on `http.port` (default `55330`). Pages: dashboard/fleet with per-node
commands, operations (lock/incident/consensus/client-URLs), observability,
audit trail (with chain verification), governance (root only), account.

First login: open the panel → **Root** tab → sign in with the config email +
initial password → enroll TOTP (scan the QR) → rotate the password. The account
activates, and **Governance** lets you invite admins, author policies, and build
groups.

Rebuild the GUI only if you change its source: `cd gui && npm install && npm run build`
(then commit `gui/out`).

### The CLI (`orionctl`)

Ships in the package `bin`, zero dependencies, same API + PBAC + audit as the
GUI. Session stored in `~/.orionctl.json` (0600).

```bash
node Packages/server/Orion-Orchestrator/bin/orionctl.js login you@example.com --root --url https://panel.example.com
orionctl status                       # cluster view (needs cluster:read:status)
orionctl cmd WKR-1 node:ping          # needs cluster:command:node:ping
orionctl lock                         # needs cluster:ops:lock
orionctl admins create dev@example.com --policy POL_DEFAULT_READ_ONLY   # root only
orionctl policies create --name ops --file ops.json                     # root only
orionctl audit verify                 # root only — hash-chain check
orionctl help
```

The complete action vocabulary, policy grammar, and config table are in
**`Packages/server/Orion-Orchestrator/README.md` § System-admin plane**.

---

## 13. The client SDK

The browser SDK lives at `Packages/client/dist/orion.beta.sdk.js` (also vendored
into the Todos client). A front end points at a node's API URL and calls the
SDK for signup, sign-in, 2FA, device authorization, and authenticated requests.

In the reference client, the only line to change per deployment is
`client/config.js`:

```js
const SERVER_URL = 'https://<your-api-url>'; // the Orion-core node this client talks to
export { SERVER_URL };
```

Because auth cookies are `Secure` + `SameSite=None` (correct for cross-origin
auth), the client and API must be served over **HTTPS** in any real deployment
(browsers only exempt `localhost`).

---

## 14. Exposing services (TLS, tunnels, reverse proxy)

Orion-core emits `Secure` cookies, so production traffic must be HTTPS. Pick one:

- **Reverse proxy (recommended for production).** Terminate TLS at nginx/Caddy/
  an ALB in front of each node's API and the panel. Set `trustProxy: true` on
  the system-admin `http` block so forwarded client IPs are honored in the audit
  trail.
- **Direct TLS.** Drop `server.cert` / `server.key` next to the API (the
  reference app auto-detects them and serves HTTPS itself).
- **Quick tunnels (demos only).** `cloudflared tunnel --url http://localhost:PORT`
  gives an instant HTTPS URL with no account. **Caveat:** the URL is ephemeral —
  it changes on every restart, so you must re-sync `client.urls` / `server.urls`
  / `SA_BASE_URL` each time. Fine for a live demo, not for production. Use a
  **named** Cloudflare tunnel or a real domain for anything lasting.

Ports to expose per role: auth node API (e.g. `3900`); orchestrator M2M
(`55321`, node-to-orchestrator only — keep it on a private network); each node's
M2M callback (`55322`); the system-admin panel (`55330`, behind TLS). The
orchestrator↔node M2M ports never need public exposure — keep them on the
private subnet.

---

## 15. End-to-end reference deployment (4 nodes on AWS)

This mirrors the live reference deployment: one orchestrator box (also hosting
Postgres/Redis/MySQL) and three auth nodes, each fronting the API + static
client through a tunnel. Full narrative in `Packages/apps/Todos-App/README.md`.

**Topology**

| Role             | Runs                                                              | M2M      |
| ---------------- | ----------------------------------------------------------------- | -------- |
| orchestrator box | Orion-Orchestrator (+ system-admin plane), Postgres, Redis, MySQL | `:55321` |
| worker ×3        | Orion-core API (`:3900`) + static client (`:8080`)                | `:55322` |

**Per-box bootstrap**

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs
# clone/rsync the repo to ~/orion on each box
cd ~/orion/Packages/server/Orion-core && npm install --omit=dev
cd ~/orion/Packages/server/Orion-Orchestrator && npm install --omit=dev   # orchestrator box
```

**Backing services** live on the orchestrator box's private IP; every worker
config points `db`, `ephemeralDB`, and `auditTrailSystem` at that private IP.
The orchestrator M2M port (`55321`) stays on the private subnet.

**Each worker** gets its own `gipsy.orion.config.js`: unique `serviceID`/
`appName`/`clusterLink.publicIp`; `clusterLink.orchestratorIp` = the
orchestrator's private IP; `client.urls` / `server.urls` list **all three**
workers' tunnel URLs; `selfUrl` is that worker's own. Each worker's
`client/config.js` `SERVER_URL` points at its own API tunnel.

**Launch (tmux per box)** — orchestrator box runs `orchestrator/start.js` (with
the `SYSTEM_ADMIN_*` env vars) plus the panel tunnel; each worker runs
`server/index.js`, the static client, and two tunnels (client + API). Watch the
orchestrator log for `[hello]` and `[health] FORMING → HEALTHY` — the fleet is
live.

**Verify**: `orch.getClusterStatus()` (or the panel) shows `HEALTHY N/N online`;
sign up on any worker's client and confirm the session works across workers.

---

## 16. Operating the fleet day-to-day

- **Panel / CLI**: watch fleet health, run per-node or fleet-wide commands,
  declare/resolve incidents, propose consensus votes, review the audit trail —
  all under PBAC.
- **Emergency lockdown**: `orch.lockCluster()` (or panel → Operations → Lock)
  rejects all API traffic fleet-wide; `unlockCluster()` restores it.
- **Runtime config push**: `orch.addClientUrls([...])` propagates new allowed
  client origins to every node that permits runtime updates — no redeploy.
- **Policies**: grant an operator exactly what they need (e.g. read + ping, but
  never ETS-lockdown clears) and nothing more; deny statements always win.
- **Audit**: `orionctl audit verify` / panel chain-verify proves the trail is
  untampered; the DB itself rejects edits.

---

## 17. Testing

The suite uses the built-in Node test runner — **no install step**:

```bash
cd Testing
npm test              # whole suite
npm run test:server   # Orion-core suites
npm run test:client   # browser SDK suites
npm run test:crypto   # cryptography suites
npm run test:coverage # + V8 coverage
```

Requires Node ≥ 20. The orchestrator + system-admin plane (`PBACEngine`,
`authCrypto`, `AuditLog`, protocol) are covered under
`Testing/suites/server/orchestrator/`. See `Testing/README.md`.

---

## 18. Upgrades and redeploys

1. Commit and push your changes.
2. On each box: `git fetch origin && git reset --hard origin/main` (this discards
   local edits — keep real config in git-ignored `gipsy.*` files so it survives).
3. Reinstall changed deps: `npm install --omit=dev` in each affected package.
4. Restart processes (the reference deployment uses tmux windows per process).
5. Watch the orchestrator log return to `HEALTHY N/N online`.

Migrations are versioned and checksummed — new schema is applied automatically
and safely on boot, serialized cluster-wide via advisory locks.

---

## 19. Security checklist before you go live

- [ ] Every secret is in a `gipsy.*` file or an env var — nothing real committed.
- [ ] All traffic is HTTPS (reverse proxy or real certs), not a quick tunnel.
- [ ] `dataEncryption.key` is set (TOTP secrets sealed at rest) and backed up.
- [ ] `auditTrailSystem` enabled and pointed at MySQL for tamper-evident logging.
- [ ] `securityTier` chosen deliberately (4 = strictest token binding).
- [ ] `allowedEmailDomains` restricted if this isn't a public sign-up.
- [ ] System-admin plane enabled; root password rotated + TOTP enrolled.
- [ ] `sql/worker-grants.example.sql` applied so workers are SELECT-only on `orch_*`.
- [ ] Orchestrator M2M ports (`55321`/`55322`) are private-subnet only.
- [ ] `safeMode: 'ENABLED'` so remote command overrides can't disable security.
- [ ] Redis + Postgres reachable only from your nodes (security groups / firewall).

---

## 20. Troubleshooting

| Symptom                                              | Likely cause / fix                                                                                                               |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Node exits: _"Missing server/gipsy.orion.config.js"_ | Copy `orion.config.example.js` → `gipsy.orion.config.js` and fill it in.                                                         |
| Signup/2FA/passkey silently unavailable              | No `mail` credentials — email-OTP methods are force-disabled. Add SMTP creds.                                                    |
| Tokens from node A rejected on node B                | Redis not shared (or not configured). Multi-node **requires** a shared `ephemeralDB`.                                            |
| CORS errors in the browser                           | Client origin not in `client.urls`; add it (or push via `orch.addClientUrls`).                                                   |
| Orchestrator can't reach nodes after restart         | Benign: nodes re-register on their next heartbeat; health returns to `HEALTHY` within ~30–60s.                                   |
| Panel 401 / `AUTH::TOTP-REQUIRED`                    | Expected until you complete the login ladder (magic link/password → TOTP → active).                                              |
| Panel URL stopped working                            | Quick-tunnel URL changed on restart — re-sync `SA_BASE_URL` and the allowlists, or move to a named tunnel/domain.                |
| `CREATE TABLE` denied on boot                        | The DB user lacks DDL rights in its database. Grant it, or make it the DB owner.                                                 |
| Audit chain reports BROKEN                           | The row set was tampered with outside the app; investigate — the DB trigger blocks normal edits, so this means direct DB access. |

---

**Deep-dive references**

- Cluster control plane + system-admin plane → `Packages/server/Orion-Orchestrator/README.md`
- Encrypted M2M transport → `Packages/server/R_sync/README.md`
- Annotated full config template → `Packages/apps/Todos-App/server/orion.config.example.js`
- Worked example (local + EC2) → `Packages/apps/Todos-App/README.md`
- Test suite → `Testing/README.md`
