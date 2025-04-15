const Joi = require('joi');

const name = "point-break";

const endpointSchemas = {
    [`/${name}/api/v1/action/register-user`]: Joi.object({
        email: Joi.string().email().required(),
        password: Joi.string().min(7).required()
    }),
    [`/${name}/api/v1/action/sign-in-user`]: Joi.object({
        email: Joi.string().email().required(),
        password: Joi.string().min(7).required()
    }),
}

module.exports = { endpointSchemas };