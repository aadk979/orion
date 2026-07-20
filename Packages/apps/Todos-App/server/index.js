import { initiateServer, logger } from '../../../server/Orion-core/index.js';
import { migrate } from './todos/TodosModel.js';
import fs from 'fs/promises';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Orion-core's auth cookies are always Secure + SameSite=None (correct for
// cross-origin auth), which browsers only accept over TLS — except for the
// localhost exception used in local dev. A real deployment needs real certs;
// if server.cert/server.key are present in this folder, serve HTTPS.
const loadTlsCredentials = async () => {
    try {
        const [cert, key] = await Promise.all([fs.readFile(path.join(__dirname, 'server.cert')), fs.readFile(path.join(__dirname, 'server.key'))]);
        return { cert, key };
    } catch {
        return null;
    }
};

const loadConfiguration = async () => {
    const localConfigPath = path.join(__dirname, 'gipsy.orion.config.js');

    try {
        await fs.access(localConfigPath);
    } catch {
        throw new Error(
            'Missing server/gipsy.orion.config.js — copy orion.config.example.js to gipsy.orion.config.js in the same folder and fill in real values.'
        );
    }

    const { configuration } = await import('./gipsy.orion.config.js');
    return configuration;
};

const main = async () => {
    const configuration = await loadConfiguration();

    const server = await initiateServer(undefined, configuration);
    await migrate();

    const tls = await loadTlsCredentials();

    if (tls) {
        https.createServer(tls, server.app).listen(configuration.app.port, () => {
            logger.info(`Todos API listening (HTTPS) on port ${configuration.app.port}`);
        });
    } else {
        server.app.listen(configuration.app.port, () => {
            logger.info(`Todos API listening (HTTP) on port ${configuration.app.port}`);
        });
    }
};

main().catch(err => {
    console.error('Failed to start Todos server:', err);
    process.exit(1);
});
