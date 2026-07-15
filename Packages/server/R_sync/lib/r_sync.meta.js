const __Version__ = '1.0.0';
const __Status__ = 'Stable';
const __PackageType__ = 'R_SYNC';

const PERSISTANT_ORCHESTRATOR_CONFIG_FILE = "r_sync.internal.orchestrator_config.json";
const PERSISTANT_WORKER_CONFIG_FILE = "r_sync.internal.worker_config.json";
const R_SYNC_LOCAL_DB_NAME = "r_sync.local_db.db";

const AUDIT_TRAIL_SYSTEM_SCHEMA_VERSION = '1.0.0';
const AUDIT_WAL_FILE_NAME = 'r_sync.internal.audit_wal.log';
const AUDIT_KEY_STORE_DIR_NAME = 'r_sync.internal.audit_keys';

export {
    __Version__,
    __Status__,
    __PackageType__,
    PERSISTANT_ORCHESTRATOR_CONFIG_FILE,
    PERSISTANT_WORKER_CONFIG_FILE,
    R_SYNC_LOCAL_DB_NAME,
    AUDIT_TRAIL_SYSTEM_SCHEMA_VERSION,
    AUDIT_WAL_FILE_NAME,
    AUDIT_KEY_STORE_DIR_NAME
};