import mysql from 'mysql2/promise';
import crypto from 'crypto';
import { logger } from '../logger.js';
import { globalAccessPoint } from '../GlobalAccessPoint.js';

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
        }

        if (!enabled) {
            this.enabled = false;
            logger.info('Audit Trail System disabled');
        }
    }

    getPool() {
        return this.pool;
    }

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

    async initialize() {
        try {
            if (!this.enabled) {
                return;
            }

            await this.createDatabaseIfNotExists();

            const query = `
        CREATE TABLE IF NOT EXISTS audit_trail (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          timestamp DATETIME NOT NULL,
          requestId VARCHAR(128),
          userUid VARCHAR(128),
          userEmail VARCHAR(255),
          ipAddress VARCHAR(45),
          userAgent TEXT,
          fingerprint VARCHAR(255),
          source VARCHAR(255),
          functionName VARCHAR(255),
          action VARCHAR(128) NOT NULL,
          status ENUM('PENDING','SUCCESS','FAILED') NOT NULL,
          impact TEXT,
          metadata JSON,
          errorCode VARCHAR(255),
          hash CHAR(64),
          prevHash CHAR(64),
          schemaVersion VARCHAR(16) DEFAULT '1.0.0'
        );
      `;
            const conn = await this.pool.getConnection();
            await conn.query(query);
            conn.release();
            logger?.info?.('✅ AuditTrail table initialized');
        } catch (error) {
            logger?.error?.('Failed to initialize audit trail system:', error);
            throw error;
        }
    }

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

    async record({
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
                return;
            }

            if (!this.pool) {
                logger?.warn?.('Audit trail system not properly initialized');
                return { error: true, errorCode: 'AUDIT-SYSTEM-NOT-INITIALIZED' };
            }

            const timestamp = new Date();
            const prevHash = await this.getLastHash();

            const entry = {
                timestamp,
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

            const hash = this.computeHash(entry, prevHash);

            await this.pool.query(
                `
        INSERT INTO audit_trail (
          timestamp, requestId, userUid, userEmail, ipAddress,
          userAgent, fingerprint, source, functionName, action, status,
          impact, metadata, errorCode, hash, prevHash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
                [
                    timestamp,
                    requestId,
                    entry.userUid,
                    entry.userEmail,
                    ipAddress,
                    entry.userAgent,
                    entry.fingerprint,
                    source,
                    functionName,
                    action,
                    status,
                    impact,
                    entry.metadata,
                    errorCode,
                    hash,
                    prevHash
                ]
            );

            logger?.info?.(`[AUDIT] ${action} - ${status}`);
            return { error: false, hash };
        } catch (err) {
            logger?.error?.('Failed to record audit trail:', {
                message: err.message,
                code: err.code,
                action: action,
                source: source,
                functionName: functionName
            });
            return { error: true, errorCode: 'AUDIT-INSERT-FAILED' };
        }
    }

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
