import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

function getCallerDirectory() {
    try {
        const callerDir = process.cwd();
        if (!callerDir) throw new Error('NO_CALLER_DIRECTORY');
        return callerDir;
    } catch (err) {
        logger.error('Failed to get caller directory:', err);
        return null;
    }
}

async function writeToCaller(filename, data) {
    try {
        const callerDir = getCallerDirectory();
        if (!callerDir) return { error: true, errorCode: 'CALLER-DIRECTORY-NOT-FOUND' };

        const targetPath = path.resolve(callerDir, filename);
        await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });

        const formattedData = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

        await fs.promises.writeFile(targetPath, formattedData, 'utf8');

        return { error: false, path: targetPath };
    } catch (err) {
        if (err.code === 'EACCES') return { error: true, errorCode: 'PERMISSION-DENIED' };
        if (err.code === 'ENOENT') return { error: true, errorCode: 'DIRECTORY-NOT-FOUND' };
        return { error: true, errorCode: 'WRITE-OPERATION-FAILED' };
    }
}

async function readFromCaller(filename) {
    try {
        const callerDir = getCallerDirectory();
        if (!callerDir) return { error: true, errorCode: 'CALLER-DIRECTORY-NOT-FOUND' };

        const targetPath = path.resolve(callerDir, filename);
        const data = await fs.promises.readFile(targetPath, 'utf8');

        let parsed;
        try {
            parsed = JSON.parse(data);
        } catch {
            parsed = data;
        }

        return { error: false, data: parsed };
    } catch (err) {
        if (err.code === 'ENOENT') return { error: true, errorCode: 'FILE-NOT-FOUND' };
        if (err.code === 'EACCES') return { error: true, errorCode: 'PERMISSION-DENIED' };
        return { error: true, errorCode: 'READ-OPERATION-FAILED' };
    }
}

export { writeToCaller, readFromCaller };
