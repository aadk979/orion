/**
 * The batch mailing plane, node side.
 *
 * Import from here rather than from the individual files — this is the surface
 * the rest of Orion-core and the test suite are written against, and the split
 * inside the directory is free to move behind it.
 *
 * See BatchMailerSystem.js for what each file in here is responsible for.
 */

export { BatchMailerSystem } from './BatchMailerSystem.js';
export { SlidingRateLimiter } from './SlidingRateLimiter.js';
export { LeaseLostError } from './errors.js';
export { isPermanentRejection, isTransportFailure, isRateLimited, backoffFor } from './failures.js';
export { BUILTIN_TOKENS, tokensFor, substitute } from './tokens.js';
export { defaultConfig as batchMailerDefaultConfig } from './config.js';
