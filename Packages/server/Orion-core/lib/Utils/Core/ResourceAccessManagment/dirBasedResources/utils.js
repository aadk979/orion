import path from 'path';
import fs from 'fs';

const BASE_RESOURCE_DIR = 'orion-public-non-sensitives';

const getSafePath = filePath => {
    const baseDir = path.join(process.cwd(), BASE_RESOURCE_DIR);
    const resolvedPath = path.resolve(baseDir, filePath);

    if (!resolvedPath.startsWith(baseDir)) {
        return { error: true, errorCode: 'GENERAL::PATH-TRAVERSAL::A::p' };
    }

    return resolvedPath;
};

const fileExists = filePath => {
    try {
        return fs.existsSync(filePath);
    } catch {
        return false;
    }
};

export { getSafePath, fileExists };
