/**
 * AuditLog — the orchestrator's immutable admin-plane audit trail.
 *
 * Every admin API request (and every auth event) is recorded, scoped to the
 * admin that made it. Rows are hash-chained — hash = sha256(canonical row +
 * prev_hash) — so any post-hoc tampering breaks the chain, and the table
 * itself rejects UPDATE/DELETE via trigger (see migration 0001). Writes are
 * serialized through an in-process queue: one orchestrator per cluster is the
 * only writer, so a local queue is sufficient to keep the chain linear.
 *
 * Auditing is fail-open for reads but fail-closed for governance: callers that
 * must not proceed without an audit row await write() and treat a rejection
 * as an error.
 */

import crypto from 'crypto';
import { logger } from 'r-sync';

/**
 * Deterministic JSON with recursively sorted object keys. JSONB normalizes
 * key order on storage, so the hash must be computed over a canonical form
 * that survives the Postgres round-trip.
 */
const canonicalJson = (value) => {
    if (Array.isArray(value)) {
        return '[' + value.map(canonicalJson).join(',') + ']';
    }
    if (value !== null && typeof value === 'object') {
        return '{' + Object.keys(value).sort()
            .map(k => JSON.stringify(k) + ':' + canonicalJson(value[k]))
            .join(',') + '}';
    }
    return JSON.stringify(value) ?? 'null';
};

class AuditLog {

    constructor(db) {
        this.db = db;
        this._chain = Promise.resolve();
    }

    /**
     * Appends one audit row. Returns a promise resolving to the inserted row.
     * @param {object} entry - { adminId, adminEmail, ip, method, path, action,
     *                           resource, decision, statusCode, details }
     */
    write(entry) {
        const queued = this._chain.then(() => this._insert(entry));
        // The chain itself must survive a failed insert or every later write
        // would reject with the same stale error.
        this._chain = queued.catch(() => { });
        return queued;
    }

    async _insert(entry) {
        const { rows: lastRows } = await this.db.query(
            'SELECT hash FROM orch_admin_audit ORDER BY id DESC LIMIT 1'
        );
        const prevHash = lastRows[0]?.hash || null;

        const payload = {
            adminId: entry.adminId || null,
            adminEmail: entry.adminEmail || null,
            ip: entry.ip || null,
            method: entry.method || null,
            path: entry.path || null,
            action: entry.action,
            resource: entry.resource || null,
            decision: entry.decision,
            statusCode: entry.statusCode ?? null,
            details: entry.details || {}
        };

        const hash = crypto
            .createHash('sha256')
            .update(canonicalJson(payload) + (prevHash || ''))
            .digest('hex');

        const { rows } = await this.db.query(
            `INSERT INTO orch_admin_audit
                (admin_id, admin_email, ip, method, path, action, resource, decision, status_code, details, prev_hash, hash)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
             RETURNING *`,
            [
                payload.adminId, payload.adminEmail, payload.ip, payload.method, payload.path,
                payload.action, payload.resource, payload.decision, payload.statusCode,
                JSON.stringify(payload.details), prevHash, hash
            ]
        );
        return rows[0];
    }

    /** Best-effort variant for hot paths — logs instead of throwing. */
    writeSafe(entry) {
        this.write(entry).catch(err => {
            logger.error(`AuditLog: audit write failed — ${err.message}`);
        });
    }

    async list({ limit = 100, offset = 0, adminId = null, action = null, since = null } = {}) {
        const where = [];
        const params = [];

        if (adminId) {
            params.push(adminId);
            where.push(`admin_id = $${params.length}`);
        }
        if (action) {
            params.push(action + '%');
            where.push(`action LIKE $${params.length}`);
        }
        if (since) {
            params.push(since);
            where.push(`at >= $${params.length}`);
        }

        params.push(Math.min(Number(limit) || 100, 500));
        const limitIdx = params.length;
        params.push(Math.max(Number(offset) || 0, 0));
        const offsetIdx = params.length;

        const { rows } = await this.db.query(
            `SELECT * FROM orch_admin_audit
             ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
             ORDER BY id DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
            params
        );
        return rows;
    }

    /**
     * Walks the whole chain and verifies every link — an operator's tamper
     * check. Returns { valid, checked, brokenAtId }.
     */
    async verifyChain() {
        const { rows } = await this.db.query(
            `SELECT id, admin_id, admin_email, ip, method, path, action, resource,
                    decision, status_code, details, prev_hash, hash
             FROM orch_admin_audit ORDER BY id ASC`
        );

        let prevHash = null;
        for (const row of rows) {
            const payload = {
                adminId: row.admin_id,
                adminEmail: row.admin_email,
                ip: row.ip,
                method: row.method,
                path: row.path,
                action: row.action,
                resource: row.resource,
                decision: row.decision,
                statusCode: row.status_code,
                details: row.details
            };
            const expected = crypto
                .createHash('sha256')
                .update(canonicalJson(payload) + (prevHash || ''))
                .digest('hex');

            if (row.prev_hash !== prevHash || row.hash !== expected) {
                return { valid: false, checked: rows.length, brokenAtId: row.id };
            }
            prevHash = row.hash;
        }

        return { valid: true, checked: rows.length, brokenAtId: null };
    }
}

export { AuditLog };
