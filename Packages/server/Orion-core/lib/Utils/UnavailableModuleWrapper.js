import { globalAccessPoint } from './GlobalAccessPoint.js';

// To be modified to use global system config, temporary flag
const PANIC_ON_MODULE_UNAVAILABILITY = true;

const MODULE_UNAVAILABLE_ERROR_CODE = 'SYSTEM::MODULE-UNAVAILABLE::A::i';

class SafeModuleHandler {
    constructor(moduleName, moduleMethod, functionSource) {
        this.moduleName = moduleName;
        this.moduleMethod = moduleMethod;
        this.functionSource = functionSource;
    }

    // Strict access for modules the caller requires: panics (or returns an error object) when unavailable
    getModule(functionName) {
        const module = this.probeModule();

        if (module === null) {
            return this.handleUnavailableModule(functionName);
        }

        return module;
    }

    // Soft access for modules that are optional by design: returns null when unavailable, never panics
    probeModule() {
        try {
            const module = globalAccessPoint[this.moduleMethod]();

            // Non-locked keys don't throw when missing, getValue returns undefined instead
            return module === undefined ? null : module;
        } catch (e) {
            if (e.code === 'GAP:$:VALUE_NOT_FOUND') {
                return null;
            }

            throw e;
        }
    }

    handleUnavailableModule(functionName) {
        if (PANIC_ON_MODULE_UNAVAILABILITY) {
            const location = functionName
                ? `(functionName: ${functionName}) in (functionSource: ${this.functionSource})`
                : `(functionSource: ${this.functionSource})`;

            const error = new Error(`SafeModuleHandler: Module (${this.moduleName}) not found at ${location}`);
            error.code = 'SMH:$:MODULE_UNAVAILABLE';
            error.errorCode = MODULE_UNAVAILABLE_ERROR_CODE;

            throw error;
        }

        return { error: true, errorCode: MODULE_UNAVAILABLE_ERROR_CODE };
    }

    getModuleName() {
        return this.moduleName;
    }
}

export { SafeModuleHandler, MODULE_UNAVAILABLE_ERROR_CODE };
