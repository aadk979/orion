import { globalAccessPoint } from './GlobalAccessPoint.js';
import { logger } from './logger.js';
import { errorTrackerSystem } from './Systems/ErrorTrackerSystem.js';

const SAFE_MODE_OVERRIDE_INFO = '(Only system config can perform this change and requires a restart of the application)';

const SECURITY_SYSTEMS = new Set(['captcha', 'deviceAuthorization', 'dip']);

class OrionSystemsControl {
    constructor(safeMode) {
        if (OrionSystemsControl.instance) {
            throw new Error('Only one instance of orion systems control is allowed');
        }

        this.safeMode = safeMode !== undefined ? safeMode : true;
        OrionSystemsControl.instance = this;

        globalAccessPoint.getValue('OrionSystemsControlServerLock');
    }

    // ── Server lock ───────────────────────────────────────────────────────────────

    lockServer() {
        globalAccessPoint.setValue('OrionSystemsControlServerLock', true);
        logger.warn('SystemsControl: Server locked');
        return true;
    }

    unlockServer() {
        globalAccessPoint.setValue('OrionSystemsControlServerLock', false);
        logger.info('SystemsControl: Server unlocked');
        return true;
    }

    // ── ETS access + lockdown management ─────────────────────────────────────────

    errorTrackerSystem() {
        return errorTrackerSystem;
    }

    clearEtsLockdown() {
        if (this.safeMode) {
            logger.warn(`SystemsControl: Cannot clear ETS lockdown — safe mode enabled. ${SAFE_MODE_OVERRIDE_INFO}`);
            return false;
        }
        errorTrackerSystem.clearLockdown();
        return true;
    }

    // ── Security system toggles ────────────────────────────────────────────────

    deactivateSystemSecurity(system) {
        if (this.safeMode) {
            logger.warn(`SystemsControl: Cannot deactivate "${system}" — safe mode enabled. ${SAFE_MODE_OVERRIDE_INFO}`);
            return false;
        }
        if (!SECURITY_SYSTEMS.has(system)) {
            throw new Error(`SystemsControl: Unknown security system "${system}"`);
        }
        globalAccessPoint.setValue(system, false);
        return true;
    }

    reactivateSystemSecurity(system) {
        if (this.safeMode) {
            logger.warn(`SystemsControl: Cannot reactivate "${system}" — safe mode enabled. ${SAFE_MODE_OVERRIDE_INFO}`);
            return false;
        }
        if (!SECURITY_SYSTEMS.has(system)) {
            throw new Error(`SystemsControl: Unknown security system "${system}"`);
        }
        globalAccessPoint.setValue(system, true);
        return true;
    }

    // ── Memory monitor ────────────────────────────────────────────────────────────

    deactivateMemoryMonitoring() {
        const mm = globalAccessPoint.memoryMonitioringSystem();
        if (!mm?.active) return;
        mm.stop();
    }

    reactivateMemoryMonitoring() {
        const mm = globalAccessPoint.memoryMonitioringSystem();
        if (mm?.active) return;
        mm.start();
    }

    // ── Audit trail ───────────────────────────────────────────────────────────────

    pauseAuditTrail() {
        if (this.safeMode) {
            logger.warn(`SystemsControl: Cannot pause audit trail — safe mode enabled. ${SAFE_MODE_OVERRIDE_INFO}`);
            return false;
        }
        const at = globalAccessPoint.auditTrailSystem();
        if (at) at.enabled = false;
        return true;
    }

    resumeAuditTrail() {
        if (this.safeMode) {
            logger.warn(`SystemsControl: Cannot resume audit trail — safe mode enabled. ${SAFE_MODE_OVERRIDE_INFO}`);
            return false;
        }
        const at = globalAccessPoint.auditTrailSystem();
        if (at) at.enabled = true;
        return true;
    }

    // ── Circuit breaker ────────────────────────────────────────────────────────────

    resetCircuitBreaker(dependency) {
        if (this.safeMode) {
            logger.warn(`SystemsControl: Cannot reset circuit breaker — safe mode enabled. ${SAFE_MODE_OVERRIDE_INFO}`);
            return false;
        }
        globalAccessPoint.circuitBreakerSystem()?.forceClose(dependency);
        return true;
    }

    openCircuitBreaker(dependency) {
        globalAccessPoint.circuitBreakerSystem()?.forceOpen(dependency);
        return true;
    }

    // ── Load shedding ──────────────────────────────────────────────────────────────

    setMaxInFlight(limit) {
        if (this.safeMode) {
            logger.warn(`SystemsControl: Cannot change in-flight limit — safe mode enabled. ${SAFE_MODE_OVERRIDE_INFO}`);
            return false;
        }
        globalAccessPoint.loadSheddingSystem()?.setMaxInFlight(limit);
        return true;
    }

    // ── Abuse detection ────────────────────────────────────────────────────────────

    unblockActor(actorId) {
        if (this.safeMode) {
            logger.warn(`SystemsControl: Cannot unblock actor — safe mode enabled. ${SAFE_MODE_OVERRIDE_INFO}`);
            return false;
        }
        globalAccessPoint.abuseDetectionSystem()?.unblock(actorId);
        return true;
    }

    // ── Event loop monitor ─────────────────────────────────────────────────────────

    deactivateEventLoopMonitor() {
        globalAccessPoint.eventLoopMonitor()?.stop();
    }

    reactivateEventLoopMonitor() {
        globalAccessPoint.eventLoopMonitor()?.start();
    }

    // ── Unified status snapshot ────────────────────────────────────────────────────

    getSystemStatus() {
        return {
            safeMode: this.safeMode,
            serverLocked: !!globalAccessPoint.getValue('OrionSystemsControlServerLock'),
            etsLockdown: !!globalAccessPoint.ETS_LOCKDOWN(),
            elmDegraded: !!globalAccessPoint.getValue('ELM_DEGRADED'),
            security: Object.fromEntries([...SECURITY_SYSTEMS].map(s => [s, !!globalAccessPoint.getValue(s)])),
            circuitBreakers: globalAccessPoint.circuitBreakerSystem()?.getAllStates() || {},
            loadShedder: globalAccessPoint.loadSheddingSystem()?.getStats() || null,
            abuseDetection: globalAccessPoint.abuseDetectionSystem()?.getStats() || null,
            errorTracker: errorTrackerSystem.getInsightSummary(),
            memoryMonitor: globalAccessPoint.memoryMonitioringSystem()?.getMemoryStats() || null,
            eventLoop: globalAccessPoint.eventLoopMonitor()?.getStats() || null
        };
    }
}

export { OrionSystemsControl };