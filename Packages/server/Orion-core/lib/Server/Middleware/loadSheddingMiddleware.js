import { globalAccessPoint } from '../../Utils/GlobalAccessPoint.js';
import { respondWithError } from '../Response/response.js';

const loadSheddingMiddleware = (req, res, next) => {
    const loadShedder = globalAccessPoint.loadSheddingSystem();
    if (!loadShedder) return next();

    if (!loadShedder.canAccept()) {
        return respondWithError(res, 'SERVER-OVERLOADED');
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
