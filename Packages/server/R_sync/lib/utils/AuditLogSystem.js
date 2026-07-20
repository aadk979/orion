import mysql from 'mysql2/promise';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';
import { globalAccessPoint } from './globalAccessPoint.js';
import { generateId } from './valueGenerators.js';
import { AUDIT_TRAIL_SYSTEM_SCHEMA_VERSION, AUDIT_WAL_FILE_NAME, AUDIT_KEY_STORE_DIR_NAME } from '../r_sync.meta.js';

const DEFAULT_FLUSH_THRESHOLD = 50;
const DEFAULT_FLUSH_INTERVAL_MS = 30_000;

class AuditTrailSystem {
    constructor(enabled = false) {
        const callerDir = process.cwd();
        this._fileAuditPath = path.resolve(callerDir, 'logs', 'r_sync.audit.jsonl');

        let systemConfig;
        try {
            systemConfig = globalAccessPoint.getValue('systemConfig');
        } catch (e) {
            systemConfig = {};
        }

        const util = systemConfig?.utilities?.auditTrailSystem;
        const configEnabled = util?.enabled ?? enabled;

        const passwordFromConfig = util && Object.prototype.hasOwnProperty.call(util, 'password') ? util.password : undefined;
        const password = passwordFromConfig !== undefined ? passwordFromConfig : process.env.R_SYNC_AUDIT_DB_PASSWORD;

        if (configEnabled) {
            if (password === undefined) {
                logger?.warn?.(
                    'AuditTrailSystem: MySQL audit is enabled but no password is configured. Set utilities.auditTrailSystem.password or R_SYNC_AUDIT_DB_PASSWORD. Using JSONL file audit only.'
                );
                this.enabled = false;
                this.pool = null;
            } else {
                this.enabled = true;

                this.config = {
                    host: util?.host || 'localhost',
                    user: util?.user || 'root',
                    password: String(password),
                    database: util?.database || 'orion_audit',
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

                this._buffer = [];
                this._sequenceNumber = 0;
                this._flushing = false;
                this._flushThreshold = util?.flushThreshold || DEFAULT_FLUSH_THRESHOLD;
                this._flushIntervalMs = util?.flushIntervalMs || DEFAULT_FLUSH_INTERVAL_MS;
                this._flushTimer = null;

                this._signingKeyPair = null;
                this._currentKeyId = null;

                this._walFilePath = path.resolve(callerDir, AUDIT_WAL_FILE_NAME);
                this._keyStoreDir = path.resolve(callerDir, AUDIT_KEY_STORE_DIR_NAME);

                if (!fs.existsSync(this._keyStoreDir)) {
                    try {
                        fs.mkdirSync(this._keyStoreDir, { recursive: true });
                    } catch (err) {
                        logger?.error?.('Failed to create audit key store directory:', err);
                    }
                }
            }
        } else {
            this.enabled = false;
            this.pool = null;
        }

        if (!this.enabled) {
            logger?.info?.('AuditTrailSystem: MySQL audit off — security audit events append to logs/r_sync.audit.jsonl');
        }
    }

    _appendJsonlAudit(lineObj) {
        try {
            const dir = path.dirname(this._fileAuditPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.appendFileSync(this._fileAuditPath, JSON.stringify(lineObj) + '\n', 'utf8');
        } catch (err) {
            logger?.error?.('Audit JSONL write failed:', err.message);
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
            }
            conn.release();

            // Re-create pool to select the database. End the bootstrap pool
            // first so its connections are not leaked.
            const bootstrapPool = this.pool;
            this.pool = mysql.createPool(this.config);
            await bootstrapPool.end().catch(err => {
                logger?.warn?.('Failed to close bootstrap audit pool:', err.message);
            });
        } catch (error) {
            logger?.error?.('Failed to create audit database:', error);
            throw error;
        }
    }

    // ─── Initialize ──────────────────────────────────────────────────

    async initialize() {
        try {
            if (!this.enabled) return;

            await this.createDatabaseIfNotExists();

            // M2M Specific Schema
            const query = `
                CREATE TABLE IF NOT EXISTS m2m_audit_log (
                    id BIGINT PRIMARY KEY AUTO_INCREMENT,
                    recordId VARCHAR(48) NOT NULL,
                    timestamp DATETIME NOT NULL,
                    actorId VARCHAR(128) NOT NULL COMMENT 'WorkerID, Orchestrator, or IP',
                    actionType VARCHAR(64) NOT NULL COMMENT 'Event name or Action',
                    resource VARCHAR(128) COMMENT 'Target ID or System Component',
                    ipAddress VARCHAR(45),
                    userAgent TEXT,
                    signingKeyId VARCHAR(128) NOT NULL,
                    outcome ENUM('SUCCESS', 'FAILURE', 'PENDING', 'DENIED') DEFAULT 'PENDING',
                    severity ENUM('INFO', 'WARN', 'ERROR', 'CRITICAL') DEFAULT 'INFO',
                    metadata JSON,
                    hash CHAR(64),
                    prevHash CHAR(64),
                    schemaVersion VARCHAR(16) DEFAULT '${AUDIT_TRAIL_SYSTEM_SCHEMA_VERSION}',
                    INDEX idx_actor (actorId),
                    INDEX idx_action (actionType),
                    INDEX idx_timestamp (timestamp),
                    INDEX idx_key (signingKeyId)
                );
            `;

            const conn = await this.pool.getConnection();
            await conn.query(query);

            // Schema Migration: Attempt to add columns if they don't exist
            try {
                await conn.query(`ALTER TABLE m2m_audit_log ADD COLUMN ipAddress VARCHAR(45) AFTER resource`);
            } catch (e) {}
            try {
                await conn.query(`ALTER TABLE m2m_audit_log ADD COLUMN userAgent TEXT AFTER ipAddress`);
            } catch (e) {}
            try {
                await conn.query(`ALTER TABLE m2m_audit_log ADD COLUMN signingKeyId VARCHAR(128) NOT NULL AFTER userAgent`);
            } catch (e) {}

            conn.release();

            this._generateSigningKeyPair();
            await this._recoverFromWAL();
            this._startFlushTimer();
            this._registerShutdownHandlers();

            logger?.info?.(`✅ AuditTrail system initialized for M2M (DB: ${this.config.database})`);
        } catch (error) {
            logger?.error?.('Failed to initialize audit trail system:', error);
            throw error;
        }
    }

    // ─── Signing Key Management ──────────────────────────────────────

    _generateSigningKeyPair() {
        // Generate new key pair
        const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
        });

        // Generate Key ID (SHA-256 fingerprint of public key)
        const keyHash = crypto.createHash('sha256').update(publicKey).digest('hex');
        const keyId = `key_${keyHash.substring(0, 16)}`;

        this._signingKeyPair = { publicKey, privateKey };
        this._currentKeyId = keyId;

        // Persist Public Key
        const keyData = {
            id: keyId,
            publicKey: publicKey,
            createdAt: new Date().toISOString(),
            algorithm: 'Ed25519'
        };

        const keyPath = path.join(this._keyStoreDir, `${keyId}.json`);

        try {
            if (!fs.existsSync(this._keyStoreDir)) {
                fs.mkdirSync(this._keyStoreDir, { recursive: true });
            }
            fs.writeFileSync(keyPath, JSON.stringify(keyData, null, 2), 'utf8');
            logger?.info?.(`🔑 Audit signing key generated and stored: ${keyId}`);
        } catch (err) {
            logger?.error?.('Failed to store audit public key:', err);
        }
    }

    _signEntry(entryJson) {
        const sign = crypto.sign(null, Buffer.from(entryJson, 'utf8'), this._signingKeyPair.privateKey);
        return sign.toString('base64');
    }

    _verifyEntrySignature(entryJson, signatureBase64, keyId) {
        try {
            // Load key from store
            const keyPath = path.join(this._keyStoreDir, `${keyId}.json`);
            if (!fs.existsSync(keyPath)) {
                logger?.warn?.(`⚠️ Missing public key for verification: ${keyId}`);
                return false;
            }

            const keyData = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
            const publicKeyPem = keyData.publicKey;

            return crypto.verify(null, Buffer.from(entryJson, 'utf8'), publicKeyPem, Buffer.from(signatureBase64, 'base64'));
        } catch (err) {
            logger?.warn?.(`Signature verification error for ${keyId}:`, err.message);
            return false;
        }
    }

    // ─── WAL (Write-Ahead Log) ───────────────────────────────────────

    _appendToWAL(entry) {
        try {
            const entryJson = JSON.stringify(entry);
            const signature = this._signEntry(entryJson);
            // We don't strictly need to store keyId in the wrapper if it's in the entry, but fine to have it
            const walLine = JSON.stringify({ entry, signature }) + '\n';

            fs.appendFile(this._walFilePath, walLine, 'utf8', err => {
                if (err) logger?.error?.('Failed to append to audit WAL:', err.message);
            });
        } catch (err) {
            logger?.error?.('WAL append serialization error:', err.message);
        }
    }

    async _recoverFromWAL() {
        try {
            let walContents = null;
            try {
                walContents = fs.readFileSync(this._walFilePath, 'utf8');
            } catch {
                return; // No WAL file
            }

            if (!walContents || walContents.trim().length === 0) {
                return;
            }

            const lines = walContents.trim().split('\n');
            let recoveredCount = 0;
            let skippedCount = 0;

            for (const line of lines) {
                if (!line.trim()) continue;

                try {
                    const { entry, signature } = JSON.parse(line);

                    // Recover keyId from entry
                    const keyId = entry.signingKeyId;
                    if (!keyId) {
                        logger?.warn?.('⚠️ WAL entry missing signingKeyId - skipping');
                        skippedCount++;
                        continue;
                    }

                    const entryJson = JSON.stringify(entry);
                    const isValid = this._verifyEntrySignature(entryJson, signature, keyId);

                    if (isValid) {
                        this._buffer.push(entry);

                        if (entry._seq != null && entry._seq >= this._sequenceNumber) {
                            this._sequenceNumber = entry._seq + 1;
                        }

                        recoveredCount++;
                    } else {
                        logger?.warn?.(`⚠️ WAL entry failed signature verification - skipped (seq: ${entry?._seq})`);
                        skippedCount++;
                    }
                } catch (parseErr) {
                    logger?.warn?.('⚠️ Malformed audit WAL line - skipped:', parseErr.message);
                    skippedCount++;
                }
            }

            if (recoveredCount > 0) {
                logger?.info?.(`🔄 Audit WAL recovery complete: ${recoveredCount} records recovered`);
                try {
                    fs.unlinkSync(this._walFilePath);
                } catch {}
            }
        } catch (err) {
            logger?.error?.('Audit WAL recovery failed:', err);
        }
    }

    _clearWAL() {
        try {
            fs.writeFileSync(this._walFilePath, '', 'utf8');
        } catch {}
    }

    // ─── Hash Chain ──────────────────────────────────────────────────

    async getLastHash() {
        const [rows] = await this.pool.query('SELECT hash FROM m2m_audit_log ORDER BY id DESC LIMIT 1');
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
        actorId = 'UNKNOWN',
        actionType = 'UNKNOWN',
        resource = 'SYSTEM',
        outcome = 'SUCCESS',
        severity = 'INFO',
        ipAddress = null,
        userAgent = null,
        metadata = {}
    }) {
        try {
            const cleanMetadata = metadata ? JSON.parse(JSON.stringify(metadata)) : {};
            const finalIp = ipAddress || cleanMetadata.ip || cleanMetadata.requestIp || cleanMetadata.ipAddress || null;
            const finalUA = userAgent || cleanMetadata.userAgent || cleanMetadata.UserAgent || null;

            const recordId = generateId('AUD', 32);
            const jsonlBase = {
                recordId,
                isoTimestamp: new Date().toISOString(),
                actorId: String(actorId).substring(0, 128),
                actionType: String(actionType).substring(0, 64),
                resource: String(resource).substring(0, 128),
                ipAddress: finalIp ? String(finalIp).substring(0, 45) : null,
                userAgent: finalUA ? String(finalUA) : null,
                outcome,
                severity,
                metadata: cleanMetadata
            };
            const integrityHash = crypto.createHash('sha256').update(JSON.stringify(jsonlBase)).digest('hex');
            const jsonlEntry = { ...jsonlBase, integrityHash };

            if (!this.enabled || !this.pool) {
                this._appendJsonlAudit(jsonlEntry);
                return { error: false };
            }

            const seq = this._sequenceNumber++;

            const entry = {
                _seq: seq,
                recordId,
                timestamp: new Date(),
                actorId: String(actorId).substring(0, 128),
                actionType: String(actionType).substring(0, 64),
                resource: String(resource).substring(0, 128),
                ipAddress: finalIp ? String(finalIp).substring(0, 45) : null,
                userAgent: finalUA ? String(finalUA) : null,
                signingKeyId: this._currentKeyId,
                outcome,
                severity,
                metadata: JSON.stringify(cleanMetadata)
            };

            this._buffer.push(entry);
            this._appendToWAL(entry);

            if (this._buffer.length >= this._flushThreshold) {
                this._flush().catch(err => {
                    logger?.error?.('Audit trail auto-flush failed:', err.message);
                });
            }

            return { error: false };
        } catch (err) {
            logger?.error?.('Failed to buffer audit record:', err.message);
            return { error: true };
        }
    }

    // ─── Flush Engine ────────────────────────────────────────────────

    async _flush() {
        if (this._flushing || this._buffer.length === 0) return;

        this._flushing = true;

        try {
            const batch = this._buffer.splice(0);
            batch.sort((a, b) => a._seq - b._seq);

            let prevHash = await this.getLastHash();
            const rows = [];

            for (const entry of batch) {
                const { _seq, ...cleanEntry } = entry;

                const hash = this.computeHash(cleanEntry, prevHash);

                rows.push([
                    cleanEntry.recordId,
                    cleanEntry.timestamp,
                    cleanEntry.actorId,
                    cleanEntry.actionType,
                    cleanEntry.resource,
                    cleanEntry.ipAddress,
                    cleanEntry.userAgent,
                    cleanEntry.signingKeyId,
                    cleanEntry.outcome,
                    cleanEntry.severity,
                    cleanEntry.metadata,
                    hash,
                    prevHash
                ]);

                prevHash = hash;
            }

            const conn = await this.pool.getConnection();

            try {
                await conn.beginTransaction();

                const insertSQL = `
                    INSERT INTO m2m_audit_log (
                        recordId, timestamp, actorId, actionType, resource, 
                        ipAddress, userAgent, signingKeyId, outcome, severity, 
                        metadata, hash, prevHash
                    ) VALUES ?
                `;

                await conn.query(insertSQL, [rows]);
                await conn.commit();

                logger?.info?.(`[AUDIT] Flushed ${batch.length} records to database`);
            } catch (txErr) {
                await conn.rollback().catch(() => {});
                throw txErr;
            } finally {
                conn.release();
            }

            this._clearWAL();
        } catch (err) {
            logger?.error?.('Audit trail flush failed:', err.message);
            // In a real system, you might want to push back to buffer or WAL logic
        } finally {
            this._flushing = false;
        }

        if (this._buffer.length >= this._flushThreshold) {
            await this._flush();
        }
    }

    async forceFlush() {
        while (this._flushing) await new Promise(r => setTimeout(r, 50));
        await this._flush();
    }

    _startFlushTimer() {
        this._stopFlushTimer();
        this._flushTimer = setInterval(() => {
            if (this._buffer.length > 0) this._flush();
        }, this._flushIntervalMs);
        if (this._flushTimer?.unref) this._flushTimer.unref();
    }

    _stopFlushTimer() {
        if (this._flushTimer) {
            clearInterval(this._flushTimer);
            this._flushTimer = null;
        }
    }

    _registerShutdownHandlers() {
        const handler = async () => {
            this._stopFlushTimer();
            await this.forceFlush();
        };
        process.once('SIGTERM', handler);
        process.once('SIGINT', handler);
    }
}

const auditLogger = new AuditTrailSystem();
auditLogger.initialize().catch(err => {
    logger?.error?.('AuditTrailSystem initialize failed:', err.message);
});

export { AuditTrailSystem, auditLogger };
