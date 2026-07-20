import { logger } from '../logger.js';
import { globalAccessPoint } from '../GlobalAccessPoint.js';

const DEFAULTS = {
    maxInFlight: 500,
    degradedMaxInFlight: 100
};

class LoadSheddingSystem {
    constructor(config = {}) {
        this._inFlight = 0;
        this.config = { ...DEFAULTS, ...config };
    }

    increment() {
        this._inFlight++;
    }

    decrement() {
        if (this._inFlight > 0) this._inFlight--;
    }

    canAccept() {
        const degraded = !!globalAccessPoint.getValue('ELM_DEGRADED');
        const limit = degraded ? this.config.degradedMaxInFlight : this.config.maxInFlight;
        return this._inFlight < limit;
    }

    get inFlight() {
        return this._inFlight;
    }

    setMaxInFlight(limit) {
        this.config.maxInFlight = limit;
        logger.info(`LoadShedder: maxInFlight updated to ${limit}`);
    }

    setDegradedMaxInFlight(limit) {
        this.config.degradedMaxInFlight = limit;
        logger.info(`LoadShedder: degradedMaxInFlight updated to ${limit}`);
    }

    getStats() {
        return {
            inFlight: this._inFlight,
            maxInFlight: this.config.maxInFlight,
            degradedMaxInFlight: this.config.degradedMaxInFlight,
            degradedMode: !!globalAccessPoint.getValue('ELM_DEGRADED')
        };
    }
}

export { LoadSheddingSystem };
