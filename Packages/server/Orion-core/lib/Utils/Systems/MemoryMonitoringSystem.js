import os from 'os';
import { logger } from '../logger.js';
import { globalAccessPoint } from '../GlobalAccessPoint.js';
import { SafeModuleHandler } from '../UnavailableModuleWrapper.js';

const systemConfigModule = new SafeModuleHandler('SystemConfig', 'systemConfig', 'MemoryMonitoringSystem.js');


function deepDelete(obj, path) {
    let curr = obj;

    for (let i = 0; i < path.length - 1; i++) {
        curr = curr[path[i]];
        if (!curr) return; // path doesn't exist
    }

    delete curr[path[path.length - 1]];

    return obj;
}

function getValueByPath(obj, path) {
    return path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);
}

function setValueByPath(obj, path, value) {
    const keys = path.split('.');
    let current = obj;
    keys.slice(0, -1).forEach(k => (current = current[k] ||= {}));
    current[keys[keys.length - 1]] = value;
}

class MemoryMonitoringSystem {
    constructor(active = true) {
        this.active = active;
        this.interval = null;

        // 🧩 Hard-coded configuration
        this.rules = {
            headroom: 30, // % of free memory below which warning triggers
            systemKillThreshold: 85 // % usage at which Orion self-terminates
        };
    }

    parseBytesToGB(bytes) {
        return Number((bytes / 1024 ** 3).toFixed(3));
    }

    getMemoryStats() {
        const total = os.totalmem();
        const free = os.freemem();
        const used = total - free;
        const usagePercent = (used / total) * 100;

        const inGB = { total: this.parseBytesToGB(total), free: this.parseBytesToGB(free), used: this.parseBytesToGB(used) };

        return { total, free, used, usagePercent, inGB };
    }

    evaluateMemoryState() {
        const { total, free, used, usagePercent } = this.getMemoryStats();

        // 🧾 General system memory log
        logger.info(`Memory Monitor: ${this.parseBytesToGB(used)}GB / ${this.parseBytesToGB(total)}GB in use (${usagePercent.toFixed(2)}% usage)`);

        // ⚠️ Headroom warning
        if (100 - usagePercent <= this.rules.headroom) {
            logger.warn(`Memory Monitor: Free memory below safe headroom (${(100 - usagePercent).toFixed(2)}% free, ${this.parseBytesToGB(free)}GB remaining)`);
        }

        // 🔴 Critical usage threshold — terminate instance
        if (usagePercent >= this.rules.systemKillThreshold) {
            logger.error(`Memory Monitor: Critical memory usage detected (${usagePercent.toFixed(2)}% usage, ${this.parseBytesToGB(used)}GB used)`);
            logger.error('Memory Monitor: Instance will now terminate to prevent instability');
            process.exit(1);
        }
    }

    start() {
        if (!this.active) {
            logger.info('Memory Monitor: Disabled — monitoring not active');
            return;
        }

        logger.info('Memory Monitor: Monitoring activated');
        this.evaluateMemoryState(); // Run first check immediately
        this.interval = setInterval(() => this.evaluateMemoryState(), 60_000);
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            logger.info('Memory Monitor: Monitoring stopped');
        }
    }

    purgeSystemConfigPostSetup() {
        let purgedSystemConfig = systemConfigModule.getModule();

        const purgables = [
            'auditTrailSystem',
            'api.slug',
            'api.customMiddlewares',
            'api.resourceAccessConfig',
            'authMethods.OAuth',
            'accessControl',
            'dataIntegrity',
            'resourceAccessConfig',
            'rateLimitWindowMs',
            'maxRequests',
            'sizeLimit',
            'authMethods.allowedEmailDomains',
            'api.customEndpoints[{method,callback}]'
        ];

        purgables.forEach(path => {
            const match = path.match(/^(.+?)\[(.*)\]$|^(.+?)\{(.*)\}$/);

            if (match) {
                const fullKey = match[1] || match[3];
                const keysToRemove = (match[2] || match[4]).split(',').map(k => k.trim());

                const target = getValueByPath(purgedSystemConfig, fullKey);
                if (!target) return;

                if (Array.isArray(target)) {
                    target.forEach(obj => {
                        if (typeof obj === 'object') {
                            keysToRemove.forEach(key => delete obj[key]);
                        }
                    });
                } else if (typeof target === 'object') {
                    keysToRemove.forEach(key => delete target[key]);
                }

                setValueByPath(purgedSystemConfig, fullKey, target);
                return;
            }

            if (path.includes('.')) {
                const keys = path.split('.');
                const purged = deepDelete(purgedSystemConfig, keys);
                if (purged) purgedSystemConfig = purged;
                return;
            }

            delete purgedSystemConfig[path];
        });

        globalAccessPoint.setValue('systemConfig', purgedSystemConfig);
    }
}

export { MemoryMonitoringSystem };
