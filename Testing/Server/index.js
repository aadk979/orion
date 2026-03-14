import { initiateServer, logger } from '../../Packages/server/Orion-core/index.js';
import { configuration } from './orion.config.js';
import fs from 'fs/promises';  // Use promises version
import path from 'path';

async function deleteOrionInternalFiles() {
    try {
        const currentDir = process.cwd();
        const files = await fs.readdir(currentDir);
        
        const filesToDelete = files.filter(file => file.startsWith('orion.internal'));
        
        if (filesToDelete.length === 0) {
            console.log('No files found starting with "orion.internal"');
            return;
        }
        
        console.log(`Found ${filesToDelete.length} file(s) to delete:`);
        filesToDelete.forEach(file => console.log(`- ${file}`));
        
        await Promise.all(filesToDelete.map(async (file) => {
            const filePath = path.join(currentDir, file);
            try {
                const stats = await fs.stat(filePath);
                if (stats.isDirectory()) {
                    await fs.rm(filePath, { recursive: true, force: true });
                    console.log(`Deleted directory: ${file}`);
                } else {
                    await fs.unlink(filePath);
                    console.log(`Deleted file: ${file}`);
                }
            } catch (err) {
                console.error(`Error deleting ${file}:`, err.message);
            }
        }));
        
        console.log('Cleanup completed!');
        
    } catch (err) {
        console.error('Error reading directory:', err.message);
    }
}

const main = async () => {
    try {
        console.clear();
        const server = await initiateServer(undefined, configuration);
        server.app.listen(configuration.app.PORT, () => {
            logger.info('Server is up and running');
        });

        // Handle exit signals properly
        const cleanup = async () => {
            console.log('\nCleaning up orion.internal files...');
            await deleteOrionInternalFiles();
            process.exit(0);
        };

        process.on('SIGTERM', cleanup);
        process.on('SIGINT', cleanup);
        
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
};

main();