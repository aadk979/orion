import { generateTOTPSecret, verifyTOTPToken, generateTOTPAuthURI } from './TOTP.js';
import { respondWithError, respondWithSuccess } from '../../../Server/Response/response.js';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { UserModel, TOTPModel, UserSecurityModel } from '../../Databases/models/index.js';
import { tryCatch } from '../../TryCatch.js';
import { fileURLToPath } from 'url';
import { requestContext } from '../../../Server/Middleware/requestMetadata.js';
import QRCode from 'qrcode';

const generateTOTPSetupSecret = async (uid) => {
    const Function = async (parameters) => {
        if (globalAccessPoint.getValue('totpSystemDisabled')) return { error: true, errorCode: 'TOTP-SYSTEM-DISABLED' };

        const auditTrail = globalAccessPoint.auditTrailSystem();
        const requestMetadata = requestContext.getStore();

        const user = await UserModel.getUserByUid(parameters.uid);

        if (!user) {
            return { error: true, errorCode: 'ACC-SIGN-IN-ACC-NO-EXISTS' };
        }

        const totpEnabled = await TOTPModel.isEnabled(parameters.uid);
        if (totpEnabled) {
            return { error: true, errorCode: 'TOTP-ALREADY-ENABLED' };
        }

        const { error, secret } = await generateTOTPSecret();
        if (error) {
            return { error: true, errorCode: 'INTERNAL-ERROR' };
        }

        const authURI = await generateTOTPAuthURI(secret, user.email, 'Orion');
        if (authURI.error) {
            return { error: true, errorCode: 'INTERNAL-ERROR' };
        }

        let qrCode;
        try {
            qrCode = await QRCode.toDataURL(authURI.uri);
        } catch (e) {
            return { error: true, errorCode: 'INTERNAL-ERROR' };
        }

        // Save pending secret
        await TOTPModel.savePendingSecret(parameters.uid, secret);

        if (auditTrail) {
            auditTrail.record({
                user: { uid: parameters.uid },
                action: 'TOTP_SETUP_SECRET_GENERATED',
                status: 'SUCCESS',
                source: 'SetupTOTP.js',
                functionName: 'generateTOTPSetupSecret',
                requestId: requestMetadata?.requestId,
                impact: 'TOTP pending secret generated and stored',
                metadata: {}
            });
        }

        return { error: false, qrCode, secret };
    };

    const parameters = { uid };
    const functionSource = fileURLToPath(import.meta.url);
    return await tryCatch(Function, true, parameters, 'generateTOTPSetupSecret', functionSource);
};

const verifyAndEnableTOTP = async (uid, totpCode) => {
    const Function = async (parameters) => {
        if (globalAccessPoint.getValue('totpSystemDisabled')) return { error: true, errorCode: 'TOTP-SYSTEM-DISABLED' };

        const auditTrail = globalAccessPoint.auditTrailSystem();
        const requestMetadata = requestContext.getStore();

        const user = await UserModel.getUserByUid(parameters.uid);

        if (!user) {
            return { error: true, errorCode: 'ACC-SIGN-IN-ACC-NO-EXISTS' };
        }

        const pendingSecret = await TOTPModel.getPendingSecret(parameters.uid);
        if (!pendingSecret) {
            return { error: true, errorCode: 'TOTP-NO-PENDING-SECRET' };
        }

        const verification = await verifyTOTPToken(parameters.totpCode, pendingSecret);

        if (verification.error) {
            if (auditTrail) {
                auditTrail.record({
                    user: { uid: parameters.uid },
                    action: 'TOTP_SETUP_VERIFICATION',
                    status: 'FAILED',
                    source: 'SetupTOTP.js',
                    functionName: 'verifyAndEnableTOTP',
                    requestId: requestMetadata?.requestId,
                    impact: 'TOTP verification failed during setup',
                    metadata: { reason: 'INVALID_CODE' },
                    errorCode: 'TOTP-INVALID-TOKEN'
                });
            }
            return { error: true, errorCode: 'TOTP-INVALID-TOKEN' };
        }

        // Verification succeeded — promote pending secret and enable TOTP
        await TOTPModel.enableTOTP(parameters.uid, pendingSecret);

        // Enable 2FA flag on the account
        await UserSecurityModel.setTwoFAEnabled(parameters.uid, true);

        if (auditTrail) {
            auditTrail.record({
                user: { uid: parameters.uid },
                action: 'TOTP_SETUP_ENABLED',
                status: 'SUCCESS',
                source: 'SetupTOTP.js',
                functionName: 'verifyAndEnableTOTP',
                requestId: requestMetadata?.requestId,
                impact: 'TOTP enabled on account, 2FA flag set',
                metadata: {}
            });
        }

        return { error: false, completed: true };
    };

    const parameters = { uid, totpCode };
    const functionSource = fileURLToPath(import.meta.url);
    return await tryCatch(Function, true, parameters, 'verifyAndEnableTOTP', functionSource);
};

const routeHandlerGenerateTOTPSecret = async (request, response) => {
    const uid = request.user.uid;

    const callback = await generateTOTPSetupSecret(uid);

    if (callback.error) {
        return respondWithError(response, callback.errorCode);
    }

    return respondWithSuccess(response, 200, { qrCode: callback.qrCode, secret: callback.secret });
};

const routeHandlerVerifyAndEnableTOTP = async (request, response) => {
    const uid = request.user.uid;
    const totpCode = request.body.packet.totpCode;

    const callback = await verifyAndEnableTOTP(uid, totpCode);

    if (callback.error) {
        return respondWithError(response, callback.errorCode);
    }

    return respondWithSuccess(response, 200, { success: true });
};

export { generateTOTPSetupSecret, verifyAndEnableTOTP, routeHandlerGenerateTOTPSecret, routeHandlerVerifyAndEnableTOTP };