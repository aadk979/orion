import { respondWithError, respondWithSuccess } from '../../../Server/Response/response.js';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { tryCatch } from '../../TryCatch.js';
import { fileURLToPath } from 'url';
import { getRandomElement } from '../../ArrayUtilities.js';

const generateDipConfig = async () => {
    const Function = async (parameters) => {

      const dipEnabled = globalAccessPoint.getValue("dip");

      if (!dipEnabled) {
          return { error: true, errorCode: "DIP-DISABLED" };
      }

      const dipConfigsAvailable = globalAccessPoint.getValue("dipConfigsAvailable");

      const selectedGroup = getRandomElement(dipConfigsAvailable);

      const group = globalAccessPoint.getValue("ephemeralDB").getData(selectedGroup);

      const config = getRandomElement(group.data);

      return { error: false, dipConfig: { ...config } };
    };

    const functionSource = fileURLToPath(import.meta.url);
    const result = await tryCatch(Function, true, { }, 'generateDipConfig', functionSource);
    return result;
};

const routeHandlerGenerateDipConfig = async (request, response) => {
  
    const callback = await generateDipConfig();

    if (callback.error) {
        return respondWithError(response, callback.errorCode);
    }

    return respondWithSuccess(response , 200 , callback.dipConfig);
};

export { routeHandlerGenerateDipConfig };