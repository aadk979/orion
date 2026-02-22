import mysql from 'mysql2/promise';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { logger } from '../logger.js';
import { globalAccessPoint } from '../GlobalAccessPoint.js';
import { generateId } from '../valueGenerator.js';
import {
    AUDIT_TRAIL_SYSTEM_SCHEMA_VERSION,
    AUDIT_WAL_FILE_NAME,
    AUDIT_WAL_PUBLIC_KEY_FILE_NAME
} from '../../orion.meta.js';

const DEFAULT_FLUSH_THRESHOLD = 50;
const DEFAULT_FLUSH_INTERVAL_MS = 30_000;

class AuditTrailSystem {
    constructor(enabled) {
        if (enabled) {
            const systemConfig = globalAccessPoint.systemConfig();
            this.enabled = true;

            this.config = {
                host: systemConfig?.utilities?.auditTrailSystem?.host || 'localhost',
                user: systemConfig?.utilities?.auditTrailSystem?.user || 'root',
                password: systemConfig?.utilities?.auditTrailSystem?.password || 'SecurePassword1234',
                database: systemConfig?.utilities?.auditTrailSystem?.database || 'orion_audit',
                waitForConnections: true,
                connectionLimit: 10,
                queueLimit: 0
            };

            this.pool = mysql.createPool({
                host: this.config.host,
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

            const [databases] = await conn.query(`SHOW DATABASES LIKE '${this.config.database}'`);

            if (databases.length === 0) {
                logger?.info?.(`📊 Creating audit database: ${this.config.database}`);
                await conn.query(`CREATE DATABASE \`${this.config.database}\``);
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

    // ─── Initialize ──────────────────────────────────────────────────

    async initialize() {
        try {
            if (!this.enabled) {
                return;
            }

            await this.createDatabaseIfNotExists();

            const query = `
                CREATE TABLE IF NOT EXISTS audit_trail (
                id BIGINT PRIMARY KEY AUTO_INCREMENT,
                recordId VARCHAR(48) NOT NULL,
                timestamp DATETIME NOT NULL,
                requestId VARCHAR(128),
                userUid VARCHAR(128),
                userEmail VARCHAR(255),
                ipAddress VARCHAR(45),
                userAgent TEXT,
                fingerprint VARCHAR(255),
                source VARCHAR(255),
                functionName VARCHAR(255),
                action VARCHAR(255) NOT NULL,
                status ENUM('PENDING','SUCCESS','FAILED') NOT NULL,
                impact TEXT,
                metadata JSON,
                errorCode VARCHAR(255),
                hash CHAR(64),
                prevHash CHAR(64),
                schemaVersion VARCHAR(16) DEFAULT '${AUDIT_TRAIL_SYSTEM_SCHEMA_VERSION}'
                );
            `;

            const conn = await this.pool.getConnection();
            await conn.query(query);
            conn.release();

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
            return crypto.verify(
                null,
                Buffer.from(entryJson, 'utf8'),
                publicKeyPem,
                Buffer.from(signatureBase64, 'base64')
            );
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
                return { error: true, errorCode: 'AUDIT-SYSTEM-NOT-INITIALIZED' };
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

        try {
            // Snapshot and clear the current buffer atomically
            const batch = this._buffer.splice(0);

            // Sort by sequence number (safety — should already be ordered)
            batch.sort((a, b) => a._seq - b._seq);

            // Fetch the last hash from the database
            let prevHash = await this.getLastHash();

            // Build the hash chain across the batch
            const rows = [];

            for (const entry of batch) {
                // Strip the internal _seq before hashing and inserting
                const { _seq, ...cleanEntry } = entry;

                const hash = this.computeHash(cleanEntry, prevHash);

                rows.push([
                    cleanEntry.recordId,
                    cleanEntry.timestamp,
                    cleanEntry.requestId,
                    cleanEntry.userUid,
                    cleanEntry.userEmail,
                    cleanEntry.ipAddress,
                    cleanEntry.userAgent,
                    cleanEntry.fingerprint,
                    cleanEntry.source,
                    cleanEntry.functionName,
                    cleanEntry.action,
                    cleanEntry.status,
                    cleanEntry.impact,
                    cleanEntry.metadata,
                    cleanEntry.errorCode,
                    hash,
                    prevHash
                ]);

                prevHash = hash;
            }

            // Bulk INSERT inside a single transaction
            const conn = await this.pool.getConnection();

            try {
                await conn.beginTransaction();

                const insertSQL = `
                    INSERT INTO audit_trail (
                        recordId, timestamp, requestId, userUid, userEmail, ipAddress,
                        userAgent, fingerprint, source, functionName, action, status,
                        impact, metadata, errorCode, hash, prevHash
                    ) VALUES ?
                `;

                await conn.query(insertSQL, [rows]);
                await conn.commit();

                logger?.info?.(`[AUDIT] Flushed ${batch.length} records to database`);
            } catch (txErr) {
                await conn.rollback().catch(() => { });
                throw txErr;
            } finally {
                conn.release();
            }

            // Clear the WAL — these records are now persisted in the DB
            this._clearWAL();
        } catch (err) {
            logger?.error?.('Audit trail flush failed:', {
                message: err.message,
                code: err.code,
                bufferedCount: this._buffer.length
            });
        } finally {
            this._flushing = false;
        }

        // If the buffer grew during flush, recurse
        if (this._buffer.length >= this._flushThreshold) {
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
            sql += ` AND ${key} = ?`;
            params.push(value);
        }

        sql += ' ORDER BY timestamp DESC LIMIT 1000';
        const [rows] = await this.pool.query(sql, params);
        return rows;
    }
}

export { AuditTrailSystem };
