// Do not tamper with this file unless you know what you are doing.
// This file contains endpoint schemas for the default endpoints that are added by the Orion system.
// You are highly discouraged from modifying this file as some client SDK's may rely on these if not properly modifed or maintained.
// Modifying this file incorrectly may cause security vulneribilities or bugs in the system.

const Joi = require('joi');

const nameSpace = "point-break";

const endpointSchemas = {
    [`/${nameSpace}/api/v1/action/sign-up-user`]: Joi.object({
        email: Joi.string().email().required(),
        password: Joi.string().min(7).required()
    }),
    [`/${nameSpace}/api/v1/action/sign-in-user`]: Joi.object({
        email: Joi.string().email().required(),
        password: Joi.string().min(7).required()
    }),
    [`/${nameSpace}/api/v1/action/generate-no-auth-token-transaction`]: Joi.object({
        captchaQuestionsHash: Joi.string().length(64).hex().required()
    }),
    [`/${nameSpace}/api/v1/action/generate-no-auth-token`]: Joi.object({
        transactionId: Joi.string().min(8).required(),
        recaptchaResponse: Joi.any().required(),
        captchaSystemVersion: Joi.string().valid("[orion:v1]-[1.0.0]-[BETA]").required()
    }),
    [`/${nameSpace}/api/v1/request/have-no-auth-token`]: Joi.object().max(0),
    [`/${nameSpace}/api/v1/request/encryption-request-key`]: Joi.object().max(0),
    [`/${nameSpace}/api/v1/action/configure-dip`]: Joi.object().max(0),
    [`/${nameSpace}/api/v1/action/generate-passkey-registration-options`]: Joi.object().max(0),
    [`/${nameSpace}/api/v1/action/complete-passkey-registration`]: Joi.object({
        registrationResponse: Joi.object().min(1).required()
    }),
    [`/${nameSpace}/api/v1/action/generate-passkey-authentication-options`]: Joi.object({
        email: Joi.string().email().required()
    }),
    [`/${nameSpace}/api/v1/action/complete-passkey-authentication`]: Joi.object({
        authenticationResponse: Joi.object().min(1).required(),
        email: Joi.string().email().required()
    }),
    [`/${nameSpace}/api/v1/action/sign-out-user`]: Joi.object().max(0),
}

module.exports = { endpointSchemas };