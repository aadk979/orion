import os from "os";
import { logger } from "../logger.js";

class MemoryMonitoringSystem {
    constructor(active = true) {
        this.active = active;
        this.interval = null;

        // 🧩 Hard-coded configuration
        this.rules = {
            headroom: 30,           // % of free memory below which warning triggers
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
        return { total, free, used, usagePercent };
    }

    evaluateMemoryState() {
        const { total, free, used, usagePercent } = this.getMemoryStats();

        // 🧾 General system memory log
        logger.info(
            `Memory Monitor: ${this.parseBytesToGB(used)}GB / ${this.parseBytesToGB(total)}GB in use (${usagePercent.toFixed(2)}% usage)`
        );

        // ⚠️ Headroom warning
        if (100 - usagePercent <= this.rules.headroom) {
            logger.warn(
                `Memory Monitor: Free memory below safe headroom (${(100 - usagePercent).toFixed(2)}% free, ${this.parseBytesToGB(free)}GB remaining)`
            );
        }

        // 🔴 Critical usage threshold — terminate instance
        if (usagePercent >= this.rules.systemKillThreshold) {
            logger.error(
                `Memory Monitor: Critical memory usage detected (${usagePercent.toFixed(2)}% usage, ${this.parseBytesToGB(used)}GB used)`
            );
            logger.error("Memory Monitor: Instance will now terminate to prevent instability");
            process.exit(1);
        }
    }

    start() {
        if (!this.active) {
            logger.info("Memory Monitor: Disabled — monitoring not active");
            return;
        }

        logger.info("Memory Monitor: Monitoring activated");
        this.evaluateMemoryState(); // Run first check immediately
        this.interval = setInterval(() => this.evaluateMemoryState(), 60_000);
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            logger.info("Memory Monitor: Monitoring stopped");
        }
    }
}

export { MemoryMonitoringSystem };