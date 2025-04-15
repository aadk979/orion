const admin = require('firebase-admin');
const { logger } = require('../logger');

class FirestoreService {
  constructor() {
    this.db = null;
    this.initialized = false;
  }

  initialize(cred) {
    try {
      if (!cred || typeof cred !== 'object') {
        throw new Error('Missing or invalid credentials object');
      }

      admin.initializeApp({
        credential: admin.credential.cert(cred),
      });

      this.db = admin.firestore();
      this.initialized = true;
      logger.info('Firebase initialized successfully');
      return true;
    } catch (err) {
      logger.error('Initialization Error:', err.message);
      return false;
    }
  }

  ensureInitialized() {
    if (!this.initialized || !this.db) {
      throw new Error('Firestore is not initialized. Call initialize() first.');
    }
  }

  async addData(collectionName, docId, data) {
    try {
      this.ensureInitialized();

      const docRef = this.db.collection(collectionName).doc(docId);
      await this.db.runTransaction(async (t) => {
        const doc = await t.get(docRef);
        t.set(docRef, data);
      });


      return { completed: true, error: false }
    } catch (err) {
      logger.error('Add Error:', err.message);
      return { error: true, context: "DB-FAIL", errorArray: [err.message] };
    }
  }

  async getData(collectionName, docId) {
    try {
      this.ensureInitialized();

      const docRef = this.db.collection(collectionName).doc(docId);
      const result = await this.db.runTransaction(async (t) => {
        const doc = await t.get(docRef);
        if (!doc.exists) {
          return undefined;
        };
        return doc.data();
      });

      return { error: false, data: result, completed: true };
    } catch (err) {
      logger.error('Get Error:', err.message);
      return { error: true, context: "DB-FAIL", errorArray: [err.message] };
    }
  }

  async deleteData(collectionName, docId) {
    try {
      this.ensureInitialized();

      const docRef = this.db.collection(collectionName).doc(docId);
      await this.db.runTransaction(async (t) => {
        const doc = await t.get(docRef);
        t.delete(docRef);
      });

      return { completed: true, error: false }
    } catch (err) {
      logger.error('Delete Error:', err.message);
      return { error: true, context: "DB-FAIL", errorArray: [err.message] };
    }
  }
}

module.exports = { FirestoreService };