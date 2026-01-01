import zxcvbn from 'zxcvbn';
import { logger } from './logger.js';
function isValidEmail(email) {
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return emailRegex.test(email);
}

function isPasswordSafe(password) {
    const result = zxcvbn(password);
    return result.score >= 3;
}

function isValidEmailDomain(validDomains, userEmail) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(userEmail)) {
        return false;
    }

    const emailDomain = userEmail.split('@')[1].toLowerCase();

    const normalizedValidDomains = validDomains.map(domain => domain.toLowerCase());

    return normalizedValidDomains.includes(emailDomain);
}

const validateClientUrls = arr => {
    if (!Array.isArray(arr)) {
        return [];
    }

    const seen = new Set();
    const validUrls = [];

    for (const item of arr) {
        if (typeof item !== 'string') {
            logger.warn(`Configuration error: refused to register client url ${item}!`);
            continue;
        }

        const url = item.trim();

        // Check protocol requirement
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            logger.warn(`Configuration error: refused to register client url ${url}!`);
            continue;
        }

        try {
            const urlObj = new URL(url);

            // Validate hostname exists and is a proper domain
            if (!urlObj.hostname || urlObj.hostname.includes(' ') || (urlObj.hostname !== 'localhost' && !urlObj.hostname.includes('.'))) {
                logger.warn(`Configuration error: refused to register client url ${url}!`);
                continue;
            }

            // Allow protocol + domain + port, but reject paths, queries, fragments, etc.
            const expectedUrl = urlObj.port ? `${urlObj.protocol}//${urlObj.hostname}:${urlObj.port}` : `${urlObj.protocol}//${urlObj.hostname}`;
            const expectedUrlWithSlash = `${expectedUrl}/`;

            if (url !== expectedUrl && url !== expectedUrlWithSlash) {
                logger.warn(`Configuration error: refused to register client url ${url}!`);
                continue;
            }

            // Normalize to lowercase for deduplication
            const normalizedUrl = expectedUrl.toLowerCase();

            if (!seen.has(normalizedUrl)) {
                seen.add(normalizedUrl);
                validUrls.push(expectedUrl);
            }
        } catch (error) {
            logger.warn(`Configuration error: refused to register client url ${url}!`);
            continue;
        }
    }

    return validUrls;
};

const packageExports = {
    isValidEmail,
    isPasswordSafe,
    isValidEmailDomain
};

export { isValidEmail, isPasswordSafe, isValidEmailDomain, validateClientUrls, packageExports };
