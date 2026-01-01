class OrionVault {
    constructor(dbName = 'Orion-vault', storeName = 'orion-core') {
        this.dbName = dbName;
        this.storeName = storeName;
        this.db = null;
        this.dbPromise = this.initDB();
    }

    initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);

            request.onupgradeneeded = event => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName);
                }
            };

            request.onsuccess = event => {
                const db = event.target.result;

                // Handle multi-tab / worker conflicts
                db.onversionchange = () => {
                    console.warn('[OrionVault] DB closed due to version change');
                    db.close();
                    this.db = null;
                    this.dbPromise = this.initDB(); // auto-reconnect
                };

                this.db = db;
                resolve(db);
            };

            request.onerror = event => {
                reject(`DB error: ${event.target.errorCode}`);
            };

            request.onblocked = () => {
                reject('[OrionVault] DB open blocked by another context');
            };
        });
    }

    async getDB() {
        if (this.db) return this.db;
        this.db = await this.dbPromise;
        return this.db;
    }

    async setItem(key, value) {
        const db = await this.getDB();

        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.storeName, 'readwrite');
            const store = tx.objectStore(this.storeName);

            const request = store.put(value, key);
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(undefined);
        });
    }

    async getItem(key) {
        const db = await this.getDB();

        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.storeName, 'readonly');
            const store = tx.objectStore(this.storeName);

            const request = store.get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(undefined);
        });
    }

    async deleteItem(key) {
        const db = await this.getDB();

        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.storeName, 'readwrite');
            const store = tx.objectStore(this.storeName);

            const request = store.delete(key);
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(undefined);
        });
    }

    async reset() {
        // Close active connection if present
        if (this.db) {
            this.db.close();
            this.db = null;
        }

        return new Promise((resolve, reject) => {
            const deleteRequest = indexedDB.deleteDatabase(this.dbName);

            deleteRequest.onsuccess = () => {
                this.dbPromise = this.initDB();
                resolve(true);
            };

            deleteRequest.onerror = e => {
                reject(`Failed to reset DB: ${e.target.errorCode}`);
            };

            deleteRequest.onblocked = () => {
                reject('[OrionVault] Reset blocked: DB still open elsewhere');
            };
        });
    }
}

const orionVault = new OrionVault();
export { orionVault };
