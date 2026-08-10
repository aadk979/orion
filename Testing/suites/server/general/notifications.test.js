// logger.js must be evaluated before GlobalAccessPoint.js (circular; see fileResponse.test.js).
import '../../../helpers/bootstrap.js';
import '../../../../Packages/server/Orion-core/lib/Utils/logger.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { globalAccessPoint } from '../../../../Packages/server/Orion-core/lib/Utils/GlobalAccessPoint.js';
import { NotificationModel, AUDIENCES, SEVERITIES } from '../../../../Packages/server/Orion-core/lib/Utils/Databases/models/NotificationModel.js';
import { routeHandlerAcknowledgeNotifications, routeHandlerGetNotifications } from '../../../../Packages/server/Orion-core/lib/Utils/Core/Notifications/NotificationService.js';

/**
 * The prompting DECISION lives in SQL (NotificationModel.evaluatePrompt) so it
 * cannot be influenced by a client clock. What is testable without Postgres is
 * the contract around it: what gets sent to the database, and what the route
 * layer accepts from a caller.
 */

const executed = [];

const fakeDatabase = {
    query: async (text, params = []) => {
        executed.push({ sql: text.replace(/\s+/g, ' ').trim(), params });

        if (/COUNT\(\*\) FILTER/.test(text)) {
            return { rows: [{ pending: '0', unread: '1', last_shown_at: 1, reprompt_due: true, next_prompt_at: 2 }], rowCount: 1 };
        }
        if (/^\s*SELECT n\.id/.test(text)) {
            return { rows: [], rowCount: 0 };
        }
        if (/RETURNING id/.test(text)) {
            return { rows: [{ id: '7' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
    }
};

globalAccessPoint.setValue('db', fakeDatabase);

const lastCall = () => executed[executed.length - 1];

/** Minimal express double capturing the JSON body a handler responds with. */
const createResponse = () => {
    const captured = { statusCode: 200, body: null, headers: {} };

    const response = {
        status(code) {
            captured.statusCode = code;
            return response;
        },
        json(body) {
            captured.body = body;
            return response;
        },
        // Orion's response helpers set headers before serializing.
        setHeader(name, value) {
            captured.headers[name] = value;
            return response;
        },
        header(name, value) {
            captured.headers[name] = value;
            return response;
        },
        captured
    };

    return response;
};

describe('NotificationModel — announce', () => {
    test('rejects an unknown audience rather than storing an undeliverable row', async () => {
        await assert.rejects(() => NotificationModel.announce({ audience: 'everyone', title: 't', body: 'b' }), /unknown audience/);
    });

    test('rejects an unknown severity', async () => {
        await assert.rejects(() => NotificationModel.announce({ severity: 'catastrophic', title: 't', body: 'b' }), /unknown severity/);
    });

    test('accepts every documented audience and severity', async () => {
        for (const audience of AUDIENCES) {
            for (const severity of SEVERITIES) {
                assert.equal(await NotificationModel.announce({ audience, severity, title: 't', body: 'b' }), 7);
            }
        }
    });

    test('a keyed announcement upserts, so a cluster raises one notice rather than one per node', async () => {
        await NotificationModel.announce({ notificationKey: 'system:test', audience: 'all', severity: 'urgent', title: 't', body: 'b' });

        const { sql } = lastCall();

        assert.match(sql, /ON CONFLICT \(notification_key\)/);
        // Refreshing must NOT reset receipts: five nodes restarting should not
        // re-prompt a user who already dismissed the notice.
        assert.doesNotMatch(sql, /orion_notification_receipts/);
    });
});

describe('NotificationModel — receipts', () => {
    test('materialization is a single statement scoped to one user', async () => {
        await NotificationModel.materializeFor('uid-1');

        const { sql, params } = lastCall();

        assert.match(sql, /INSERT INTO orion_notification_receipts/);
        assert.match(sql, /ON CONFLICT \(notification_id, user_uid\) DO NOTHING/);
        // Audience is evaluated here, against live state, rather than snapshotted
        // when the notification was announced.
        assert.match(sql, /totp-enrolled/);
        assert.deepEqual(params, ['uid-1']);
    });

    test('markShown / markViewed are no-ops for an empty id list', async () => {
        const before = executed.length;

        assert.equal(await NotificationModel.markShown('uid-1', []), 0);
        assert.equal(await NotificationModel.markViewed('uid-1', []), 0);

        assert.equal(executed.length, before, 'no query was issued');
    });

    test('markShown never resurrects an acknowledged notification', async () => {
        await NotificationModel.markShown('uid-1', [1, 2]);

        assert.match(lastCall().sql, /state <> 'viewed'/);
    });

    test('the prompt decision comes back from the database, not the caller', async () => {
        const decision = await NotificationModel.evaluatePrompt('uid-1');

        assert.match(lastCall().sql, /interval '24 hours'/);
        // The fake reports an unread item past its re-prompt window.
        assert.equal(decision.prompt, true);
        assert.equal(decision.unread, 1);
        assert.equal(decision.nextPromptAt, 2);
    });
});

describe('Notification routes', () => {
    test('acknowledging with no ids is refused', async () => {
        const response = createResponse();

        await routeHandlerAcknowledgeNotifications({ user: { uid: 'uid-1' }, body: { packet: { ids: [] } } }, response);

        assert.equal(response.captured.body.error, true);
    });

    test('ids from the client are coerced, filtered and bounded', async () => {
        const response = createResponse();

        await routeHandlerAcknowledgeNotifications(
            {
                user: { uid: 'uid-1' },
                // Junk a hostile or buggy client could send.
                body: { packet: { ids: ['3', -1, 0, 'abc', 4.5, null, ...Array.from({ length: 200 }, (_, i) => i + 100)] } }
            },
            response
        );

        const { params } = executed.filter(entry => /state = 'viewed'/.test(entry.sql)).pop();
        const ids = params[1];

        assert.ok(ids.every(id => Number.isInteger(id) && id > 0), 'only positive integers survive');
        assert.ok(ids.length <= 100, 'the list is bounded');
        assert.equal(ids[0], 3, 'valid string ids are coerced');
    });

    test('the list route reports the prompt decision to the client', async () => {
        const response = createResponse();

        await routeHandlerGetNotifications({ user: { uid: 'uid-1' } }, response);

        assert.equal(response.captured.body.error, false);
        assert.equal(response.captured.body.data.prompt, true);
        assert.deepEqual(response.captured.body.data.notifications, []);
    });
});
