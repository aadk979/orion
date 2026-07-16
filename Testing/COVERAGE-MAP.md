# Coverage Map

Status of every source area under `Packages/`. Legend:

- ✅ **Unit** — covered by an automated suite in `Testing/suites/`.
- 🔌 **Integration** — behavior depends on Postgres / Redis / a bound HTTP
  server / real crypto ceremonies; belongs in the live harness (`integration/`).
  Listed here so nothing is silently missed.
- ⚙️ **Bootstrap/wiring** — thin glue evaluated indirectly by other suites
  (e.g. imported through the package-surface smoke test).

Run `npm run test:coverage` for line/branch numbers on the ✅ set.

---

## Server — `Packages/server/Orion-core`

### Utilities (`lib/Utils`)

| Module | Status | Suite |
| --- | --- | --- |
| `Encoders.js` | ✅ | `server/utils/Encoders.test.js` |
| `Date&Time.js` | ✅ | `server/utils/DateTime.test.js` |
| `valueGenerator.js` | ✅ | `server/utils/valueGenerator.test.js` |
| `ArrayUtilities.js` | ✅ | `server/utils/ArrayUtilities.test.js` |
| `Validator.js` | ✅ | `server/utils/Validator.test.js` |
| `Sanitizer.js` | ✅ | `server/utils/Sanitizer.test.js` |
| `CookieUtils.js` | ✅ | `server/utils/CookieUtils.test.js` |
| `CryptoFunctions.js` | ✅ | `server/utils/CryptoFunctions.test.js` |
| `dedicatedCrypto.js` | ✅ | `server/utils/dedicatedCrypto.test.js` |
| `Compressor.js` | ✅ | `server/utils/Compressor.test.js` |
| `Ip.js` | ✅ (network paths excluded) | `server/utils/Ip.test.js` |
| `Parsers.js` | ✅ | `server/utils/Parsers.test.js` |
| `GlobalAccessPoint.js` | ✅ | `server/utils/GlobalAccessPoint.test.js` |
| `TryCatch.js` | ✅ | `server/utils/TryCatch.test.js` |
| `FileHandler.js` | ✅ | `server/utils/FileHandler.test.js` |
| `logger.js` | ⚙️ | exercised via bootstrap + every importing suite |
| `Device.js` | 🔌 | ua-parser over real request headers |
| `Cron.js` | 🔌 | node-cron scheduling |
| `CustomCaptchaSystem.js` | 🔌 | canvas rendering |
| `SystemsControl.js` | 🔌 | orchestrates live systems |

### Cryptography surface tested (security-critical)

- Digests: SHA-256/512, BLAKE2b/2s (known-answer + shape).
- KDFs: PBKDF2, scrypt (determinism + salted verify round-trip; the unsalted
  KDF quirk is documented in the suite).
- Password hashing: bcrypt hash/verify.
- Symmetric: AES-256-GCM encrypt/decrypt, random-IV non-determinism, auth-tag
  rejection on wrong key, base64 key export/import.
- Asymmetric: RSA keypair + public/private round-trip, RSA-OAEP dedicated
  transport keys.
- MAC/signatures: HMAC-SHA256 determinism, Ed25519 sign/verify + tamper.
- Transport: ECDH shared-secret agreement, raw/pkcs8 key export-import, HKDF
  key derivation.
- Secrets managers: ECDSA (P-256) and RSA (RS256) generation via `SecretsCrypto`
  with real sign/verify proof and JWK/base64 re-import.

### Databases (`lib/Utils/Databases`)

| Module | Status | Suite |
| --- | --- | --- |
| `EphemeralDatabases/localMemoryDB.js` | ✅ (CRUD + TTL + clone isolation) | `server/databases/localMemoryDB.test.js` |
| `EphemeralDatabases/redis.js` | 🔌 | needs a Redis instance |
| `EphemeralDatabases/index.js` | 🔌 | selects a live backend |
| `PersitantDatabases/postgres.js` | 🔌 | needs Postgres |
| `PersitantDatabases/index.js` | 🔌 | selects a live backend |
| `models/*` | 🔌 | schema/queries against a live DB |

### Systems (`lib/Utils/Systems`)

| Module | Status | Suite |
| --- | --- | --- |
| `CircuitBreakerSystem.js` | ✅ (full state machine) | `server/systems/CircuitBreakerSystem.test.js` |
| `ErrorTrackerSystem.js` | ✅ (reporting + analytics + export) | `server/systems/ErrorTrackerSystem.test.js` |
| `SecretsCrypto.js` | ✅ | `server/systems/SecretsCrypto.test.js` |
| `SignatureSecretsManager.js` | 🔌 | key rotation w/ shared store |
| `TokenSecretsManager.js` | 🔌 | tiered secrets w/ store |
| `VolatileSecretsManager.js` | 🔌 | in-memory secret lifecycle + timers |
| `AbuseDetectionSystem.js` | 🔌 | request-stream heuristics |
| `DynamicGlobalRateLimiter.js` | 🔌 | limiter over live traffic |
| `LoadSheddingSystem.js` / `EventLoopMonitor.js` / `MemoryMonitoringSystem.js` | 🔌 | runtime load signals |
| `GracefulShutdownSystem.js` | 🔌 | process signal lifecycle |
| `AuditTrailSystem.js` / `Tracer.js` / `Snapshotter.js` | 🔌 | observability against a store |
| `ClusterLinkSystem.js` | ✅ (commands, consensus ballots, alert edges, desync recovery, cluster-state tracking; live transport 🔌) | `server/orchestrator/ClusterLinkSystem.test.js` |

### Errors (`lib/Errors`)

| Area | Status | Suite |
| --- | --- | --- |
| All 21 registry modules | ✅ (schema integrity + global uniqueness) | `server/errors/errorRegistry.test.js` |
| `internal-errors.js` | ⚙️ | aggregation + `errors.json` write (side-effecting; tested via the individual modules) |

### General & Server

| Area | Status | Suite / Note |
| --- | --- | --- |
| `General/EndpointSchema.js` | ✅ (Joi accept/reject) | `server/general/EndpointSchema.test.js` |
| `index.js` (package entry) | ✅ (public API surface) | `server/PackageSurface.test.js` |
| `lib/Server/initiateServer.js` | 🔌 | boots Express + all systems |
| `lib/Server/Middleware/*` | 🔌 | request pipeline (auth, origin, abuse, load-shedding, device scan, header parse, resource access, metadata) |
| `lib/Server/Endpoints/*`, `Response/response.js`, `onStartConfigurations.js` | 🔌 | live routing/response |

### Core account/security/token/OAuth/resource logic (`lib/Utils/Core`)

All 🔌 — these read/write users, tokens, devices, passkeys and TOTP through the
persistence + ephemeral layers, or perform browser ceremonies:

`AccountManagment/*` (CreateAccount, SignIn, SignOut, GetUserProfile,
PasswordReset, SetupTOTP, TOTP, UserControl, Passkeys/*, DeviceAuthorization),
`SecurityManagment/*` (StepUpAuth, Remove2FAMethod, NoAuthToken, CookieReset,
DeviceAuthorization), `TokenManagement/*` (Access/Refresh/Resource tokens,
cleanup, field map), `OAuth/*`, `ResourceAccessManagment/*`.

> `TokenManagement/tokenFieldMap.js` and `ResourceAccessManagment/configs.js`
> are static maps and are good candidates to promote to ✅ unit tests next.

### Communication (`lib/Utils/Mail`)

`mailConstructor.js`, `mailer.js`, `sendMail.js` — 🔌 (nodemailer transport).
The template *construction* in `mailConstructor.js` is a candidate for a pure
unit test if the SMTP transport is injectable.

---

## Client — `Packages/client`

| Module | Status | Suite / Note |
| --- | --- | --- |
| `lib/Utils/Encoders.js` | ✅ (utf16 defect pinned) | `client/Encoders.test.js` |
| `lib/Utils/Utils.js` | ✅ (sanitizeInput excluded — needs DOM) | `client/Utils.test.js` |
| `lib/Utils/Date&Time.js` | candidate ✅ | pure; promote next |
| `lib/Utils/Api.js`, `Api-2.js`, `Captcha.js`, `Authorisation.js`, `OrionVault.js`, `DevicePrint.js`, `GlobalAccessPoint.js` | 🔌 | depend on `fetch`, DOM, WebAuthn, storage |
| `lib/API-Handlers/**`, `lib/Flows/**`, `lib/Root.js` | 🔌 | full browser SDK flows (jsdom/Playwright) |
| `lib/External-Scripts/*` | n/a | vendored bundles (DOMPurify, webAuthn, fingerprint) |

---

## Server — `Packages/server/Orion-Orchestrator`

| Module | Status | Suite |
| --- | --- | --- |
| `lib/protocol.js` | ✅ (contract stability + envelope builders) | `server/orchestrator/protocol.test.js` |
| `lib/CommandDispatcher.js` | ✅ (correlation, timeout, impersonation guard, clear) | `server/orchestrator/CommandDispatcher.test.js` |
| `lib/NodeRegistry.js` | ✅ (lifecycle, alert cap, stale sweep, hydration) | `server/orchestrator/NodeRegistry.test.js` |
| `lib/PolicyEngine.js` | ✅ (defaults coverage, cooldowns, all action types, scheduled remediation, validation) | `server/orchestrator/PolicyEngine.test.js` |
| `lib/ConsensusEngine.js` | ✅ (quorum math, partitions, undecided semantics) | `server/orchestrator/ConsensusEngine.test.js` |
| `lib/ClusterHealth.js` | ✅ (node health rules, state computation, transitions) | `server/orchestrator/ClusterHealth.test.js` |
| `lib/EscalationHub.js` | ✅ (channels, isolation, history caps; webhook delivery 🔌) | `server/orchestrator/EscalationHub.test.js` |
| `lib/RegistryStore.js` | ✅ (round trip, debounce, corruption recovery) | `server/orchestrator/RegistryStore.test.js` |
| `lib/OrionOrchestrator.js` | 🔌 | binds an R_Sync ORCHESTRATOR HTTP server; full production loop verified live against a ClusterLinkSystem node |
| `index.js` (package entry) | ⚙️ | re-exports evaluated via the suites above |

---

## Suggested next promotions (pure → ✅ without a live backend)

1. `client/lib/Utils/Date&Time.js`
2. `Core/TokenManagement/tokenFieldMap.js` (static mapping)
3. `Core/ResourceAccessManagment/configs.js` (static config)
4. `Mail/mailConstructor.js` (if the transport is made injectable)
