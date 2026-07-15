import { AccessTokens } from './Authentication/accessTokens.js';
import { StepUpAuth } from './Security/stepUpAuth.js';
import { RefreshTokens } from './Authentication/refreshTokens.js';
import { AuthenticationMiddleware } from './Authentication/authenticationMiddleware.js';
import { ResourceTokens } from './Authentication/resourceTokens.js';
import { AccountRegistration } from './Account/registration.js';
import { AccountSignIn } from './Account/signIn.js';
import { Passkeys } from './Account/passkeys.js';
import { TOTP } from './Account/totp.js';
import { UserControl } from './Account/userControl.js';
import { OAuth } from './OAuth/oauth.js';
import { DeviceAuthorization } from './Security/deviceAuthorization.js';
import { TwoFARemoval } from './Security/twoFARemoval.js';
import { Captcha } from './Security/captcha.js';
import { NoAuthToken } from './Security/noAuthToken.js';
import { DataValidation } from './Security/dataValidation.js';
import { General } from './Security/general.js';
import { Mail } from './Communication/mail.js';
import { Database } from './System/database.js';
import { FileOperations } from './System/fileOperations.js';
import { System } from './System/system.js';

const internalErrors = {
    ...AccessTokens,
    ...StepUpAuth,
    ...RefreshTokens,
    ...AuthenticationMiddleware,
    ...ResourceTokens,
    ...AccountRegistration,
    ...AccountSignIn,
    ...Passkeys,
    ...TOTP,
    ...UserControl,
    ...OAuth,
    ...DeviceAuthorization,
    ...TwoFARemoval,
    ...Captcha,
    ...NoAuthToken,
    ...DataValidation,
    ...General,
    ...Mail,
    ...Database,
    ...FileOperations,
    ...System
};

export { internalErrors };
