class InMemoryDB {
  constructor(serviceName = "memory") {
    this.serviceName = serviceName;
    this.store = Object.create(null);
    this.ttls = Object.create(null);
    this.timers = Object.create(null);
  }

  _expire(key) {
    if (this.timers[key]) clearTimeout(this.timers[key]);
    delete this.store[key];
    delete this.ttls[key];
    delete this.timers[key];
  }

  addData(key, value, ttl) {
    this._expire(key);
    this.store[key] = (typeof value === "object" && value !== null) ? structuredClone(value) : value;

    if (ttl !== undefined) {
      const now = Math.floor(Date.now() / 1000);
      const expiresIn = ttl - now;

      if (expiresIn <= 0) {
        this._expire(key);
        return { error: false, expired: true, completed: true };
      }

      this.ttls[key] = ttl;
      this.timers[key] = setTimeout(() => this._expire(key), expiresIn * 1000);
    }

    return { error: false, completed: true };
  }

  getData(key) {
    const ttl = this.ttls[key];
    const now = Math.floor(Date.now() / 1000);

    if (ttl !== undefined && now >= ttl) {
      this._expire(key);
      return { error: false, expired: true, completed: true, exist: false };
    }

    return { error: false, data: (typeof this.store[key] === "object" && this.store[key] !== null) ? structuredClone(this.store[key]) : this.store[key] , completed: true, exist: this.store[key] !== undefined ? true : false };
  }

  has(key) {
    const ttl = this.ttls[key];
    const now = Math.floor(Date.now() / 1000);

    if (ttl !== undefined && now >= ttl) {
      this._expire(key);
      return { error: false, data: false, expired: true, completed: true };
    }

    return { error: false, data: this.store[key] !== undefined, completed: true };
  }

  getTTL(key) {
    const ttl = this.ttls[key];
    if (ttl === undefined) {
      return { error: false, data: null, completed: true };
    }

    const now = Math.floor(Date.now() / 1000);
    if (now >= ttl) {
      this._expire(key);
      return { error: false, expired: true, completed: true };
    }

    return { error: false, data: ttl - now, completed: true };
  }

  updateTTL(key, ttl) {
    if (this.store[key] === undefined) {
      return { error: false, expired: true, completed: true };
    }

    return this.addData(key, this.store[key], ttl);
  }

  removeTTL(key) {
    if (this.store[key] === undefined) {
      return { error: false, expired: true, completed: true };
    }

    if (this.timers[key]) clearTimeout(this.timers[key]);
    delete this.ttls[key];
    delete this.timers[key];

    return { error: false, completed: true };
  }

  deleteData(key) {
    if (this.store[key] === undefined) {
      return { error: false, expired: true, completed: true };
    }

    this._expire(key);
    return { error: false, completed: true };
  }

  clear() {
    for (const key in this.timers) clearTimeout(this.timers[key]);
    this.store = Object.create(null);
    this.ttls = Object.create(null);
    this.timers = Object.create(null);
    return { error: false, completed: true };
  }

  size() {
    return { error: false, data: Object.keys(this.store).length, completed: true };
  }

  keys() {
    return { error: false, data: Object.keys(this.store), completed: true };
  }

  close() {
    return { error: false, completed: true };
  }
}

export { InMemoryDB };