import { logger } from '../logger.js';
import { globalAccessPoint } from '../GlobalAccessPoint.js';

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
            const ls = globalAccessPoint.loadSheddingSystem();
            if (ls) await this._waitForDrain(ls);
        } catch (err) {
            logger.warn(`GracefulShutdown: Drain wait failed — ${err.message}`);
        }

        // 3. Flush audit trail buffer
        try {
            const at = globalAccessPoint.auditTrailSystem();
            if (at?.enabled && typeof at.flush === 'function') {
                await at.flush();
                logger.info('GracefulShutdown: Audit trail flushed');
            }
        } catch (err) {
            logger.warn(`GracefulShutdown: Audit flush failed — ${err.message}`);
        }

        // 4. Stop monitors
        try { globalAccessPoint.memoryMonitioringSystem()?.stop(); } catch (_) {}
        try { globalAccessPoint.eventLoopMonitor()?.stop(); } catch (_) {}

        // 5. Close DB
        try {
            const db = globalAccessPoint.db();
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
