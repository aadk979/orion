const { MongoClient } = require('mongodb');
const { logger } = require('../logger');

class MongoService {
    constructor() {
        this.client = null;
        this.db = null;
        this.initialized = false;
    }

    async initialize(cred, dbName = 'default') {
        try {
            const uri = cred.uri || undefined;

            if (!uri || typeof uri !== 'string') {
                throw new Error('Missing or invalid MongoDB URI');
            }

            this.client = new MongoClient(uri, {
                useNewUrlParser: true,
                useUnifiedTopology: true,
            });

            await this.client.connect();
            this.db = this.client.db(dbName);
            this.initialized = true;
            logger.info(`✅ MongoDB connected to '${dbName}'`);
            return true;
        } catch (err) {
            logger.error('Initialization Error:', err.message);
            return false;
        }
    }

    ensureInitialized() {
        if (!this.initialized || !this.db) {
            throw new Error('MongoDB is not initialized. Call initialize() first.');
        }
    }

    async addData(collectionName, docId, data) {
        try {
            this.ensureInitialized();

            const collection = this.db.collection(collectionName);
            const existing = await collection.findOne({ _id: docId });

            if (existing) throw new Error('Document already exists!');

            await collection.insertOne({ _id: docId, ...data });

            return { completed: true, error: false };
        } catch (err) {
            logger.error('Add Error:', err.message);
            return { error: true, context: 'DB-FAIL', errorArray: [err.message] };
        }
    }

    async getData(collectionName, docId) {
        try {
            this.ensureInitialized();

            const collection = this.db.collection(collectionName);
            const doc = await collection.findOne({ _id: docId });

            if (!doc) {
                return undefined
            }

            return { error: false, data: doc, completed: true };
        } catch (err) {
            logger.error('Get Error:', err.message);
            return { error: true, context: 'DB-FAIL', errorArray: [err.message] };
        }
    }

    async deleteData(collectionName, docId) {
        try {
            this.ensureInitialized();

            const collection = this.db.collection(collectionName);
            const result = await collection.deleteOne({ _id: docId });

            if (result.deletedCount === 0) throw new Error('Document not found!');

            return { completed: true, error: false };
        } catch (err) {
            logger.error('Delete Error:', err.message);
            return { error: true, context: 'DB-FAIL', errorArray: [err.message] };
        }
    }

    async close() {
        try {
            if (this.client) await this.client.close();
            this.initialized = false;
            logger.info('MongoDB connection closed');
        } catch (err) {
            logger.error('Close Error:', err.message);
        }
    }
}

module.exports = { MongoService };