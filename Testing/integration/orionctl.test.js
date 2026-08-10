import test, { describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * orionctl — the system-admin CLI, exercised as a real subprocess against a
 * stub of the admin API.
 *
 * orionctl runs `main()` on import and keeps its session in ~/.orionctl.json,
 * so there is nothing importable to unit test. Spawning it is not a workaround
 * — it is the only way to cover what actually breaks in a CLI: argument
 * parsing, exit codes, what lands on stdout versus stderr, and whether a
 * destructive command can be driven from a shell one-liner.
 *
 * HOME and USERPROFILE are redirected to a temp directory (os.homedir() reads
 * USERPROFILE on Windows and HOME elsewhere), so the developer's real session
 * file is never read or written.
 *
 * The CLI's contract with the API is the point: it must send the same requests
 * the panel does, and it must not reimplement any server-side validation —
 * a second definition of "a valid sheet" or "an allowed command" is a second
 * thing to drift.
 */

const CLI = fileURLToPath(new URL('../../Packages/server/Orion-Orchestrator/bin/orionctl.js', import.meta.url));

let home;
let server;
let apiUrl;
/** Queue of [predicate, responder] consulted in order for each request. */
let routes;
let received;

const respond = (res, status, payload) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
};

before(async () => {
    home = mkdtempSync(join(tmpdir(), 'orionctl-'));

    server = createServer((req, res) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            const body = Buffer.concat(chunks);
            const entry = { method: req.method, url: req.url, headers: req.headers, body };
            received.push(entry);

            const route = routes.find(([match]) => match(req));
            if (!route) return respond(res, 404, { error: true, code: 'API::NOT-FOUND', message: 'Unknown endpoint' });
            route[1](res, entry);
        });
    });

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    apiUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (home && existsSync(home)) rmSync(home, { recursive: true, force: true });
});

beforeEach(() => {
    routes = [];
    received = [];
    writeConfig({ url: apiUrl, token: 'test-token' });
});

const configPath = () => join(home, '.orionctl.json');
const writeConfig = config => writeFileSync(configPath(), JSON.stringify(config));
const readConfig = () => JSON.parse(readFileSync(configPath(), 'utf-8'));

/**
 * Runs orionctl with an isolated HOME.
 *
 * `stdin` answers interactive prompts, fed one line at a time as each prompt
 * appears rather than all at once: orionctl creates a fresh readline interface
 * per prompt and closes it, and a closed interface discards whatever else was
 * buffered — so a single write would be swallowed by the first question. A
 * human typing one line per question never hits that; a pipe does.
 */
const run = (args, { stdin = '' } = {}) =>
    new Promise(resolve => {
        const child = spawn(process.execPath, [CLI, ...args], {
            env: { ...process.env, HOME: home, USERPROFILE: home },
            stdio: ['pipe', 'pipe', 'pipe']
        });

        const pending = stdin ? stdin.split('\n').filter(line => line !== '') : [];
        let stdout = '';
        let stderr = '';

        // Prompts are written without a trailing newline and end in ": ".
        // The pipe is closed once the last answer is written: readline pauses
        // stdin on close but does not unref it, so an open pipe would keep the
        // child alive after it had finished its work.
        const answerIfPrompted = () => {
            if (!/: $/.test(stdout)) return;
            if (pending.length === 0) return child.stdin.end();

            const line = pending.shift();
            if (pending.length === 0) child.stdin.end(`${line}\n`);
            else child.stdin.write(`${line}\n`);
        };

        child.stdout.on('data', d => {
            stdout += d;
            answerIfPrompted();
        });
        child.stderr.on('data', d => (stderr += d));
        if (pending.length === 0) child.stdin.end();

        child.on('close', code => resolve({ code, stdout, stderr, json: parseJson(stdout) }));
    });

/**
 * The printed result, ignoring any human-facing preamble.
 *
 * Most commands print nothing but `JSON.stringify(value, null, 2)`, but the
 * interactive ones (the keyvault wipe) print warnings and a prompt first — so
 * the result is the last top-level JSON document on stdout, not all of it.
 */
const parseJson = stdout => {
    // Scanning forward returns the OUTERMOST document: an inner `{` would parse
    // too, but only after the real opening brace has been tried and failed.
    // A prompt is written without a newline, so the result can begin partway
    // through a line ("...to proceed: {") — hence character offsets, not lines.
    for (let i = 0; i < stdout.length; i++) {
        if (stdout[i] !== '{' && stdout[i] !== '[') continue;
        try {
            return JSON.parse(stdout.slice(i).trim());
        } catch (_) {
            /* not the start of the result document */
        }
    }
    return null;
};

/** Registers a stub route. `path` may be an exact string or a RegExp. */
const route = (method, path, status, payload) => {
    routes.push([
        req => req.method === method && (path instanceof RegExp ? path.test(req.url) : req.url === path),
        res => respond(res, status, payload)
    ]);
};

describe('orionctl — help and dispatch', () => {
    test('bare invocation prints help and exits 0', async () => {
        const { code, stdout } = await run([]);

        assert.equal(code, 0);
        assert.match(stdout, /orionctl — Orion-Orchestrator system-admin CLI/);
    });

    test('help is reachable under all three spellings', async () => {
        for (const arg of [['help'], ['--help'], []]) {
            const { code, stdout } = await run(arg);
            assert.equal(code, 0);
            assert.match(stdout, /^orionctl —/);
        }
    });

    test('help documents every top-level command the dispatcher accepts', async () => {
        const { stdout } = await run(['help']);

        // A command that exists but is undocumented may as well not exist.
        for (const command of [
            'login',
            'logout',
            'whoami',
            'status',
            'health',
            'nodes',
            'cmd',
            'cmd-all',
            'lock',
            'unlock',
            'incident',
            'consensus',
            'client-urls',
            'secrets',
            'keyvault',
            'mailing',
            'notifications',
            'audit',
            'admins',
            'policies',
            'groups'
        ]) {
            assert.match(stdout, new RegExp(`\\b${command}\\b`), `${command} is not documented in help`);
        }
    });

    test('an unknown command exits non-zero and points at help', async () => {
        const { code, stderr } = await run(['not-a-command']);

        assert.equal(code, 1);
        assert.match(stderr, /unknown command "not-a-command" — run: orionctl help/);
    });

    test('help needs no configured URL, so a first run is never a dead end', async () => {
        writeConfig({});

        const { code, stdout } = await run(['help']);

        assert.equal(code, 0);
        assert.match(stdout, /^orionctl —/);
    });

    test('a command with no configured URL explains how to set one', async () => {
        writeConfig({});

        const { code, stderr } = await run(['status']);

        assert.equal(code, 1);
        assert.match(stderr, /no orchestrator URL configured — run: orionctl login <email> --url/);
    });

    test('a corrupt config file is treated as empty rather than crashing', async () => {
        writeFileSync(configPath(), 'not json at all');

        const { code, stderr } = await run(['status']);

        assert.equal(code, 1);
        assert.match(stderr, /no orchestrator URL configured/);
    });
});

describe('orionctl — the API client', () => {
    test('a read sends the bearer token and unwraps the named field', async () => {
        route('GET', '/api/cluster/status', 200, { error: false, status: { cluster: 'prod', nodes: 2 } });

        const { code, json } = await run(['status']);

        assert.equal(code, 0);
        assert.deepEqual(json, { cluster: 'prod', nodes: 2 });
        assert.equal(received[0].headers.authorization, 'Bearer test-token');
    });

    test('each read unwraps its own envelope key', async () => {
        const cases = [
            [['health'], '/api/cluster/health', { health: { state: 'HEALTHY' } }, { state: 'HEALTHY' }],
            [['nodes'], '/api/cluster/nodes', { nodes: [{ workerId: 'W1' }] }, [{ workerId: 'W1' }]],
            [['policy-rules'], '/api/cluster/policy-rules', { rules: ['r1'] }, ['r1']],
            [['node', 'W1'], '/api/cluster/nodes/W1', { node: { workerId: 'W1' } }, { workerId: 'W1' }]
        ];

        for (const [args, path, payload, expected] of cases) {
            routes = [];
            received = [];
            route('GET', path, 200, { error: false, ...payload });

            const { json } = await run(args);
            assert.deepEqual(json, expected, `${args.join(' ')} unwrapped the wrong key`);
        }
    });

    test('an API error becomes a non-zero exit with the server code and message on stderr', async () => {
        route('GET', '/api/cluster/status', 403, { error: true, code: 'PBAC::DENIED', message: 'Policy denies "cluster:read:status"' });

        const { code, stdout, stderr } = await run(['status']);

        assert.equal(code, 1);
        assert.equal(stdout, '', 'an error must not also print a result to stdout');
        assert.match(stderr, /PBAC::DENIED: Policy denies "cluster:read:status"/);
    });

    test('a 401 tells the operator to sign in again rather than just failing', async () => {
        route('GET', '/api/cluster/status', 401, { error: true, code: 'AUTH::NO-SESSION', message: 'Authentication required' });

        const { code, stderr } = await run(['status']);

        assert.equal(code, 1);
        assert.match(stderr, /session may have expired; run: orionctl login/);
    });

    test('an envelope with error:true is a failure even on HTTP 200', async () => {
        route('GET', '/api/cluster/status', 200, { error: true, code: 'API::INTERNAL', message: 'Internal error' });

        const { code, stderr } = await run(['status']);

        assert.equal(code, 1);
        assert.match(stderr, /API::INTERNAL/);
    });

    test('a non-JSON error body still produces a usable message', async () => {
        routes.push([
            req => req.url === '/api/cluster/status',
            res => {
                res.writeHead(502, { 'content-type': 'text/html' });
                res.end('<html>bad gateway</html>');
            }
        ]);

        const { code, stderr } = await run(['status']);

        assert.equal(code, 1);
        assert.match(stderr, /HTTP-502/);
    });

    test('an unreachable orchestrator is reported as unreachable, not as a crash', async () => {
        writeConfig({ url: 'http://127.0.0.1:1', token: 't' });

        const { code, stderr } = await run(['status']);

        assert.equal(code, 1);
        assert.match(stderr, /cannot reach http:\/\/127\.0\.0\.1:1/);
        assert.doesNotMatch(stderr, /at Object|at async/, 'a stack trace is not a diagnosis');
    });

    test('a trailing slash on the configured URL does not produce a double slash', async () => {
        writeConfig({ url: `${apiUrl}/`, token: 't' });
        route('GET', '/api/cluster/nodes', 200, { error: false, nodes: [] });

        const { code } = await run(['nodes']);

        assert.equal(code, 0);
        assert.equal(received[0].url, '/api/cluster/nodes');
    });
});

describe('orionctl — argument and flag parsing', () => {
    test('--limit rides the query string with a documented default', async () => {
        route('GET', /^\/api\/cluster\/escalations/, 200, { error: false, escalations: [] });
        await run(['escalations', '--limit', '5']);
        assert.equal(received[0].url, '/api/cluster/escalations?limit=5');

        received = [];
        route('GET', /^\/api\/cluster\/escalations/, 200, { error: false, escalations: [] });
        await run(['escalations']);
        assert.equal(received[0].url, '/api/cluster/escalations?limit=50');
    });

    test('a non-numeric limit falls back to the default rather than corrupting the query', async () => {
        route('GET', /^\/api\/cluster\/command-log/, 200, { error: false, commandLog: [] });

        await run(['command-log', '--limit', 'abc']);

        assert.equal(received[0].url, '/api/cluster/command-log?limit=50');
    });

    test('--args parses JSON and is forwarded verbatim', async () => {
        route('POST', '/api/cluster/nodes/W1/command', 200, { error: false, outcome: { ok: true } });

        const { code, json } = await run(['cmd', 'W1', 'server:lock', '--args', '{"grace":30}']);

        assert.equal(code, 0);
        assert.deepEqual(json, { ok: true });
        assert.deepEqual(JSON.parse(received[0].body), { action: 'server:lock', args: { grace: 30 } });
    });

    test('malformed --args is rejected before any request is made', async () => {
        const { code, stderr } = await run(['cmd', 'W1', 'server:lock', '--args', '{not json']);

        assert.equal(code, 1);
        assert.match(stderr, /--args must be valid JSON/);
        assert.equal(received.length, 0, 'a malformed flag must not reach the API');
    });

    test('an omitted --args sends an empty object, not undefined', async () => {
        route('POST', '/api/cluster/command-all', 200, { error: false, results: [] });

        await run(['cmd-all', 'server:lock']);

        assert.deepEqual(JSON.parse(received[0].body), { action: 'server:lock', args: {} });
    });

    test('a valueless flag is parsed as a boolean', async () => {
        route('GET', /^\/api\/notifications/, 200, { error: false, notifications: [], unread: 0 });

        await run(['notifications', '--unread']);

        assert.equal(received[0].url, '/api/notifications?unread=true');
    });

    test('a worker id with URL-hostile characters is encoded', async () => {
        route('GET', /^\/api\/cluster\/nodes\//, 200, { error: false, node: {} });

        await run(['node', 'worker/one?x=1']);

        assert.equal(received[0].url, '/api/cluster/nodes/worker%2Fone%3Fx%3D1');
    });

    test('missing required positionals produce a usage line, not a stack', async () => {
        const usages = [
            [['cmd', 'W1'], /usage: orionctl cmd <workerId> <action>/],
            [['cmd-all'], /usage: orionctl cmd-all <action>/],
            [['node'], /usage: orionctl node <workerId>/],
            [['consensus'], /usage: orionctl consensus <topic>/],
            [['client-urls'], /usage: orionctl client-urls/],
            [['incident'], /usage: orionctl incident <declare\|resolve>/],
            [['incident', 'maybe'], /usage: orionctl incident <declare\|resolve>/],
            [['secrets'], /usage: orionctl secrets <keys\|revoke\|rotate-node>/],
            [['secrets', 'revoke'], /usage: orionctl secrets revoke/],
            [['keyvault'], /usage: orionctl keyvault <status\|check/],
            [['mailing'], /usage: orionctl mailing <submit\|list/],
            [['mailing', 'submit'], /usage: orionctl mailing submit/],
            [['admins'], /usage: orionctl admins <list\|create/],
            [['admins', 'create'], /usage: orionctl admins create <email>/],
            [['policies'], /usage: orionctl policies <list\|attachments/],
            [['groups'], /usage: orionctl groups <list\|create/],
            [['groups', 'create'], /usage: orionctl groups create <name>/]
        ];

        for (const [args, expected] of usages) {
            const { code, stderr } = await run(args);
            assert.equal(code, 1, `${args.join(' ')} should exit 1`);
            assert.match(stderr, expected, `${args.join(' ')} printed the wrong usage`);
        }
    });
});

describe('orionctl — cluster operations', () => {
    test('client-urls splits a comma list and drops empties', async () => {
        route('POST', '/api/cluster/client-urls', 200, { error: false, results: [] });

        await run(['client-urls', 'https://a.example,,https://b.example']);

        assert.deepEqual(JSON.parse(received[0].body), { clientUrls: ['https://a.example', 'https://b.example'] });
    });

    test('secrets revoke splits and trims the kid list', async () => {
        route('POST', '/api/cluster/secrets/revoke', 200, { error: false, results: [] });

        await run(['secrets', 'revoke', ' k1 , k2 ,, k3 ']);

        assert.deepEqual(JSON.parse(received[0].body), { kids: ['k1', 'k2', 'k3'] });
    });

    test('an unknown command is left for the server to reject, not filtered locally', async () => {
        route('POST', '/api/cluster/nodes/W1/command', 400, { error: true, code: 'CLUSTER::UNKNOWN-COMMAND', message: '"bogus" is not allowlisted' });

        const { code, stderr } = await run(['cmd', 'W1', 'bogus']);

        // One definition of the allowlist, on the server. A client-side copy
        // would drift and would not be the one that is enforced anyway.
        assert.equal(code, 1);
        assert.match(stderr, /CLUSTER::UNKNOWN-COMMAND/);
        assert.equal(received.length, 1, 'the request must still be attempted');
    });

    test('incident declare and resolve hit their own endpoints', async () => {
        route('POST', /^\/api\/cluster\/incident\//, 200, { error: false, health: { state: 'INCIDENT' } });

        await run(['incident', 'declare', '--reason', 'region outage']);

        assert.equal(received[0].url, '/api/cluster/incident/declare');
        assert.deepEqual(JSON.parse(received[0].body), { reason: 'region outage' });
    });
});

describe('orionctl — the keyvault wipe', () => {
    test('a reason shorter than ten characters is refused locally', async () => {
        for (const args of [['keyvault', 'wipe'], ['keyvault', 'wipe', '--reason', 'short']]) {
            const { code, stderr } = await run(args);

            assert.equal(code, 1);
            assert.match(stderr, /the reason is recorded in the audit trail/);
            assert.equal(received.length, 0, 'nothing may be sent without a reason');
        }
    });

    test('the confirmation phrase is typed interactively, never accepted as a flag', async () => {
        const { code, stderr } = await run(['keyvault', 'wipe', '--reason', 'vault destroyed in outage', '--confirmation', 'WIPE ENCRYPTED FIELDS'], {
            stdin: 'no\n'
        });

        // A destructive, irreversible command must not be something a shell
        // history or a copied one-liner can repeat.
        assert.equal(code, 1);
        assert.match(stderr, /confirmation phrase did not match — nothing was changed/);
        assert.equal(received.length, 0);
    });

    test('a mistyped phrase aborts without contacting the API', async () => {
        // Case, truncation and a casual "yes" all fail — the phrase is compared
        // exactly, so none of them can stand in for deliberate confirmation.
        for (const typed of ['wipe encrypted fields', 'WIPE ENCRYPTED FIELD', 'WIPE ENCRYPTED FIELDS X', 'yes']) {
            received = [];
            const { code, stderr } = await run(['keyvault', 'wipe', '--reason', 'vault destroyed in outage'], { stdin: `${typed}\n` });

            assert.equal(code, 1, `accepted "${typed}"`);
            assert.match(stderr, /nothing was changed/);
            assert.equal(received.length, 0);
        }
    });

    test('an aborted prompt (EOF, no input) destroys nothing', async () => {
        // Ctrl-D or a closed pipe at the confirmation prompt.
        const { code } = await run(['keyvault', 'wipe', '--reason', 'vault destroyed in outage']);

        assert.notEqual(code, null);
        assert.equal(received.length, 0, 'an unanswered prompt must never proceed to the wipe');
    });

    test('the exact phrase proceeds and sends every flag the operator set', async () => {
        route('POST', '/api/cluster/keyvault/wipe', 200, { error: false, result: { workerId: 'W1' } });

        const { code, json } = await run(
            [
                'keyvault',
                'wipe',
                '--reason',
                'vault destroyed in region outage',
                '--fields',
                'totp_secret, recovery_codes',
                '--admins',
                '--include-root',
                '--override-consensus'
            ],
            { stdin: 'WIPE ENCRYPTED FIELDS\n' }
        );

        assert.equal(code, 0);
        assert.deepEqual(json, { workerId: 'W1' });
        assert.deepEqual(JSON.parse(received[0].body), {
            confirmation: 'WIPE ENCRYPTED FIELDS',
            reason: 'vault destroyed in region outage',
            fields: ['totp_secret', 'recovery_codes'],
            includeAdmins: true,
            includeRootAdmin: true,
            overrideConsensus: true
        });
    });

    test('the destructive flags default to false rather than being omitted', async () => {
        route('POST', '/api/cluster/keyvault/wipe', 200, { error: false, result: {} });

        await run(['keyvault', 'wipe', '--reason', 'vault destroyed in outage'], { stdin: 'WIPE ENCRYPTED FIELDS\n' });

        const body = JSON.parse(received[0].body);
        assert.deepEqual([body.includeAdmins, body.includeRootAdmin, body.overrideConsensus, body.fields], [false, false, false, null]);
    });

    test('the operator is warned about irreversibility before the prompt', async () => {
        const { stdout } = await run(['keyvault', 'wipe', '--reason', 'vault destroyed in outage'], { stdin: 'no\n' });

        assert.match(stdout, /DESTROYS encrypted field data/);
        assert.match(stdout, /loses their authenticator enrollment/);
        assert.match(stdout, /cannot be undone/);
    });

    test('a server-side consensus refusal is surfaced with its code', async () => {
        route('POST', '/api/cluster/keyvault/wipe', 409, {
            error: true,
            code: 'KEYVAULT::CONSENSUS-REFUSED',
            message: '2 of 3 node(s) can still decrypt'
        });

        const { code, stderr } = await run(['keyvault', 'wipe', '--reason', 'vault destroyed in outage'], { stdin: 'WIPE ENCRYPTED FIELDS\n' });

        assert.equal(code, 1);
        assert.match(stderr, /KEYVAULT::CONSENSUS-REFUSED: 2 of 3 node\(s\) can still decrypt/);
    });

    test('keyvault rotate-dek maps --batch and --no-reencrypt', async () => {
        route('POST', '/api/cluster/keyvault/rotate-dek', 200, { error: false, result: {} });

        await run(['keyvault', 'rotate-dek', '--node', 'W2', '--batch', '500', '--no-reencrypt']);

        assert.deepEqual(JSON.parse(received[0].body), { workerId: 'W2', batchSize: 500, reencrypt: false });
    });

    test('keyvault rotate-dek re-encrypts by default', async () => {
        route('POST', '/api/cluster/keyvault/rotate-dek', 200, { error: false, result: {} });

        await run(['keyvault', 'rotate-dek']);

        assert.deepEqual(JSON.parse(received[0].body), { workerId: null, batchSize: null, reencrypt: true });
    });
});

describe('orionctl — batch mailing', () => {
    test('a sheet is uploaded as a raw body with the filename on the query string', async () => {
        const file = join(home, 'blast.xlsx');
        writeFileSync(file, 'PKfake-xlsx-bytes');
        route('POST', /^\/api\/mailing\/jobs/, 201, { error: false, job: { id: 'JOB_1' }, plan: { totalRecipients: 12 } });

        const { code, json } = await run(['mailing', 'submit', file]);

        assert.equal(code, 0);
        assert.equal(json.job.id, 'JOB_1');
        assert.match(received[0].url, /\?filename=blast\.xlsx$/);
        assert.equal(received[0].headers['content-type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        assert.equal(received[0].body.toString(), 'PKfake-xlsx-bytes');
    });

    test('a .csv is uploaded with the csv content type', async () => {
        const file = join(home, 'list.CSV');
        writeFileSync(file, 'recipient,subject,content\na@b.c,hi,there');
        route('POST', /^\/api\/mailing\/jobs/, 201, { error: false, job: {} });

        await run(['mailing', 'submit', file]);

        assert.equal(received[0].headers['content-type'], 'text/csv');
    });

    test('a missing file is caught before any upload is attempted', async () => {
        const { code, stderr } = await run(['mailing', 'submit', join(home, 'nope.xlsx')]);

        assert.equal(code, 1);
        assert.match(stderr, /no such file/);
        assert.equal(received.length, 0);
    });

    test('every sheet validation problem is printed, not just the first', async () => {
        const file = join(home, 'bad.csv');
        writeFileSync(file, 'wrong,columns');
        route('POST', /^\/api\/mailing\/jobs/, 400, {
            error: true,
            code: 'MAILING::SHEET-INVALID',
            message: 'The sheet could not be accepted',
            details: ['row 2: recipient is not an email', 'row 5: subject is empty', 'missing column: content']
        });

        const { code, stderr } = await run(['mailing', 'submit', file]);

        // An operator fixing a sheet one error per upload is an operator
        // uploading ten times.
        assert.equal(code, 1);
        assert.match(stderr, /row 2: recipient is not an email/);
        assert.match(stderr, /row 5: subject is empty/);
        assert.match(stderr, /missing column: content/);
    });

    test('the CLI never parses the sheet itself', async () => {
        const file = join(home, 'garbage.xlsx');
        writeFileSync(file, 'this is definitely not a spreadsheet');
        route('POST', /^\/api\/mailing\/jobs/, 400, { error: true, code: 'MAILING::UNREADABLE', message: 'not a spreadsheet' });

        await run(['mailing', 'submit', file]);

        // "What a valid sheet looks like" must have one definition, on the
        // server — so even obvious garbage is uploaded rather than pre-judged.
        assert.equal(received.length, 1);
        assert.equal(received[0].body.toString(), 'this is definitely not a spreadsheet');
    });

    test('mailing list builds its query from the flags supplied', async () => {
        route('GET', /^\/api\/mailing\/jobs/, 200, { error: false, jobs: [] });

        await run(['mailing', 'list', '--status', 'running', '--limit', '5']);

        assert.equal(received[0].url, '/api/mailing/jobs?status=running&limit=5');
    });

    test('mailing list with no flags sends no query string', async () => {
        route('GET', '/api/mailing/jobs', 200, { error: false, jobs: [] });

        await run(['mailing', 'list']);

        assert.equal(received[0].url, '/api/mailing/jobs');
    });

    test('a cancel sends a null reason rather than omitting the field', async () => {
        route('POST', /cancel$/, 200, { error: false, cancelled: 3 });

        await run(['mailing', 'cancel', 'JOB_1']);

        assert.deepEqual(JSON.parse(received[0].body), { reason: null });
    });
});

describe('orionctl — governance', () => {
    test('policies create requires both a name and a document file', async () => {
        const { code, stderr } = await run(['policies', 'create', '--name', 'read-only']);

        assert.equal(code, 1);
        assert.match(stderr, /usage: orionctl policies create --name NAME --file doc\.json/);
        assert.equal(received.length, 0);
    });

    test('a policy document is read from disk and sent as JSON', async () => {
        const document = { version: 1, statements: [{ sid: 'ro', effect: 'allow', actions: ['cluster:read:*'], resources: ['*'] }] };
        const file = join(home, 'policy.json');
        writeFileSync(file, JSON.stringify(document));
        route('POST', '/api/policies', 201, { error: false, policy: { id: 'POL_1' } });

        const { code, json } = await run(['policies', 'create', '--name', 'read-only', '--file', file, '--description', 'safe reads']);

        assert.equal(code, 0);
        assert.deepEqual(json, { id: 'POL_1' });
        assert.deepEqual(JSON.parse(received[0].body), { name: 'read-only', description: 'safe reads', document });
    });

    test('an unreadable or malformed policy document fails before the request', async () => {
        const bad = join(home, 'bad-policy.json');
        writeFileSync(bad, '{ not json');

        const missing = await run(['policies', 'create', '--name', 'x', '--file', join(home, 'absent.json')]);
        assert.equal(missing.code, 1);
        assert.match(missing.stderr, /cannot read policy document/);

        const malformed = await run(['policies', 'create', '--name', 'x', '--file', bad]);
        assert.equal(malformed.code, 1);
        assert.match(malformed.stderr, /cannot read policy document/);
        assert.equal(received.length, 0);
    });

    test('attach and detach require a principal', async () => {
        for (const sub of ['attach', 'detach']) {
            const { code, stderr } = await run(['policies', sub, 'POL_1']);

            assert.equal(code, 1);
            assert.match(stderr, /pass --admin <adminId> or --group <groupId>/);
        }
    });

    test('--admin and --group map to the principal type the API expects', async () => {
        route('POST', /attach$/, 200, { error: false, attached: true });
        await run(['policies', 'attach', 'POL_1', '--admin', 'SAD_1']);
        assert.deepEqual(JSON.parse(received[0].body), { principalType: 'admin', principalId: 'SAD_1' });

        received = [];
        route('POST', /attach$/, 200, { error: false, attached: true });
        await run(['policies', 'attach', 'POL_1', '--group', 'GRP_1']);
        assert.deepEqual(JSON.parse(received[0].body), { principalType: 'group', principalId: 'GRP_1' });
    });

    test('admins suspend and activate differ only in the status they send', async () => {
        route('POST', /status$/, 200, { error: false, admin: {} });
        await run(['admins', 'suspend', 'SAD_1']);
        assert.deepEqual(JSON.parse(received[0].body), { status: 'suspended' });

        received = [];
        route('POST', /status$/, 200, { error: false, admin: {} });
        await run(['admins', 'activate', 'SAD_1']);
        assert.deepEqual(JSON.parse(received[0].body), { status: 'active' });
    });

    test('admins create forwards the optional policy and group grants', async () => {
        route('POST', '/api/admins', 201, { error: false, admin: { id: 'SAD_2' } });

        await run(['admins', 'create', 'new@orion.local', '--name', 'Grace', '--policy', 'POL_1', '--group', 'GRP_1']);

        assert.deepEqual(JSON.parse(received[0].body), {
            email: 'new@orion.local',
            displayName: 'Grace',
            policyId: 'POL_1',
            groupId: 'GRP_1'
        });
    });

    test('governance denials from a non-root session are surfaced verbatim', async () => {
        route('GET', '/api/admins', 403, { error: true, code: 'GOV::ROOT-ONLY', message: 'Only the root admin can perform governance actions' });

        const { code, stderr } = await run(['admins', 'list']);

        assert.equal(code, 1);
        assert.match(stderr, /GOV::ROOT-ONLY: Only the root admin/);
    });

    test('audit verify is routed to its own endpoint, not treated as a filter', async () => {
        route('GET', '/api/audit/verify', 200, { error: false, intact: true, rows: 42 });

        const { code, json } = await run(['audit', 'verify']);

        assert.equal(code, 0);
        assert.equal(json.intact, true);
    });

    test('audit filters are composed into one query string', async () => {
        route('GET', /^\/api\/audit/, 200, { error: false, audit: [] });

        await run(['audit', '--limit', '10', '--action', 'governance', '--admin', 'SAD_1']);

        assert.equal(received[0].url, '/api/audit?limit=10&action=governance&adminId=SAD_1');
    });
});

describe('orionctl — session file handling', () => {
    test('logout revokes server-side and then drops the local token', async () => {
        route('POST', '/api/auth/logout', 200, { error: false, loggedOut: true });

        const { code, stdout } = await run(['logout']);

        assert.equal(code, 0);
        assert.match(stdout, /Signed out\./);
        assert.equal(received[0].headers.authorization, 'Bearer test-token');
        // The URL is kept so the next login does not need --url again.
        assert.deepEqual(readConfig(), { url: apiUrl });
    });

    test('a failed logout leaves the local token in place', async () => {
        route('POST', '/api/auth/logout', 500, { error: true, code: 'API::INTERNAL', message: 'Internal error' });

        const { code } = await run(['logout']);

        assert.equal(code, 1);
        assert.equal(readConfig().token, 'test-token', 'a token believed live on the server must not be discarded locally');
    });

    test('whoami reports the current session', async () => {
        route('GET', '/api/auth/session', 200, { error: false, stage: 'active', admin: { email: 'admin@orion.local', role: 'admin' } });

        const { code, json } = await run(['whoami']);

        assert.equal(code, 0);
        assert.equal(json.admin.email, 'admin@orion.local');
    });

    test('login without a URL on a fresh machine says so', async () => {
        writeConfig({});

        const { code, stderr } = await run(['login', 'admin@orion.local']);

        assert.equal(code, 1);
        assert.match(stderr, /pass --url <https:\/\/orch-host:55330> on first login/);
    });

    test('login requires an email', async () => {
        const { code, stderr } = await run(['login']);

        assert.equal(code, 1);
        assert.match(stderr, /usage: orionctl login <email>/);
    });

    test('a full magic-link login persists the session token', async () => {
        writeConfig({});
        route('POST', '/api/auth/magic-link', 200, { error: false, requested: true });
        route('POST', '/api/auth/magic-link/verify', 200, { error: false, token: 'pending-token', totpEnrolled: true });
        route('POST', '/api/auth/totp/verify', 200, {
            error: false,
            token: 'active-token',
            admin: { email: 'admin@orion.local', role: 'admin', status: 'active', passwordChangeRequired: false }
        });

        const { code, stdout } = await run(['login', 'admin@orion.local', '--url', apiUrl], { stdin: 'link-code\n123456\n' });

        assert.equal(code, 0);
        assert.match(stdout, /Signed in as admin@orion\.local \(admin, active\)/);
        assert.equal(readConfig().url, apiUrl);
        assert.ok(readConfig().token, 'the session must survive the process');
    });

    test('login walks an unenrolled admin through TOTP setup', async () => {
        writeConfig({});
        route('POST', '/api/auth/magic-link', 200, { error: false, requested: true });
        route('POST', '/api/auth/magic-link/verify', 200, { error: false, token: 'pending-token', totpEnrolled: false });
        route('POST', '/api/auth/totp/setup', 200, { error: false, uri: 'otpauth://totp/Orion:admin', secret: 'JBSWY3DPEHPK3PXP' });
        route('POST', '/api/auth/totp/activate', 200, {
            error: false,
            token: 'active-token',
            admin: { email: 'admin@orion.local', role: 'admin', status: 'active', passwordChangeRequired: false }
        });

        const { code, stdout } = await run(['login', 'admin@orion.local', '--url', apiUrl], { stdin: 'link-code\n123456\n' });

        assert.equal(code, 0);
        assert.match(stdout, /enrollment is mandatory/);
        assert.match(stdout, /otpauth:\/\/totp\/Orion:admin/);
        assert.match(stdout, /JBSWY3DPEHPK3PXP/);
        assert.ok(received.some(r => r.url === '/api/auth/totp/activate'));
    });

    test('root login uses the password path, never the magic link', async () => {
        writeConfig({});
        route('POST', '/api/auth/root/login', 200, { error: false, token: 'pending-token', totpEnrolled: true });
        route('POST', '/api/auth/totp/verify', 200, {
            error: false,
            token: 'active-token',
            admin: { email: 'root@orion.local', role: 'root', status: 'active', passwordChangeRequired: false }
        });

        const { code } = await run(['login', 'root@orion.local', '--root', '--url', apiUrl], { stdin: 'hunter2hunter2\n123456\n' });

        assert.equal(code, 0);
        assert.ok(received.some(r => r.url === '/api/auth/root/login'));
        assert.ok(!received.some(r => r.url === '/api/auth/magic-link'), 'root must not be offered the magic-link path');
    });

    test('a bootstrap root is forced through a password rotation before finishing', async () => {
        writeConfig({});
        route('POST', '/api/auth/root/login', 200, { error: false, token: 'pending-token', totpEnrolled: true });
        route('POST', '/api/auth/totp/verify', 200, {
            error: false,
            token: 'active-token',
            admin: { email: 'root@orion.local', role: 'root', status: 'pending', passwordChangeRequired: true }
        });
        route('POST', '/api/auth/root/change-password', 200, {
            error: false,
            admin: { email: 'root@orion.local', role: 'root', status: 'active', passwordChangeRequired: false }
        });

        const { code, stdout } = await run(['login', 'root@orion.local', '--root', '--url', apiUrl], {
            stdin: 'bootstrap-pass\n123456\nbootstrap-pass\nnew-password-12\nnew-password-12\n'
        });

        assert.equal(code, 0);
        assert.match(stdout, /bootstrap password must be rotated/);
        assert.ok(received.some(r => r.url === '/api/auth/root/change-password'));
        assert.match(stdout, /Signed in as root@orion\.local \(root, active\)/);
    });

    test('mismatched new passwords abort the rotation', async () => {
        const { code, stderr } = await run(['change-password'], { stdin: 'current\nnew-password-1\nnew-password-2\n' });

        assert.equal(code, 1);
        assert.match(stderr, /passwords do not match/);
        assert.equal(received.length, 0);
    });

    test('an account left inactive after login is called out', async () => {
        writeConfig({});
        route('POST', '/api/auth/magic-link', 200, { error: false, requested: true });
        route('POST', '/api/auth/magic-link/verify', 200, { error: false, token: 'pending-token', totpEnrolled: true });
        route('POST', '/api/auth/totp/verify', 200, {
            error: false,
            token: 'active-token',
            admin: { email: 'admin@orion.local', role: 'admin', status: 'pending', passwordChangeRequired: false }
        });

        const { code, stdout } = await run(['login', 'admin@orion.local', '--url', apiUrl], { stdin: 'code\n123456\n' });

        assert.equal(code, 0);
        assert.match(stdout, /account is not active yet/);
    });
});
