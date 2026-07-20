import express from 'express';
import { getEtsStatus, getEtsReport, getAnalytics, getErrorById, triggerLockdown, liftLockdown } from '../controllers/etsController.js';
import { restrictToLocalhost } from '../middleware/securityMiddleware.js';

const router = express.Router();

// All ETS admin endpoints are restricted to localhost.
// These routes intentionally bypass the ETS lockdown enforcement middleware
// so that an admin can always reach them to diagnose and lift a lockdown.
router.use(restrictToLocalhost);

/**
 * GET /r_sync/api/v1/ets/status
 *
 * Overall ETS health snapshot:
 *   - locked_down        : whether the system is currently in lockdown
 *   - total_errors       : total number of errors tracked since boot
 *   - active_violations  : number of threshold violations currently active
 *   - violations         : full list of active threshold violation objects
 *   - summary            : insight summary (top messages, functions, sources, bursts)
 *   - timestamp          : current unix time
 */
router.get('/status', getEtsStatus);

/**
 * GET /r_sync/api/v1/ets/report
 *
 * Full mass export of every error tracked by the ETS.
 * All internal Maps are serialised to plain objects.
 * Intended for offline analysis or piping to an external monitoring system.
 */
router.get('/report', getEtsReport);

/**
 * GET /r_sync/api/v1/ets/analytics
 *
 * Ranked analytics data:
 *   - topErrorMessages         : most frequent error messages
 *   - mostErrorProneFunctions  : functions that generated the most errors
 *   - mostErrorProneSources    : source files that generated the most errors
 *   - recentBursts             : errors within the last 2-second burst window
 *
 * Optional query param:
 *   - limit (number, default 5) — controls how many entries per category
 */
router.get('/analytics', getAnalytics);

/**
 * GET /r_sync/api/v1/ets/errors/:errorId
 *
 * Full stored detail for a single tracked error:
 *   - functionName, functionSource, errorMessage, errStack
 *   - relations : causal links to other error IDs
 *
 * Returns 404 if the error ID is unknown to the tracker.
 */
router.get('/errors/:errorId', getErrorById);

/**
 * POST /r_sync/api/v1/ets/lockdown
 *
 * Manually places the system into ETS lockdown.
 * Blocks all incoming M2M traffic (discover-me, worker-event, heartbeat).
 *
 * Body (optional):
 *   - reason (string) — recorded in the audit log
 *
 * Idempotent: safe to call even if already in lockdown.
 */
router.post('/lockdown', triggerLockdown);

/**
 * DELETE /r_sync/api/v1/ets/lockdown
 *
 * Lifts an active ETS lockdown, resuming normal M2M traffic.
 * Error history is preserved — the tracked data remains queryable
 * after the lockdown is lifted so root-cause analysis can continue.
 *
 * Returns 400 if the system is not currently in lockdown.
 */
router.delete('/lockdown', liftLockdown);

export { router as etsRoutes };
