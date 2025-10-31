import { AccessTokens } from './Authentication/accessTokens.js';
import { RefreshTokens } from './Authentication/refreshTokens.js';
import { AuthenticationMiddleware } from './Authentication/authenticationMiddleware.js';
import { AccountRegistration } from './Account/registration.js';
import { AccountSignIn } from './Account/signIn.js';
import { Passkeys } from './Account/passkeys.js';
import { OAuth } from './OAuth/oauth.js';
import { DeviceAuthorization } from './Security/deviceAuthorization.js';
import { Captcha } from './Security/captcha.js';
import { NoAuthToken } from './Security/noAuthToken.js';
import { DataValidation } from './Security/dataValidation.js';
import { General } from './Security/general.js';
import { Mail } from './Communication/mail.js';
import { Dip } from './Security/dips.js';

const internalErrors = {
    ...AccessTokens,
    ...RefreshTokens,
    ...AuthenticationMiddleware,
    ...AccountRegistration,
    ...AccountSignIn,
    ...Passkeys,
    ...OAuth,
    ...DeviceAuthorization,
    ...Captcha,
    ...NoAuthToken,
    ...DataValidation,
    ...General,
    ...Mail,
    ...Dip
};

export { internalErrors };