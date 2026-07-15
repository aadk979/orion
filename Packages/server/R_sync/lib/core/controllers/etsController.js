import { errorTrackerSystem } from "../../utils/Systems/ErrorTrackerSystem.js";
import { globalAccessPoint } from "../../utils/globalAccessPoint.js";
import { logger } from "../../utils/logger.js";
import { auditLogger } from "../../utils/AuditLogSystem.js";
import { getCurrentUnixTime } from "../../utils/Date&Time.js";

/**
 * GET /r_sync/api/v1/ets/status
 *
 * Returns the overall ETS health snapshot:
 *  - Whether the system is currently in lockdown
 *  - Active threshold violations
 *  - High-level insight summary (top errors, functions, sources, burst window)
 *  - Total errors tracked so far
 */
const getEtsStatus = async (req, res) => {
  try {
    const isLockedDown = globalAccessPoint.getValue("ETS_LOCKDOWN") === true;
    const violations = errorTrackerSystem.checkThresholds();
    const summary = errorTrackerSystem.getInsightSummary();
    const totalErrors = errorTrackerSystem._errorsTracked_errors.length;

    return res.status(200).json({
      locked_down: isLockedDown,
      total_errors: totalErrors,
      active_violations: violations.length,
      violations,
      summary,
      timestamp: getCurrentUnixTime(),
    });
  } catch (err) {
    logger.error(`ETS: getEtsStatus failed — ${err.message}`);
    return res.status(500).json({
      error: true,
      errorCode: "ETS_STATUS_FAILED",
      message: err.message,
    });
  }
};

/**
 * GET /r_sync/api/v1/ets/report
 *
 * Full mass export of every error tracked by the ETS.
 * Includes all Maps serialised to plain objects, error relations,
 * and a top-level export timestamp.
 *
 * Intended for offline analysis or export to an external monitoring system.
 */
const getEtsReport = async (req, res) => {
  try {
    const report = errorTrackerSystem.massExport();

    logger.info(`ETS: Full report exported (${report.errors.length} errors)`);

    return res.status(200).json(report);
  } catch (err) {
    logger.error(`ETS: getEtsReport failed — ${err.message}`);
    return res.status(500).json({
      error: true,
      errorCode: "ETS_REPORT_FAILED",
      message: err.message,
    });
  }
};

/**
 * GET /r_sync/api/v1/ets/analytics
 *
 * Returns ranked analytics data useful for dashboards or alerting:
 *  - Top N error messages by occurrence
 *  - Top N most error-prone functions
 *  - Top N most error-prone source files
 *  - Errors that occurred within the recent burst window (last 2 s by default)
 *
 * Optional query param:
 *  - limit (number, default 5) — controls how many top entries are returned per category
 */
const getAnalytics = async (req, res) => {
  try {
    const limit = Math.max(1, parseInt(req.query.limit, 10) || 5);

    const analytics = {
      topErrorMessages: errorTrackerSystem.getTopErrorMessages(limit),
      mostErrorProneFunctions:
        errorTrackerSystem.getMostErrorProneFunctions(limit),
      mostErrorProneSources: errorTrackerSystem.getMostErrorProneSources(limit),
      recentBursts: errorTrackerSystem.getRecentErrorBursts(),
      timestamp: getCurrentUnixTime(),
    };

    return res.status(200).json(analytics);
  } catch (err) {
    logger.error(`ETS: getAnalytics failed — ${err.message}`);
    return res.status(500).json({
      error: true,
      errorCode: "ETS_ANALYTICS_FAILED",
      message: err.message,
    });
  }
};

/**
 * GET /r_sync/api/v1/ets/errors/:errorId
 *
 * Returns the full stored detail for a single tracked error including:
 *  - functionName, functionSource, errorMessage, errStack
 *  - All known causal relations to other error IDs
 *
 * Returns 404 if the error ID is not found in the tracker.
 */
const getErrorById = async (req, res) => {
  try {
    const { errorId } = req.params;

    if (!errorId) {
      return res.status(400).json({
        error: true,
        errorCode: "MISSING_ERROR_ID",
        message: "An errorId path parameter is required",
      });
    }

    const report = errorTrackerSystem.getFullErrorReport(errorId);

    // The ETS returns an object with the id key populated but all others
    // undefined when the error does not exist — treat that as not found.
    if (!report.functionName && !report.errorMessage) {
      return res.status(404).json({
        error: true,
        errorCode: "ERROR_NOT_FOUND",
        message: `No tracked error found with ID: ${errorId}`,
      });
    }

    // Serialise the inner Map to a plain object so it is JSON-safe
    const relationsMap = errorTrackerSystem.getErrorRelations(errorId);
    const relations = Object.fromEntries(relationsMap);

    return res.status(200).json({
      ...report,
      relations,
      timestamp: getCurrentUnixTime(),
    });
  } catch (err) {
    logger.error(`ETS: getErrorById failed — ${err.message}`);
    return res.status(500).json({
      error: true,
      errorCode: "ETS_ERROR_FETCH_FAILED",
      message: err.message,
    });
  }
};

/**
 * POST /r_sync/api/v1/ets/lockdown
 *
 * Manually places the system into ETS lockdown.
 * Equivalent to the automatic lockdown triggered by threshold violations,
 * but initiated by an admin operator.
 *
 * Body (optional):
 *  - reason (string) — human-readable justification recorded in the audit log
 *
 * Idempotent: calling this while already in lockdown succeeds without error.
 */
const triggerLockdown = async (req, res) => {
  try {
    const { reason = "Manual admin lockdown" } = req.body || {};

    const alreadyLocked = globalAccessPoint.getValue("ETS_LOCKDOWN") === true;

    globalAccessPoint.setValue("ETS_LOCKDOWN", true);

    logger.error(`ETS: Lockdown triggered by admin — reason: "${reason}"`);

    auditLogger.record({
      actorId: req.socket?.remoteAddress || req.ip,
      actionType: "ETS_LOCKDOWN_TRIGGERED",
      resource: req.path,
      outcome: "SUCCESS",
      severity: "CRITICAL",
      metadata: {
        reason,
        alreadyLocked,
        method: req.method,
        userAgent: req.headers["user-agent"],
        triggeredAt: getCurrentUnixTime(),
      },
    });

    return res.status(200).json({
      locked_down: true,
      already_locked: alreadyLocked,
      reason,
      timestamp: getCurrentUnixTime(),
    });
  } catch (err) {
    logger.error(`ETS: triggerLockdown failed — ${err.message}`);
    return res.status(500).json({
      error: true,
      errorCode: "ETS_LOCKDOWN_TRIGGER_FAILED",
      message: err.message,
    });
  }
};

/**
 * DELETE /r_sync/api/v1/ets/lockdown
 *
 * Lifts an active ETS lockdown, allowing M2M traffic to resume.
 *
 * This does NOT clear the error history — all tracked errors and their
 * analytics remain intact so the root cause can still be investigated
 * after the lockdown is lifted.
 *
 * Returns 400 if the system is not currently in lockdown.
 */
const liftLockdown = async (req, res) => {
  try {
    const isLockedDown = globalAccessPoint.getValue("ETS_LOCKDOWN") === true;

    if (!isLockedDown) {
      return res.status(400).json({
        error: true,
        errorCode: "NOT_IN_LOCKDOWN",
        message: "System is not currently in lockdown — nothing to lift",
      });
    }

    // Snapshot the error state for the audit trail BEFORE clearing it, then
    // reset the tracker. Without this reset the cumulative TOTAL_ERRORS
    // threshold would immediately re-trip the lockdown on the very next error,
    // making a lifted lockdown effectively unrecoverable.
    const snapshot = errorTrackerSystem.getSummarySnapshot();
    const clearHistory = req.body?.preserveHistory !== true;

    globalAccessPoint.setValue("ETS_LOCKDOWN", false);

    if (clearHistory) {
      errorTrackerSystem.reset();
    }

    logger.info(
      `ETS: Lockdown lifted by admin (history ${clearHistory ? "cleared" : "preserved"})`,
    );

    auditLogger.record({
      actorId: req.socket?.remoteAddress || req.ip,
      actionType: "ETS_LOCKDOWN_LIFTED",
      resource: req.path,
      outcome: "SUCCESS",
      severity: "HIGH",
      metadata: {
        method: req.method,
        userAgent: req.headers["user-agent"],
        liftedAt: getCurrentUnixTime(),
        historyCleared: clearHistory,
        snapshot,
      },
    });

    return res.status(200).json({
      locked_down: false,
      message: "Lockdown successfully lifted — M2M traffic is now permitted",
      history_cleared: clearHistory,
      remaining_tracked_errors: errorTrackerSystem._errorsTracked_errors.length,
      snapshot,
      timestamp: getCurrentUnixTime(),
    });
  } catch (err) {
    logger.error(`ETS: liftLockdown failed — ${err.message}`);
    return res.status(500).json({
      error: true,
      errorCode: "ETS_LIFT_FAILED",
      message: err.message,
    });
  }
};

export {
  getEtsStatus,
  getEtsReport,
  getAnalytics,
  getErrorById,
  triggerLockdown,
  liftLockdown,
};
