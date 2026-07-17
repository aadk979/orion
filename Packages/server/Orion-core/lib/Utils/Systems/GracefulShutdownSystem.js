import { logger } from '../logger.js';
import { globalAccessPoint } from '../GlobalAccessPoint.js';
import { SafeModuleHandler } from '../UnavailableModuleWrapper.js';

const dbModule = new SafeModuleHandler('Database', 'db', 'GracefulShutdownSystem.js');
const auditTrailSystemModule = new SafeModuleHandler('AuditTrailSystem', 'auditTrailSystem', 'GracefulShutdownSystem.js');
const memoryMonitoringSystemModule = new SafeModuleHandler('MemoryMonitoringSystem', 'memoryMonitioringSystem', 'GracefulShutdownSystem.js');
const eventLoopMonitorModule = new SafeModuleHandler('EventLoopMonitor', 'eventLoopMonitor', 'GracefulShutdownSystem.js');
const loadSheddingSystemModule = new SafeModuleHandler('LoadSheddingSystem', 'loadSheddingSystem', 'GracefulShutdownSystem.js');
const clusterLinkSystemModule = new SafeModuleHandler('ClusterLinkSystem', 'clusterLinkSystem', 'GracefulShutdownSystem.js');
const databaseJanitorModule = new SafeModuleHandler('DatabaseJanitor', 'databaseJanitor', 'GracefulShutdownSystem.js');


const DRAIN_TIMEOUT_MS = 30_000;
const DRAIN_POLL_MS = 500;

class GracefulShutdownSystem {
    constructor() {
        this._registered = false;
        this._shuttingDown = false;
    }

    register() {
        if (this._registered) return;
        this._registered = true;

        process.on('SIGTERM', () => this._shutdown('SIGTERM', 0));
        process.on('SIGINT', () => this._shutdown('SIGINT', 0));

        process.on('uncaughtException', (err) => {
            logger.error('GracefulShutdown: uncaughtException —', err?.message || err);
            this._shutdown('uncaughtException', 1);
        });

        process.on('unhandledRejection', (reason) => {
            logger.error('GracefulShutdown: unhandledRejection —', reason?.message || reason);
            // Non-fatal: record in ETS if available, don't force shutdown
        });

        logger.info('GracefulShutdown: Signal handlers registered');
    }

    async _shutdown(signal, exitCode) {
        if (this._shuttingDown) return;
        this._shuttingDown = true;

        logger.info(`GracefulShutdown: Received ${signal} — beginning graceful shutdown`);

        // 1. Stop accepting new requests
        try {
            const sc = globalAccessPoint.getValue('orionSystemsControl');
            if (sc) sc.lockServer();
        } catch (_) {}

        // 2. Drain in-flight requests
        try {
            const ls = loadSheddingSystemModule.probeModule();
            if (ls) await this._waitForDrain(ls);
        } catch (err) {
            logger.warn(`GracefulShutdown: Drain wait failed — ${err.message}`);
        }

        // 3. Detach from the cluster — sends a best-effort goodbye so the
        //    orchestrator marks this node offline immediately
        try {
            const cl = clusterLinkSystemModule.probeModule();
            if (cl?.enabled) {
                await cl.stop(`graceful-shutdown:${signal}`);
                logger.info('GracefulShutdown: Cluster link detached');
            }
        } catch (err) {
            logger.warn(`GracefulShutdown: Cluster link stop failed — ${err.message}`);
        }

        // 4. Flush audit trail buffer (shutdown = stop flush timer + forceFlush)
        try {
            const at = auditTrailSystemModule.probeModule();
            if (at?.enabled && typeof at.shutdown === 'function') {
                await at.shutdown();
                logger.info('GracefulShutdown: Audit trail flushed');
            }
        } catch (err) {
            logger.warn(`GracefulShutdown: Audit flush failed — ${err.message}`);
        }

        // 5. Stop monitors and background sweepers
        try { memoryMonitoringSystemModule.probeModule()?.stop(); } catch (_) {}
        try { eventLoopMonitorModule.probeModule()?.stop(); } catch (_) {}
        try { databaseJanitorModule.probeModule()?.stop(); } catch (_) {}

        // 6. Close DB
        try {
            const db = dbModule.probeModule();
            if (db && typeof db.close === 'function') {
                await db.close();
                logger.info('GracefulShutdown: DB connections closed');
            }
        } catch (err) {
            logger.warn(`GracefulShutdown: DB close failed — ${err.message}`);
        }

        logger.info(`GracefulShutdown: Complete — exit ${exitCode}`);
        process.exit(exitCode);
    }

    async _waitForDrain(loadShedder) {
        if (loadShedder.inFlight === 0) return;

        logger.info(`GracefulShutdown: Draining ${loadShedder.inFlight} in-flight requests (timeout ${DRAIN_TIMEOUT_MS / 1000}s)`);

        const start = Date.now();
        await new Promise(resolve => {
            const poll = setInterval(() => {
                if (loadShedder.inFlight === 0 || Date.now() - start >= DRAIN_TIMEOUT_MS) {
                    clearInterval(poll);
                    resolve();
                }
            }, DRAIN_POLL_MS);
        });

        if (loadShedder.inFlight > 0) {
            logger.warn(`GracefulShutdown: Drain timeout — ${loadShedder.inFlight} requests still in flight`);
        }
    }
}

export { GracefulShutdownSystem };
