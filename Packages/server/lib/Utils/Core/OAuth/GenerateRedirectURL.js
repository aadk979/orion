import { respondWithError, respondWithSuccess } from "../../../Server/Response/response.js"
import { cronScheduler } from "../../Cron.js"
import { hashString } from "../../CryptoFunctions.js"
import { base64Encode } from "../../Encoders.js"
import { globalAccessPoint } from "../../GlobalAccessPoint.js"
import { getIp, getIpRange } from "../../Ip.js"
import { tryCatch } from "../../TryCatch.js"
import { fileURLToPath } from 'url';
import { generateChallenge, generateRequestId } from "../../valueGenerator.js"
import { requestContext } from "../../../Server/Middleware/requestMetadata.js"

const SUPPORTED_PROVIDERS = [
    "GOOGLE",
    "GITHUB",
    "MICROSOFT",
    "DISCORD",
    "FACEBOOK",
    "AMAZON",
    "SLACK",
    "APPLE",
    "TWITTER",
    "LINKEDIN",
    "REDDIT",
    "SPOTIFY"
];

const deleteFunction = async (parameters) => {
    await globalAccessPoint.db().deleteData("O-AUTH-REQUESTS", parameters.requestId);
}

const generateOAuthRedirectURL = async (providerName, deviceFingerprint, ip) => {
    const Function = async (parameters) => {
        const auditTrail = globalAccessPoint.getValue('auditTrailSystem');
        const requestMetadata = requestContext.getStore();
        
        if (!SUPPORTED_PROVIDERS.includes(parameters.providerName.toUpperCase())) {
            auditTrail.record({
                user: {},
                device: { 
                    fingerprint: parameters.deviceFingerprint,
                    userAgent: requestMetadata?.userAgent 
                },
                action: "OAUTH_REDIRECT_ATTEMPT",
                status: "FAILED",
                source: "GenerateRedirectURL.js",
                functionName: "generateOAuthRedirectURL",
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: "OAuth redirect blocked - unsupported provider",
                metadata: { 
                    reason: "UNSUPPORTED_PROVIDER",
                    provider: parameters.providerName
                },
                errorCode: "O-AUTH-UNSUPPORTED-PROVIDER"
            });
            return { error: true, errorCode: "O-AUTH-UNSUPPORTED-PROVIDER" }
        }

        const oAuthToolKit = globalAccessPoint.getValue("oAuthToolKit");

        const requestId = generateRequestId("O-AUTH", 32);
        const challenge = generateChallenge(32);
        const hashedDeviceFingerprint = await hashString(parameters.deviceFingerprint);
        const hashedChallenge = await hashString(challenge);
        const ipRange = getIpRange(parameters.ip);

        const stateForClient = { requestId, challenge, providerName: parameters.providerName.toUpperCase() };
        const stateForServer = { requestId, hashedDeviceFingerprint, hashedChallenge, ipRange, providerName: parameters.providerName.toUpperCase() };

        const encodedStateForClient = base64Encode(JSON.stringify(stateForClient));

        await globalAccessPoint.db().addData("O-AUTH-REQUESTS", requestId, stateForServer);

        cronScheduler.addEvent(requestId, deleteFunction, "2m", { requestId });

        const redirectURLResponse = oAuthToolKit.generateAuthUrl(parameters.providerName.toLowerCase(), encodedStateForClient);

        if (redirectURLResponse?.error) {
            auditTrail.record({
                user: {},
                device: { 
                    fingerprint: parameters.deviceFingerprint,
                    userAgent: requestMetadata?.userAgent 
                },
                action: "OAUTH_REDIRECT_ATTEMPT",
                status: "FAILED",
                source: "GenerateRedirectURL.js",
                functionName: "generateOAuthRedirectURL",
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: "OAuth redirect failed - URL generation error",
                metadata: { 
                    reason: "URL_GENERATION_FAILED",
                    provider: parameters.providerName,
                    requestId: requestId
                },
                errorCode: redirectURLResponse.errorCode
            });
            return { error: true, errorCode: redirectURLResponse.errorCode };
        }

        auditTrail.record({
            user: {},
            device: { 
                fingerprint: parameters.deviceFingerprint,
                userAgent: requestMetadata?.userAgent 
            },
            action: "OAUTH_REDIRECT_SUCCESS",
            status: "SUCCESS",
            source: "GenerateRedirectURL.js",
            functionName: "generateOAuthRedirectURL",
            requestId: requestMetadata?.requestId,
            ipAddress: parameters.ip,
            impact: "OAuth redirect URL generated successfully",
            metadata: { 
                provider: parameters.providerName,
                requestId: requestId,
                challenge: challenge
            }
        });

        return { error: false, redirectURL: redirectURLResponse.redirectURL };
    }

    const parameters = {
        providerName,
        deviceFingerprint,
        ip
    }

    const functionSource = fileURLToPath(import.meta.url);
    const results = await tryCatch(Function, true, parameters, 'generateOAuthRedirectURL', functionSource);

    if (results.error && results.errorCode === "UNKNOWN-ERROR") {
        return { error: true, errorCode: "O-AUTH-UNABLE-TO-GENERATE-REDIRECT-URL" };
    }

    return results;
}

const routeHandlerGenerateOAuthRedirectURL = async (request , response) => {
    const packet = request.body.packet;

    const providerName = packet.providerName;

    const ip = getIp(request);
    const fingerprint = request.headers["orion-fingerprint"];

    const callback = await generateOAuthRedirectURL(providerName, fingerprint, ip);

    if(callback.error) {
        return respondWithError(response , callback.errorCode)
    }

    return respondWithSuccess(response , 200 , callback);
}

export { generateOAuthRedirectURL, routeHandlerGenerateOAuthRedirectURL };