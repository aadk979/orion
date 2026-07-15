import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import hpp from 'hpp';
import cookieParser from 'cookie-parser';
import compression from "compression";

import { logger } from '../Utils/logger.js';
import { originVerifier } from './Middleware/originVerifier.js';
import { headerParser } from './Middleware/headerParser.js';
import { PersistantDatabaseManager } from '../Utils/Databases/PersitantDatabases/index.js';
import { globalAccessPoint } from '../Utils/GlobalAccessPoint.js';
import { defaultServerRoutes } from './Endpoints/index.js';
import { dataValidator } from './Middleware/dataValidator.js';
import { authenticationMiddleware } from './Middleware/authentication.js';
import { VolatileSecretsManager } from '../Utils/Systems/VolatileSecretsManager.js';
import { getCurrentUnixTime, parseDuration } from '../Utils/Date&Time.js';
import { OAuthProviderToolkit } from '../Utils/Core/OAuth/OrionOAuthToolKit.js';
import { deviceCheckMiddlware } from './Middleware/deviceScanner.js';
import { MemoryMonitoringSystem } from '../Utils/Systems/MemoryMonitoringSystem.js';
import { serverStatusMiddlware } from './Middleware/serverStatus.js';
import { handleOnStartConfiguration } from './onStartConfigurations.js';
import { requestMetadataMiddleware } from './Middleware/requestMetadata.js';
import { AuditTrailSystem } from '../Utils/Systems/AuditTrailSystem.js';
import { resourceAccessMiddleware } from './Middleware/resourceAccess.js';
import { serverUtilitiesMiddleware } from './Middleware/serverUtilities.js';
import { circuitBreakerSystem } from '../Utils/Systems/CircuitBreakerSystem.js';
import { EventLoopMonitor } from '../Utils/Systems/EventLoopMonitor.js';
import { LoadSheddingSystem } from '../Utils/Systems/LoadSheddingSystem.js';
import { abuseDetectionSystem } from '../Utils/Systems/AbuseDetectionSystem.js';
import { GracefulShutdownSystem } from '../Utils/Systems/GracefulShutdownSystem.js';
import { OrionSystemsControl } from '../Utils/SystemsControl.js';
import { loadSheddingMiddleware } from './Middleware/loadSheddingMiddleware.js';
import { abuseCheckMiddleware } from './Middleware/abuseCheckMiddleware.js';
import { SafeModuleHandler } from '../Utils/UnavailableModuleWrapper.js';
import { DynamicGlobalRateLimiter } from '../Utils/Systems/DynamicGlobalRateLimiter.js';
import { rateLimitPolicy, validateRateLimitPolicy } from '../General/index.js';

const loggerModule = new SafeModuleHandler('Logger', 'logger', 'initiateServer.js');


// Default config used if none provided
const defaultStartConfig = Object.freeze({
    sizeLimit: '10mb'
});

// Prepares the middleware stack
const buildMiddlewarePipeline = (systemConfig, rateLimiter) => {
    const OriginVerifier = new originVerifier(systemConfig);
    const HeaderParser = new headerParser(systemConfig);

    return [
        express.json({ limit: systemConfig.api?.maxPayloadSize || '10mb' }),
        express.urlencoded({ extended: true }),
        cors({ origin: OriginVerifier.corsVerifier, credentials: true }),
        helmet(),
        hpp(),
        cookieParser(),
        compression({ threshold: 1024 }),
        // Custom middlewares
        serverUtilitiesMiddleware,
        requestMetadataMiddleware,
        // Edge rate-limit pass — first point where the IP and fingerprint actors are
        // resolved, and ahead of every expensive downstream check.
        rateLimiter.middleware,
        serverStatusMiddlware,
        loadSheddingMiddleware,
        resourceAccessMiddleware,
        OriginVerifier.verifyOrigin,
        HeaderParser.verifyHeader,
        abuseCheckMiddleware,
        authenticationMiddleware,
        // Account rate-limit pass — authentication has now populated req.user, so the
        // account actor can be charged. No-ops for unauthenticated requests.
        rateLimiter.accountMiddleware,
        dataValidator,
        deviceCheckMiddlware
    ];
};

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
                `${globalAccessPoint.apiSlug() ? '/' + globalAccessPoint.apiSlug() : ''}${path}`,
                ...middlewareCallbacks,
                callback
            );
        } else {
            // No middleware to apply, just register the route with callback only
            app[routeMethod](`${globalAccessPoint.apiSlug() ? '/' + globalAccessPoint.apiSlug() : ''}${path}`, callback);
        }
    });
};

const initiateServer = async (startConfig = defaultStartConfig, systemConfig) => {
    try {
        const mergedConfig = { ...defaultStartConfig, ...startConfig, ...systemConfig };

        if (!mergedConfig?.app.serviceID) {
            mergedConfig.app.serviceID = crypto.randomUUID();
        }

        // Init DB — schema migration runs on pool connect
        const dbManager = new PersistantDatabaseManager(mergedConfig);
        await dbManager.db().ready();

        // Init Volatile Secrets Manager
        const volatileSecretsManager = new VolatileSecretsManager(20, 32, true);

        const oAuthToolKit = new OAuthProviderToolkit(systemConfig.authMethods?.OAuth || {});

        globalAccessPoint.setValue('oAuthToolKit', oAuthToolKit);
        await oAuthToolKit.initializeAllProviders();


        // Init Memory Handler system
        const memoryMonitioringSystem = new MemoryMonitoringSystem(false);
        memoryMonitioringSystem.start();

        globalAccessPoint.setValue('db', dbManager.db());
        globalAccessPoint.setValue('systemConfig', mergedConfig);

        loggerModule.getModule().configureFromGlobalAccessPoint();

        globalAccessPoint.setValue('volatileSecretsManager', volatileSecretsManager);
        globalAccessPoint.setValue('memoryMonitioringSystem', memoryMonitioringSystem);

        globalAccessPoint.setValue('timeOfLife', getCurrentUnixTime());

        // Init Audit Trail System (Intialized later since it refernces system config via global access point)
        const auditTrailSystem = new AuditTrailSystem(systemConfig?.utilities?.auditTrailSystem?.enabled || false);
        globalAccessPoint.setValue('auditTrailSystem', auditTrailSystem);

        // Initialize audit trail system (creates database and tables if needed)
        await auditTrailSystem.initialize();

        // Init circuit breaker, load shedder, abuse detection (singletons — already instantiated)
        globalAccessPoint.setValue('circuitBreakerSystem', circuitBreakerSystem);
        globalAccessPoint.setValue('abuseDetectionSystem', abuseDetectionSystem);

        const loadSheddingSystemInstance = new LoadSheddingSystem(
            systemConfig?.utilities?.loadShedding || {}
        );
        globalAccessPoint.setValue('loadSheddingSystem', loadSheddingSystemInstance);

        const eventLoopMonitorInstance = new EventLoopMonitor(
            systemConfig?.utilities?.eventLoopMonitor?.enabled ?? true,
            systemConfig?.utilities?.eventLoopMonitor || {}
        );
        eventLoopMonitorInstance.start();
        globalAccessPoint.setValue('eventLoopMonitor', eventLoopMonitorInstance);

        // Init systems control and register in GAP for graceful shutdown access
        const orionSystemsControl = new OrionSystemsControl(
            systemConfig?.utilities?.safeMode ?? true
        );
        globalAccessPoint.setValue('orionSystemsControl', orionSystemsControl);

        // Init graceful shutdown — must be last so all systems are registered in GAP
        const gracefulShutdown = new GracefulShutdownSystem();
        gracefulShutdown.register();

        globalAccessPoint.setValue('server', { lockdown: false });

        await handleOnStartConfiguration();

        // Init rate limiter — policy is validated before the limiter is mounted so a
        // malformed cost table fails the boot rather than silently mis-throttling.
        validateRateLimitPolicy(rateLimitPolicy);
        const rateLimiter = new DynamicGlobalRateLimiter({
            defaultTTL: systemConfig?.utilities?.rateLimiter?.defaultTTL ?? 300
        });

        const app = express();

        app.set('trust proxy', 1);

        // Apply middleware stack
        const middlewares = buildMiddlewarePipeline(mergedConfig, rateLimiter);
        middlewares.forEach(mw => app.use(mw));

        // Register endpoints
        registerRoutes(app, defaultServerRoutes.endpoints);
        registerRoutes(app, mergedConfig?.api?.customEndpoints || [], mergedConfig?.api?.customMiddlewares || []);

        memoryMonitioringSystem.purgeSystemConfigPostSetup();

        logger.info(`Service "${mergedConfig.app.appName || 'Unnamed'}" ready`);
        logger.info(`Service ID: ${mergedConfig.app.serviceID}`);
        logger.info(`Listening on port: ${mergedConfig.app.port || 'Not Set (dev?)'}`);

        return { app, dbManager, PORT: mergedConfig.app.port || 58944 };
    } catch (err) {
        console.error(err);
        logger.error(`💥 Server boot failure: ${err.message}`);
        throw new Error(`Server init error: ${err.message}`);
    }
};

export { initiateServer };