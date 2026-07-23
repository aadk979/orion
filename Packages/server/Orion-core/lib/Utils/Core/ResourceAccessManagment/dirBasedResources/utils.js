import path from 'path';
import fs from 'fs';

const BASE_RESOURCE_DIR = 'orion-public-non-sensitives';

/**
 * Resolves a caller-supplied path inside the public resource directory.
 *
 * Containment is checked with path.relative rather than a string prefix. A bare
 * `startsWith(baseDir)` also accepts any SIBLING directory whose name merely
 * extends the base name — `orion-public-non-sensitives-backup/` satisfies a
 * prefix test against `orion-public-non-sensitives`. This surface is reachable
 * unauthenticated (the ORAS middleware runs ahead of origin verification and
 * authentication, and `public` is its default access type), so the check has to
 * be exact.
 *
 * @returns {string | { error: true, errorCode: string }} absolute path, or an error
 */
const getSafePath = filePath => {
    if (typeof filePath !== 'string' || filePath === '') {
        return { error: true, errorCode: 'GENERAL::PATH-TRAVERSAL::A::p' };
    }

    const baseDir = path.resolve(process.cwd(), BASE_RESOURCE_DIR);
    const resolvedPath = path.resolve(baseDir, filePath);

    // Empty  → the base directory itself; absolute or '..'-leading → outside it.
    const relative = path.relative(baseDir, resolvedPath);

    if (relative === '' || path.isAbsolute(relative) || relative.split(path.sep)[0] === '..') {
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
