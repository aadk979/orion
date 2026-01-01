import { respondWithError, respondWithSuccess } from '../../../Server/Response/response.js';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { tryCatch } from '../../TryCatch.js';
import { fileURLToPath } from 'url';
import { getRandomElement } from '../../ArrayUtilities.js';
import { encrypt, exportKeyBase64, generateEncryptionKey } from '../../CryptoFunctions.js';
import { encryptPublic } from '../../dedicatedCrypto.js';

const generateDipConfig = async (publicKey) => {
    const Function = async parameters => {
        const dipEnabled = globalAccessPoint.getValue('dip');

        if (!dipEnabled) {
            return { error: true, errorCode: 'DIP-DISABLED' };
        }

        const dipConfigsAvailable = globalAccessPoint.getValue('dipConfigsAvailable');

        const selectedGroup = getRandomElement(dipConfigsAvailable);

        const group = globalAccessPoint.getValue('ephemeralDB').getData(selectedGroup);

        const config = getRandomElement(group.data);

        const aesKey = generateEncryptionKey();

        const encryptedPayload = encrypt(JSON.stringify(config), aesKey);

        const exportedAESKey = await exportKeyBase64(aesKey);

        const encryptedTransportKey = await encryptPublic(exportedAESKey, parameters.publicKey);

        const payload = {
            encryptedTransportKey,
            encryptedData: encryptedPayload
        }

        return { error: false, data: payload };
    };

    const functionSource = fileURLToPath(import.meta.url);
    const result = await tryCatch(Function, true, { publicKey }, 'generateDipConfig', functionSource);
    return result;
};

const routeHandlerGenerateDipConfig = async (request, response) => {

    const publicKey = request?.body?.packet?.publicKey;

    if (!publicKey) {
        return respondWithError(response, "DIP-PUBLIC-KEY-NOT-PROVIDED");
    }

    const callback = await generateDipConfig(publicKey);

    if (callback.error) {
        return respondWithError(response, callback.errorCode);
    }

    return respondWithSuccess(response, 200, callback.data);
};

export { routeHandlerGenerateDipConfig };
