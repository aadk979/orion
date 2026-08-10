has# Coverage Map

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

| Module                   | Status                      | Suite                                           |
| ------------------------ | --------------------------- | ----------------------------------------------- |
| `Encoders.js`            | ✅                          | `server/utils/Encoders.test.js`                 |
| `Date&Time.js`           | ✅                          | `server/utils/DateTime.test.js`                 |
| `valueGenerator.js`      | ✅                          | `server/utils/valueGenerator.test.js`           |
| `ArrayUtilities.js`      | ✅                          | `server/utils/ArrayUtilities.test.js`           |
| `Validator.js`           | ✅                          | `server/utils/Validator.test.js`                |
| `Sanitizer.js`           | ✅                          | `server/utils/Sanitizer.test.js`                |
| `CookieUtils.js`         | ✅                          | `server/utils/CookieUtils.test.js`              |
| `CryptoFunctions.js`     | ✅                          | `server/utils/CryptoFunctions.test.js`          |
| `dedicatedCrypto.js`     | ✅                          | `server/utils/dedicatedCrypto.test.js`          |
| `Compressor.js`          | ✅                          | `server/utils/Compressor.test.js`               |
| `Ip.js`                  | ✅ (network paths excluded) | `server/utils/Ip.test.js`                       |
| `Parsers.js`             | ✅                          | `server/utils/Parsers.test.js`                  |
| `GlobalAccessPoint.js`   | ✅                          | `server/utils/GlobalAccessPoint.test.js`        |
| `TryCatch.js`            | ✅                          | `server/utils/TryCatch.test.js`                 |
| `FileHandler.js`         | ✅                          | `server/utils/FileHandler.test.js`              |
| `logger.js`              | ⚙️                          | exercised via bootstrap + every importing suite |
| `Device.js`              | 🔌                          | ua-parser over real request headers             |
| `Cron.js`                | 🔌                          | node-cron scheduling                            |
| `CustomCaptchaSystem.js` | 🔌                          | canvas rendering                                |
| `SystemsControl.js`      | 🔌                          | orchestrates live systems                       |

### Resource Access (`lib/Utils/Core/ResourceAccessManagment`)

| Module                                                                                                 | Status                                                                           | Suite                                                  |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `dirBasedResources/convertors.js`, `dirBasedResources/fileResponse.js`                                 | ✅ (type sniffing, nosniff, disposition)                                         | `server/utils/fileResponse.test.js`                    |
| `s3BasedResources/S3UrlBuilder.js`                                                                     | ✅ (host/path styles, key templating, presign determinism; signs via AWS SDK v3) | `server/utils/s3UrlBuilder.test.js`                    |
| `s3BasedResources/urlResponse.js`                                                                      | ✅ (JSON envelope, no-store, url validation)                                     | `server/utils/s3UrlResponse.test.js`                   |
| `callbackBasedResources/callbackValidator.js`                                                          | ✅ (accepts SECURE-0/S3-0, rejects bad entries)                                  | `server/utils/rasCallbackValidator.test.js`            |
| `callbackBasedResources/secureDelivery.js`                                                             | ✅ (S3 delivery, access-type binding, allowlist, SECURE-0 regression)            | `server/utils/secureDelivery.test.js`                  |
| `configs.js`                                                                                           | ✅ (via callbackValidator + secureDelivery)                                      | —                                                      |
| `callbackBasedResources/utils.js` (`resourceUriBuilder`), `dirBasedResources/utils.js` (`getSafePath`) | 🔌                                                                               | URL/path helpers exercised through the live middleware |

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

| Module                                | Status                                                                     | Suite                                                 |
| ------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------- |
| `EphemeralDatabases/localMemoryDB.js` | ✅ (CRUD + TTL + clone isolation)                                          | `server/databases/localMemoryDB.test.js`              |
| `EphemeralDatabases/redis.js`         | 🔌                                                                         | needs a Redis instance                                |
| `EphemeralDatabases/index.js`         | 🔌                                                                         | selects a live backend                                |
| `PersitantDatabases/postgres.js`      | 🔌                                                                         | migration runner + pool; needs Postgres               |
| `PersitantDatabases/index.js`         | 🔌                                                                         | selects a live backend                                |
| `migrations/*.sql`                    | 🔌                                                                         | versioned DDL applied by the runner against a live DB |
| `models/*`                            | 🔌                                                                         | queries against a live DB                             |
| Field encryption (envelope sealing)   | ✅ (seal/open round-trip, AAD-bound DEK version, tamper, enc.v1 legacy compat, plaintext passthrough, refusal when unavailable, DEK + KEK rotation) | `server/utils/totpSecretSealing.test.js`              |
| `Core/KeyVault/*` providers + gating  | ✅ (registry completeness, normalized contract, explicitAllow gate, cluster refusal of inline keys, wrap/unwrap health round trip, field registry) | `server/utils/keyVaultProviders.test.js`              |
| `Core/KeyVault/configSchema.js`       | ✅ (per-provider schema drift guard, unknown-key rejection with suggestions, required keys + env fallbacks, either/or groups, fatal gates, absence tolerance) | `server/utils/keyVaultConfigSchema.test.js`           |
| `models/NotificationModel.js`         | ✅ (audience/severity validation, keyed upsert without receipt reset, lazy materialization, DB-side prompt decision, route id coercion) | `server/general/notifications.test.js`                |

### Systems (`lib/Utils/Systems`)

| Module                                                                        | Status                                                                                                    | Suite                                           |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `CircuitBreakerSystem.js`                                                     | ✅ (full state machine)                                                                                   | `server/systems/CircuitBreakerSystem.test.js`   |
| `ErrorTrackerSystem.js`                                                       | ✅ (reporting + analytics + export)                                                                       | `server/systems/ErrorTrackerSystem.test.js`     |
| `SecretsCrypto.js`                                                            | ✅                                                                                                        | `server/systems/SecretsCrypto.test.js`          |
| `SignatureSecretsManager.js`                                                  | ✅ forceRotate/describeKeys (scheduled rotation w/ shared store 🔌)                                       | `server/systems/SecretsManagersForceRotate.test.js` |
| `TokenSecretsManager.js`                                                      | ✅ forceRotate/describeKeys (scheduled rotation w/ shared store 🔌)                                       | `server/systems/SecretsManagersForceRotate.test.js` |
| `VolatileSecretsManager.js`                                                   | 🔌                                                                                                        | in-memory secret lifecycle + timers             |
| `AbuseDetectionSystem.js`                                                     | 🔌                                                                                                        | request-stream heuristics                       |
| `DynamicGlobalRateLimiter.js`                                                 | 🔌                                                                                                        | limiter over live traffic                       |
| `LoadSheddingSystem.js` / `EventLoopMonitor.js` / `MemoryMonitoringSystem.js` | 🔌                                                                                                        | runtime load signals                            |
| `GracefulShutdownSystem.js`                                                   | 🔌                                                                                                        | process signal lifecycle                        |
| `DatabaseJanitor.js`                                                          | 🔌                                                                                                        | advisory-locked TTL sweeps against a live DB    |
| `AuditTrailSystem.js` / `Snapshotter.js`                                      | 🔌                                                                                                        | observability against a store                   |
| `ClusterLinkSystem.js`                                                        | ✅ (commands, secrets revocation, key-vault status/wipe gating, consensus ballots incl. encryption-unavailable, alert edges, desync recovery, cluster-state tracking; live transport 🔌) | `server/orchestrator/ClusterLinkSystem.test.js` |
| `BatchMailer/*` (system, GroupSender, recipientQueue, reporting, limiter, tokens, failures, transport) | ✅ (sliding rate budget incl. `wait()`, token substitution, archive+delete atomicity, retry/backoff, dead-lettering, permanent-vs-throttle-vs-transport classification, dead-transport abort, one-group-at-a-time, graceful cancel, start/stop lifecycle, unreadable-queue and down-link reporting, progress fan-out; live SMTP 🔌) | `server/orchestrator/BatchMailerSystem.test.js` |

### Errors (`lib/Errors`)

| Area                    | Status                                    | Suite                                                                                 |
| ----------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------- |
| All 22 registry modules | ✅ (schema integrity + global uniqueness) | `server/errors/errorRegistry.test.js`                                                 |
| `internal-errors.js`    | ⚙️                                        | aggregation + `errors.json` write (side-effecting; tested via the individual modules) |

### General & Server

| Area                                                                         | Status                  | Suite / Note                                                                                                |
| ---------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| `General/EndpointSchema.js`                                                  | ✅ (Joi accept/reject)  | `server/general/EndpointSchema.test.js`                                                                     |
| `index.js` (package entry)                                                   | ✅ (public API surface) | `server/PackageSurface.test.js`                                                                             |
| `lib/Server/initiateServer.js`                                               | 🔌                      | boots Express + all systems                                                                                 |
| `lib/Server/Middleware/*`                                                    | 🔌                      | request pipeline (auth, origin, abuse, load-shedding, device scan, header parse, resource access, metadata) |
| `lib/Server/Endpoints/*`, `Response/response.js`, `onStartConfigurations.js` | 🔌                      | live routing/response                                                                                       |
| `onStartConfigurations.js` → `handleAllowedUserRolesConfig`                  | ✅ (store value, normalization, boot-failure paths) | `server/general/allowedUserRolesConfig.test.js`                          |

### Core account/security/token/OAuth/resource logic (`lib/Utils/Core`)

All 🔌 — these read/write users, tokens, devices, passkeys and TOTP through the
persistence + ephemeral layers, or perform browser ceremonies:

`AccountManagment/*` (CreateAccount, SignIn, SignOut, GetUserProfile,
PasswordReset, SetupTOTP, TOTP, Passkeys/*, DeviceAuthorization),
`SecurityManagment/*` (StepUpAuth, Remove2FAMethod, NoAuthToken, CookieReset,
DeviceAuthorization), `TokenManagement/*` (Access/Refresh/Resource tokens,
cleanup, field map), `OAuth/*`. The pure pieces of `ResourceAccessManagment/*`
are unit-tested — see the Resource Access section above.

`AccountManagment/UserControl.js` is partially promoted:

| Area                                    | Status                                                                                                             | Suite                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| `updateUserRole`                        | ✅ (all validation gates, custom-role allowlist, uppercasing, the `sessions_valid_from` bump, audit on every path) | `server/general/UserControlRoleGate.test.js` |
| Remainder (existence, lookups, disable/enable, password set) | 🔌                                                                                            | live users table                             |

`UserModel` reaches Postgres through globalAccessPoint's `db` module, so a
recording fake exercises the real SQL without a server. What stays 🔌 is whether
Postgres honours that SQL — not whether UserControl issues it.

> `TokenManagement/tokenFieldMap.js` is a static map and is a good candidate to
> promote to a ✅ unit test next.

### Communication (`lib/Utils/Mail`)

`mailConstructor.js`, `mailer.js`, `sendMail.js` — 🔌 (nodemailer transport).
The template _construction_ in `mailConstructor.js` is a candidate for a pure
unit test if the SMTP transport is injectable.

---

## Client — `Packages/client`

| Module                                                                                                                      | Status                                  | Suite / Note                                        |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------- |
| `lib/Utils/Encoders.js`                                                                                                     | ✅ (utf16 defect pinned)                | `client/Encoders.test.js`                           |
| `lib/Utils/Utils.js`                                                                                                        | ✅ (sanitizeInput excluded — needs DOM) | `client/Utils.test.js`                              |
| `lib/Utils/Date&Time.js`                                                                                                    | candidate ✅                            | pure; promote next                                  |
| `lib/Utils/Api.js`, `Api-2.js`, `Captcha.js`, `Authorisation.js`, `OrionVault.js`, `DevicePrint.js`, `GlobalAccessPoint.js` | 🔌                                      | depend on `fetch`, DOM, WebAuthn, storage           |
| `lib/API-Handlers/**`, `lib/Flows/**`, `lib/Root.js`                                                                        | 🔌                                      | full browser SDK flows (jsdom/Playwright)           |
| `lib/External-Scripts/*`                                                                                                    | n/a                                     | vendored bundles (DOMPurify, webAuthn, fingerprint) |

---

## Server — `Packages/server/Orion-Orchestrator`

| Module                     | Status                                                                                 | Suite                                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `lib/protocol.js`          | ✅ (contract stability + envelope builders)                                            | `server/orchestrator/protocol.test.js`                                                                        |
| `lib/CommandDispatcher.js` | ✅ (correlation, timeout, impersonation guard, clear)                                  | `server/orchestrator/CommandDispatcher.test.js`                                                               |
| `lib/NodeRegistry.js`      | ✅ (lifecycle, alert cap, stale sweep, hydration)                                      | `server/orchestrator/NodeRegistry.test.js`                                                                    |
| `lib/PolicyEngine.js`      | ✅ (defaults coverage, cooldowns, all action types, scheduled remediation, validation) | `server/orchestrator/PolicyEngine.test.js`                                                                    |
| `lib/ConsensusEngine.js`   | ✅ (quorum math, partitions, undecided semantics)                                      | `server/orchestrator/ConsensusEngine.test.js`                                                                 |
| `lib/ClusterHealth.js`     | ✅ (node health rules, state computation, transitions)                                 | `server/orchestrator/ClusterHealth.test.js`                                                                   |
| `lib/EscalationHub.js`     | ✅ (channels, isolation, history caps; webhook delivery 🔌)                            | `server/orchestrator/EscalationHub.test.js`                                                                   |
| `lib/RegistryStore.js`     | ✅ (round trip, debounce, corruption recovery)                                         | `server/orchestrator/RegistryStore.test.js`                                                                   |
| `lib/OrionOrchestrator.js` | 🔌                                                                                     | binds an R_Sync ORCHESTRATOR HTTP server; full production loop verified live against a ClusterLinkSystem node |
| `index.js` (package entry) | ⚙️                                                                                     | re-exports evaluated via the suites above                                                                     |

### System-admin plane (`lib/SystemAdmin`)

| Module                  | Status                                                                                                                          | Suite                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `PBACEngine.js`         | ✅ (all four wildcard forms incl. the intra-segment prefix glob, deny-overrides, default deny, document validation)              | `server/orchestrator/PBACEngine.test.js`               |
| `adminActions.js`       | ✅ (vocabulary pinned as literals, uniqueness, freeze, namespace isolation under the real matcher)                               | `server/orchestrator/adminActions.test.js`             |
| `SystemAdminService.js` | ✅ (module load, config defaults, TOTP single-use claim, `authorize` root bypass + PBAC path, root-only gate on all 13 governance methods) | `server/orchestrator/SystemAdminService.test.js`        |
| `authCrypto.js`         | ✅                                                                                                                              | `server/orchestrator/authCrypto.test.js`               |
| `AuditLog.js`           | ✅                                                                                                                              | `server/orchestrator/AuditLog.test.js`                 |
| `index.js`              | ✅ (smoke import — guards against a module-level parse error taking the whole plane down)                                        | `server/orchestrator/SystemAdminService.test.js`       |
| `AdminServer.js`        | 🔌                                                                                                                              | binds Express; session/stage/PBAC gates over live HTTP |
| `models.js`             | 🔌 (effective-policy SQL asserted indirectly via `authorize`)                                                                    | live `orch_*` tables                                   |
| `AdminDatabase.js`, `AdminMailer.js` | 🔌                                                                                                                  | Postgres pool / SMTP transport                         |
| `migrations/*.sql`      | 🔌                                                                                                                              | applied under advisory lock against live Postgres      |

### Batch mailing plane (`lib/Mailing`)

| Module                    | Status                                                                                                                                                                                | Suite                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `GroupPlanner.js`         | ✅ (the specified 100/5/15 → 15×6+10 split, cap-versus-node-count, partition invariants, edges)                                                                                        | `server/orchestrator/GroupPlanner.test.js`            |
| `SheetParser.js`          | ✅ (real .xlsx fixtures: required/optional columns, unknown columns as tokens, header aliasing, every rejection path, all-or-nothing validation, job-id generation)                    | `server/orchestrator/SheetParser.test.js`             |
| `BatchMailingService.js` + `Dispatcher.js`, `NodeReports.js`, `MailingWatchdog.js`, `JobCompletion.js`, `JobSubmission.js`, `MailingReads.js`, `leases.js` | ✅ (dispatch fan-out, one-group-per-node, lease rollback on refusal and on duplicate assignment, one-job-at-a-time, cooldown gating, node loss, group completion, stall/24h watchdog, cancellation, submission incl. duplicate-id/load-rollback/empty-fleet/delay warnings, job detail, restart recovery, submitter summary, timer lifecycle, queue reporting — all driven through the service facade) | `server/orchestrator/BatchMailingService.test.js`     |
| `MailingModels.js`        | 🔌 (SQL asserted indirectly through the service's stubbed models)                                                                                                                      | live `orch_mailing_*` tables                          |

> The single-running-job rule and the single-live-assignment rule are enforced
> by partial unique indexes, not by application code — the service suite stubs
> those constraints to prove it reacts correctly when the database rejects a
> racing write, but the constraints themselves are exercised against live
> Postgres.

> The `index.js` smoke import is deliberately listed: `SystemAdminService.js`
> once shipped a duplicate `const` declaration in one scope — a SyntaxError that
> made the entire plane unimportable. No suite touched the plane, so nothing
> failed. Keep at least one test importing it.

---

## Suggested next promotions (pure → ✅ without a live backend)

1. `client/lib/Utils/Date&Time.js`
2. `Core/TokenManagement/tokenFieldMap.js` (static mapping)
3. `Mail/mailConstructor.js` (if the transport is made injectable)
