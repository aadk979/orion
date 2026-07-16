/**
 * Test bootstrap — MUST be the first import in every test file.
 *
 * Why this exists:
 *   Several Orion modules perform filesystem side effects *at import time*,
 *   keyed off `process.cwd()`:
 *     - `lib/Utils/logger.js`        → creates a `logs/` directory
 *     - `lib/Errors/internal-errors` → writes `errors.json`
 *     - `lib/Utils/FileHandler.js`   → read/write/remove relative to cwd
 *
 *   To keep the repository clean and to keep FileHandler tests hermetic, we
 *   chdir into a git-ignored scratch directory (`gipsy.test-artifacts/`) BEFORE
 *   any Orion module is evaluated. Node's test runner executes each test file in
 *   its own child process, so this chdir is isolated per test file.
 *
 * Because ES modules evaluate imports depth-first in source order, importing
 * this module *first* guarantees the chdir below runs before any subsequently
 * imported Orion module touches the filesystem.
 */

import fs from 'node:fs';
import path from 'node:path';

// r-sync (imported by the Orion-Orchestrator modules) boots a LokiJS store at
// import time; in test mode it stays in-memory with no autosave timers, which
// keeps `node --test` child processes from hanging on open handles.
process.env.R_SYNC_TEST_MODE = '1';

const ARTIFACTS_DIR = path.resolve(import.meta.dirname, '..', 'gipsy.test-artifacts');

// Each child process gets its own sub-directory so parallel test files never
// stomp on each other's logs / errors.json.
const perProcessDir = path.join(ARTIFACTS_DIR, `pid-${process.pid}`);

fs.mkdirSync(perProcessDir, { recursive: true });
process.chdir(perProcessDir);

export const TEST_ARTIFACTS_DIR = perProcessDir;