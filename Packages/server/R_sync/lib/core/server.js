import express from "express";
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import hpp from 'hpp';
import { logger } from '../utils/logger.js';
import { restrictToM2M } from './middleware/securityMiddleware.js';

const defaultStartConfig = Object.freeze({
    rateLimitWindowMs: 15 * 60 * 1000,
    maxRequests: 200,
    sizeLimit: '10mb'
});

const createServer = () => {
    const app = express();

    const trustProxyEnv = String(process.env.R_SYNC_TRUST_PROXY || '').toLowerCase();
    if (trustProxyEnv === '1' || trustProxyEnv === 'true') {
        app.set('trust proxy', 1);
    }

    // Body parsing
    app.use(express.json({ limit: defaultStartConfig.sizeLimit }));
    app.use(express.urlencoded({ extended: true, limit: defaultStartConfig.sizeLimit }));

    // Security middleware
    app.use(rateLimit({
        windowMs: defaultStartConfig.rateLimitWindowMs,
        max: defaultStartConfig.maxRequests,
        message: 'Rate limit exceeded. Try again later.',
        legacyHeaders: false,
        standardHeaders: true
    }));
    app.use(hpp());
    app.use(helmet());
    const corsOrigins = process.env.R_SYNC_CORS_ORIGIN;
    if (corsOrigins && corsOrigins.trim() !== '') {
        const list = corsOrigins.split(',').map((s) => s.trim()).filter(Boolean);
        app.use(cors({ origin: list.length === 1 ? list[0] : list }));
    }
    // No CORS middleware when unset — appropriate for default M2M (non-browser) clients

    // Request logging middleware
    app.use((req, res, next) => {
        logger.info(`${req.method} ${req.path}`);
        next();
    });

    // Enforce M2M only access
    app.use(restrictToM2M);

    return app;
};

const startServer = (app, port, role) => {
    return new Promise((resolve, reject) => {
        const server = app.listen(port, () => {
            logger.info(`R_Sync ${role} server running on port ${port}`);
            resolve(server);
        });

        server.on('error', (err) => {
            logger.error(`Failed to start server: ${err.message}`);
            reject(err);
        });
    });
};

export { createServer, startServer, defaultStartConfig };
