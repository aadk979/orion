import { logger } from './logger.js';

class GlobalAccessPoint {
    static instance;

    constructor() {
        if (GlobalAccessPoint.instance) {
            throw new Error("There can only be one instance of global access point!");
        }

        this._values = {};
        this._lockedKeys = new Set([
            "db",
            "systemConfig",
            "volatileSecretsManager",
            "refreshRateLimiter",
            "oAuthToolKit"
        ]);

        GlobalAccessPoint.instance = this;
    }

    setValue(name, value) {
        if (this._lockedKeys.has(name) && this._values[name] !== undefined) {
            logger.error(`CRITICAL: Locked value for key ${name} cannot be overwritten.`);
            return false;
        }

        this._values[name] = value;
        return true;
    }

    getValue(name) {
        if (!(name in this._values)) {
            logger.error(`CRITICAL: Requested value for key ${name} does not exist.`);
            throw new Error(`GlobalAccessPoint: No value found for key "${name}"`);
        }
        return this._values[name];
    }

    removeValue(name) {
        if (this._lockedKeys.has(name)) {
            logger.error(`CRITICAL: Locked value for key ${name} cannot be removed.`);
            return false;
        }

        delete this._values[name];
        return true;
    }

    // Convenience getters
    db() {
        return this.getValue("db");
    }

    systemConfig() {
        return this.getValue("systemConfig");
    }

    nameSpace() {
        return "alpine";
    }
}

// Singleton instance
const globalAccessPoint = new GlobalAccessPoint();

export { globalAccessPoint };
