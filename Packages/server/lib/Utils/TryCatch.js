const { logger } = require("./logger")

const tryCatch = async (Function , async , parameters) => {
    try {
        switch (async) {
            case true : {
                const result = await Function(parameters);
                return result;
            }
            case false : {
                const result = Function(parameters);
                return result;
            }

            default : {
                const result = await Function(parameters);
                return result;
            }
        }
    }
    catch(e) {
        logger.error("Error while executing function: " + e);
        return { error: true , errorCode: "UNKOWN-ERROR" , context: e.message }
    }
}

module.exports = { tryCatch }