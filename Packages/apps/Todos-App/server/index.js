import { initiateServer, logger } from '../../../server/Orion-core/index.js';
import { migrate } from './todos/TodosModel.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

    server.app.listen(configuration.app.port, () => {
        logger.info(`Todos API listening on port ${configuration.app.port}`);
    });
};

main().catch((err) => {
    console.error('Failed to start Todos server:', err);
    process.exit(1);
});
