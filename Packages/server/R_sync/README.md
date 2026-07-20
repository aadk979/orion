# R_Sync — Encrypted M2M Communication Library

> **Version:** 1.0.0 (Stable)  
> **License:** MIT  
> **Author:** Kalivaradhan Aadharsh

R_Sync is a Node.js library for **machine-to-machine (M2M)** communication built on an **Orchestrator ↔ Worker** architecture. It provides encrypted event-driven messaging over HTTP with automatic key exchange, signature-based authentication, and audit logging — all out of the box.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [How It Works](#how-it-works)
- [Technology Stack](#technology-stack)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration Reference](#configuration-reference)
- [API Reference — `R_Sync` Class](#api-reference--r_sync-class)
- [REST API Endpoints](#rest-api-endpoints)
- [Security Model](#security-model)
- [Cryptographic Functions](#cryptographic-functions)
- [Utility Exports](#utility-exports)
- [File & Directory Structure](#file--directory-structure)
- [Logging & Auditing](#logging--auditing)
- [Tests](#tests)
- [Production environment variables](#production-environment-variables)
- [System Flush](#system-flush)
- [Advanced Usage](#advanced-usage)

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│                    ORCHESTRATOR                       │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ TunnelManager│  │  LokiJS DB   │  │ Audit Logs │ │
│  │ (Key Mgmt)   │  │ (Workers,    │  │ (JSON-line)│ │
│  │              │  │  Keys, Events)│  │            │ │
│  └──────┬───────┘  └──────────────┘  └────────────┘ │
│         │                                            │
│  ┌──────▼──────────────────────────────────────────┐ │
│  │            Express.js HTTP Server               │ │
│  │  POST /discover-me    (worker registration)     │ │
│  │  POST /worker-event   (receive worker events)   │ │
│  │  POST /broadcast      (send to all workers)     │ │
│  │  POST /send-to        (send to one worker)      │ │
│  │  POST /heartbeat      (worker heartbeat)        │ │
│  │  GET  /workers        (list registered workers) │ │
│  │  GET  /status         (orchestrator health)     │ │
│  │  POST /flush          (wipe everything)         │ │
│  └─────────────────────────────────────────────────┘ │
└────────────────────────┬─────────────────────────────┘
                         │  Encrypted HTTP (AES-256-GCM)
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│   WORKER A   │ │   WORKER B   │ │   WORKER N   │
│              │ │              │ │              │
│  POST /event │ │  POST /event │ │  POST /event │
│  GET /status │ │  GET /status │ │  GET /status │
└──────────────┘ └──────────────┘ └──────────────┘
```

### Roles

| Role             | Description                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| **Orchestrator** | Central coordinator. Manages worker registrations, key exchange, and event dispatch. One per cluster.     |
| **Worker**       | A node that registers with the orchestrator, receives events, and can emit events back. Many per cluster. |

---

## How It Works

### 1. Discovery & Registration

1. On first boot, a worker generates a **persistent Ed25519 identity key pair** and saves it to its local config file (`r_sync.internal.worker_config.json`). This key is reused for the lifetime of the worker — it is what proves, on every future reconnect, that a request claiming a given `workerId` is coming from the _same_ worker that originally registered it.
2. On every boot (including restarts), the worker also generates a **fresh ECC key pair** (ECDH) and a **fresh Ed25519 session signature key pair** — these rotate every time for forward secrecy and are unrelated to the identity key.
3. Worker sends `POST /discover-me` with its session public keys and its persistent `identityPublicKey`. The request is signed with the **identity** private key over `timestamp:workerId:nonce:sha256(encryptionPublicKey)` — a fresh nonce and a digest of the offered encryption key are included so a captured registration request cannot be replayed or have its key material swapped.
4. Orchestrator performs **ECDH** with the worker's session encryption key to derive a shared secret, then derives an **AES-256** key via **HKDF** using a per-session salt (`SHA-256` of both parties' raw public keys — no two tunnels share a salt).
5. Orchestrator returns its own public keys. Both sides now hold the same symmetric key.
6. Worker stores the shared key locally and begins sending heartbeats.

### 2. Encrypted Communication

All events (broadcast, sendTo, emitToOrchestrator) follow the same pattern:

1. **Serialize** the event object to JSON.
2. **Encrypt** with AES-256-GCM using the shared key → produces `payload` (Base64).
3. **Sign** the encrypted payload with Ed25519 → produces `signature`.
4. Send `{ payload, signature, timestamp }` over HTTP.
5. Recipient **verifies** the signature, then **decrypts** the payload.
6. Recipient checks the event's embedded `id` and `timestamp` (part of the signed, encrypted payload — not a header) against a short-lived replay cache. Worker→orchestrator events are additionally authenticated by a nonce-bearing header signature (see Request Authentication below); orchestrator→worker events are deduplicated purely on the event id, so a captured event (e.g. `system:flush`) cannot be replayed to trigger its side effect twice — the second delivery is acknowledged as a no-op duplicate (`{ duplicate: true }`) instead of re-invoking handlers.

### 3. Reconnection & Key Rotation

If a worker restarts, it sends its persisted `workerId` with the registration request, signed with its **persistent identity key**. The orchestrator looks up the `identityPublicKey` it stored for that `workerId` at first registration and requires it to match exactly — a request for a known `workerId` signed by a _different_ identity key is rejected with `403 IDENTITY_MISMATCH` rather than being treated as a reconnect. This is what prevents a leaked/guessed `workerId` from being hijacked by an attacker who doesn't hold the original worker's identity key. Once identity is confirmed, the orchestrator rotates the session keys (deletes old shared key, derives a new one) and re-establishes the tunnel — all transparent to the developer.

### 4. Heartbeat

Workers periodically send `POST /heartbeat` to the orchestrator (default: every 30s). Each heartbeat is signed with the worker's session Ed25519 key, carries a nonce, and is checked against a replay cache. The orchestrator verifies the signature and nonce, then updates the worker's `lastHeartbeat` timestamp.

---

## Technology Stack

| Component            | Technology                                | Purpose                                                |
| -------------------- | ----------------------------------------- | ------------------------------------------------------ |
| Runtime              | **Node.js** (ESM modules)                 | JavaScript runtime                                     |
| HTTP Server          | **Express.js v5**                         | Routing, middleware                                    |
| Symmetric Encryption | **AES-256-GCM** (`crypto`)                | Event payload encryption                               |
| Key Exchange         | **ECDH** (P-256/P-384/P-521)              | Shared secret derivation                               |
| Key Derivation       | **HKDF**                                  | Deriving AES keys from shared secrets                  |
| Digital Signatures   | **Ed25519**                               | Message authentication, request signing                |
| Hashing              | **SHA-256, SHA-512, BLAKE2b, BLAKE2s**    | Data integrity                                         |
| Password Hashing     | **bcrypt, PBKDF2, scrypt**                | Password-based hashing                                 |
| Database             | **LokiJS**                                | In-memory document store with file persistence         |
| Security Middleware  | **Helmet, HPP, CORS, express-rate-limit** | HTTP hardening                                         |
| Logging              | **Custom Logger** + **AuditLogSystem**    | Console + file logging with tamper-evident audit trail |

---

## Installation

```bash
npm install
```

### Dependencies

```json
{
    "bcrypt": "^5.1.0",
    "cors": "^2.8.5",
    "express": "^5.2.1",
    "helmet": "^8.1.0",
    "hpp": "^0.2.3",
    "lokijs": "^1.5.12",
    "express-rate-limit": "^7.0.0"
}
```

---

## Quick Start

### Orchestrator

```javascript
import { R_Sync } from 'r-sync';

const orchestrator = new R_Sync({
    role: 'ORCHESTRATOR',
    publicIp: '127.0.0.1',
    port: 55321,
    encryptionAlg: 'ECC_256',
    cluster: 'my-cluster'
});

// Listen for events FROM workers
orchestrator.onWorkerEvent((workerId, event) => {
    console.log(`Worker ${workerId} says: ${event.name}`, event.data);

    // Respond to that specific worker
    orchestrator.sendTo(workerId, 'ack', { received: true });
});

await orchestrator.startOrchestrator();

// Broadcast to ALL workers
await orchestrator.broadcast('config:update', { theme: 'dark' });

// Send to ONE specific worker
await orchestrator.sendTo('ID_WORKER-abc123', 'task:assign', { job: 'process-data' });
```

### Worker

```javascript
import { R_Sync } from 'r-sync';

const worker = new R_Sync({
    role: 'WORKER',
    publicIp: '127.0.0.1',
    port: 55322,
    orchestratorIp: '127.0.0.1',
    orchestratorPort: 55321,
    encryptionAlg: 'ECC_256',
    heartbeatIntervalMs: 30000,
    cluster: 'my-cluster'
});

// Listen for events FROM orchestrator (broadcasts + targeted)
worker.onEvent(event => {
    console.log(`Received: ${event.name}`, event.data);
});

await worker.startWorker();

// Send an event TO the orchestrator
await worker.emitToOrchestrator('status:report', {
    cpuUsage: '12%',
    memoryUsage: '45%'
});
```

### Running the Examples

```bash
# Terminal 1 — Start orchestrator
npm run start:orchestrator

# Terminal 2 — Start worker
npm run start:worker
```

---

## Configuration Reference

### Orchestrator Config

| Property                  | Type      | Required | Default       | Description                                                                                                                                                             |
| ------------------------- | --------- | -------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `role`                    | `string`  | ✅       | —             | Must be `"ORCHESTRATOR"`                                                                                                                                                |
| `cluster`                 | `string`  | ✅       | —             | Cluster name. Workers must match this to register.                                                                                                                      |
| `publicIp`                | `string`  | ❌       | `"127.0.0.1"` | The IP address workers will connect to.                                                                                                                                 |
| `port`                    | `number`  | ❌       | `55321`       | HTTP server port.                                                                                                                                                       |
| `encryptionAlg`           | `string`  | ❌       | `"ECC_256"`   | ECC curve for ECDH. Options: `"ECC_256"`, `"ECC_384"`, `"ECC_521"`                                                                                                      |
| `trustAdvertisedWorkerIp` | `boolean` | ❌       | `false`       | If `true`, use `x-r_sync-ip` as the worker callback address; if `false`, use the TCP peer address (recommended unless workers are behind NAT and you trust the header). |

### Worker Config

| Property              | Type      | Required | Default       | Description                                                                                                                                                                                                                                                                                                                  |
| --------------------- | --------- | -------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `role`                | `string`  | ✅       | —             | Must be `"WORKER"`                                                                                                                                                                                                                                                                                                           |
| `cluster`             | `string`  | ✅       | —             | Must match the orchestrator's cluster name.                                                                                                                                                                                                                                                                                  |
| `publicIp`            | `string`  | ❌       | `"127.0.0.1"` | Sent as `x-r_sync-ip` at registration; the orchestrator uses it only when `trustAdvertisedWorkerIp` is `true`. Otherwise it uses the registration TCP peer address.                                                                                                                                                          |
| `port`                | `number`  | ❌       | `55322`       | Worker's HTTP server port for receiving events.                                                                                                                                                                                                                                                                              |
| `orchestratorIp`      | `string`  | ❌       | `"127.0.0.1"` | Orchestrator's IP to connect to.                                                                                                                                                                                                                                                                                             |
| `orchestratorPort`    | `number`  | ❌       | `55321`       | Orchestrator's port.                                                                                                                                                                                                                                                                                                         |
| `encryptionAlg`       | `string`  | ❌       | `"ECC_256"`   | Must match orchestrator's encryption algorithm.                                                                                                                                                                                                                                                                              |
| `heartbeatIntervalMs` | `number`  | ❌       | `30000`       | Heartbeat interval in milliseconds. Minimum: `1000`.                                                                                                                                                                                                                                                                         |
| `exitOnBootFailure`   | `boolean` | ❌       | `true`        | When `true`, a worker that cannot register with its orchestrator crashes the process (standalone-worker semantics). Set to `false` when the worker is **embedded** in a host application (e.g. an Orion-core node) — `startWorker()` then throws instead of exiting, so the host can retry registration on its own schedule. |

### Encryption Algorithm Options

| Value     | Curve      | Security Level |
| --------- | ---------- | -------------- |
| `ECC_256` | NIST P-256 | 128-bit        |
| `ECC_384` | NIST P-384 | 192-bit        |
| `ECC_521` | NIST P-521 | 256-bit        |

---

## API Reference — `R_Sync` Class

### Constructor

```javascript
const node = new R_Sync(config);
```

Creates a singleton instance. Only **one** `R_Sync` instance per process is allowed. Throws if called a second time.

---

### Lifecycle Methods

#### `startOrchestrator()` → `Promise<R_Sync>`

**Role:** Orchestrator only  
Initializes the database, generates cryptographic keys, creates the Express server, mounts all orchestrator routes, and starts listening.

```javascript
await orchestrator.startOrchestrator();
```

#### `startWorker()` → `Promise<R_Sync>`

**Role:** Worker only  
Initializes the database, generates keys, registers with the orchestrator (ECDH key exchange), starts the local Express server, and begins heartbeating.

```javascript
await worker.startWorker();
```

#### `stop()` → `Promise<void>`

Stops the HTTP server and clears the heartbeat interval.

```javascript
await node.stop();
```

---

### Event Methods

#### `broadcast(eventName, data)` → `Promise<Array>`

**Role:** Orchestrator only  
Encrypts and sends an event to **all** active workers in parallel.

```javascript
const results = await orchestrator.broadcast('deploy:start', { version: '2.0' });
// results = [{ workerId: '...', success: true }, ...]
```

#### `sendTo(workerId, eventName, data)` → `Promise<Object>`

**Role:** Orchestrator only  
Encrypts and sends an event to **one specific** worker by its ID.

```javascript
const result = await orchestrator.sendTo('ID_WORKER-abc123', 'task:run', { taskId: 42 });
// result = { eventId: '...', workerId: '...', success: true }
```

#### `emitToOrchestrator(eventName, data)` → `Promise<Object>`

**Role:** Worker only  
Encrypts, signs, and sends an event to the orchestrator. The request is authenticated via the `validateWorkerSignature` middleware (worker ID + timestamp + nonce + Ed25519 signature).

```javascript
const result = await worker.emitToOrchestrator('metrics:report', { cpu: '23%' });
// result = { acknowledged: true, eventId: '...' }
```

#### `onEvent(callback)` → `R_Sync`

**Role:** Worker only  
Registers a handler for events received **from the orchestrator** (both broadcasts and targeted sends).

```javascript
worker.onEvent(event => {
    console.log(event.name, event.id, event.data, event.timestamp);
});
```

#### `onWorkerEvent(callback)` → `R_Sync`

**Role:** Orchestrator only  
Registers a handler for events received **from workers**.

```javascript
orchestrator.onWorkerEvent((workerId, event) => {
    console.log(`Worker ${workerId}: ${event.name}`, event.data);
});
```

---

### Utility Methods

#### `getRole()` → `string`

Returns `"ORCHESTRATOR"` or `"WORKER"`.

#### `getSupportedEncryptionAlgorithms()` → `string[]`

Returns `["ECC_256", "ECC_384", "ECC_521"]`.

#### `static getInstance()` → `R_Sync | null`

Returns the singleton instance or `null`.

---

### Properties

| Property         | Type     | Set by                | Description                                       |
| ---------------- | -------- | --------------------- | ------------------------------------------------- |
| `role`           | `string` | Constructor           | `"ORCHESTRATOR"` or `"WORKER"`                    |
| `workerId`       | `string` | `startWorker()`       | The assigned worker ID (e.g., `ID_WORKER-xYz...`) |
| `orchestratorId` | `string` | `startOrchestrator()` | The orchestrator's ID                             |
| `publicIp`       | `string` | Constructor           | Public IP of this node                            |
| `port`           | `number` | Constructor           | HTTP port                                         |
| `cluster`        | `string` | Constructor           | Cluster name                                      |

---

## REST API Endpoints

All endpoints are prefixed with `/r_sync/api/v1/`.

### Orchestrator Endpoints

| Method | Path            | Middleware                                            | Description                                                                                                                                                                    |
| ------ | --------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST` | `/discover-me`  | `enforceETSLockdown`, `validateRegistrationSignature` | Worker registration + ECDH key exchange. Requires proof-of-possession of a persistent Ed25519 `identityPublicKey` (see [Discovery & Registration](#1-discovery--registration)) |
| `POST` | `/worker-event` | `validateWorkerSignature`                             | Receive an encrypted event from a worker                                                                                                                                       |
| `POST` | `/broadcast`    | `restrictToLocalhost`                                 | Broadcast event to all active workers                                                                                                                                          |
| `POST` | `/send-to`      | `restrictToLocalhost`                                 | Send event to a specific worker by ID                                                                                                                                          |
| `POST` | `/heartbeat`    | `validateWorkerSignature`                             | Worker heartbeat                                                                                                                                                               |
| `GET`  | `/workers`      | `restrictToLocalhost`                                 | List all registered workers                                                                                                                                                    |
| `GET`  | `/status`       | `restrictToLocalhost`                                 | Orchestrator status + worker count                                                                                                                                             |
| `POST` | `/flush`        | `restrictToLocalhost`                                 | Wipe all data and shut down                                                                                                                                                    |

### Worker Endpoints

| Method | Path      | Description                                |
| ------ | --------- | ------------------------------------------ |
| `POST` | `/event`  | Receive encrypted events from orchestrator |
| `GET`  | `/status` | Worker registration status                 |

### Using the HTTP API Directly

```bash
# Broadcast (from localhost)
curl -X POST http://localhost:55321/r_sync/api/v1/broadcast \
  -H "Content-Type: application/json" \
  -d '{"eventName": "system:ping", "data": {"message": "hello"}}'

# Send to a specific worker (from localhost)
curl -X POST http://localhost:55321/r_sync/api/v1/send-to \
  -H "Content-Type: application/json" \
  -d '{"workerId": "ID_WORKER-abc123", "eventName": "task:run", "data": {}}'

# List workers (from localhost)
curl http://localhost:55321/r_sync/api/v1/workers

# Orchestrator status (from localhost)
curl http://localhost:55321/r_sync/api/v1/status
```

---

## Security Model

### Layers of Protection

| Layer                      | Mechanism                                  | Description                                                                                                                                                                                                                                                                                                               |
| -------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Transport Encryption**   | AES-256-GCM                                | All event payloads encrypted with a shared symmetric key                                                                                                                                                                                                                                                                  |
| **Key Exchange**           | ECDH (P-256/384/521)                       | Diffie-Hellman key agreement — private keys never leave the node                                                                                                                                                                                                                                                          |
| **Key Derivation**         | HKDF with per-session salt                 | AES key derived from ECDH shared secret; salt is `SHA-256` of both parties' raw public keys, so no two tunnels reuse the same salt                                                                                                                                                                                        |
| **Message Authentication** | Ed25519 Signatures                         | Every encrypted payload is signed; receiver verifies                                                                                                                                                                                                                                                                      |
| **Identity Continuity**    | Persistent Ed25519 identity key            | Generated once per worker and reused across restarts; reconnects for a known `workerId` must be signed by the same identity key or are rejected with `403 IDENTITY_MISMATCH` (prevents `workerId` hijacking)                                                                                                              |
| **Request Authentication** | Signed Headers                             | Heartbeats and worker events include `workerId:timestamp:nonce` signed by Ed25519 (session key); registration includes `timestamp:workerId:nonce:sha256(encryptionKey)` signed by the identity key                                                                                                                        |
| **Replay Protection**      | Nonce + Timestamp Window (both directions) | Worker→orchestrator requests: 30s window + nonce cache (nonce is only recorded after signature verification, to avoid a forged request pre-burning a nonce). Registration: 120s window + dedicated nonce cache. Orchestrator→worker events: 60s timestamp window + event-id dedup, so a captured event cannot be replayed |
| **M2M Restriction**        | User-Agent Blocking                        | Best-effort defense-in-depth only — blocks obvious browser User-Agents (Mozilla, Chrome, Safari, Edge). Not a substitute for the cryptographic controls above, which are what actually gate access                                                                                                                        |
| **Admin Isolation**        | Localhost-only                             | Sensitive endpoints (broadcast, send-to, workers, flush, `/ets/*`) accessible only from `127.0.0.1`                                                                                                                                                                                                                       |
| **HTTP Hardening**         | Helmet, HPP, CORS, Rate Limiting           | Standard Express security headers and protections                                                                                                                                                                                                                                                                         |
| **Key Rotation**           | Automatic on Reconnect                     | Worker reconnections trigger full session-key regeneration (identity key is unaffected)                                                                                                                                                                                                                                   |

### Security Middleware

| Middleware                      | Purpose                                                                                                                                                                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `restrictToLocalhost`           | Blocks non-localhost requests to admin endpoints                                                                                                                                                                                       |
| `restrictToM2M`                 | Blocks browser User-Agents globally (defense-in-depth only)                                                                                                                                                                            |
| `enforceETSLockdown`            | Rejects worker-facing traffic with 503 while the system is in ETS lockdown                                                                                                                                                             |
| `validateWorkerSignature`       | Verifies Ed25519 signature + nonce/timestamp on worker requests (heartbeat, worker-event)                                                                                                                                              |
| `validateRegistrationSignature` | Proof of Possession — verifies the registering worker owns the private key for its persistent `identityPublicKey`, with the signature bound to a nonce and a digest of the offered encryption key (blocks replay and key-swap attacks) |

---

## Cryptographic Functions

The `crypto.js` module provides a comprehensive set of cryptographic utilities, all exported via `cryptoExports`:

### Hashing

| Function                              | Algorithm                                   |
| ------------------------------------- | ------------------------------------------- |
| `sha256Hash(input)`                   | SHA-256                                     |
| `sha512Hash(input)`                   | SHA-512                                     |
| `blake2bHash(input)`                  | BLAKE2b (512-bit)                           |
| `blake2sHash(input)`                  | BLAKE2s (256-bit)                           |
| `pbkdf2Hash(password, salt?)`         | PBKDF2 (100K iterations, SHA-512)           |
| `scryptHash(password, salt?)`         | scrypt                                      |
| `hashString(input)`                   | bcrypt (async, 12 rounds)                   |
| `hashStringSync(input, alg?)`         | Configurable: sha256/sha512/blake2b/blake2s |
| `verifyHash(input, hashed)`           | bcrypt verify (async)                       |
| `verifyHashSync(input, hashed, alg?)` | Configurable hash verify                    |

### Symmetric Encryption

| Function                         | Description                     |
| -------------------------------- | ------------------------------- |
| `encrypt(plaintext, keyBuffer)`  | AES-256-GCM encrypt → Base64    |
| `decrypt(base64Data, keyBuffer)` | AES-256-GCM decrypt             |
| `generateEncryptionKey()`        | Generate random 32-byte AES key |

### Asymmetric (RSA)

| Function                                | Description                     |
| --------------------------------------- | ------------------------------- |
| `generateKeyPair(keySize?)`             | RSA key pair (default 2048-bit) |
| `publicEncrypt(publicKey, message)`     | RSA-OAEP encrypt                |
| `privateDecrypt(privateKey, encrypted)` | RSA-OAEP decrypt                |

### Elliptic Curve (ECDH)

| Function                                        | Description                                                                                                                                                                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generateKeyPairECC(size?)`                     | Generate ECDH key pair (P-256/384/521)                                                                                                                                                                                 |
| `exportPublicKeyECC(key)`                       | Export public key as raw bytes                                                                                                                                                                                         |
| `importPublicKeyECC(rawKey, size?)`             | Import raw bytes as public key                                                                                                                                                                                         |
| `deriveSharedSecret(privateKey, peerPublicKey)` | ECDH shared secret derivation                                                                                                                                                                                          |
| `deriveKey(sharedSecret, salt?, info?)`         | HKDF to derive AES-256 key                                                                                                                                                                                             |
| `deriveTunnelSalt(aPubBytes, bPubBytes)`        | Derives a deterministic per-session HKDF salt (`SHA-256` of the two raw public keys concatenated). Both sides compute this identically, so it replaces the old fixed constant salt without needing an extra round trip |

### Signatures (Ed25519)

| Function                                      | Description                            |
| --------------------------------------------- | -------------------------------------- |
| `generateSignatureKeyPair()`                  | Generate Ed25519 key pair (JWK format) |
| `generateSignature(data, privateJwk)`         | Sign data → Base64 signature           |
| `verifySignature(data, signature, publicJwk)` | Verify Ed25519 signature               |

### HMAC

| Function                  | Description              |
| ------------------------- | ------------------------ |
| `generateHmacKey()`       | Generate random HMAC key |
| `generateHmac(data, key)` | HMAC-SHA256              |

### Key Utilities

| Function                         | Description                |
| -------------------------------- | -------------------------- |
| `importKeyFromBase64(base64Key)` | Base64 → Buffer            |
| `exportKeyBase64(keyBuffer)`     | Buffer → Base64            |
| `hashToBigNumber(hash)`          | Convert hex hash to BigInt |

---

## Utility Exports

The library re-exports utility packages from `index.js`:

```javascript
import {
    R_Sync,
    cryptoExports, // All crypto functions
    dateTimeExports, // Time utilities
    valueGeneratorExports, // ID / random generators
    waitForDb, // Database ready check
    getAllWorkers, // Query all workers from DB
    getWorkerById, // Query single worker
    logger, // Logger instance
    __Version__, // "1.0.0"
    __Status__, // "Stable"
    __PackageType__ // "R_SYNC"
} from 'r-sync';
```

### Date & Time Utilities (`dateTimeExports`)

| Function                      | Description                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| `getCurrentUnixTime()`        | Current Unix timestamp (seconds)                                                   |
| `getFutureUnixTime(duration)` | Future timestamp. Duration format: `"30s"`, `"5m"`, `"2h"`, `"1d"`, `"1w"`, `"1y"` |
| `isUnixExpired(unixTime)`     | Check if a timestamp is in the past                                                |
| `parseDuration(str)`          | Parse duration string to milliseconds (e.g., `"1h 30m"` → `5400000`)               |
| `formatTime(ms)`              | Format ms to human-readable (`"1h 23min"`)                                         |
| `formatTimePrecise(ms)`       | Precise formatting with decimals                                                   |

### Value Generator Utilities (`valueGeneratorExports`)

| Function                            | Description                                            |
| ----------------------------------- | ------------------------------------------------------ |
| `generateId(prefix, length)`        | Cryptographically random ID (e.g., `ID_WORKER-xYz...`) |
| `generateRequestId(prefix, length)` | Request ID with `REQ_` prefix                          |
| `generateRandomNumber(length)`      | Random numeric string                                  |
| `generateChallenge(byteLength)`     | Random hex challenge                                   |

---

## File & Directory Structure

```
r-sync/
├── index.js                          # Main entry point & re-exports
├── package.json
├── lib/
│   ├── interface.js                  # R_Sync class — the public API
│   ├── r_sync.meta.js                # Version, file name constants
│   ├── core/
│   │   ├── server.js                 # Express server factory
│   │   ├── TunnelManager.js          # ECDH tunnels, encrypt/decrypt, send/broadcast
│   │   ├── controllers/
│   │   │   ├── orchestratorController.js  # Registration, broadcast, worker-event, heartbeat, flush
│   │   │   └── workerController.js        # Event reception, flush handling, status
│   │   ├── routes/
│   │   │   ├── orchestratorRoutes.js      # Orchestrator route definitions
│   │   │   └── workerRoutes.js            # Worker route definitions
│   │   └── middleware/
│   │       └── securityMiddleware.js      # Auth, M2M restriction, localhost guard
│   └── utils/
│       ├── crypto.js                 # 30+ cryptographic functions
│       ├── lokidb.js                 # LokiJS database (workers, keys, events)
│       ├── logger.js                 # Custom logger with file + console output
│       ├── AuditLogSystem.js         # Tamper-evident audit + interaction logging
│       ├── configSchemas.js          # Config validation schemas
│       ├── Date&Time.js              # Unix time utilities
│       ├── valueGenerators.js        # Cryptographic ID generators
│       ├── globalAccessPoint.js      # Singleton key-value store for system config
│       ├── fileHandler.js            # Read/write/delete files in caller's directory
│       ├── replayGuard.js            # Reusable nonce/id cache with TTL, used for replay protection
│       ├── tryCatch.js               # Error-catching wrapper with ETS integration
│       └── Systems/
│           └── ErrorTrackerSystem.js # Error tracking and escalation
└── examples/
    ├── orchestrator.example.js       # Runnable orchestrator demo
    └── worker.example.js             # Runnable worker demo
```

---

## Logging & Auditing

### Application Logger

The `CustomLogger` singleton outputs to both **console** (with ANSI colors) and **file** (`logs/app.log`):

```
[2026-02-14T10:30:05.123Z::1739523005] INFO: Worker registered: ID_WORKER-abc123
[2026-02-14T10:30:05.456Z::1739523005] WARN: Heartbeat failed: timeout
[2026-02-14T10:30:05.789Z::1739523005] ERROR: Broadcast failed: No active workers
```

### Audit Log System

By default, security-relevant audit records append to **`logs/r_sync.audit.jsonl`** (one JSON object per line, each with an `integrityHash` field).

Optional **MySQL** buffering is available when `globalAccessPoint` `systemConfig.utilities.auditTrailSystem.enabled` is `true` and a password is set via that config or **`R_SYNC_AUDIT_DB_PASSWORD`**. There is no default database password in code.

### Error Tracking & Lockdown Recovery

The `ErrorTrackerSystem` (ETS) tracks every error raised through the internal `tryCatch` wrapper — by message, source function, and originating file — and watches for threshold violations (total error count, error bursts, a single error or function repeating excessively). When a **CRITICAL** threshold trips, it sets a global `ETS_LOCKDOWN` flag; the `enforceETSLockdown` middleware then rejects all worker-facing traffic (`discover-me`, `worker-event`, `heartbeat`) with `503` until an admin lifts it.

Lifting a lockdown (`DELETE /r_sync/api/v1/ets/lockdown`, localhost-only) also **resets the ETS's tracked error history** by default. This matters because the total-error threshold is cumulative and never expires on its own — without a reset, the very next error anywhere would immediately re-trip the same threshold and re-lock the system, making a lockdown effectively unrecoverable. The pre-reset state is captured as a summary snapshot (top error messages, most error-prone functions/sources) and written to the audit trail before it's cleared, so the incident remains reviewable. To keep the full error history instead of resetting it, pass `{ "preserveHistory": true }` in the request body — note that with history preserved, the system may re-enter lockdown almost immediately if it's still near the threshold.

### Tests

```bash
npm test
```

Tests preload `test/set-env.mjs` so the embedded database runs in-memory during the run.

### Production environment variables

| Variable                       | Purpose                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `R_SYNC_TRUST_PROXY`           | Set to `1` or `true` to enable Express `trust proxy` (correct client IPs behind a reverse proxy).            |
| `R_SYNC_CORS_ORIGIN`           | Comma-separated allowed origins for `cors`; if unset, the CORS middleware is not mounted (typical for M2M).  |
| `R_SYNC_AUDIT_DB_PASSWORD`     | MySQL password when DB audit is enabled without embedding it in config.                                      |
| `R_SYNC_LOGGER_HANDLE_SIGNALS` | Set to `1` to restore legacy SIGINT/SIGTERM handling on the library logger (default: host app owns signals). |

---

## System Flush

Flush completely wipes all data from both orchestrator and all connected workers:

```bash
curl -X POST http://localhost:55321/r_sync/api/v1/flush \
  -H "Content-Type: application/json" \
  -d '{"reason": "Infrastructure reset"}'
```

What happens:

1. Orchestrator broadcasts `system:flush` event to all workers.
2. Each worker clears its database, deletes config files, and exits.
3. Orchestrator clears its own database, deletes config files, and exits.

---

## Advanced Usage

### Multiple Workers on One Machine

Run workers on different ports:

```javascript
// Worker A
const workerA = new R_Sync({ role: 'WORKER', port: 55322 /* ... */ });

// Worker B (separate process)
const workerB = new R_Sync({ role: 'WORKER', port: 55323 /* ... */ });
```

### Event Patterns

```javascript
// Request-Response pattern (worker asks, orch responds)
worker.onEvent(event => {
    if (event.name === 'ack:received') {
        console.log('Orchestrator acknowledged my event:', event.data.originalEventId);
    }
});
await worker.emitToOrchestrator('data:request', { query: 'latest-status' });

// Fan-out (orchestrator broadcasts task, each worker picks it up)
orchestrator.broadcast('task:available', { taskId: 99, type: 'process-image' });

// Targeted assignment (orchestrator assigns to a specific worker)
orchestrator.sendTo(leastBusyWorkerId, 'task:assign', { taskId: 99 });
```

### Accessing Worker Data (Orchestrator Side)

```javascript
import { getAllWorkers, getWorkerById } from 'r-sync';

const workers = await getAllWorkers();
// [{ id, ip, port, status, registeredAt, lastHeartbeat, ... }]

const worker = await getWorkerById('ID_WORKER-abc123');
```

### Persistent Configuration

R_Sync automatically persists configuration files in the working directory:

| File                                       | Created By   | Contains                                |
| ------------------------------------------ | ------------ | --------------------------------------- |
| `r_sync.internal.orchestrator_config.json` | Orchestrator | Orchestrator ID, IP, port, timestamps   |
| `r_sync.internal.worker_config.json`       | Worker       | Worker ID, last registration time       |
| `r_sync.local_db.db`                       | Both         | LokiJS database (workers, keys, events) |

These files allow reconnection with the same identity after a restart.

---

## Communication Flow Summary

```
                    ┌─────────────────────────────────────┐
                    │          Communication Methods       │
                    ├─────────────────────────────────────┤
                    │                                     │
  Worker → Orch     │  worker.emitToOrchestrator(name, d) │
                    │       → POST /worker-event          │
                    │       → encrypted + signed           │
                    │       → validated by middleware       │
                    │                                     │
  Orch → Worker     │  orch.sendTo(id, name, data)        │
                    │       → POST /event (on worker)     │
                    │       → encrypted + signed           │
                    │                                     │
  Orch → All        │  orch.broadcast(name, data)         │
                    │       → POST /event (on each worker)│
                    │       → parallel, encrypted          │
                    │                                     │
  Listen (Worker)   │  worker.onEvent(callback)           │
  Listen (Orch)     │  orch.onWorkerEvent(callback)       │
                    └─────────────────────────────────────┘
```
