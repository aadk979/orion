import Joi from 'joi';
import { globalAccessPoint } from '../Utils/GlobalAccessPoint.js';

const NAME_SPACE = globalAccessPoint.nameSpace();

const endpointSchemas = {
    [`/${NAME_SPACE}/api/v1/action/sign-up-user`]: Joi.object({
        email: Joi.string().email().required(),
        password: Joi.string().min(7).required()
    }),
    [`/${NAME_SPACE}/api/v1/action/sign-in-user`]: Joi.object({
        email: Joi.string().email().required(),
        password: Joi.string().min(7).required()
    }),
    [`/${NAME_SPACE}/api/v1/action/generate-no-auth-token-transaction`]: Joi.object({
        captchaQuestionsHash: Joi.string().length(64).hex().required()
    }),
    [`/${NAME_SPACE}/api/v1/action/generate-no-auth-token`]: Joi.object({
        transactionId: Joi.string().min(8).required(),
        recaptchaResponse: Joi.any().required(),
        captchaSystemVersion: Joi.string().valid('[orion:v1]-[1.0.0]-[BETA]').required()
    }),
    [`/${NAME_SPACE}/api/v1/request/have-no-auth-token`]: Joi.object().max(0),
    [`/${NAME_SPACE}/api/v1/request/encryption-request-key`]: Joi.object().max(0),
    [`/${NAME_SPACE}/api/v1/action/configure-dip`]: Joi.object().max(0),
    [`/${NAME_SPACE}/api/v1/action/generate-passkey-registration-options`]: Joi.object().max(0),
    [`/${NAME_SPACE}/api/v1/action/complete-passkey-registration`]: Joi.object({
        registrationResponse: Joi.object().min(1).required()
    }),
    [`/${NAME_SPACE}/api/v1/action/generate-passkey-authentication-options`]: Joi.object({
        email: Joi.string().email().required()
    }),
    [`/${NAME_SPACE}/api/v1/action/sign-in-with-passkey-authentication`]: Joi.object({
        authenticationResponse: Joi.object().min(1).required(),
        email: Joi.string().email().required()
    }),
    [`/${NAME_SPACE}/api/v1/action/sign-out-user`]: Joi.object().max(0),
    [`/${NAME_SPACE}/api/v1/action/get-o-auth-redirect-url`]: Joi.object({
        providerName: Joi.string().min(1).required()
    }),
    [`/${NAME_SPACE}/api/v1/action/authorize-me`]: Joi.object({
        authorizationCode: Joi.string().min(1).required()
    }),
    [`/${NAME_SPACE}/api/v1/request/available-2fa-methods`]: Joi.object().max(0),
    [`/${NAME_SPACE}/api/v1/action/send-device-authorization-email`]: Joi.object().max(0),
    [`/${NAME_SPACE}/api/v1/action/authorize-device-with-passkey`]: Joi.object({
        authenticationResponse: Joi.object().min(1).required()
    }),
    [`/${NAME_SPACE}/api/v1/action/authorize-device-with-totp`]: Joi.object({
        totpCode: Joi.string().length(6).required()
    }),
    [`/${NAME_SPACE}/api/v1/action/handle-o-auth-callback`]: Joi.object({
        code: Joi.string().min(1).required(),
        state: Joi.string().min(1).required()
    }),
    [`/${NAME_SPACE}/api/v1/action/generate-totp-secret`]: Joi.object().max(0),
    [`/${NAME_SPACE}/api/v1/action/verify-and-enable-totp`]: Joi.object({
        totpCode: Joi.string().length(6).required()
    })
};

export { endpointSchemas };
