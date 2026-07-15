import { endpointSchemas } from '../../General/EndpointSchema.js';
import { respondWithError } from '../Response/response.js';

const dataValidator = async (request, response, next) => {
    const endpointKey = `${request.path}`;
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
