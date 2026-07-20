import mysql from 'mysql2/promise';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { logger } from '../logger.js';
import { generateId } from '../valueGenerator.js';
import { AUDIT_TRAIL_SYSTEM_SCHEMA_VERSION, AUDIT_WAL_FILE_NAME, AUDIT_WAL_PUBLIC_KEY_FILE_NAME } from '../../orion.meta.js';
import { SafeModuleHandler } from '../UnavailableModuleWrapper.js';

const systemConfigModule = new SafeModuleHandler('SystemConfig', 'systemConfig', 'AuditTrailSystem.js');

const DEFAULT_FLUSH_THRESHOLD = 50;
const DEFAULT_FLUSH_INTERVAL_MS = 30_000;

const VALID_STATUSES = new Set(['PENDING', 'SUCCESS', 'FAILED']);

class AuditTrailSystem {
    static QUERYABLE_COLUMNS = new Set([
        'recordId',
        'requestId',
        'sessionId',
        'userUid',
        'userEmail',
        'ipAddress',
        'fingerprint',
        'source',
        'functionName',
        'environment',
        'action',
        'status',
        'errorCode',
        'schemaVersion'
    ]);

    constructor(enabled) {
        if (enabled) {
            const systemConfig = systemConfigModule.getModule();
            this.enabled = true;

            const atConfig = systemConfig?.utilities?.auditTrailSystem || {};

            // Fail fast: an enabled audit trail silently falling back to
            // root/localhost default credentials is worse than not booting.
            if (!atConfig.host || !atConfig.user || !atConfig.password) {
                throw new Error(
                    'AuditTrailSystem is enabled but utilities.auditTrailSystem is missing host, user, or password — ' +
                        'configure explicit credentials (defaults are not provided by design)'
                );
            }

            this.config = {
                host: atConfig.host,
                port: atConfig.port || 3306,
                user: atConfig.user,
                password: atConfig.password,
                database: atConfig.database || 'orion_audit',
                waitForConnections: true,
                connectionLimit: 10,
                queueLimit: 0
            };

            this.pool = mysql.createPool({
                host: this.config.host,
                port: this.config.port,
                user: this.config.user,
                password: this.config.password,
                waitForConnections: true,
                connectionLimit: 10,
                queueLimit: 0
            });

            // Buffering & flush configuration
            this._buffer = [];
            this._sequenceNumber = 0;
            this._flushing = false;
            this._flushThreshold = systemConfig?.utilities?.auditTrailSystem?.flushThreshold || DEFAULT_FLUSH_THRESHOLD;
            this._flushIntervalMs = systemConfig?.utilities?.auditTrailSystem?.flushIntervalMs || DEFAULT_FLUSH_INTERVAL_MS;
            this._flushTimer = null;

            // Signing keypair (generated during initialize)
            this._signingKeyPair = null;

            // WAL file paths
            const callerDir = process.cwd();
            this._walFilePath = path.resolve(callerDir, AUDIT_WAL_FILE_NAME);
            this._pubKeyFilePath = path.resolve(callerDir, AUDIT_WAL_PUBLIC_KEY_FILE_NAME);
        }

        if (!enabled) {
            this.enabled = false;
            logger.info('Audit Trail System disabled');
        }
    }

    getPool() {
        return this.pool;
    }

    // ─── Database Setup ──────────────────────────────────────────────

    async createDatabaseIfNotExists() {
        try {
            const conn = await this.pool.getConnection();

            // ? / ?? placeholders: mysql2 escapes the value and identifier —
            // never interpolate the configured database name into SQL directly.
            const [databases] = await conn.query('SHOW DATABASES LIKE ?', [this.config.database]);

            if (databases.length === 0) {
                logger?.info?.(`📊 Creating audit database: ${this.config.database}`);
                await conn.query('CREATE DATABASE ??', [this.config.database]);
                logger?.info?.(`✅ Audit database '${this.config.database}' created successfully`);
            } else {
                logger?.info?.(`✅ Audit database '${this.config.database}' already exists`);
            }

            conn.release();

            this.pool = mysql.createPool(this.config);
        } catch (error) {
            logger?.error?.('Failed to create audit database:', error);
            throw error;
        }
    }

    // ─── Schema ──────────────────────────────────────────────────────
    // Reference copy: lib/Utils/Databases/audit-mysql.ddl.sql — keep in sync.

    async _ensureSchema() {
        const conn = await this.pool.getConnection();
        try {
            await conn.query(`
                CREATE TABLE IF NOT EXISTS audit_trail (
                    id            BIGINT PRIMARY KEY AUTO_INCREMENT,
                    recordId      VARCHAR(48) NOT NULL,
                    timestamp     DATETIME(3) NOT NULL,
                    requestId     VARCHAR(128),
                    sessionId     VARCHAR(128),
                    userUid       VARCHAR(128),
                    userEmail     VARCHAR(255),
                    ipAddress     VARCHAR(45),
                    userAgent     TEXT,
                    fingerprint   VARCHAR(255),
                    source        VARCHAR(255),
                    functionName  VARCHAR(255),
                    environment   VARCHAR(64),
                    action        VARCHAR(255) NOT NULL,
                    status        ENUM('PENDING','SUCCESS','FAILED') NOT NULL,
                    durationMs    INT,
                    impact        TEXT,
                    metadata      TEXT,
                    errorCode     VARCHAR(255),
                    hash          CHAR(64),
                    prevHash      CHAR(64),
                    schemaVersion VARCHAR(16) DEFAULT '${AUDIT_TRAIL_SYSTEM_SCHEMA_VERSION}',
                    UNIQUE KEY uq_audit_record       (recordId),
                    KEY        idx_audit_timestamp   (timestamp),
                    KEY        idx_audit_user_time   (userUid, timestamp),
                    KEY        idx_audit_action_time (action, timestamp),
                    KEY        idx_audit_request     (requestId)
                ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4
            `);

            // Converge tables created by schema 2.0.0: CREATE TABLE IF NOT
            // EXISTS cannot reshape an existing table, so add what's missing.
            const [cols] = await conn.query(
                `SELECT COLUMN_NAME, DATA_TYPE, DATETIME_PRECISION, COLUMN_DEFAULT
                 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_trail'`
            );
            const have = new Set(cols.map(c => c.COLUMN_NAME));

            if (!have.has('sessionId')) await conn.query('ALTER TABLE audit_trail ADD COLUMN sessionId VARCHAR(128) AFTER requestId');
            if (!have.has('environment')) await conn.query('ALTER TABLE audit_trail ADD COLUMN environment VARCHAR(64) AFTER functionName');
            if (!have.has('durationMs')) await conn.query('ALTER TABLE audit_trail ADD COLUMN durationMs INT AFTER status');

            // JSON → TEXT: the JSON type normalizes documents, which breaks
            // byte-exact hash-chain re-verification of metadata.
            if (cols.some(c => c.COLUMN_NAME === 'metadata' && c.DATA_TYPE === 'json')) {
                await conn.query('ALTER TABLE audit_trail MODIFY COLUMN metadata TEXT');
            }

            // DATETIME → DATETIME(3): second-precision truncation would make
            // re-hashed entries diverge from the chain (entries are hashed with
            // millisecond timestamps).
            const ts = cols.find(c => c.COLUMN_NAME === 'timestamp');
            if (ts && Number(ts.DATETIME_PRECISION) !== 3) {
                await conn.query('ALTER TABLE audit_trail MODIFY COLUMN timestamp DATETIME(3) NOT NULL');
            }

            const sv = cols.find(c => c.COLUMN_NAME === 'schemaVersion');
            if (sv && sv.COLUMN_DEFAULT !== AUDIT_TRAIL_SYSTEM_SCHEMA_VERSION) {
                await conn.query('ALTER TABLE audit_trail ALTER COLUMN schemaVersion SET DEFAULT ?', [AUDIT_TRAIL_SYSTEM_SCHEMA_VERSION]);
            }

            const [idx] = await conn.query(
                `SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_trail'`
            );
            const haveIdx = new Set(idx.map(i => i.INDEX_NAME));

            if (!haveIdx.has('uq_audit_record')) {
                // Legacy tables may hold duplicate recordIds from pre-2.1.0 WAL
                // replays; keep the earliest copy so the unique key can land.
                await conn.query('DELETE t1 FROM audit_trail t1 JOIN audit_trail t2 ON t1.recordId = t2.recordId AND t1.id > t2.id');
                await conn.query('ALTER TABLE audit_trail ADD UNIQUE KEY uq_audit_record (recordId)');
            }
            if (!haveIdx.has('idx_audit_timestamp')) await conn.query('ALTER TABLE audit_trail ADD KEY idx_audit_timestamp (timestamp)');
            if (!haveIdx.has('idx_audit_user_time')) await conn.query('ALTER TABLE audit_trail ADD KEY idx_audit_user_time (userUid, timestamp)');
            if (!haveIdx.has('idx_audit_action_time')) await conn.query('ALTER TABLE audit_trail ADD KEY idx_audit_action_time (action, timestamp)');
            if (!haveIdx.has('idx_audit_request')) await conn.query('ALTER TABLE audit_trail ADD KEY idx_audit_request (requestId)');
        } finally {
            conn.release();
        }
    }

    // ─── Initialize ──────────────────────────────────────────────────

    async initialize() {
        try {
            if (!this.enabled) {
                return;
            }

            await this.createDatabaseIfNotExists();
            await this._ensureSchema();

            // Generate Ed25519 signing keypair for this boot session
            this._generateSigningKeyPair();

            // Attempt WAL recovery from a previous boot
            await this._recoverFromWAL();

            // Start the periodic flush timer
            this._startFlushTimer();

            // Register graceful shutdown handlers
            this._registerShutdownHandlers();

            logger?.info?.('✅ AuditTrail system initialized (buffered mode)');
            logger?.info?.(`   ├─ Flush threshold: ${this._flushThreshold} records`);
            logger?.info?.(`   ├─ Flush interval: ${this._flushIntervalMs}ms`);
            logger?.info?.(`   └─ WAL path: ${this._walFilePath}`);
        } catch (error) {
            logger?.error?.('Failed to initialize audit trail system:', error);
            throw error;
        }
    }

    // ─── Signing Key Management ──────────────────────────────────────

    _generateSigningKeyPair() {
        const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
        });

        this._signingKeyPair = { publicKey, privateKey };

        // Write the public key to disk so the NEXT boot can verify this session's WAL
        try {
            fs.writeFileSync(this._pubKeyFilePath, publicKey, 'utf8');
            logger?.info?.(`🔑 Audit WAL public key written to: ${this._pubKeyFilePath}`);
        } catch (err) {
            logger?.error?.('Failed to write audit WAL public key:', err);
        }
    }

    _signEntry(entryJson) {
        const sign = crypto.sign(null, Buffer.from(entryJson, 'utf8'), this._signingKeyPair.privateKey);
        return sign.toString('base64');
    }

    _verifyEntrySignature(entryJson, signatureBase64, publicKeyPem) {
        try {
            return crypto.verify(null, Buffer.from(entryJson, 'utf8'), publicKeyPem, Buffer.from(signatureBase64, 'base64'));
        } catch {
            return false;
        }
    }

    // ─── WAL (Write-Ahead Log) ───────────────────────────────────────

    _appendToWAL(entry) {
        try {
            const entryJson = JSON.stringify(entry);
            const signature = this._signEntry(entryJson);
            const walLine = JSON.stringify({ entry, signature }) + '\n';

            // Async append — fire and forget for performance
            fs.appendFile(this._walFilePath, walLine, 'utf8', err => {
                if (err) {
                    logger?.error?.('Failed to append to audit WAL:', err.message);
                }
            });
        } catch (err) {
            logger?.error?.('WAL append serialization error:', err.message);
        }
    }

    async _recoverFromWAL() {
        try {
            // Check if a previous boot's public key exists
            let previousPubKey = null;

            try {
                previousPubKey = fs.readFileSync(this._pubKeyFilePath, 'utf8');
            } catch {
                logger?.info?.('🔑 No previous audit WAL public key found — first boot or clean state');
                return;
            }

            // Check if a WAL file exists
            let walContents = null;

            try {
                walContents = fs.readFileSync(this._walFilePath, 'utf8');
            } catch {
                logger?.info?.('📄 No audit WAL file found — nothing to recover');
                return;
            }

            if (!walContents || walContents.trim().length === 0) {
                logger?.info?.('📄 Audit WAL file is empty — nothing to recover');
                return;
            }

            const lines = walContents.trim().split('\n');
            let recoveredCount = 0;
            let skippedCount = 0;

            for (const line of lines) {
                if (!line.trim()) continue;

                try {
                    const { entry, signature } = JSON.parse(line);
                    const entryJson = JSON.stringify(entry);
                    const isValid = this._verifyEntrySignature(entryJson, signature, previousPubKey);

                    if (isValid) {
                        this._buffer.push(entry);

                        // Update the sequence counter to be ahead of any recovered entries
                        if (entry._seq != null && entry._seq >= this._sequenceNumber) {
                            this._sequenceNumber = entry._seq + 1;
                        }

                        recoveredCount++;
                    } else {
                        logger?.warn?.(`⚠️ Audit WAL entry failed signature verification — skipped (seq: ${entry?._seq})`);
                        skippedCount++;
                    }
                } catch (parseErr) {
                    logger?.warn?.('⚠️ Malformed audit WAL line — skipped:', parseErr.message);
                    skippedCount++;
                }
            }

            logger?.info?.(`🔄 Audit WAL recovery complete: ${recoveredCount} recovered, ${skippedCount} skipped`);

            // Clean up the old WAL — these records are now in the buffer
            try {
                fs.unlinkSync(this._walFilePath);
            } catch {
                // Ignore if already gone
            }
        } catch (err) {
            logger?.error?.('Audit WAL recovery failed:', err);
        }
    }

    _clearWAL() {
        try {
            fs.writeFileSync(this._walFilePath, '', 'utf8');
        } catch {
            // Non-critical — next append will create a new file
        }
    }

    // ─── Hash Chain ──────────────────────────────────────────────────

    async getLastHash() {
        const [rows] = await this.pool.query('SELECT hash FROM audit_trail ORDER BY id DESC LIMIT 1');
        return rows.length ? rows[0].hash : null;
    }

    computeHash(entry, prevHash) {
        const hash = crypto
            .createHash('sha256')
            .update(JSON.stringify(entry) + (prevHash || ''))
            .digest('hex');
        return hash;
    }

    // ─── Buffered Record ─────────────────────────────────────────────

    record({
        user = {},
        device = {},
        action = 'UNKNOWN_ACTION',
        status = 'PENDING',
        source = 'Unknown',
        functionName = 'Unknown',
        requestId = null,
        ipAddress = null,
        impact = null,
        metadata = {},
        errorCode = null,
        sessionId = null,
        environment = 'production',
        durationMs = null
    }) {
        try {
            if (!this.enabled) {
                return { error: false };
            }

            if (!this.pool) {
                logger?.warn?.('Audit trail system not properly initialized');
                return { error: true, errorCode: 'SYSTEM::AUDIT-NOT-INITIALIZED::A::i' };
            }

            // A value outside the ENUM would reject the whole bulk INSERT and
            // take 49 innocent records down with it — coerce, don't crash.
            if (!VALID_STATUSES.has(status)) {
                status = 'PENDING';
            }

            const seq = this._sequenceNumber++;
            const recordId = generateId('AUD', 32);

            const entry = {
                _seq: seq,
                recordId,
                timestamp: new Date(),
                requestId,
                sessionId,
                userUid: user.uid || null,
                userEmail: user.email || null,
                ipAddress,
                userAgent: device.userAgent || null,
                fingerprint: device.fingerprint || null,
                source,
                functionName,
                environment,
                action,
                status,
                durationMs,
                impact,
                metadata: JSON.stringify(metadata || {}),
                errorCode
            };

            // Push to in-memory buffer
            this._buffer.push(entry);

            // Persist to WAL on disk (async, non-blocking)
            this._appendToWAL(entry);

            // Trigger flush if threshold is reached
            if (this._buffer.length >= this._flushThreshold) {
                this._flush().catch(err => {
                    logger?.error?.('Audit trail auto-flush failed:', err.message);
                });
            }

            return { error: false };
        } catch (err) {
            logger?.error?.('Failed to buffer audit record:', {
                message: err.message,
                action,
                source,
                functionName
            });
            return { error: true, errorCode: 'AUDIT-BUFFER-FAILED' };
        }
    }

    // ─── Flush Engine ────────────────────────────────────────────────

    async _flush() {
        if (this._flushing) {
            return;
        }

        if (this._buffer.length === 0) {
            return;
        }

        this._flushing = true;

        // Snapshot and clear the current buffer atomically
        const batch = this._buffer.splice(0);
        let flushed = false;

        try {
            // Sort by sequence number (safety — should already be ordered)
            batch.sort((a, b) => a._seq - b._seq);

            const conn = await this.pool.getConnection();

            try {
                await conn.beginTransaction();

                // Drop entries already persisted: a crash between the previous
                // flush's commit and its WAL truncation makes recovery replay
                // them, and re-inserting would fork the hash chain.
                const recordIds = batch.map(e => e.recordId);
                const [existing] = await conn.query('SELECT recordId FROM audit_trail WHERE recordId IN (?)', [recordIds]);
                const alreadyStored = new Set(existing.map(r => r.recordId));
                const pending = batch.filter(e => !alreadyStored.has(e.recordId));

                if (pending.length === 0) {
                    await conn.commit();
                } else {
                    // Locking read INSIDE the transaction: serializes concurrent
                    // flushers on the chain head so the hash chain cannot fork.
                    const [last] = await conn.query('SELECT hash FROM audit_trail ORDER BY id DESC LIMIT 1 FOR UPDATE');
                    let prevHash = last.length ? last[0].hash : null;

                    const rows = [];

                    for (const entry of pending) {
                        // Strip the internal _seq before hashing and inserting.
                        // The hash covers the FULL entry — every stored column —
                        // so the chain is re-verifiable from the table alone.
                        const { _seq, ...cleanEntry } = entry;

                        const hash = this.computeHash(cleanEntry, prevHash);

                        rows.push([
                            cleanEntry.recordId,
                            cleanEntry.timestamp,
                            cleanEntry.requestId,
                            cleanEntry.sessionId,
                            cleanEntry.userUid,
                            cleanEntry.userEmail,
                            cleanEntry.ipAddress,
                            cleanEntry.userAgent,
                            cleanEntry.fingerprint,
                            cleanEntry.source,
                            cleanEntry.functionName,
                            cleanEntry.environment,
                            cleanEntry.action,
                            cleanEntry.status,
                            cleanEntry.durationMs,
                            cleanEntry.impact,
                            cleanEntry.metadata,
                            cleanEntry.errorCode,
                            hash,
                            prevHash
                        ]);

                        prevHash = hash;
                    }

                    const insertSQL = `
                        INSERT INTO audit_trail (
                            recordId, timestamp, requestId, sessionId, userUid, userEmail,
                            ipAddress, userAgent, fingerprint, source, functionName,
                            environment, action, status, durationMs, impact, metadata,
                            errorCode, hash, prevHash
                        ) VALUES ?
                    `;

                    await conn.query(insertSQL, [rows]);
                    await conn.commit();

                    logger?.info?.(`[AUDIT] Flushed ${rows.length} records to database`);
                }
            } catch (txErr) {
                await conn.rollback().catch(() => {});
                throw txErr;
            } finally {
                conn.release();
            }

            flushed = true;

            // Clear the WAL — these records are now persisted in the DB
            this._clearWAL();
        } catch (err) {
            // Requeue at the FRONT of the buffer: the records stay in memory
            // (and in the WAL) for the next timer tick instead of being lost.
            this._buffer.unshift(...batch);

            logger?.error?.('Audit trail flush failed — batch requeued:', {
                message: err.message,
                code: err.code,
                bufferedCount: this._buffer.length
            });
        } finally {
            this._flushing = false;
        }

        // If the buffer grew during a SUCCESSFUL flush, recurse. Never recurse
        // after a failure — that would spin against a down database; the timer
        // retries instead.
        if (flushed && this._buffer.length >= this._flushThreshold) {
            await this._flush();
        }
    }

    /**
     * Public method to force an immediate flush regardless of threshold.
     * Used by live checks and graceful shutdown.
     */
    async forceFlush() {
        // Wait for any in-progress flush to finish
        while (this._flushing) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        await this._flush();
    }

    // ─── Timer Management ────────────────────────────────────────────

    _startFlushTimer() {
        if (this._flushTimer) {
            clearInterval(this._flushTimer);
        }

        this._flushTimer = setInterval(() => {
            if (this._buffer.length > 0 && !this._flushing) {
                this._flush().catch(err => {
                    logger?.error?.('Audit trail timer-flush failed:', err.message);
                });
            }
        }, this._flushIntervalMs);

        // Allow the process to exit without waiting for the timer
        if (this._flushTimer?.unref) {
            this._flushTimer.unref();
        }
    }

    _stopFlushTimer() {
        if (this._flushTimer) {
            clearInterval(this._flushTimer);
            this._flushTimer = null;
        }
    }

    // ─── Graceful Shutdown ───────────────────────────────────────────

    _registerShutdownHandlers() {
        const gracefulShutdown = async signal => {
            logger?.info?.(`[AUDIT] Received ${signal} — flushing ${this._buffer.length} buffered audit records...`);
            this._stopFlushTimer();

            try {
                await this.forceFlush();
                logger?.info?.('[AUDIT] Graceful flush complete');
            } catch (err) {
                logger?.error?.('[AUDIT] Graceful flush failed:', err.message);
            }
        };

        process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.once('SIGINT', () => gracefulShutdown('SIGINT'));
    }

    /**
     * Manual shutdown — call this for a controlled teardown.
     */
    async shutdown() {
        logger?.info?.('[AUDIT] Shutting down audit trail system...');
        this._stopFlushTimer();
        await this.forceFlush();
        logger?.info?.('[AUDIT] Audit trail system shut down');
    }

    // ─── Query ───────────────────────────────────────────────────────

    async query(filters = {}) {
        let sql = 'SELECT * FROM audit_trail WHERE 1=1';
        const params = [];

        for (const [key, value] of Object.entries(filters)) {
            // Filter keys are interpolated into SQL — only known columns may pass.
            if (!AuditTrailSystem.QUERYABLE_COLUMNS.has(key)) {
                throw new Error(`AuditTrailSystem.query: '${key}' is not a filterable column`);
            }
            sql += ` AND ${key} = ?`;
            params.push(value);
        }

        // id, not timestamp: the insert order that the hash chain follows.
        sql += ' ORDER BY id DESC LIMIT 1000';
        const [rows] = await this.pool.query(sql, params);
        return rows;
    }
}

export { AuditTrailSystem };
