import { logger } from "../../../logger.js";
import { SUPPORTED_TOKENS } from "../configs.js";

const validateRASCallbacks = (config = []) => {

    const configTypeSchema = {
        callbackPath: "string",
        accessType: "string",
        callback: "function",
    }

    const allowedCallbacks = [];

    for (const callback of config) {

        let mistakeCount = 0;

        if (callback?.callbackPath.trim() === "" || typeof callback?.callbackPath !== configTypeSchema.callbackPath) {
            mistakeCount ++;
            logger.warn(`Invalid callback path, "${callback?.callbackPath}", refused to register callback!`)
        }

        if (!SUPPORTED_TOKENS.find(val => val.tokenType === callback?.accessType.toUpperCase().trim())) {
            mistakeCount ++;
            logger.warn(`Invalid access type, "${callback?.accessType}", refused to register callback!`)
        }

        if (typeof callback.callback !== configTypeSchema.callback) {
            mistakeCount ++;
            logger.warn(`Given callback is not of type function, "${typeof callback?.callback}", refused to register callback!`)
        }

        allowedCallbacks.push(mistakeCount > 0 ? null : callback);
    }

    return allowedCallbacks.filter(val => val !== null);
}

export { validateRASCallbacks }