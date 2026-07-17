#!/usr/bin/env node
/**
 * orionctl — CLI for the Orion-Orchestrator system-admin plane.
 *
 * Talks to the exact same /api the orch panel uses: same magic-link + TOTP
 * login (password + TOTP for root), same PBAC enforcement, same audit trail.
 * There is no privileged side door — a policy that denies an action in the
 * GUI denies it here too.
 *
 * Session state lives in ~/.orionctl.json (0600). Zero dependencies: Node
 * built-ins + global fetch only.
 */

import { readFileSync, writeFileSync, existsSync, chmodSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import readline from 'readline';
import process from 'process';

const CONFIG_PATH = join(homedir(), '.orionctl.json');

// ── Config ───────────────────────────────────────────────────────────────────

const loadConfig = () => {
    try {
        return existsSync(CONFIG_PATH) ? JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) : {};
    } catch (_) {
        return {};
    }
};

const saveConfig = (config) => {
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    try { chmodSync(CONFIG_PATH, 0o600); } catch (_) { /* windows */ }
};

// ── Terminal helpers ─────────────────────────────────────────────────────────

const prompt = (question, { hidden = false } = {}) => new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    if (hidden && process.stdin.isTTY) {
        const onData = (char) => {
            const s = String(char);
            if (s === '\n' || s === '\r' || s === '') return;
            readline.moveCursor(process.stdout, -s.length, 0);
            process.stdout.write('*'.repeat(s.length));
        };
        process.stdin.on('data', onData);
        rl.question(question, (answer) => {
            process.stdin.off('data', onData);
            process.stdout.write('\n');
            rl.close();
            resolve(answer.trim());
        });
        return;
    }

    rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
    });
});

const die = (message, code = 1) => {
    console.error(`orionctl: ${message}`);
    process.exit(code);
};

const printJson = (value) => console.log(JSON.stringify(value, null, 2));

// ── Argument parsing (positional + --flags) ─────────────────────────────────

const parseArgs = (argv) => {
    const positional = [];
    const flags = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith('--')) {
            const key = arg.slice(2);
            const next = argv[i + 1];
            if (next !== undefined && !next.startsWith('--')) {
                flags[key] = next;
                i++;
            } else {
                flags[key] = true;
            }
        } else {
            positional.push(arg);
        }
    }
    return { positional, flags };
};

const parseJsonFlag = (value, name) => {
    if (value === undefined) return {};
    try {
        return JSON.parse(value);
    } catch (_) {
        die(`--${name} must be valid JSON`);
    }
};

// ── API client ───────────────────────────────────────────────────────────────

class ApiClient {

    constructor(config) {
        this.url = config.url ? String(config.url).replace(/\/$/, '') : null;
        this.token = config.token || null;
    }

    async request(method, path, body = undefined, { auth = true } = {}) {
        if (!this.url) die('no orchestrator URL configured — run: orionctl login <email> --url <https://orch-host:55330>');

        const headers = { 'content-type': 'application/json' };
        if (auth && this.token) headers.authorization = `Bearer ${this.token}`;

        let response;
        try {
            response = await fetch(this.url + path, {
                method,
                headers,
                body: body === undefined ? undefined : JSON.stringify(body)
            });
        } catch (err) {
            die(`cannot reach ${this.url} — ${err.message}`);
        }

        let payload = null;
        try {
            payload = await response.json();
        } catch (_) { /* non-JSON error body */ }

        if (!response.ok || payload?.error) {
            const code = payload?.code || `HTTP-${response.status}`;
            if (response.status === 401 && auth) {
                die(`${code}: ${payload?.message || 'unauthorized'} — session may have expired; run: orionctl login <email>`);
            }
            die(`${code}: ${payload?.message || response.statusText}`);
        }

        return payload;
    }

    get(path) { return this.request('GET', path); }
    post(path, body = {}) { return this.request('POST', path, body); }
    patch(path, body = {}) { return this.request('PATCH', path, body); }
    delete(path) { return this.request('DELETE', path); }
}

// ── Login flow (device-style: magic link + TOTP; root: password + TOTP) ─────

const completeTotpStage = async (api, firstFactor) => {
    if (!firstFactor.totpEnrolled) {
        console.log('\nThis account has no authenticator enrolled yet — enrollment is mandatory.');
        const setup = await api.post('/api/auth/totp/setup');
        console.log('\nAdd this account to your authenticator app:');
        console.log(`  URI:    ${setup.uri}`);
        console.log(`  Secret: ${setup.secret}`);
        const code = await prompt('\nCode from your authenticator: ');
        return api.post('/api/auth/totp/activate', { token: code });
    }

    const code = await prompt('Authenticator code: ');
    return api.post('/api/auth/totp/verify', { token: code });
};

const cmdLogin = async (config, positional, flags) => {
    const email = positional[0] || die('usage: orionctl login <email> [--root] [--url <orch-url>]');
    if (flags.url) config.url = String(flags.url).replace(/\/$/, '');
    if (!config.url) die('no orchestrator URL known — pass --url <https://orch-host:55330> on first login');

    const api = new ApiClient(config);
    let firstFactor;

    if (flags.root) {
        const password = await prompt('Root password: ', { hidden: true });
        firstFactor = await api.request('POST', '/api/auth/root/login', { email, password }, { auth: false });
    } else {
        await api.request('POST', '/api/auth/magic-link', { email }, { auth: false });
        console.log(`\nIf ${email} is a system admin, a sign-in link was emailed to it.`);
        const code = await prompt('Paste the sign-in code from the email: ');
        firstFactor = await api.request('POST', '/api/auth/magic-link/verify', { code }, { auth: false });
    }

    api.token = firstFactor.token;
    const result = await completeTotpStage(api, firstFactor);

    config.token = firstFactor.token;
    saveConfig(config);

    let admin = result.admin;

    if (admin.passwordChangeRequired) {
        console.log('\nYour bootstrap password must be rotated before the account activates.');
        const currentPassword = await prompt('Current password: ', { hidden: true });
        const newPassword = await prompt('New password (min 12 chars): ', { hidden: true });
        const confirm = await prompt('Repeat new password: ', { hidden: true });
        if (newPassword !== confirm) die('passwords do not match');
        const changed = await api.post('/api/auth/root/change-password', { currentPassword, newPassword });
        admin = changed.admin;
    }

    console.log(`\nSigned in as ${admin.email} (${admin.role}, ${admin.status}). Session saved to ${CONFIG_PATH}`);
    if (admin.status !== 'active') {
        console.log('NOTE: account is not active yet — finish the remaining activation steps.');
    }
};

// ── Command table ────────────────────────────────────────────────────────────

const HELP = `orionctl — Orion-Orchestrator system-admin CLI

Auth
  login <email> [--root] [--url URL]     sign in (magic link + TOTP; root: password + TOTP)
  logout                                 revoke the current session
  whoami                                 show the current session
  change-password                        rotate the root password

Cluster (governed by YOUR attached PBAC policy)
  status | health | nodes | node <workerId>
  escalations | consensus-history | policy-rules | policy-outcomes | command-log | commands
  cmd <workerId> <action> [--args JSON] [--timeout ms]
  cmd-all <action> [--args JSON]
  lock | unlock
  incident <declare|resolve> [--reason TEXT]
  consensus <topic> [--params JSON]
  client-urls <url1,url2,...>

Audit
  audit [--limit N] [--action PREFIX] [--admin ID]
  audit verify                            (root) verify the hash chain

Governance (root only)
  admins list
  admins create <email> [--name TEXT] [--policy ID] [--group ID]
  admins suspend <id> | admins activate <id> | admins delete <id>
  policies list | policies attachments <id>
  policies create --name NAME --file doc.json [--description TEXT]
  policies update <id> [--name NAME] [--file doc.json] [--description TEXT]
  policies delete <id>
  policies attach <id> (--admin ID | --group ID)
  policies detach <id> (--admin ID | --group ID)
  groups list | groups create <name> [--description TEXT] | groups delete <id>
  groups members <id> | groups add <groupId> <adminId> | groups remove <groupId> <adminId>
`;

const principalFromFlags = (flags) => {
    if (flags.admin) return { principalType: 'admin', principalId: flags.admin };
    if (flags.group) return { principalType: 'group', principalId: flags.group };
    die('pass --admin <adminId> or --group <groupId>');
};

const readPolicyFile = (file) => {
    if (!file) return undefined;
    try {
        return JSON.parse(readFileSync(file, 'utf-8'));
    } catch (err) {
        die(`cannot read policy document ${file} — ${err.message}`);
    }
};

const main = async () => {
    const [, , command, ...rest] = process.argv;
    const { positional, flags } = parseArgs(rest);
    const config = loadConfig();
    const api = new ApiClient(config);

    switch (command) {
        case undefined:
        case 'help':
        case '--help':
            console.log(HELP);
            return;

        // ── Auth ────────────────────────────────────────────────────────────
        case 'login':
            return cmdLogin(config, positional, flags);

        case 'logout': {
            await api.post('/api/auth/logout');
            delete config.token;
            saveConfig(config);
            console.log('Signed out.');
            return;
        }

        case 'whoami':
            return printJson((await api.get('/api/auth/session')));

        case 'change-password': {
            const currentPassword = await prompt('Current password: ', { hidden: true });
            const newPassword = await prompt('New password (min 12 chars): ', { hidden: true });
            const confirm = await prompt('Repeat new password: ', { hidden: true });
            if (newPassword !== confirm) die('passwords do not match');
            return printJson(await api.post('/api/auth/root/change-password', { currentPassword, newPassword }));
        }

        // ── Cluster reads ───────────────────────────────────────────────────
        case 'status':
            return printJson((await api.get('/api/cluster/status')).status);
        case 'health':
            return printJson((await api.get('/api/cluster/health')).health);
        case 'nodes':
            return printJson((await api.get('/api/cluster/nodes')).nodes);
        case 'node': {
            const workerId = positional[0] || die('usage: orionctl node <workerId>');
            return printJson((await api.get(`/api/cluster/nodes/${encodeURIComponent(workerId)}`)).node);
        }
        case 'escalations':
            return printJson((await api.get(`/api/cluster/escalations?limit=${Number(flags.limit) || 50}`)).escalations);
        case 'consensus-history':
            return printJson((await api.get(`/api/cluster/consensus-history?limit=${Number(flags.limit) || 10}`)).history);
        case 'policy-rules':
            return printJson((await api.get('/api/cluster/policy-rules')).rules);
        case 'policy-outcomes':
            return printJson((await api.get(`/api/cluster/policy-outcomes?limit=${Number(flags.limit) || 20}`)).outcomes);
        case 'command-log':
            return printJson((await api.get(`/api/cluster/command-log?limit=${Number(flags.limit) || 50}`)).commandLog);
        case 'commands':
            return printJson(await api.get('/api/cluster/commands'));

        // ── Cluster operations ──────────────────────────────────────────────
        case 'cmd': {
            const [workerId, action] = positional;
            if (!workerId || !action) die('usage: orionctl cmd <workerId> <action> [--args JSON]');
            return printJson((await api.post(`/api/cluster/nodes/${encodeURIComponent(workerId)}/command`, {
                action,
                args: parseJsonFlag(flags.args, 'args'),
                timeoutMs: flags.timeout ? Number(flags.timeout) : undefined
            })).outcome);
        }
        case 'cmd-all': {
            const action = positional[0] || die('usage: orionctl cmd-all <action> [--args JSON]');
            return printJson((await api.post('/api/cluster/command-all', {
                action,
                args: parseJsonFlag(flags.args, 'args')
            })).results);
        }
        case 'lock':
            return printJson((await api.post('/api/cluster/lock')).results);
        case 'unlock':
            return printJson((await api.post('/api/cluster/unlock')).results);
        case 'incident': {
            const sub = positional[0];
            if (!['declare', 'resolve'].includes(sub)) die('usage: orionctl incident <declare|resolve> [--reason TEXT]');
            return printJson((await api.post(`/api/cluster/incident/${sub}`, { reason: flags.reason })).health);
        }
        case 'consensus': {
            const topic = positional[0] || die('usage: orionctl consensus <topic> [--params JSON]');
            return printJson((await api.post('/api/cluster/consensus', { topic, params: parseJsonFlag(flags.params, 'params') })).vote);
        }
        case 'client-urls': {
            const urls = (positional[0] || '').split(',').filter(Boolean);
            if (urls.length === 0) die('usage: orionctl client-urls <url1,url2,...>');
            return printJson((await api.post('/api/cluster/client-urls', { clientUrls: urls })).results);
        }

        // ── Audit ───────────────────────────────────────────────────────────
        case 'audit': {
            if (positional[0] === 'verify') {
                return printJson(await api.get('/api/audit/verify'));
            }
            const params = new URLSearchParams();
            if (flags.limit) params.set('limit', flags.limit);
            if (flags.action) params.set('action', flags.action);
            if (flags.admin) params.set('adminId', flags.admin);
            const qs = params.toString();
            return printJson((await api.get(`/api/audit${qs ? '?' + qs : ''}`)).audit);
        }

        // ── Governance: admins ──────────────────────────────────────────────
        case 'admins': {
            const sub = positional[0];
            switch (sub) {
                case 'list':
                    return printJson((await api.get('/api/admins')).admins);
                case 'create': {
                    const email = positional[1] || die('usage: orionctl admins create <email> [--name TEXT] [--policy ID] [--group ID]');
                    return printJson((await api.post('/api/admins', {
                        email,
                        displayName: flags.name || null,
                        policyId: flags.policy || null,
                        groupId: flags.group || null
                    })).admin);
                }
                case 'suspend':
                    return printJson((await api.post(`/api/admins/${encodeURIComponent(positional[1])}/status`, { status: 'suspended' })).admin);
                case 'activate':
                    return printJson((await api.post(`/api/admins/${encodeURIComponent(positional[1])}/status`, { status: 'active' })).admin);
                case 'delete':
                    return printJson(await api.delete(`/api/admins/${encodeURIComponent(positional[1])}`));
                default:
                    die('usage: orionctl admins <list|create|suspend|activate|delete>');
            }
            return;
        }

        // ── Governance: policies ────────────────────────────────────────────
        case 'policies': {
            const sub = positional[0];
            switch (sub) {
                case 'list':
                    return printJson((await api.get('/api/policies')).policies);
                case 'attachments':
                    return printJson((await api.get(`/api/policies/${encodeURIComponent(positional[1])}/attachments`)).attachments);
                case 'create': {
                    if (!flags.name || !flags.file) die('usage: orionctl policies create --name NAME --file doc.json [--description TEXT]');
                    return printJson((await api.post('/api/policies', {
                        name: flags.name,
                        description: flags.description || null,
                        document: readPolicyFile(flags.file)
                    })).policy);
                }
                case 'update': {
                    const id = positional[1] || die('usage: orionctl policies update <id> [--name NAME] [--file doc.json]');
                    return printJson((await api.patch(`/api/policies/${encodeURIComponent(id)}`, {
                        name: flags.name,
                        description: flags.description,
                        document: readPolicyFile(flags.file)
                    })).policy);
                }
                case 'delete':
                    return printJson(await api.delete(`/api/policies/${encodeURIComponent(positional[1])}`));
                case 'attach':
                    return printJson(await api.post(`/api/policies/${encodeURIComponent(positional[1])}/attach`, principalFromFlags(flags)));
                case 'detach':
                    return printJson(await api.post(`/api/policies/${encodeURIComponent(positional[1])}/detach`, principalFromFlags(flags)));
                default:
                    die('usage: orionctl policies <list|attachments|create|update|delete|attach|detach>');
            }
            return;
        }

        // ── Governance: groups ──────────────────────────────────────────────
        case 'groups': {
            const sub = positional[0];
            switch (sub) {
                case 'list':
                    return printJson((await api.get('/api/groups')).groups);
                case 'create': {
                    const name = positional[1] || die('usage: orionctl groups create <name> [--description TEXT]');
                    return printJson((await api.post('/api/groups', { name, description: flags.description || null })).group);
                }
                case 'delete':
                    return printJson(await api.delete(`/api/groups/${encodeURIComponent(positional[1])}`));
                case 'members':
                    return printJson((await api.get(`/api/groups/${encodeURIComponent(positional[1])}/members`)).members);
                case 'add':
                    return printJson(await api.post(`/api/groups/${encodeURIComponent(positional[1])}/members`, { adminId: positional[2] }));
                case 'remove':
                    return printJson(await api.delete(`/api/groups/${encodeURIComponent(positional[1])}/members/${encodeURIComponent(positional[2])}`));
                default:
                    die('usage: orionctl groups <list|create|delete|members|add|remove>');
            }
            return;
        }

        default:
            die(`unknown command "${command}" — run: orionctl help`);
    }
};

main().catch(err => die(err.message));
