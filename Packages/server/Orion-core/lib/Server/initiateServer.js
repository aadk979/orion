import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import hpp from 'hpp';
import cookieParser from 'cookie-parser';

import { logger } from '../Utils/logger.js';
import { originVerifier } from './Middleware/originVerifier.js';
import { headerParser } from './Middleware/headerParser.js';
import { PersistantDatabaseManager } from '../Utils/Databases/PersitantDatabases/index.js';
import { globalAccessPoint } from '../Utils/GlobalAccessPoint.js';
import { defaultServerRoutes } from './Endpoints/index.js';
import { dataValidator } from './Middleware/dataValidator.js';
import { authenticationMiddleware } from './Middleware/authentication.js';
import { decryptionMiddleware } from './Middleware/decryptor.js';
import { dipMiddleware } from './Middleware/dip.js';
import { VolatileSecretsManager } from '../Utils/Systems/VolatileSecretsManager.js';
import { RefreshRateLimiter } from '../Utils/Systems/RefreshTokenRateLimitSystem.js';
import { getCurrentUnixTime, parseDuration } from '../Utils/Date&Time.js';
import { OAuthProviderToolkit } from '../Utils/Core/OAuth/OrionOAuthToolKit.js';
import { deviceCheckMiddlware } from './Middleware/deviceScanner.js';
import { MemoryMonitoringSystem } from '../Utils/Systems/MemoryMonitoringSystem.js';
import { serverStatusMiddlware } from './Middleware/serverStatus.js';
import { handleOnStartConfiguration } from './onStartConfigurations.js';
import { requestMetadataMiddleware } from './Middleware/requestMetadata.js';
import { AuditTrailSystem } from '../Utils/Systems/AuditTrailSystem.js';
import { resourceAccessMiddleware } from './Middleware/resourceAccess.js';
import { SignatureSecretsManager } from '../Utils/Systems/SignatureSecretsManager.js';
import { serverUtilitiesMiddleware } from './Middleware/serverUtilities.js';

// Default config used if none provided
const defaultStartConfig = Object.freeze({
    rateLimitWindowMs: 15 * 60 * 1000,
    maxRequests: 200,
    sizeLimit: '10mb'
});

// Prepares the middleware stack
const buildMiddlewarePipeline = systemConfig => {
    const OriginVerifier = new originVerifier(systemConfig);
    const HeaderParser = new headerParser(systemConfig);

    return [
        express.json({ limit: systemConfig.api?.maxPayloadSize || '10mb' }),
        express.urlencoded({ extended: true }),
        cors({ origin: OriginVerifier.corsVerifier, credentials: true }),
        helmet(),
        hpp(),
        cookieParser(),
        // Custom middlewares
        serverUtilitiesMiddleware,
        requestMetadataMiddleware,
        serverStatusMiddlware,
        resourceAccessMiddleware,
        OriginVerifier.verifyOrigin,
        HeaderParser.verifyHeader,
        authenticationMiddleware,
        dipMiddleware,
        decryptionMiddleware,
        dataValidator,
        deviceCheckMiddlware
    ];
};

// Rate limiter middleware
const createRateLimiter = ({ rateLimitWindowMs, maxRequests }) =>
    rateLimit({
        windowMs: rateLimitWindowMs,
        max: maxRequests,
        message: 'Rate limit exceeded. Try again later.',
        legacyHeaders: false,
        standardHeaders: true
    });

// Register all endpoints (core + custom)
const registerRoutes = (app, routes, middlewares) => {
    routes.forEach(({ method, path, callback }) => {
        const routeMethod = method?.toLowerCase();

        if (typeof app[routeMethod] !== 'function') {
            logger.warn(`Unknown method '${method}' for route '${path}', skipping.`);
            return;
        }

        // Filter middlewares that apply to this path or apply to all routes
        let middlewaresToApply = [];

        if (middlewares && middlewares.length > 0) {
            middlewaresToApply = middlewares.filter(mw => {
                if (typeof mw === 'function') {
                    // Plain function middleware, apply to all by default
                    return true;
                } else if (typeof mw === 'object' && mw !== null) {
                    // Middleware object expected to have applyAll or pathsToApply
                    if ('applyAll' in mw && mw.applyAll === true) return true;
                    if (Array.isArray(mw.pathsToApply) && mw.pathsToApply.includes(path)) return true;
                    return false;
                } else {
                    logger.warn(`Middleware for route '${path}' is neither function nor expected object, skipping it.`);
                    return false;
                }
            });
        }

        // Extract callbacks from middleware objects or use the function itself
        const middlewareCallbacks = middlewaresToApply
            .map(mw => {
                if (typeof mw === 'function') return mw;
                if (typeof mw === 'object' && typeof mw.callback === 'function') return mw.callback;

                // Warn if middleware callback is missing or invalid
                logger.warn(`Middleware for route '${path}' does not have a valid callback function.`);
                return null;
            })
            .filter(Boolean); // Remove any nulls

        // Register route with filtered middlewares (if any), then callback
        if (middlewareCallbacks.length > 0) {
            app[routeMethod](
                `${globalAccessPoint.getValue('apiSlug') ? '/' + globalAccessPoint.getValue('apiSlug') : ''}${path}`,
                ...middlewareCallbacks,
                callback
            );
        } else {
            // No middleware to apply, just register the route with callback only
            app[routeMethod](`${globalAccessPoint.getValue('apiSlug') ? '/' + globalAccessPoint.getValue('apiSlug') : ''}${path}`, callback);
        }
    });
};

const initiateServer = async (startConfig = defaultStartConfig, systemConfig) => {
    try {
        const mergedConfig = { ...defaultStartConfig, ...startConfig, ...systemConfig };

        if (!mergedConfig?.app.serviceID) {
            mergedConfig.app.serviceID = crypto.randomUUID();
        }

        // Init DB
        const dbManager = new PersistantDatabaseManager(mergedConfig);

        // Init Volatile Secrets Manager
        const volatileSecretsManager = new VolatileSecretsManager(20, 32, true);

        // Init Refresh Rate Limiter
        const refreshRateLimiter = new RefreshRateLimiter(
            parseDuration(systemConfig.tokens.lifespans.refreshTokens),
            Math.floor(parseDuration(systemConfig.tokens.lifespans.refreshTokens) / parseDuration(systemConfig.tokens.lifespans.accessTokens)) + 3,
            parseDuration(systemConfig.tokens.lifespans.refreshTokens)
        );

        // Init OAuth systems
        const oAuthToolKit = new OAuthProviderToolkit(systemConfig.authMethods?.oAuth || {});
        await oAuthToolKit.initializeAllProviders();

        // Init Signature secrets manager
        const signatureSecretsManager = new SignatureSecretsManager(8, true);

        // Init Memory Handler system
        const memoryMonitioringSystem = new MemoryMonitoringSystem(false);
        memoryMonitioringSystem.start();

        globalAccessPoint.setValue('db', dbManager.db());
        globalAccessPoint.setValue('systemConfig', mergedConfig);

        globalAccessPoint.getValue('logger').configureFromGlobalAccessPoint();

        globalAccessPoint.setValue('volatileSecretsManager', volatileSecretsManager);
        globalAccessPoint.setValue('refreshRateLimiter', refreshRateLimiter);
        globalAccessPoint.setValue('oAuthToolKit', oAuthToolKit);
        globalAccessPoint.setValue('signatureSecretsManager', signatureSecretsManager);
        globalAccessPoint.setValue('memoryMonitioringSystem', memoryMonitioringSystem);

        globalAccessPoint.setValue('timeOfLife', getCurrentUnixTime());

        // Init Audit Trail System (Intialized later since it refernces system config via global access point)
        const auditTrailSystem = new AuditTrailSystem(systemConfig?.utilities?.auditTrailSystem?.enabled || false);
        globalAccessPoint.setValue('auditTrailSystem', auditTrailSystem);

        // Initialize audit trail system (creates database and tables if needed)
        await auditTrailSystem.initialize();

        globalAccessPoint.setValue('server', { lockdown: false });

        await handleOnStartConfiguration();

        const app = express();

        app.set('trust proxy', 1);

        // Apply rate limiter
        app.use(createRateLimiter(mergedConfig));

        // Apply middleware stack
        const middlewares = buildMiddlewarePipeline(mergedConfig);
        middlewares.forEach(mw => app.use(mw));

        // Register endpoints
        registerRoutes(app, defaultServerRoutes.endpoints);
        registerRoutes(app, mergedConfig?.api?.customEndpoints || [], mergedConfig?.api?.customMiddlewares || []);

        memoryMonitioringSystem.purgeSystemConfigPostSetup();

        logger.info(`✅ Service "${mergedConfig.app.appName || 'Unnamed'}" ready`);
        logger.info(`🆔 Service ID: ${mergedConfig.app.serviceID}`);
        logger.info(`🌐 Listening on port: ${mergedConfig.app.PORT || 'Not Set (dev?)'}`);

        return { app, dbManager, PORT: mergedConfig.app.PORT || 58944 };
    } catch (err) {
        console.error(err);
        logger.error(`💥 Server boot failure: ${err.message}`);
        throw new Error(`Server init error: ${err.message}`);
    }
};

export { initiateServer };
