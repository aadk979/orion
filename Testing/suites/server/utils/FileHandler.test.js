import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    writeToCaller,
    readFromCaller,
    removeFromCaller
} from '../../../../Packages/server/Orion-core/lib/Utils/FileHandler.js';

// bootstrap.js chdir'd us into a per-process artifacts dir, so these operate
// on real (but throwaway) files under gipsy.test-artifacts/.

describe('writeToCaller / readFromCaller — JSON', () => {
    test('writes an object and reads it back parsed', async () => {
        const payload = { hello: 'world', n: 5, nested: { ok: true } };
        const write = await writeToCaller('fh-object.json', payload);
        assert.equal(write.error, false);

        const read = await readFromCaller('fh-object.json');
        assert.equal(read.error, false);
        assert.equal(read.json, true);
        assert.deepEqual(read.data, payload);
    });
});

describe('writeToCaller / readFromCaller — raw string', () => {
    test('writes a string and reads it back as non-JSON', async () => {
        await writeToCaller('fh-note.txt', 'just a plain note');
        const read = await readFromCaller('fh-note.txt');
        assert.equal(read.error, false);
        assert.equal(read.json, false);
        assert.equal(read.data, 'just a plain note');
    });

    test('creates nested directories as needed', async () => {
        const res = await writeToCaller('nested/deeper/file.json', { ok: 1 });
        assert.equal(res.error, false);
        const read = await readFromCaller('nested/deeper/file.json');
        assert.deepEqual(read.data, { ok: 1 });
    });
});

describe('readFromCaller — missing file', () => {
    test('returns FILE-NOT-FOUND for a nonexistent path', async () => {
        const read = await readFromCaller('does-not-exist-xyz.json');
        assert.equal(read.error, true);
        assert.equal(read.errorCode, 'FILE-OPS::FILE-NOT-FOUND::A::p');
    });
});

describe('removeFromCaller', () => {
    test('removes an existing file', async () => {
        await writeToCaller('to-delete.txt', 'bye');
        const del = await removeFromCaller('to-delete.txt');
        assert.equal(del.error, false);
        const read = await readFromCaller('to-delete.txt');
        assert.equal(read.errorCode, 'FILE-OPS::FILE-NOT-FOUND::A::p');
    });

    test('returns FILE-NOT-FOUND when removing a nonexistent file', async () => {
        const del = await removeFromCaller('never-existed.txt');
        assert.equal(del.error, true);
        assert.equal(del.errorCode, 'FILE-OPS::FILE-NOT-FOUND::A::p');
    });
});
