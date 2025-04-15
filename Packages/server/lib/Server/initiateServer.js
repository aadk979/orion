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

const defaultStartConfig = {
  rateLimitWindowMs: 15 * 60 * 1000,
  maxRequests: 100,
  sizeLimit: "10mb",
  cors: {
    origin: (origin, callback) => {
      callback(null, true);
    },
    credentials: true
  }
};

const intitiateServer = async (startConfig = defaultStartConfig, systemConfig) => {
  try {
    const dbManager = new DatabaseManager(systemConfig);

    globalAccessPoint.setValue("db" , dbManager.db());
    globalAccessPoint.setValue("systemConfig" , systemConfig);

    const app = express();

    app.set("trust proxy", 1);
    
    const limiter = rateLimit({
      windowMs: startConfig.rateLimitWindowMs,
      max: startConfig.maxRequests,
      message: "Too many request from this IP, try again later!"
    });

    app.use(limiter);
    app.use(cookieParser());
    const OriginVerifier = new originVerifier(systemConfig);
    const HeaderParser = new headerParser(systemConfig);
    app.use(express.json({ limit: startConfig.sizeLimit }));
    app.use(express.urlencoded({ extended: true }));
    app.use(cors(startConfig.cors));
    app.use(helmet());
    app.use(OriginVerifier.verifyOrigin);
    app.use(HeaderParser.verifyHeader);
    app.use(HeaderParser.parseHeader);
    app.use(dataValidator)
    app.use(hpp());

    defaultServerRoutes.endpoints.forEach(element => {
      const { method, path, requireAuth, callback } = element;
      const middleware = requireAuth ? "auth" : "no";

      switch (method) {
        case "GET":
          app.get(path, callback);
          break;

        case "POST":
          app.post(path, callback);
          break;

        case "PUT":
          app.put(path, callback);
          break;

        case "DELETE":
          app.delete(path, callback);
          break;

        case "PATCH":
          app.patch(path, callback);
          break;

        default:
          logger.warn(`Unsupported method: ${method} for path: ${path}. This route was attempted to be created by orion not the client.`);
          break;
      }
    })

    systemConfig.api.customEndpoints.forEach(element => {
      const { method, path, requireAuth, callback } = element;
      const middleware = requireAuth ? "auth" : "no";

      switch (method) {
        case "GET":
          app.get(path, callback);
          break;

        case "POST":
          app.post(path, callback);
          break;

        case "PUT":
          app.put(path, callback);
          break;

        case "DELETE":
          app.delete(path, callback);
          break;

        case "PATCH":
          app.patch(path, callback);
          break;

        default:
          logger.warn(`Unsupported method: ${method} for path: ${path}`);
          break;
      }
    });

    logger.info(`Server configured for port: ${startConfig.PORT}`);
    logger.info(`Service: ${systemConfig.name || "unnamed"}`);
    logger.info(`Service ID: ${systemConfig.serviceID || "unidentified"}`);

    return { app , dbManager: dbManager };

  } catch (e) {
    logger.error(`Server initialization failed: ${e.message}`);
    throw new Error(`Server initialization failed: ${e.message}`);
  }
};

module.exports = { intitiateServer };