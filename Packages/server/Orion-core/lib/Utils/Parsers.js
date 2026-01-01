import { globalAccessPoint } from './GlobalAccessPoint.js';

function slugParser(path) {
    const slug = globalAccessPoint.getValue('apiSlug');

    if (slug === '') {
        return path;
    }

    const slugPattern = new RegExp(`^/${slug}(/|$)`);
    if (slugPattern.test(path)) {
        return path.replace(slugPattern, '/');
    }

    return path;
}

export { slugParser };
