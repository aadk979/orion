import { endpointSchemas } from '../../General/EndpointSchema.js';
import { respondWithError } from '../Response/response.js';
import { slugParser } from '../../Utils/Parsers.js';

const dataValidator = async (request, response, next) => {
    // Schema keys are slug-less, but routes are mounted with the configured
    // api.slug prefixed — so the raw path must be normalized before lookup or
    // every schema misses and validation is silently skipped for the whole API.
    // authentication.js and deviceScanner.js normalize the same way.
    const endpointKey = slugParser(request.path);
    const schema = endpointSchemas[endpointKey];

    if (!schema) return next();

    const data = request.body.packet;

    const { error, value } = schema.validate(data);

    if (error) {
        return respondWithError(response, 'DATA-VALIDATION::INVALID-DATA::A::p');
    }

    request.body.packet = value;

    return next();
};

export { dataValidator };
