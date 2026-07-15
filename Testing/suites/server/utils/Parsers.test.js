import '../../../helpers/bootstrap.js';
// logger.js must evaluate before GlobalAccessPoint.js: the two are circular and
// logger's module body calls globalAccessPoint at top level, so entering the cycle at
// GlobalAccessPoint leaves its binding in TDZ and the import throws.
import '../../../../Packages/server/Orion-core/lib/Utils/logger.js';
import test, { describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { slugParser } from '../../../../Packages/server/Orion-core/lib/Utils/Parsers.js';
import { globalAccessPoint } from '../../../../Packages/server/Orion-core/lib/Utils/GlobalAccessPoint.js';

describe('slugParser', () => {
    test('strips a configured leading slug from the path', () => {
        globalAccessPoint.setValue('apiSlug', 'gateway');
        assert.equal(slugParser('/gateway/alpine/api/v1/ping'), '/alpine/api/v1/ping');
        assert.equal(slugParser('/gateway'), '/');
    });

    test('leaves paths without the slug prefix untouched', () => {
        globalAccessPoint.setValue('apiSlug', 'gateway');
        assert.equal(slugParser('/alpine/api/v1/ping'), '/alpine/api/v1/ping');
        // must match the *segment* boundary, not a mere prefix
        assert.equal(slugParser('/gatewayX/thing'), '/gatewayX/thing');
    });

    test('empty slug is a no-op passthrough', () => {
        globalAccessPoint.setValue('apiSlug', '');
        const p = '/alpine/api/v1/ping';
        assert.equal(slugParser(p), p);
    });
});
