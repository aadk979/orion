const { endpointSchemas } = require("../../General/EndpointSchema");
const { respondWithError } = require("../Response/response");

const dataValidator = async (request, response, next) => {
    const endpointKey = `${request.path}`;
    const schema = endpointSchemas[endpointKey];

    if (!schema) return next();

    const data = request.body.packet;

    const { error, value } = schema.validate(data);

    if (error) {
        return respondWithError(response, "DV-INVALID-DATA")
    }

    request.body.packet = value;

    return next();
}

module.exports = { dataValidator };