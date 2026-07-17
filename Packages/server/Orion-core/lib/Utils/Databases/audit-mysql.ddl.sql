-- ============================================================================
-- Orion Alpine — Audit Trail DDL (MySQL, reference)
--
-- The complete effective schema of the audit database (default name
-- `orion_audit`), owned by lib/Utils/Systems/AuditTrailSystem.js. This is the
-- MySQL counterpart to ddl.sql (the PostgreSQL application schema).
--
-- ⚠ This file is NOT executed by Orion. AuditTrailSystem creates the database
--   and converges this table itself at boot (CREATE TABLE IF NOT EXISTS plus
--   guarded ALTERs for columns/indexes added since schema 2.0.0). Keep this
--   file in sync with _ensureSchema() — it is documentation and a DBA
--   convenience. It is idempotent for provisioning a fresh audit database.
--
-- Design notes:
--   * Append-only, tamper-evident log: every row carries a sha256 `hash`
--     chained to `prevHash`. Rows are never updated or deleted by Orion.
--     The chain hash covers ALL audited fields (including sessionId,
--     environment, durationMs), so the stored row is sufficient to re-verify
--     the chain end-to-end.
--   * `recordId` is UNIQUE: crash-recovery replays the on-disk WAL through
--     INSERT ... ON DUPLICATE KEY UPDATE, so a crash between the flush commit
--     and the WAL truncation cannot double-insert records.
--   * Deliberately NO foreign key to the application's users table — the
--     audit DB is a separate server/engine, and audit rows must survive user
--     deletion (that deletion is itself an audited event).
--   * `id` (AUTO_INCREMENT) is the ordering authority, not `timestamp`:
--     within a batch many rows share a timestamp, and the hash chain is
--     ordered by insert order. Readers should ORDER BY id.
--   * Not partitioned: MySQL partitioning would require the partition key in
--     every unique key, which conflicts with UNIQUE(recordId) — and replay
--     idempotency is worth more than cheap partition drops. Retention is a
--     batched DELETE on idx_audit_timestamp during low-traffic windows.
-- ============================================================================

CREATE DATABASE IF NOT EXISTS `orion_audit`
    DEFAULT CHARACTER SET utf8mb4
    DEFAULT COLLATE utf8mb4_0900_ai_ci;

USE `orion_audit`;

CREATE TABLE IF NOT EXISTS `audit_trail` (
    `id`            BIGINT PRIMARY KEY AUTO_INCREMENT,
    `recordId`      VARCHAR(48)  NOT NULL,
    `timestamp`     DATETIME(3)  NOT NULL,          -- ms precision: batch rows are distinguishable
    `requestId`     VARCHAR(128),
    `sessionId`     VARCHAR(128),
    `userUid`       VARCHAR(128),
    `userEmail`     VARCHAR(255),
    `ipAddress`     VARCHAR(45),                    -- fits IPv6
    `userAgent`     TEXT,
    `fingerprint`   VARCHAR(255),
    `source`        VARCHAR(255),
    `functionName`  VARCHAR(255),
    `environment`   VARCHAR(64),
    `action`        VARCHAR(255) NOT NULL,
    `status`        ENUM('PENDING','SUCCESS','FAILED') NOT NULL,
    `durationMs`    INT,
    `impact`        TEXT,
    `metadata`      TEXT,                           -- JSON string, deliberately NOT the JSON type:
                                                    -- MySQL normalizes JSON documents, which would
                                                    -- break byte-exact hash-chain re-verification
                                                    -- (JSON_EXTRACT still works on valid JSON text)
    `errorCode`     VARCHAR(255),
    `hash`          CHAR(64),                       -- sha256 over the full entry + prevHash
    `prevHash`      CHAR(64),
    `schemaVersion` VARCHAR(16) DEFAULT '2.1.0',

    UNIQUE KEY `uq_audit_record`      (`recordId`),           -- WAL replay idempotency
    KEY        `idx_audit_timestamp`  (`timestamp`),          -- retention sweeps, time-range reads
    KEY        `idx_audit_user_time`  (`userUid`, `timestamp`),
    KEY        `idx_audit_action_time`(`action`, `timestamp`),
    KEY        `idx_audit_request`    (`requestId`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;
