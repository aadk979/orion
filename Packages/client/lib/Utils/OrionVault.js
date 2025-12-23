class OrionVault {
    constructor(dbName = 'Orion-vault', storeName = 'orion-core') {
        this.dbName = dbName;
        this.storeName = storeName;
        this.dbPromise = this.initDB();
    }

    async initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName);
                }
            };

            request.onsuccess = (event) => {
                resolve(event.target.result);
            };

            request.onerror = (event) => {
                reject(`DB error: ${event.target.errorCode}`);
            };
        });
    }

    async setItem(key, value) {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.storeName, 'readwrite');
            const store = tx.objectStore(this.storeName);
            const request = store.put(value, key);
            request.onsuccess = () => resolve(true);
            request.onerror = (e) => reject(undefined);
        });
    }

    async getItem(key) {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.storeName, 'readonly');
            const store = tx.objectStore(this.storeName);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(undefined);
        });
    }

    async deleteItem(key) {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.storeName, 'readwrite');
            const store = tx.objectStore(this.storeName);
            const request = store.delete(key);
            request.onsuccess = () => resolve(true);
            request.onerror = (e) => reject(undefined);
        });
    }

    async reset() {
        return new Promise((resolve, reject) => {
            const deleteRequest = indexedDB.deleteDatabase(this.dbName);
            deleteRequest.onsuccess = () => {
                this.dbPromise = this.initDB(); // Reinitialize DB after deletion
                resolve(true);
            };
            deleteRequest.onerror = (e) => reject(`Failed to reset DB: ${e.target.errorCode}`);
            deleteRequest.onblocked = () => reject('DB reset blocked, please close other connections');
        });
    }
}

const orionVault = new OrionVault();

export { orionVault };