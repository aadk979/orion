import { monitorEventLoopDelay } from 'perf_hooks';
import { logger } from '../logger.js';
import { globalAccessPoint } from '../GlobalAccessPoint.js';

const DEFAULTS = {
    intervalMs: 10_000,
    resolutionMs: 20,
    lagWarningMs: 100,
    lagCriticalMs: 500,
};

class EventLoopMonitor {
    constructor(active = true, config = {}) {
        this.active = active;
        this.config = { ...DEFAULTS, ...config };
        this._histogram = null;
        this._interval = null;
        this._cpuBaseline = null;
    }

    _sampleCpu() {
        const snapshot = process.cpuUsage(this._cpuBaseline || undefined);
        this._cpuBaseline = process.cpuUsage();
        const totalMicros = snapshot.user + snapshot.system;
        return Math.min(100, (totalMicros / 1000 / this.config.intervalMs) * 100);
    }

    start() {
        if (!this.active) {
            logger.info('EventLoopMonitor: Disabled — not active');
            return;
        }

        this._cpuBaseline = process.cpuUsage();
        this._histogram = monitorEventLoopDelay({ resolution: this.config.resolutionMs });
        this._histogram.enable();

        logger.info('EventLoopMonitor: Monitoring activated');

        this._interval = setInterval(() => this._evaluate(), this.config.intervalMs);
    }

    stop() {
        if (this._interval) {
            clearInterval(this._interval);
            this._interval = null;
        }
        if (this._histogram) {
            this._histogram.disable();
            this._histogram = null;
        }
        logger.info('EventLoopMonitor: Monitoring stopped');
    }

    _evaluate() {
        if (!this._histogram) return;

        const lagMs = this._histogram.mean / 1e6; // ns → ms
        const cpuPercent = this._sampleCpu();
        this._histogram.reset();

        logger.info(`EventLoopMonitor: lag=${lagMs.toFixed(2)}ms cpu=${cpuPercent.toFixed(1)}%`);

        if (lagMs >= this.config.lagCriticalMs) {
            logger.error(`EventLoopMonitor: CRITICAL lag ${lagMs.toFixed(2)}ms — server degraded`);
            globalAccessPoint.setValue('ELM_DEGRADED', true);
        } else {
            if (globalAccessPoint.getValue('ELM_DEGRADED')) {
                logger.info('EventLoopMonitor: Lag recovered — clearing degraded flag');
            }
            globalAccessPoint.setValue('ELM_DEGRADED', false);

            if (lagMs >= this.config.lagWarningMs) {
                logger.warn(`EventLoopMonitor: High lag ${lagMs.toFixed(2)}ms`);
            }
        }
    }

    getStats() {
        if (!this._histogram) return null;
        return {
            meanMs: this._histogram.mean / 1e6,
            maxMs: this._histogram.max / 1e6,
            p99Ms: this._histogram.percentile(99) / 1e6,
            degraded: !!globalAccessPoint.getValue('ELM_DEGRADED')
        };
    }
}

export { EventLoopMonitor };
