import { globalAccessPoint } from '../GlobalAccessPoint.js';
import { logger } from '../logger.js';
import { generateId } from '../valueGenerator.js';

// Rate-based thresholds — all checked against a rolling 1-minute window
const WINDOW_MS = 60_000;

const THRESHOLDS = {
    ERRORS_PER_MINUTE: 200,
    ERROR_BURST: 50,
    SAME_ERROR_REPEATED: 20,
    SAME_FUNCTION_ERRORS: 40,
    RECENT_ERRORS_WARNING: 20,
    ERROR_CHAIN_LENGTH: 5
};

const RECOVERY_CHECKS_NEEDED = 2;
const RECOVERY_INTERVAL_MS = 30_000;

class ErrorTrackerSystem {
    constructor() {
        this._errorsTracked_errors = [];
        this._errorsTracked_functionName = new Map();
        this._errorsTracked_functionSource = new Map();
        this._errorsTracked_errorMessage = new Map();
        this._errorsTracked_errStack = new Map();

        // Lifetime frequency counters — for reporting/export only, not threshold checks
        this._errorCountByMessage = new Map();
        this._errorCountByFunction = new Map();
        this._errorCountBySource = new Map();
        this._errorRelations = new Map();
        this._recentErrors = [];

        // Rolling window for rate-based threshold evaluation
        this._windowedErrors = [];

        // Auto-recovery state
        this._recoveryInterval = null;
        this._recoveryStableCount = 0;
    }

    // ── Threshold evaluation ────────────────────────────────────────────────────

    checkThresholds() {
        const cutoff = Date.now() - WINDOW_MS;
        const violations = [];

        this._pruneWindow(cutoff);

        if (this._windowedErrors.length >= THRESHOLDS.ERRORS_PER_MINUTE) {
            violations.push({
                level: 'CRITICAL',
                type: 'ERROR_RATE',
                message: `${this._windowedErrors.length} errors in the last minute`
            });
        }

        const burst = this.getRecentErrorBursts();
        if (burst.length >= THRESHOLDS.ERROR_BURST) {
            violations.push({
                level: 'CRITICAL',
                type: 'ERROR_BURST',
                message: `${burst.length} errors in last 2 seconds`
            });
        }

        const msgCounts = new Map();
        const funcCounts = new Map();
        for (const e of this._windowedErrors) {
            if (e.errorMessage) msgCounts.set(e.errorMessage, (msgCounts.get(e.errorMessage) || 0) + 1);
            if (e.functionName) funcCounts.set(e.functionName, (funcCounts.get(e.functionName) || 0) + 1);
        }

        for (const [msg, count] of msgCounts) {
            if (count >= THRESHOLDS.SAME_ERROR_REPEATED) {
                violations.push({
                    level: 'CRITICAL',
                    type: 'REPEATED_ERROR',
                    message: `Error "${msg}" occurred ${count} times in the last minute`
                });
            }
        }

        for (const [func, count] of funcCounts) {
            if (count >= THRESHOLDS.SAME_FUNCTION_ERRORS) {
                violations.push({
                    level: 'CRITICAL',
                    type: 'FUNCTION_ERRORS',
                    message: `Function "${func}" generated ${count} errors in the last minute`
                });
            }
        }

        return violations;
    }

    // ── Core reporting ───────────────────────────────────────────────────────────

    reportError(errorPackage) {
        const { functionName, functionSource, errorMessage, errStack, timestamp = Date.now() } = errorPackage;

        const errorId = generateId('ETS_ERROR', 36);

        this._errorsTracked_functionName.set(errorId, functionName);
        this._errorsTracked_functionSource.set(errorId, functionSource);
        this._errorsTracked_errorMessage.set(errorId, errorMessage);
        this._errorsTracked_errStack.set(errorId, errStack);

        this._errorsTracked_errors.push({ errorId, timestamp, status: 0 });

        this._trackFrequency(errorMessage, functionName, functionSource);
        this._trackRecent(errorId, timestamp);
        this._trackRelation(errorId);

        this._windowedErrors.push({ timestamp, errorMessage, functionName, functionSource });
        if (this._windowedErrors.length > 2000) {
            this._pruneWindow(Date.now() - WINDOW_MS);
        }

        const violations = this.checkThresholds();
        const critical = violations.filter(v => v.level === 'CRITICAL');

        if (critical.length > 0) {
            logger.error('ETS: System error thresholds reached — entering unhealthy server mode');
            globalAccessPoint.setValue('ETS_LOCKDOWN', true);
            this._startAutoRecovery();
        }

        return { errorId, violations };
    }

    // ── Lockdown management ──────────────────────────────────────────────────────

    clearLockdown() {
        if (this._recoveryInterval) {
            clearInterval(this._recoveryInterval);
            this._recoveryInterval = null;
        }
        this._recoveryStableCount = 0;
        globalAccessPoint.setValue('ETS_LOCKDOWN', false);
        logger.info('ETS: Lockdown cleared — server returning to healthy mode');
    }

    _startAutoRecovery() {
        if (this._recoveryInterval) return;
        this._recoveryStableCount = 0;

        this._recoveryInterval = setInterval(() => {
            this._pruneWindow(Date.now() - WINDOW_MS);
            const burst = this.getRecentErrorBursts();

            const stable = burst.length < THRESHOLDS.ERROR_BURST / 2 && this._windowedErrors.length < THRESHOLDS.ERRORS_PER_MINUTE / 2;

            if (stable) {
                this._recoveryStableCount++;
                logger.info(`ETS: Recovery check ${this._recoveryStableCount}/${RECOVERY_CHECKS_NEEDED} stable`);
            } else {
                this._recoveryStableCount = 0;
            }

            if (this._recoveryStableCount >= RECOVERY_CHECKS_NEEDED) {
                this.clearLockdown();
            }
        }, RECOVERY_INTERVAL_MS);
    }

    // ── Internal helpers ─────────────────────────────────────────────────────────

    _pruneWindow(cutoff) {
        let i = 0;
        while (i < this._windowedErrors.length && this._windowedErrors[i].timestamp < cutoff) i++;
        if (i > 0) this._windowedErrors.splice(0, i);
    }

    _trackFrequency(errorMessage, functionName, functionSource) {
        this._incrementMapCount(this._errorCountByMessage, errorMessage);
        this._incrementMapCount(this._errorCountByFunction, functionName);
        this._incrementMapCount(this._errorCountBySource, functionSource);
    }

    _incrementMapCount(map, key) {
        map.set(key, (map.get(key) || 0) + 1);
    }

    _trackRecent(errorId, timestamp) {
        this._recentErrors.push({ errorId, timestamp });
        if (this._recentErrors.length > 100) {
            this._recentErrors.shift();
        }
    }

    _trackRelation(currentErrorId) {
        const lastError = this._errorsTracked_errors.at(-2);
        if (!lastError) return;

        const prevId = lastError.errorId;
        if (!this._errorRelations.has(prevId)) {
            this._errorRelations.set(prevId, new Map());
        }

        const relationMap = this._errorRelations.get(prevId);
        relationMap.set(currentErrorId, (relationMap.get(currentErrorId) || 0) + 1);
    }

    // ── Analytics ────────────────────────────────────────────────────────────────

    getTopErrorMessages(limit = 5) {
        return this._getTopEntries(this._errorCountByMessage, limit);
    }

    getMostErrorProneFunctions(limit = 5) {
        return this._getTopEntries(this._errorCountByFunction, limit);
    }

    getMostErrorProneSources(limit = 5) {
        return this._getTopEntries(this._errorCountBySource, limit);
    }

    _getTopEntries(map, limit) {
        return [...map.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit)
            .map(([key, count]) => ({ key, count }));
    }

    getRecentErrorBursts(timeWindowMs = 2000) {
        const now = Date.now();
        return this._recentErrors.filter(err => now - err.timestamp <= timeWindowMs);
    }

    getErrorRelations(errorId) {
        return this._errorRelations.get(errorId) || new Map();
    }

    getFullErrorReport(errorId) {
        return {
            errorId,
            functionName: this._errorsTracked_functionName.get(errorId),
            functionSource: this._errorsTracked_functionSource.get(errorId),
            errorMessage: this._errorsTracked_errorMessage.get(errorId),
            errStack: this._errorsTracked_errStack.get(errorId)
        };
    }

    getInsightSummary() {
        return {
            topErrorMessages: this.getTopErrorMessages(),
            mostErrorProneFunctions: this.getMostErrorProneFunctions(),
            mostErrorProneSources: this.getMostErrorProneSources(),
            recentBursts: this.getRecentErrorBursts(),
            errorsInLastMinute: this._windowedErrors.length,
            lockdown: !!globalAccessPoint.getValue('ETS_LOCKDOWN')
        };
    }

    massExport() {
        const convertMap = map => Object.fromEntries(map);

        return {
            errors: this._errorsTracked_errors,

            functionName: convertMap(this._errorsTracked_functionName),
            functionSource: convertMap(this._errorsTracked_functionSource),
            errorMessage: convertMap(this._errorsTracked_errorMessage),
            errStack: convertMap(this._errorsTracked_errStack),

            errorCountByMessage: convertMap(this._errorCountByMessage),
            errorCountByFunction: convertMap(this._errorCountByFunction),
            errorCountBySource: convertMap(this._errorCountBySource),

            errorRelations: Object.fromEntries([...this._errorRelations.entries()].map(([key, innerMap]) => [key, convertMap(innerMap)])),

            recentErrors: this._recentErrors,
            exportedAt: new Date().toISOString()
        };
    }
}

const errorTrackerSystem = new ErrorTrackerSystem();

export { errorTrackerSystem };
