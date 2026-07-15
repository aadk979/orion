import { respondWithError } from '../Response/response.js';
import { SafeModuleHandler } from '../../Utils/UnavailableModuleWrapper.js';

const loadSheddingSystemModule = new SafeModuleHandler('LoadSheddingSystem', 'loadSheddingSystem', 'loadSheddingMiddleware.js');


const loadSheddingMiddleware = (req, res, next) => {
    const loadShedder = loadSheddingSystemModule.probeModule();
    if (!loadShedder) return next();

    if (!loadShedder.canAccept()) {
        return respondWithError(res, 'SYSTEM::OVERLOADED::A::i');
    }

    let settled = false;
    const decrement = () => {
        if (!settled) {
            settled = true;
            loadShedder.decrement();
        }
    };

    loadShedder.increment();
    res.on('finish', decrement);
    res.on('close', decrement);

    return next();
};

export { loadSheddingMiddleware };
