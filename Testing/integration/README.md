# Integration / End-to-End Harness

The suites under `Testing/suites/` are **unit tests**: hermetic, no network, no
database, no bound server. They cover every module that can be verified in
isolation (see [`../COVERAGE-MAP.md`](../COVERAGE-MAP.md)).

Everything marked 🔌 in the coverage map needs a **live environment** —
`initiateServer(startConfig, systemConfig)` boots Express and wires up Postgres,
Redis, the secrets managers, OAuth toolkit and the full middleware pipeline.
Those behaviors belong here.

This directory is **scaffolding + a plan**, not a running E2E suite yet. The one
test file self-skips unless you opt in, so `npm test` stays green everywhere.

## Opting in

Integration tests only execute when `ORION_INTEGRATION=1` is set **and** a
`systemConfig` is supplied (see `helpers/liveServer.js`). Without both, each
integration test is marked `skip` with a reason.

```bash
# 1. Bring up throwaway backing services (example)
docker run -d --name orion-pg  -e POSTGRES_PASSWORD=orion -p 5432:5432 postgres:16
docker run -d --name orion-redis -p 6379:6379 redis:7

# 2. Point the harness at them via a config module (the copy is git-ignored)
cp integration/orion.config.example.js integration/gipsy.orion.config.js
#   ...edit DB/redis credentials, allowed origins, secrets, etc.

# 3. Run
ORION_INTEGRATION=1 node --test "integration/**/*.test.js"
```

`integration/gipsy.orion.config.js` is git-ignored (matches the repo-wide
`gipsy.*` rule) so real credentials never get committed.

## What to cover here (priority order)

1. **Boot + health** — `initiateServer` starts, `/…/api/v1` responds, graceful
   shutdown releases resources. (`smoke.test.js` stub provided.)
2. **Middleware pipeline** — origin verification, header parsing, data
   validation (drive the `EndpointSchema` routes with real HTTP), abuse checks,
   load shedding, device scan, request metadata.
3. **Account lifecycle** — sign-up → sign-in → get-profile → sign-out against a
   real user store; password reset.
4. **Tokens** — access/refresh/resource token issuance, rotation, cleanup, and
   the tier logic in the secrets managers, backed by the store.
5. **2FA & device auth** — TOTP setup/verify, passkey registration/auth
   (WebAuthn ceremony via `@simplewebauthn`), device authorization + step-up.
6. **OAuth** — redirect URL generation and callback handling against a mock IdP.
7. **CAPTCHA / no-auth token** — bootstrap security path.
8. **Data layer** — Postgres models and the Redis ephemeral backend (parity with
   the already-unit-tested `InMemoryDB`).
9. **Mail** — capture transport (e.g. a local SMTP sink) for
   `mailConstructor`/`sendMail`.

## Recommended tooling

- HTTP: Node's built-in `fetch` (global) against the booted server, or
  `supertest` if you prefer request assertions.
- Browser SDK flows (`Packages/client`): `jsdom` for DOM-only utilities,
  Playwright for full WebAuthn/passkey ceremonies.
- Keep using `node:test` so unit and integration share one runner and reporter.
