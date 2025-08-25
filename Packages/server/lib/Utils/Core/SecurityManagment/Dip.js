const { respondWithError, respondWithSuccess } = require("../../../Server/Response/response");
const { cronScheduler } = require("../../Cron");
const { generateHmacKey } = require("../../CryptoFunctions");
const { globalAccessPoint } = require("../../GlobalAccessPoint");
const { getIpRange, getIp } = require("../../Ip");
const { tryCatch } = require("../../TryCatch");
const { generateRequestId } = require("../../valueGenerator");

const generateDipConfig = async (ip) => {
  const Function = async (parameters) => {
    const signatureKey = await generateHmacKey();
    const requestId = generateRequestId("DIP");

    const dipConfig = {
      dipId: requestId,
      signatureKey: signatureKey,
      ip: getIpRange(parameters.ip)
    };

    await globalAccessPoint.db().addData("dip", requestId, dipConfig);

    const deletionFunction = (parameters) => {
      globalAccessPoint.db().deleteData("dip", parameters.requestId);
    };

    cronScheduler.addEvent(requestId, deletionFunction, "3h", {
      requestId: requestId,
    });

    delete dipConfig.ip;

    return { error: false, dipConfig: { ...dipConfig , encryptAll: globalAccessPoint.getValue("systemConfig").api.encryptAll } };
  };

  const result = await tryCatch(Function, true, { ip: ip });
  return result;
};

const routeHandlerGenerateDipConfig = async (request, response) => {
    const ip = getIp(request);

    const callback = await generateDipConfig(ip);

    if (callback.error) {
        return respondWithError(response, callback.errorCode);
    }

    return respondWithSuccess(response , 200 , callback.dipConfig);
};

module.exports = { routeHandlerGenerateDipConfig }