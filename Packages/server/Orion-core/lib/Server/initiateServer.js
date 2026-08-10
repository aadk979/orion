import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import hpp from 'hpp';
import cookieParser from 'cookie-parser';
import compression from 'compression';

import { logger } from '../Utils/logger.js';
import { originVerifier } from './Middleware/originVerifier.js';
import { headerParser } from './Middleware/headerParser.js';
import { PersistantDatabaseManager } from '../Utils/Databases/PersitantDatabases/index.js';
import { globalAccessPoint } from '../Utils/GlobalAccessPoint.js';
import { defaultServerRoutes } from './Endpoints/index.js';
import { buildSharedSignalsRouter } from '../Utils/Core/SharedSignals/router.js';
import { dataValidator } from './Middleware/dataValidator.js';
import { authenticationMiddleware } from './Middleware/authentication.js';
import { VolatileSecretsManager } from '../Utils/Systems/VolatileSecretsManager.js';
import { getCurrentUnixTime } from '../Utils/Date&Time.js';
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
import { DatabaseJanitor } from '../Utils/Systems/DatabaseJanitor.js';
import { LoadSheddingSystem } from '../Utils/Systems/LoadSheddingSystem.js';
import { abuseDetectionSystem } from '../Utils/Systems/AbuseDetectionSystem.js';
import { GracefulShutdownSystem } from '../Utils/Systems/GracefulShutdownSystem.js';
import { OrionSystemsControl } from '../Utils/SystemsControl.js';
import { loadSheddingMiddleware } from './Middleware/loadSheddingMiddleware.js';
import { abuseCheckMiddleware } from './Middleware/abuseCheckMiddleware.js';
import { SafeModuleHandler } from '../Utils/UnavailableModuleWrapper.js';
import { ClusterLinkSystem } from '../Utils/Systems/ClusterLinkSystem.js';
import { BatchMailerSystem } from '../Utils/Systems/BatchMailer/index.js';
import { DynamicGlobalRateLimiter } from '../Utils/Systems/DynamicGlobalRateLimiter.js';
import { rateLimitPolicy, validateRateLimitPolicy } from '../General/index.js';
import { validateCookiePolicy } from '../General/CookiePolicy.js';
import { buildGlobalFloodGuard } from './Middleware/globalFloodGuard.js';
import { buildStaticAssetServer } from './Middleware/staticAssets.js';

const loggerModule = new SafeModuleHandler('Logger', 'logger', 'initiateServer.js');

// Default config used if none provided
const defaultStartConfig = Object.freeze({
    sizeLimit: '10mb'
});

// Prepares the middleware stack
const buildMiddlewarePipeline = (systemConfig, rateLimiter) => {
    const OriginVerifier = new originVerifier(systemConfig);
    const HeaderParser = new headerParser(systemConfig);

    // Coarse flood breaker — mounted FIRST, ahead of body parsing, so egregious
    // per-IP floods are rejected before `express.json` ever allocates. This is
    // the pre-parse complement to the deeper policy-driven DynamicGlobalRateLimiter.
    const floodGuard = buildGlobalFloodGuard(systemConfig?.utilities?.rateLimiter?.floodGuard || {});

    // Plain static asset serving (opt-in). Sits after the flood guard but before
    // body parsing and the auth/header stack, so browser asset fetches (which
    // carry no orion-* headers) are served without traversing headerParser.
    // Returns null when disabled or the directory is absent.
    const staticServer = buildStaticAssetServer(systemConfig?.api?.static || {});

    // Shared Signals (SSF/CAEP) endpoints. Mounted here, ahead of the
    // orion-header stack, because peer services delivering Security Event
    // Tokens send none of the browser headers requestMetadataMiddleware
    // requires — they authenticate with the SET signature or the management
    // token instead. Null when the feature is off, so nothing is mounted.
    const sharedSignalsRouter = buildSharedSignalsRouter();

    return [
        floodGuard,
        ...(staticServer ? [staticServer] : []),
        ...(sharedSignalsRouter ? [sharedSignalsRouter] : []),
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
            app[routeMethod](`${globalAccessPoint.apiSlug() ? '/' + globalAccessPoint.apiSlug() : ''}${path}`, ...middlewareCallbacks, callback);
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

        const loadSheddingSystemInstance = new LoadSheddingSystem(systemConfig?.utilities?.loadShedding || {});
        globalAccessPoint.setValue('loadSheddingSystem', loadSheddingSystemInstance);

        const eventLoopMonitorInstance = new EventLoopMonitor(
            systemConfig?.utilities?.eventLoopMonitor?.enabled ?? true,
            systemConfig?.utilities?.eventLoopMonitor || {}
        );
        eventLoopMonitorInstance.start();
        globalAccessPoint.setValue('eventLoopMonitor', eventLoopMonitorInstance);

        // Init database janitor — global TTL sweep of expired tokens, devices,
        // and abandoned auth-flow rows. Advisory-locked so only one cluster
        // node sweeps per cycle.
        const databaseJanitor = new DatabaseJanitor(systemConfig?.utilities?.databaseJanitor || {});
        globalAccessPoint.setValue('databaseJanitor', databaseJanitor);
        databaseJanitor.start();

        // Init systems control and register in GAP for graceful shutdown access
        const orionSystemsControl = new OrionSystemsControl(systemConfig?.utilities?.safeMode ?? true);
        globalAccessPoint.setValue('orionSystemsControl', orionSystemsControl);

        // Init graceful shutdown — must be last so all systems are registered in GAP
        const gracefulShutdown = new GracefulShutdownSystem();
        gracefulShutdown.register();

        globalAccessPoint.setValue('server', { lockdown: false });

        await handleOnStartConfiguration();

        // Init cluster link — joins the Orion-Orchestrator control plane when
        // utilities.clusterLink.enabled is set. Runs after on-start configuration
        // so clusterMode and the secrets managers are already established. An
        // unreachable orchestrator only fails the boot when
        // clusterLink.requireOrchestrator is true; otherwise registration retries
        // in the background while the node serves normally.
        // Init the batch mailer BEFORE the cluster link: the link starts
        // accepting orchestrator commands the moment it registers, and
        // mailing:assign is one of them. Registering the mailer second would
        // leave a window where an assignment arrives and is refused by a node
        // that is in fact configured to send.
        const batchMailerSystem = new BatchMailerSystem(mergedConfig?.utilities?.batchMailer || {});
        globalAccessPoint.setValue('batchMailerSystem', batchMailerSystem);
        await batchMailerSystem.start();

        const clusterLinkSystem = new ClusterLinkSystem(mergedConfig?.utilities?.clusterLink || {});
        globalAccessPoint.setValue('clusterLinkSystem', clusterLinkSystem);
        await clusterLinkSystem.start();

        // Init rate limiter — policy is validated before the limiter is mounted so a
        // malformed cost table fails the boot rather than silently mis-throttling.
        validateRateLimitPolicy(rateLimitPolicy);

        // Fail boot on a malformed cookie policy rather than silently setting
        // insecure or non-clearing cookies at runtime.
        validateCookiePolicy();

        const rateLimiter = new DynamicGlobalRateLimiter({
            defaultTTL: systemConfig?.utilities?.rateLimiter?.defaultTTL ?? 300
        });

        const app = express();

        // Trusted-proxy configuration. This decides what `req.ip` resolves to, and
        // therefore what every IP-bound security control (token tiers, step-up
        // binding, password reset, device auth, rate limiting) is actually bound to.
        //
        // Defaults to `false` — trust nothing — so a directly-exposed deployment
        // cannot be fed a spoofed X-Forwarded-For. Operators behind a proxy MUST
        // declare it: a hop count (1 for a single reverse proxy) or a list of
        // trusted proxy IPs/CIDRs. Getting this wrong in the permissive direction
        // is what makes client IP forgeable, so it is opt-in rather than assumed.
        const trustProxy = mergedConfig?.server?.trustProxy ?? false;
        app.set('trust proxy', trustProxy);

        if (trustProxy === false) {
            logger.info('Trust proxy: disabled — client IP is the socket peer and X-Forwarded-For is ignored.');
            logger.warn('If this service sits behind a reverse proxy or load balancer, set server.trustProxy (e.g. 1) or every request will be attributed to the proxy IP.');
        } else {
            logger.info(`Trust proxy: ${JSON.stringify(trustProxy)} — client IP resolved from the forwarded chain up to the first untrusted hop.`);
        }

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
