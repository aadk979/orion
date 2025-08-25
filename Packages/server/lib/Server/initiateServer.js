const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const hpp = require('hpp');
const cookieParser = require('cookie-parser');

const { logger } = require('../Utils/logger');
const { originVerifier } = require('./Middleware/originVerifier');
const { headerParser } = require('./Middleware/headerParser');
const { DatabaseManager } = require('../Utils/Databases');
const { globalAccessPoint } = require('../Utils/GlobalAccessPoint');
const { defaultServerRoutes } = require('./Endpoints');
const { dataValidator } = require('./Middleware/dataValidator');
const { authenticationMiddleware } = require('./Middleware/authentication');
const { decryptionMiddleware } = require('./Middleware/decryptor');
const { dipMiddleware } = require('./Middleware/dip');

// Default config used if none provided
const defaultStartConfig = Object.freeze({
  rateLimitWindowMs: 15 * 60 * 1000,
  maxRequests: 100,
  sizeLimit: '10mb',
  cors: {
    origin: (_, cb) => cb(null, true),
    credentials: true
  }
});

// Prepares the middleware stack
const buildMiddlewarePipeline = (systemConfig) => {
  const OriginVerifier = new originVerifier(systemConfig);
  const HeaderParser = new headerParser(systemConfig);

  return [
    express.json({ limit: systemConfig.api?.maxPayloadSize || '10mb' }),
    express.urlencoded({ extended: true }),
    cors(systemConfig.cors || defaultStartConfig.cors),
    helmet(),
    hpp(),
    cookieParser(),
    // Custom middlewares
    OriginVerifier.verifyOrigin,
    HeaderParser.verifyHeader,
    HeaderParser.parseHeader,
    authenticationMiddleware,
    dipMiddleware,
    decryptionMiddleware,
    dataValidator
  ];
};

// Rate limiter middleware
const createRateLimiter = ({ rateLimitWindowMs, maxRequests }) => rateLimit({
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
    const middlewareCallbacks = middlewaresToApply.map(mw => {
      if (typeof mw === 'function') return mw;
      if (typeof mw === 'object' && typeof mw.callback === 'function') return mw.callback;

      // Warn if middleware callback is missing or invalid
      logger.warn(`Middleware for route '${path}' does not have a valid callback function.`);
      return null;
    }).filter(Boolean); // Remove any nulls

    // Register route with filtered middlewares (if any), then callback
    if (middlewareCallbacks.length > 0) {
      app[routeMethod](path, ...middlewareCallbacks, callback);
    } else {
      // No middleware to apply, just register the route with callback only
      app[routeMethod](path, callback);
    }
  });
};


const intitiateServer = async (startConfig = defaultStartConfig, systemConfig) => {
  try {
    const mergedConfig = { ...defaultStartConfig, ...startConfig, ...systemConfig };

    // Init DB
    const dbManager = new DatabaseManager(mergedConfig);
    globalAccessPoint.setValue('db', dbManager.db());
    globalAccessPoint.setValue('systemConfig', mergedConfig);

    const app = express();
    app.set('trust proxy', 1);

    // Apply rate limiter
    app.use(createRateLimiter(mergedConfig));

    // Apply middleware stack
    const middlewares = buildMiddlewarePipeline(mergedConfig);
    middlewares.forEach(mw => app.use(mw));

    // Register endpoints
    registerRoutes(app, defaultServerRoutes.endpoints);
    registerRoutes(app, mergedConfig.api?.customEndpoints || [], mergedConfig.api?.customMiddlewares || []);

    // Logs
    logger.info(`✅ Service "${mergedConfig.name || 'Unnamed'}" ready`);
    logger.info(`🆔 Service ID: ${mergedConfig.serviceID || 'Unidentified'}`);
    logger.info(`🌐 Listening on port: ${mergedConfig.PORT || 'Not Set (dev?)'}`);

    return { app, dbManager };

  } catch (err) {
    logger.error(`💥 Server boot failure: ${err.message}`);
    throw new Error(`Server init error: ${err.message}`);
  }
};

module.exports = { intitiateServer };
