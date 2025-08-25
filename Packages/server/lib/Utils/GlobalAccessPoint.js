const { logger } = require("./logger");

class GlobalAccessPoint {
    static instance;

    constructor() {
        if (GlobalAccessPoint.instance) {
            throw new Error("There can only be one instance of global access point!");
        }

        this._values = {};
        this._lockedKeys = new Set(["db", "systemConfig"]);
        GlobalAccessPoint.instance = this;
    }

    setValue(name, value) {
        if (this._lockedKeys.has(name) && this._values[name] !== undefined) {
            logger.error(`CRITICAL: Locked value for key ${name} cannot be overwritten.`)
            return false;
        }

        this._values[name] = value;
        return true;
    }

    getValue(name) {
        return this._values[name] ?? "NO-VALUE";
    }

    removeValue(name) {
        delete this._values[name];
        return true;
    }

    db() {
        return this.getValue("db");
    }

    systemConfig() {
        return this.getValue("systemConfig");
    }
}

const globalAccessPoint = new GlobalAccessPoint();

module.exports = { globalAccessPoint };