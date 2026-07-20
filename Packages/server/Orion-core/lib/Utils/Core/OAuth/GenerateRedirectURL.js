import { respondWithError, respondWithSuccess } from '../../../Server/Response/response.js';
import { cronScheduler } from '../../Cron.js';
import { hashString } from '../../CryptoFunctions.js';
import { base64Encode } from '../../Encoders.js';
import { RequestModel } from '../../Databases/models/index.js';
import { getIp, getIpRange } from '../../Ip.js';
import { tryCatch } from '../../TryCatch.js';
import { fileURLToPath } from 'url';
import { generateChallenge, generateRequestId } from '../../valueGenerator.js';
import { requestContext } from '../../../Server/Middleware/requestMetadata.js';
import { SafeModuleHandler } from '../../UnavailableModuleWrapper.js';
import { setManagedCookie } from '../../CookieUtils.js';

const auditTrailSystemModule = new SafeModuleHandler('AuditTrailSystem', 'auditTrailSystem', 'GenerateRedirectURL.js');
const oAuthToolKitModule = new SafeModuleHandler('OAuthToolKit', 'oAuthToolKit', 'GenerateRedirectURL.js');

const SUPPORTED_PROVIDERS = ['GOOGLE', 'GITHUB', 'MICROSOFT', 'DISCORD', 'FACEBOOK', 'AMAZON', 'SLACK', 'TWITTER', 'LINKEDIN', 'REDDIT', 'SPOTIFY'];

const deleteFunction = async parameters => {
    await RequestModel.deleteOAuthRequest(parameters.requestId);
};

const generateOAuthRedirectURL = async (providerName, ip) => {
    const Function = async parameters => {
        const auditTrail = auditTrailSystemModule.getModule();
        const requestMetadata = requestContext.getStore();

        if (!SUPPORTED_PROVIDERS.includes(parameters.providerName.toUpperCase())) {
            auditTrail.record({
                user: {},
                device: {
                    userAgent: requestMetadata?.userAgent
                },
                action: 'OAUTH_REDIRECT_ATTEMPT',
                status: 'FAILED',
                source: 'GenerateRedirectURL.js',
                functionName: 'generateOAuthRedirectURL',
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: 'OAuth redirect blocked - unsupported provider',
                metadata: {
                    reason: 'UNSUPPORTED_PROVIDER',
                    provider: parameters.providerName
                },
                errorCode: 'OAUTH::UNSUPPORTED-PROVIDER::A::p'
            });
            return { error: true, errorCode: 'OAUTH::UNSUPPORTED-PROVIDER::A::p' };
        }

        const oAuthToolKit = oAuthToolKitModule.getModule();

        const requestId = generateRequestId('OAUTH::GENERIC-ERROR::A::p', 32);
        const challenge = generateChallenge(32);
        const flowSecret = generateChallenge(32);
        const hashedFlowSecret = await hashString(flowSecret);
        const hashedChallenge = await hashString(challenge);
        const ipRange = getIpRange(parameters.ip);

        // PKCE verifier and OIDC nonce are generated for every request and kept
        // server-side; the toolkit only forwards each one to providers that use it.
        const codeVerifier = oAuthToolKit.generateCodeVerifier();
        const nonce = oAuthToolKit.generateNonce();

        const stateForClient = {
            requestId,
            challenge,
            providerName: parameters.providerName.toUpperCase()
        };

        const encodedStateForClient = base64Encode(JSON.stringify(stateForClient));

        await RequestModel.createOAuthRequest(requestId, {
            hashedFlowSecret,
            hashedChallenge,
            ipRange,
            providerName: parameters.providerName.toUpperCase(),
            nonce,
            codeVerifier
        });

        cronScheduler.addEvent(requestId, deleteFunction, '2m', { requestId });

        const redirectURLResponse = await oAuthToolKit.generateAuthUrl(parameters.providerName.toLowerCase(), encodedStateForClient, {
            nonce,
            codeVerifier
        });

        if (redirectURLResponse?.error) {
            auditTrail.record({
                user: {},
                device: {
                    userAgent: requestMetadata?.userAgent
                },
                action: 'OAUTH_REDIRECT_ATTEMPT',
                status: 'FAILED',
                source: 'GenerateRedirectURL.js',
                functionName: 'generateOAuthRedirectURL',
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: 'OAuth redirect failed - URL generation error',
                metadata: {
                    reason: 'URL_GENERATION_FAILED',
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
                userAgent: requestMetadata?.userAgent
            },
            action: 'OAUTH_REDIRECT_SUCCESS',
            status: 'SUCCESS',
            source: 'GenerateRedirectURL.js',
            functionName: 'generateOAuthRedirectURL',
            requestId: requestMetadata?.requestId,
            ipAddress: parameters.ip,
            impact: 'OAuth redirect URL generated successfully',
            metadata: {
                provider: parameters.providerName,
                requestId: requestId,
                challenge: challenge
            }
        });

        return { error: false, redirectURL: redirectURLResponse.redirectURL, flowSecret };
    };

    const parameters = {
        providerName,
        ip
    };

    const functionSource = fileURLToPath(import.meta.url);
    const results = await tryCatch(Function, true, parameters, 'generateOAuthRedirectURL', functionSource);

    if (results.error && results.errorCode === 'GENERAL::UNKNOWN-ERROR::A::i') {
        return { error: true, errorCode: 'OAUTH::REDIRECT-URL-GENERATION-FAILED::A::i' };
    }

    return results;
};

const routeHandlerGenerateOAuthRedirectURL = async (request, response) => {
    const packet = request.body.packet;

    const providerName = packet.providerName;

    const ip = getIp(request);

    const callback = await generateOAuthRedirectURL(providerName, ip);

    if (callback.error) {
        return respondWithError(response, callback.errorCode);
    }

    // Deliver flow_secret via HttpOnly cookie — never in the response body
    setManagedCookie(response, 'oAuthFlowSecret', callback.flowSecret);

    return respondWithSuccess(response, 200, { redirectURL: callback.redirectURL });
};

export { generateOAuthRedirectURL, routeHandlerGenerateOAuthRedirectURL };
