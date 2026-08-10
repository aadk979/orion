# Orion

**A self-hosted authentication and identity framework for Node.js, plus the distributed control plane that runs a fleet of it.**

Orion isn't a hosted auth service — it's a library you embed. Call `initiateServer(...)` and get a hardened Express 5 application with passwords, passkeys (WebAuthn), TOTP, OAuth/OIDC, device authorization, step-up auth, session management, and field-level encryption already wired up, into which you mount your own routes. When you outgrow a single node, `Orion-Orchestrator` supervises a fleet of them over an encrypted machine-to-machine transport, behind its own PBAC-governed admin plane.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](#license)
[![Node](https://img.shields.io/badge/node-%E2%89%A518.18-339933)](#requirements)
[![Status](https://img.shields.io/badge/status-beta-orange)](#project-status)

---

## Why Orion

- **Standards-faithful, not approximated.** DPoP (RFC 9449), JWK thumbprints (RFC 7638), confirmation claims (RFC 7800), Security Event Tokens (RFC 8417), OpenID Shared Signals & CAEP, and HTTP message signatures (RFC 9421) are implemented against spec.
- **Every factor you'd actually want.** Password, WebAuthn/passkeys, TOTP, OAuth/OIDC, device authorization, and step-up re-authentication, all behind one token engine.
- **Encryption at rest with a real key-management story.** Envelope encryption (DEK/KEK) with pluggable key vault providers — AWS KMS, GCP KMS, Azure Key Vault, HashiCorp Vault, and more.
- **Graduated degradation over hard failure.** An unreachable key vault disables TOTP and falls back to emailed codes instead of refusing to boot. A Redis outage narrows the DPoP replay guard instead of locking everyone out. Login backoff never refuses a *correct* password — it escalates to step-up, because a failure counter that blocks correct credentials is a denial-of-service primitive against anyone whose email address is known.
- **A control plane that is itself governed.** Operating the fleet requires magic-link + mandatory TOTP, a PBAC policy evaluation, and lands in a hash-chained, tamper-evident audit trail — not just an API key with admin rights.

## Architecture

Each Orion-core node is a self-contained process — there's no internal service mesh, no message bus inside a node. Horizontal scale comes from running several identical nodes against shared PostgreSQL/MySQL/Redis; the orchestrator coordinates and observes the fleet, it doesn't sit on the request path.

```
 Browser                     Orion-core fleet                Control plane
┌──────────┐   HTTPS +      ┌───────────────┐   R_Sync      ┌───────────────────┐
│ Client   │───orion-*─────▶│  Node 1        │◀─encrypted───▶│ Orion-Orchestrator │
│ SDK      │   headers +    │  Node 2        │   tunnel      │  registry · policy │
│ (DPoP,   │   DPoP proof   │  Node N        │               │  consensus · PBAC  │
│ IndexedDB│                └───────┬────────┘               │  audit · panel/CLI │
│ vault)   │                        │                         └─────────┬──────────┘
└──────────┘                        ▼                                   ▼
                          PostgreSQL · MySQL · Redis              PostgreSQL (orch_*)
```

## Packages

This is a multi-package repository — no monorepo tooling, just plain npm and `file:` dependencies between packages.

| Package | Path | What it is |
|---|---|---|
| **Orion-core** | [`Packages/server/Orion-core`](Packages/server/Orion-core) | The authentication node itself: Express 5 middleware pipeline, token engine, auth flows, PostgreSQL persistence, audit trail, key-vault-backed field encryption. |
| **Orion-Orchestrator** | [`Packages/server/Orion-Orchestrator`](Packages/server/Orion-Orchestrator) | One-per-cluster control plane — node registry, remote commands, policy engine, consensus, health, a PBAC admin API + panel + `orionctl` CLI. |
| **R_Sync** | [`Packages/server/R_sync`](Packages/server/R_sync) | The encrypted transport underneath the control plane: ECDH + HKDF + AES-256-GCM + Ed25519 + replay protection over plain HTTP. |
| **Client SDK** | [`Packages/client`](Packages/client) | Browser SDK — a singleton `Orion` class with a non-extractable WebCrypto device key, an IndexedDB vault, and self-rendering overlays for device authorization, step-up, and notifications. |
| **Todos-App** | [`Packages/apps/Todos-App`](Packages/apps/Todos-App) | A reference integration showing Orion-core mounted in a real app. |
| **Testing** | [`Testing`](Testing) | The full test suite (`node:test`, no third-party framework) covering both the server and the client SDK. |
| **orion-docs** | [`orion-docs`](orion-docs) | The documentation site (Next.js + Nextra). |

## Requirements

- Node.js ≥ 18.18 (≥ 20 to run the test suite)
- PostgreSQL for identity data, MySQL for the audit trail, Redis for ephemeral state (signing keys, rate buckets, replay guards)
- A key vault provider (AWS KMS, GCP KMS, Azure Key Vault, HashiCorp Vault, or a local dev provider) if you want encryption at rest
- SMTP credentials — several flows (device auth, TOTP enrollment, passkeys) deliver a one-time code by email and are disabled at boot without one

## Getting started

Orion-core is embedded, not run standalone:

```js
import { initiateServer } from '@aadharsh/orion-alpine-x934x';

const app = await initiateServer(startConfig, systemConfig);

// mount your own routes on the returned Express app
app.get('/todos', requireAuth, listTodosHandler);
```

`systemConfig` is where everything lives — database credentials, the key vault provider, mail transport, rate-limit policy, which auth methods are enabled. See [`Packages/apps/Todos-App/server/orion.config.example.js`](Packages/apps/Todos-App/server/orion.config.example.js) for a fully-annotated template, and the [documentation site](orion-docs) for the complete reference.

To bring up a cluster, add `Orion-Orchestrator` and point each node at it — see its [README](Packages/server/Orion-Orchestrator/README.md) for the wiring.

## Testing

```bash
cd Testing
npm install
npm test
```

No install step is required beyond that — dependencies under test are resolved straight from each package's own `node_modules`, so tests run exactly against what would ship. See [`Testing/README.md`](Testing/README.md) for suite-specific commands and coverage.

## Project status

Orion-core is self-declared **Beta**; Orion-Orchestrator and R_Sync are **Stable**. The authentication, token, and cryptographic architecture is exercised by an extensive unit and cryptography test suite. Full end-to-end coverage of the auth flows themselves, and a CI pipeline, are the two areas most actively being worked on — see open issues for status.

## Security

Orion handles credentials, tokens, and encryption keys, so we take reports seriously. If you find a vulnerability, please **do not open a public issue** — instead reach out privately so it can be fixed before disclosure.

## Contributing

Issues and pull requests are welcome. Before sending a substantial change, please open an issue to discuss the approach — this is still a young project and some internals are actively evolving.

## License

[MIT](LICENSE) © Kalivaradhan Aadharsh
