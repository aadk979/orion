import { globalAccessPoint } from "../GlobalAccessPoint.js";
import { logger } from "../logger.js";
import { generateId } from "../valueGenerator.js";

const THRESHOLDS = {
    TOTAL_ERRORS: 1000,
    ERROR_BURST: 50,
    SAME_ERROR_REPEATED: 100,
    SAME_FUNCTION_ERRORS: 200,
    RECENT_ERRORS_WARNING: 20,
    ERROR_CHAIN_LENGTH: 5,
}

class ErrorTrackerSystem {
    constructor () {
        this._errorsTracked_errors = [];
        this._errorsTracked_functionName = new Map();
        this._errorsTracked_functionSource = new Map();
        this._errorsTracked_errorMessage = new Map();
        this._errorsTracked_errStack = new Map();

        // Analytics & Pattern Tracking
        this._errorCountByMessage = new Map();
        this._errorCountByFunction = new Map();
        this._errorCountBySource = new Map();
        this._errorRelations = new Map();
        this._recentErrors = [];
    }

    checkThresholds() {
        const violations = [];
        
        if (this._errorsTracked_errors.length >= THRESHOLDS.TOTAL_ERRORS) {
            violations.push({
                level: 'CRITICAL',
                type: 'TOTAL_ERRORS',
                message: `Total errors (${this._errorsTracked_errors.length}) exceeded threshold`
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
        
        for (const [msg, count] of this._errorCountByMessage.entries()) {
            if (count >= THRESHOLDS.SAME_ERROR_REPEATED) {
                violations.push({
                    level: 'CRITICAL',
                    type: 'REPEATED_ERROR',
                    message: `Error "${msg}" occurred ${count} times`
                });
            }
        }
        
        for (const [func, count] of this._errorCountByFunction.entries()) {
            if (count >= THRESHOLDS.SAME_FUNCTION_ERRORS) {
                violations.push({
                    level: 'CRITICAL',
                    type: 'FUNCTION_ERRORS',
                    message: `Function "${func}" generated ${count} errors`
                });
            }
        }
        
        return violations;
    }

    reportError(errorPackage) {
        const { functionName, functionSource, errorMessage, errStack, timestamp = Date.now() } = errorPackage;

        const errorId = generateId("ETS_ERROR", 36);

        this._errorsTracked_functionName.set(errorId, functionName);
        this._errorsTracked_functionSource.set(errorId, functionSource);
        this._errorsTracked_errorMessage.set(errorId, errorMessage);
        this._errorsTracked_errStack.set(errorId, errStack);

        this._errorsTracked_errors.push({ errorId, timestamp, status: 0 });

        this._trackFrequency(errorMessage, functionName, functionSource);
        this._trackRecent(errorId, timestamp);
        this._trackRelation(errorId);

        const violations = this.checkThresholds();
        const critical = violations.filter(v => v.level === 'CRITICAL');
        
        if (critical.length > 0) {

            logger.error("ETS: System error threshholds have been reached, entering unhealthy server mode");

            globalAccessPoint.setValue("ETS_LOCKDOWN", true);
        }
        
        return { errorId, violations };
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
            this._recentErrors.shift(); // keep recent error window small
        }
    }

    _trackRelation(currentErrorId) {
        const lastError = this._errorsTracked_errors.at(-2); // previous error
        if (!lastError) return;

        const prevId = lastError.errorId;
        if (!this._errorRelations.has(prevId)) {
            this._errorRelations.set(prevId, new Map());
        }

        const relationMap = this._errorRelations.get(prevId);
        relationMap.set(currentErrorId, (relationMap.get(currentErrorId) || 0) + 1);
    }

    // 🔍 Analytics Methods

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
            errStack: this._errorsTracked_errStack.get(errorId),
        };
    }

    // 📊 Insight Summary — useful for dashboards or auto alerts
    getInsightSummary() {
        return {
            topErrorMessages: this.getTopErrorMessages(),
            mostErrorProneFunctions: this.getMostErrorProneFunctions(),
            mostErrorProneSources: this.getMostErrorProneSources(),
            recentBursts: this.getRecentErrorBursts(),
        };
    }

    massExport() {
        const convertMap = (map) => Object.fromEntries(map);
    
        return {
            errors: this._errorsTracked_errors,
    
            functionName: convertMap(this._errorsTracked_functionName),
            functionSource: convertMap(this._errorsTracked_functionSource),
            errorMessage: convertMap(this._errorsTracked_errorMessage),
            errStack: convertMap(this._errorsTracked_errStack),
    
            errorCountByMessage: convertMap(this._errorCountByMessage),
            errorCountByFunction: convertMap(this._errorCountByFunction),
            errorCountBySource: convertMap(this._errorCountBySource),
    
            errorRelations: Object.fromEntries(
                [...this._errorRelations.entries()].map(([key, innerMap]) => [
                    key,
                    convertMap(innerMap)
                ])
            ),
    
            recentErrors: this._recentErrors,
            exportedAt: new Date().toISOString()
        };
    }
    
}

const errorTrackerSystem = new ErrorTrackerSystem()

export { errorTrackerSystem };