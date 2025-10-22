import { respondWithError, respondWithSuccess } from '../../../Server/Response/response.js';
import { cronScheduler } from '../../Cron.js';
import { generateHmacKey } from '../../CryptoFunctions.js';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { getIpRange, getIp } from '../../Ip.js';
import { tryCatch } from '../../TryCatch.js';
import { generateRequestId } from '../../valueGenerator.js';

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

export { routeHandlerGenerateDipConfig };;