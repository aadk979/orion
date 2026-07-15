import loki from 'lokijs';
import { R_SYNC_LOCAL_DB_NAME } from '../r_sync.meta.js';

const COLLECTIONS = Object.freeze(['workers', 'encryptionKeys', 'events']);

/** In-memory only, no disk I/O or autosave timers — keeps `node --test` from hanging */
const isTestMode =
    process.env.R_SYNC_TEST_MODE === '1' || process.env.NODE_ENV === 'test';

let dbReady = false;
let dbReadyPromise;
let dbReadyResolve;

// Create a promise that resolves when db is ready
dbReadyPromise = new Promise((resolve) => {
    dbReadyResolve = resolve;
});

const db = new loki(R_SYNC_LOCAL_DB_NAME, {
    autoload: !isTestMode,
    autoloadCallback: isTestMode ? undefined : databaseInitialize,
    autosave: !isTestMode,
    autosaveInterval: isTestMode ? undefined : 2000
});

function databaseInitialize() {
    // Ensure all required collections exist
    for (const collectionName of COLLECTIONS) {
        let collection = db.getCollection(collectionName);
        if (!collection) {
            collection = db.addCollection(collectionName, {
                unique: ['id'],
                indices: ['id']
            });
        }
    }

    dbReady = true;
    dbReadyResolve();
}

if (isTestMode) {
    databaseInitialize();
}

// Wait for db to be ready
async function waitForDb() {
    if (dbReady) return;
    await dbReadyPromise;
}

// Collection access helpers
function getWorkersCollection() {
    return db.getCollection('workers');
}

function getEncryptionKeysCollection() {
    return db.getCollection('encryptionKeys');
}

function getEventsCollection() {
    return db.getCollection('events');
}

// CRUD helpers for workers
async function addWorker(workerData) {
    await waitForDb();
    const workers = getWorkersCollection();
    return workers.insert(workerData);
}

async function getWorkerById(workerId) {
    await waitForDb();
    const workers = getWorkersCollection();
    return workers.findOne({ id: workerId });
}

async function getAllWorkers() {
    await waitForDb();
    const workers = getWorkersCollection();
    return workers.find();
}

async function updateWorker(workerId, updates) {
    await waitForDb();
    const workers = getWorkersCollection();
    const worker = workers.findOne({ id: workerId });
    if (worker) {
        Object.assign(worker, updates);
        workers.update(worker);
        return worker;
    }
    return null;
}

async function removeWorker(workerId) {
    await waitForDb();
    const workers = getWorkersCollection();
    const worker = workers.findOne({ id: workerId });
    if (worker) {
        workers.remove(worker);
        return true;
    }
    return false;
}

// CRUD helpers for encryption keys - upserts to handle key rotation
async function storeEncryptionKey(keyData) {
    await waitForDb();
    const keys = getEncryptionKeysCollection();

    // Check if key for this worker already exists
    const existingKey = keys.findOne({ workerId: keyData.workerId });

    if (existingKey) {
        // Update existing key (key rotation)
        Object.assign(existingKey, {
            sharedKey: keyData.sharedKey,
            signaturePublicKey: keyData.signaturePublicKey,
            updatedAt: keyData.createdAt,
            rotationCount: (existingKey.rotationCount || 0) + 1
        });
        keys.update(existingKey);
        return existingKey;
    } else {
        // Insert new key
        keyData.rotationCount = 0;
        return keys.insert(keyData);
    }
}

async function getEncryptionKey(keyId) {
    await waitForDb();
    const keys = getEncryptionKeysCollection();
    return keys.findOne({ id: keyId });
}

async function getEncryptionKeyByWorkerId(workerId) {
    await waitForDb();
    const keys = getEncryptionKeysCollection();
    return keys.findOne({ workerId: workerId });
}

// Event logging
async function logEvent(eventData) {
    await waitForDb();
    const events = getEventsCollection();
    return events.insert(eventData);
}

async function getRecentEvents(limit = 100) {
    await waitForDb();
    const events = getEventsCollection();
    return events.chain().simplesort('timestamp', true).limit(limit).data();
}

// Clear all data (for flush operation)
async function clearAllData() {
    await waitForDb();

    const workers = getWorkersCollection();
    const keys = getEncryptionKeysCollection();
    const events = getEventsCollection();

    // Clear all collections
    workers.clear();
    keys.clear();
    events.clear();

    // Force save to disk
    return new Promise((resolve, reject) => {
        db.saveDatabase((err) => {
            if (err) {
                reject(err);
            } else {
                resolve(true);
            }
        });
    });
}

export {
    db,
    waitForDb,
    getWorkersCollection,
    getEncryptionKeysCollection,
    getEventsCollection,
    addWorker,
    getWorkerById,
    getAllWorkers,
    updateWorker,
    removeWorker,
    storeEncryptionKey,
    getEncryptionKey,
    getEncryptionKeyByWorkerId,
    logEvent,
    getRecentEvents,
    clearAllData
};