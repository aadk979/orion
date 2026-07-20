import { globalAccessPoint } from './GlobalAccessPoint.js';
import { logger } from './logger.js';
import { errorTrackerSystem } from './Systems/ErrorTrackerSystem.js';
import { SafeModuleHandler } from './UnavailableModuleWrapper.js';

const auditTrailSystemModule = new SafeModuleHandler('AuditTrailSystem', 'auditTrailSystem', 'SystemsControl.js');
const memoryMonitoringSystemModule = new SafeModuleHandler('MemoryMonitoringSystem', 'memoryMonitioringSystem', 'SystemsControl.js');
const eventLoopMonitorModule = new SafeModuleHandler('EventLoopMonitor', 'eventLoopMonitor', 'SystemsControl.js');
const loadSheddingSystemModule = new SafeModuleHandler('LoadSheddingSystem', 'loadSheddingSystem', 'SystemsControl.js');
const circuitBreakerSystemModule = new SafeModuleHandler('CircuitBreakerSystem', 'circuitBreakerSystem', 'SystemsControl.js');
const abuseDetectionSystemModule = new SafeModuleHandler('AbuseDetectionSystem', 'abuseDetectionSystem', 'SystemsControl.js');

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
        const mm = memoryMonitoringSystemModule.probeModule();
        if (!mm?.active) return;
        mm.stop();
    }

    reactivateMemoryMonitoring() {
        const mm = memoryMonitoringSystemModule.probeModule();
        if (mm?.active) return;
        mm.start();
    }

    // ── Audit trail ───────────────────────────────────────────────────────────────

    pauseAuditTrail() {
        if (this.safeMode) {
            logger.warn(`SystemsControl: Cannot pause audit trail — safe mode enabled. ${SAFE_MODE_OVERRIDE_INFO}`);
            return false;
        }
        const at = auditTrailSystemModule.probeModule();
        if (at) at.enabled = false;
        return true;
    }

    resumeAuditTrail() {
        if (this.safeMode) {
            logger.warn(`SystemsControl: Cannot resume audit trail — safe mode enabled. ${SAFE_MODE_OVERRIDE_INFO}`);
            return false;
        }
        const at = auditTrailSystemModule.probeModule();
        if (at) at.enabled = true;
        return true;
    }

    // ── Circuit breaker ────────────────────────────────────────────────────────────

    resetCircuitBreaker(dependency) {
        if (this.safeMode) {
            logger.warn(`SystemsControl: Cannot reset circuit breaker — safe mode enabled. ${SAFE_MODE_OVERRIDE_INFO}`);
            return false;
        }
        circuitBreakerSystemModule.probeModule()?.forceClose(dependency);
        return true;
    }

    openCircuitBreaker(dependency) {
        circuitBreakerSystemModule.probeModule()?.forceOpen(dependency);
        return true;
    }

    // ── Load shedding ──────────────────────────────────────────────────────────────

    setMaxInFlight(limit) {
        if (this.safeMode) {
            logger.warn(`SystemsControl: Cannot change in-flight limit — safe mode enabled. ${SAFE_MODE_OVERRIDE_INFO}`);
            return false;
        }
        loadSheddingSystemModule.probeModule()?.setMaxInFlight(limit);
        return true;
    }

    // ── Abuse detection ────────────────────────────────────────────────────────────

    unblockActor(actorId) {
        if (this.safeMode) {
            logger.warn(`SystemsControl: Cannot unblock actor — safe mode enabled. ${SAFE_MODE_OVERRIDE_INFO}`);
            return false;
        }
        abuseDetectionSystemModule.probeModule()?.unblock(actorId);
        return true;
    }

    // ── Event loop monitor ─────────────────────────────────────────────────────────

    deactivateEventLoopMonitor() {
        eventLoopMonitorModule.probeModule()?.stop();
    }

    reactivateEventLoopMonitor() {
        eventLoopMonitorModule.probeModule()?.start();
    }

    // ── Unified status snapshot ────────────────────────────────────────────────────

    getSystemStatus() {
        return {
            safeMode: this.safeMode,
            serverLocked: !!globalAccessPoint.getValue('OrionSystemsControlServerLock'),
            etsLockdown: !!globalAccessPoint.ETS_LOCKDOWN(),
            elmDegraded: !!globalAccessPoint.getValue('ELM_DEGRADED'),
            security: Object.fromEntries([...SECURITY_SYSTEMS].map(s => [s, !!globalAccessPoint.getValue(s)])),
            circuitBreakers: circuitBreakerSystemModule.probeModule()?.getAllStates() || {},
            loadShedder: loadSheddingSystemModule.probeModule()?.getStats() || null,
            abuseDetection: abuseDetectionSystemModule.probeModule()?.getStats() || null,
            errorTracker: errorTrackerSystem.getInsightSummary(),
            memoryMonitor: memoryMonitoringSystemModule.probeModule()?.getMemoryStats() || null,
            eventLoop: eventLoopMonitorModule.probeModule()?.getStats() || null
        };
    }
}

export { OrionSystemsControl };
