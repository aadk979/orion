import { generateTOTPSecret, verifyTOTPToken, generateTOTPAuthURI } from './TOTP.js';
import { respondWithError, respondWithSuccess } from '../../../Server/Response/response.js';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { tryCatch } from '../../TryCatch.js';
import { fileURLToPath } from 'url';
import { requestContext } from '../../../Server/Middleware/requestMetadata.js';

const generateTOTPSetupSecret = async (uid) => {
    const Function = async (parameters) => {
        const auditTrail = globalAccessPoint.auditTrailSystem();
        const requestMetadata = requestContext.getStore();

        const user = await globalAccessPoint.db().getData('Users', parameters.uid);

        if (!user.data) {
            return { error: true, errorCode: 'ACC-SIGN-IN-ACC-NO-EXISTS' };
        }

        if (user.data.credentials?.totp?.enabled) {
            return { error: true, errorCode: 'TOTP-ALREADY-ENABLED' };
        }

        const { error, secret } = await generateTOTPSecret();
        if (error) {
            return { error: true, errorCode: 'INTERNAL-ERROR' };
        }

        const authURI = await generateTOTPAuthURI(secret, user.data.email, 'Orion');
        if (authURI.error) {
            return { error: true, errorCode: 'INTERNAL-ERROR' };
        }

        // Save pending secret
        if (!user.data.credentials) user.data.credentials = {};
        if (!user.data.credentials.totp) user.data.credentials.totp = { enabled: false };

        user.data.credentials.totp.pendingSecret = secret;

        await globalAccessPoint.db().addData('Users', parameters.uid, user.data);

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

        return { error: false, secret, uri: authURI.uri };
    };

    const parameters = { uid };
    const functionSource = fileURLToPath(import.meta.url);
    return await tryCatch(Function, true, parameters, 'generateTOTPSetupSecret', functionSource);
};

const verifyAndEnableTOTP = async (uid, totpCode) => {
    const Function = async (parameters) => {
        const auditTrail = globalAccessPoint.auditTrailSystem();
        const requestMetadata = requestContext.getStore();

        const user = await globalAccessPoint.db().getData('Users', parameters.uid);

        if (!user.data) {
            return { error: true, errorCode: 'ACC-SIGN-IN-ACC-NO-EXISTS' };
        }

        const pendingSecret = user.data.credentials?.totp?.pendingSecret;
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

        // Verification succeeded, configure TOTP
        user.data.credentials.totp.enabled = true;
        user.data.credentials.totp.secret = pendingSecret;
        delete user.data.credentials.totp.pendingSecret;

        // Enable 2FA on the account
        if (!user.data.security) user.data.security = {};
        user.data.security.twoFA = true;

        await globalAccessPoint.db().addData('Users', parameters.uid, user.data);

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

    return respondWithSuccess(response, 200, { secret: callback.secret, uri: callback.uri });
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