import { getCurrentUnixTime } from './Date&Time.js';
import { logger } from './logger.js';
import { errorTrackerSystem } from './Systems/errorTrackerSystem.js';

const tryCatch = async (Function, async, parameters, functionName, functionSource) => {
    // Capture the call site (where tryCatch itself was invoked)
    const trace = new Error().stack?.split('\n')?.slice(2, 5)?.join('\n');

    try {
        let result;
        switch (async) {
            case true:
                result = await Function(parameters);
                break;
            case false:
                result = Function(parameters);
                break;
            default:
                result = await Function(parameters);
        }

        return result;
    } catch (e) {
        const errStack = e?.stack?.split('\n')?.slice(0, 5)?.join('\n');
        console.log("<START_ERROR>");
        console.error(e);

        logger.error("Error while executing function: " + (functionName || Function.name || 'Anonymous Function'));
        logger.error("Function source: " + (functionSource || "Unknown Source"));
        logger.error("Error occurred in: " + (trace || "Unknown Location"));
        logger.error("Error message: " + e.message);
        logger.error("Error stack: " + errStack);

        // This is to be passed to the error tracking module for further analysis and escalated actions
        // Not implemented in current build
        const errorPackage = { functionName: functionName || Function.name, functionSource: functionSource, errorMessage: e.message, errStack: errStack, timestamp: getCurrentUnixTime() };

        const report = errorTrackerSystem.reportError(errorPackage);

        logger.error("ETS Error Id: " + report.errorId);

        console.log("<END_ERROR>");
        
        return { error: true, errorCode: "UNKNOWN-ERROR", context: e.message, trace };
    }
};

export { tryCatch };