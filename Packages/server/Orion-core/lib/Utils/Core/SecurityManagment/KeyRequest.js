import { respondWithError, respondWithSuccess } from '../../../Server/Response/response.js';
import { getRandomElement } from '../../ArrayUtilities.js';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';

// Orion prefers the ECC system for smaller key sizes and speed
const systemSupportedAlgs = ['ECC_256', 'ECC_384', 'RSA_2048', 'RSA_3072', 'RSA_4096'];

const routeHandlerKeyRequest = async (request, response) => {
    // Use prefered primary of no algs given
    let availableAlgs = request?.body?.packet?.algs || ['ECC_224'];
    let cleanedAlgs = [];

    // Prefered primary alg is the first element
    if (availableAlgs.includes(systemSupportedAlgs[0])) {

        const encryptionConfigsAvailable = globalAccessPoint.encryptionConfigsAvailable().filter(val => !val.includes('RSA') && !val.includes('ECC'));

        const selectedGroup = getRandomElement(encryptionConfigsAvailable);

        const group = globalAccessPoint.ephemeralDB().getData(selectedGroup);

        const config = getRandomElement(group.data);

        if (config.alg === 'ECC') {

            config.publicKey = config.exportedKey;

            delete config.exportedKey;

        }

        delete config.privateKey;

        return respondWithSuccess(response, 200, { ...config });
    }

    for (const alg of availableAlgs) {
        if (systemSupportedAlgs.includes(alg)) {
            cleanedAlgs.push(alg);
        }
    }

    if (cleanedAlgs.length === 0) {
        return respondWithError(response, 'ENCRYPTION-ALGS-NOT-SUPPORTED');
    }

    for (const alg of cleanedAlgs) {
        if (systemSupportedAlgs.includes(alg)) {
            const encryptionConfigsAvailable = globalAccessPoint.encryptionConfigsAvailable().filter(val => val.includes(alg));

            const selectedGroup = getRandomElement(encryptionConfigsAvailable);

            const group = globalAccessPoint.ephemeralDB().getData(selectedGroup);

            const config = getRandomElement(group.data);

            if (config.alg === 'ECC') {
                
                config.publicKey = config.exportedKey;

                delete config.exportedKey;

            }

            delete config.privateKey;

            return respondWithSuccess(response, 200, { ...config });
        }
    }
};

export { routeHandlerKeyRequest };