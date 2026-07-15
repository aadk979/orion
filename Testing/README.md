# Orion Test Suite

Automated tests for the **Orion (Alpine)** authentication framework — both the
server package (`Packages/server/Orion-core`) and the browser SDK
(`Packages/client`).

The suite uses the **built-in Node.js test runner** (`node:test` +
`node:assert/strict`). There is **no third-party test framework and no install
step** — the runtime dependencies the code under test needs (bcrypt, zxcvbn,
geoip-lite, joi, …) are resolved from `Packages/**/node_modules`, exactly as
they are in production.

> Requires Node **≥ 20** (developed and verified on Node 25). The suite relies on
> `node:test`, `mock.timers`, and web-standard globals (`btoa`, `TextEncoder`,
> `CompressionStream`, `crypto.subtle`).

---

## Running the tests

From this directory (`Testing/`):

```bash
npm test              # run the whole suite
npm run test:server   # server (Orion-core) suites only
npm run test:client   # browser SDK suites only
npm run test:crypto   # the three cryptography suites
npm run test:coverage # whole suite with V8 line/branch coverage
npm run test:watch    # re-run on file changes
```

Or drive `node --test` directly with any glob:

```bash
node --test "suites/server/utils/*.test.js"
node --test "suites/**/Crypto*.test.js"
```

Every test file is self-contained and side-effect-isolated, so files run in
parallel across worker processes with no shared state.

---

## Layout

```
Testing/
├── package.json                 # scripts + "type": module (no dependencies)
├── README.md                    # this file
├── COVERAGE-MAP.md              # module-by-module coverage status
├── helpers/
│   ├── bootstrap.js             # MUST be imported first in every test file
│   ├── mocks.js                 # mockRequest / mockResponse / silenceConsole
│   └── fixtures.js              # shared deterministic sample data
├── suites/
│   ├── server/                  # Orion-core (Node) tests
│   │   ├── PackageSurface.test.js
│   │   ├── utils/               # pure + crypto utilities
│   │   ├── databases/           # ephemeral store
│   │   ├── systems/             # resilience / secrets systems
│   │   ├── errors/              # error registry integrity
│   │   └── general/             # endpoint request schemas
│   └── client/                  # browser SDK tests (run under Node globals)
└── integration/                 # live end-to-end harness (see its README)
```

---

## How the suite stays hermetic

Several Orion modules perform **filesystem side effects at import time**, keyed
off `process.cwd()`:

| Module | Side effect on import |
| --- | --- |
| `lib/Utils/logger.js` | creates a `logs/` directory |
| `lib/Errors/internal-errors.js` | writes `errors.json` |
| `lib/Utils/FileHandler.js` | reads/writes relative to cwd |

`helpers/bootstrap.js` handles this. **It must be the first import in every test
file.** Because ES modules evaluate imports depth-first in source order,
importing it first guarantees it runs before any Orion module loads. It:

1. Creates a per-process scratch dir `gipsy.test-artifacts/pid-<pid>/`.
2. `chdir`s into it, so all cwd-relative writes land there instead of the repo.

`gipsy.test-artifacts/` is git-ignored (both by `Testing/.gitignore` and the
repo-wide `gipsy.*` rule), so test runs never dirty the working tree.

### The pattern every test file follows

```js
import '../../../helpers/bootstrap.js';   // 1. FIRST — redirects cwd side effects
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { thingUnderTest } from '../../../../Packages/server/Orion-core/lib/...';
```

Helpers available:

- `mockRequest(overrides)` / `mockResponse()` — Express-shaped doubles.
- `silenceConsole(fn)` — swallow console output from noisy modules (logger,
  `tryCatch`, circuit-breaker state logs) for the duration of `fn`.
- `fixtures.js` — deterministic emails, passwords, IPs, AES keys, sample objects.

---

## What is covered

See **[COVERAGE-MAP.md](./COVERAGE-MAP.md)** for the authoritative,
module-by-module breakdown. In short:

- **Unit-tested now:** the deterministic core — encoders, date/time,
  value/ID generation, validators, sanitizer, cookies, parsers, the global
  access point, `tryCatch`, file I/O, the full cryptography surface
  (hashing/KDF, AES-GCM, RSA, HMAC, Ed25519, ECDH transport, the RSA/ECDSA
  secrets crypto), the in-memory ephemeral DB, the circuit breaker, the error
  tracker, the error registry, the request-validation schemas, the package
  entry point, and the browser SDK's pure utilities.
- **Requires the live integration harness:** anything that needs Postgres,
  Redis, a bound HTTP server, or real cookies/OAuth/passkey ceremonies —
  middleware pipeline, account/session flows, token issuance against a store,
  mail delivery, OAuth callbacks, device authorization. Scaffolding and a plan
  live in [`integration/`](./integration/README.md).

## Known defects pinned by tests

A few tests deliberately assert *current, incorrect* behavior so a future fix
trips the test (a "regression pin"). These are labelled in-place, e.g. the
browser SDK `utf16` codec, which does not round-trip because
`new TextEncoder('utf-16le')` silently emits UTF-8. Search the suites for
`KNOWN DEFECT` / `regression pin`.

---

## Adding a test

1. Create `suites/<area>/<Module>.test.js`.
2. Make `import '.../helpers/bootstrap.js'` the **first** line.
3. Prefer deterministic assertions. For time-dependent code use
   `mock.timers` (see `DateTime`, `localMemoryDB`, `CircuitBreakerSystem`).
4. Wrap intentionally-failing or log-heavy calls in `silenceConsole`.
5. Run `npm test` — it should stay green and leave the working tree clean.
