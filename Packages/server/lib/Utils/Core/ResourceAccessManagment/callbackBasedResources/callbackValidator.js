import { logger } from "../../../logger.js";
import { SUPPORTED_TOKENS } from "../configs.js";

const validateRASCallbacks = (config = []) => {

    const configTypeSchema = {
        callbackPath: "string",
        accessType: "string",
        callback: "function",
    }

    return config.filter(callback => {
        
        if (typeof callback?.callbackPath !== configTypeSchema.callbackPath || !callback?.callbackPath.trim()) {
            logger.warn(`Invalid callback path "${callback?.callbackPath}", refused to register callback!`);
            return false;
        }

        const accessType = callback?.accessType?.toUpperCase().trim();
        const isSupported = SUPPORTED_TOKENS.find(val => val.tokenType === accessType);
        if (!isSupported) {
            logger.warn(`Invalid access type "${callback?.accessType}", refused to register callback!`);
            return false;
        }

        if (typeof callback.callback !== configTypeSchema.callback) {
            logger.warn(`Given callback is not of type function, "${typeof callback?.callback}", refused to register callback!`);
            return false;
        }

        return true;
    });
}

export { validateRASCallbacks }
