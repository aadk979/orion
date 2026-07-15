// R_Sync - M2M Communication Library
// Main entry point

import { R_Sync } from './lib/interface.js';

// Export crypto utilities for advanced usage
import { packageExports as cryptoExports } from './lib/utils/crypto.js';
import { packageExports as dateTimeExports } from './lib/utils/Date&Time.js';
import { packageExports as valueGeneratorExports } from './lib/utils/valueGenerators.js';

// Export database utilities
import {
    waitForDb,
    getAllWorkers,
    getWorkerById
} from './lib/utils/lokidb.js';

// Export logger
import { logger } from './lib/utils/logger.js';

// Export metadata
import {
    __Version__,
    __Status__,
    __PackageType__
} from './lib/r_sync.meta.js';

export {
    R_Sync,
    cryptoExports,
    dateTimeExports,
    valueGeneratorExports,
    waitForDb,
    getAllWorkers,
    getWorkerById,
    logger,
    __Version__,
    __Status__,
    __PackageType__
};

export default R_Sync;