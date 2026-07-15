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
        if (!callerDir) return { error: true, errorCode: 'FILE-OPS::CALLER-DIRECTORY-NOT-FOUND::A::p' };

        const targetPath = path.resolve(callerDir, filename);
        await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });

        const formattedData = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

        await fs.promises.writeFile(targetPath, formattedData, 'utf8');

        return { error: false, path: targetPath };
    } catch (err) {
        if (err.code === 'EACCES') return { error: true, errorCode: 'FILE-OPS::PERMISSION-DENIED::A::p' };
        if (err.code === 'ENOENT') return { error: true, errorCode: 'FILE-OPS::DIRECTORY-NOT-FOUND::A::p' };
        return { error: true, errorCode: 'FILE-OPS::WRITE-FAILED::A::i' };
    }
}

async function readFromCaller(filename) {
    try {
        const callerDir = getCallerDirectory();
        if (!callerDir) return { error: true, errorCode: 'FILE-OPS::CALLER-DIRECTORY-NOT-FOUND::A::p' };

        const targetPath = path.resolve(callerDir, filename);
        const data = await fs.promises.readFile(targetPath, 'utf8');

        let parsed;
        let json = false;
        try {
            parsed = JSON.parse(data);
            json = true;
        } catch {
            parsed = data;
        }

        return { error: false, data: parsed, json };
    } catch (err) {
        if (err.code === 'ENOENT') return { error: true, errorCode: 'FILE-OPS::FILE-NOT-FOUND::A::p' };
        if (err.code === 'EACCES') return { error: true, errorCode: 'FILE-OPS::PERMISSION-DENIED::A::p' };
        return { error: true, errorCode: 'FILE-OPS::READ-FAILED::A::i' };
    }
}

async function removeFromCaller(filename) {
    try {
        const callerDir = getCallerDirectory();
        if (!callerDir) return { error: true, errorCode: 'FILE-OPS::CALLER-DIRECTORY-NOT-FOUND::A::p' };

        const targetPath = path.resolve(callerDir, filename);
        await fs.promises.access(targetPath, fs.constants.F_OK);
        await fs.promises.unlink(targetPath);

        return { error: false, path: targetPath };
    } catch (err) {
        if (err.code === 'ENOENT') return { error: true, errorCode: 'FILE-OPS::FILE-NOT-FOUND::A::p' };
        if (err.code === 'EACCES') return { error: true, errorCode: 'FILE-OPS::PERMISSION-DENIED::A::p' };
        if (err.code === 'EISDIR') return { error: true, errorCode: 'IS-DIRECTORY' };
        return { error: true, errorCode: 'DELETE-OPERATION-FAILED' };
    }
}

export { writeToCaller, readFromCaller, removeFromCaller };
