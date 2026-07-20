class Snapshotter {
    #snapshot = undefined;
    #reverter = null;
    #resolver = null;
    #active = false;
    // Track whether revert has already been called so that resolve()
    // after revert() does not call the resolver on corrupted state. This
    // also prevents double-revert if the caller accidentally calls it twice.
    #reverted = false;

    constructor(data, reverter, resolver) {
        if (typeof reverter !== 'function') throw new TypeError('reverter must be a function');
        if (typeof resolver !== 'function') throw new TypeError('resolver must be a function');

        this.#snapshot = Snapshotter.#deepClone(data);
        this.#reverter = reverter;
        this.#resolver = resolver;
        this.#active = true;

        Object.freeze(this);
    }

    /**
     * Restore state: calls the reverter with the original snapshot.
     * Safe to call multiple times — only the first call takes effect.
     * After revert(), calling resolve() is a no-op (reverted state is
     * not "success", so the resolver should not run).
     */
    revert() {
        if (!this.#active || this.#reverted) return;
        this.#reverted = true;
        this.#reverter(Snapshotter.#deepClone(this.#snapshot));
        this.#wipe();
    }

    /**
     * Signal success: calls the resolver, then permanently deactivates
     * this Snapshotter and releases all held references.
     * No-op if revert() was already called.
     */
    resolve() {
        if (!this.#active) return;
        const resolver = this.#resolver;
        this.#wipe();
        resolver();
    }

    // ─── internal helpers ──────────────────────────────────────────────────────

    #wipe() {
        this.#snapshot = undefined;
        this.#reverter = null;
        this.#resolver = null;
        this.#active = false;
    }

    /**
     * Lean deep-clone that handles the most common JS structures without
     * pulling in a library. Covers:
     *   - primitives, null, undefined
     *   - Date, RegExp
     *   - ArrayBuffer / TypedArrays
     *   - plain Arrays and plain Objects (including nested)
     *   - Circular references (via a WeakMap)
     *
     * Class instances that aren't one of the above are stored by reference
     * (cloning arbitrary class state is impossible without cooperation from
     * the class itself).
     */
    static #deepClone(value, seen = new WeakMap()) {
        // Primitives
        if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
            return value;
        }

        // Circular reference guard
        if (seen.has(value)) return seen.get(value);

        // Date
        if (value instanceof Date) return new Date(value.getTime());

        // RegExp
        if (value instanceof RegExp) return new RegExp(value.source, value.flags);

        // ArrayBuffer
        if (value instanceof ArrayBuffer) return value.slice(0);

        // TypedArrays (Int8Array, Float64Array, etc.)
        if (ArrayBuffer.isView(value)) {
            return new value.constructor(value.buffer.slice(0), value.byteOffset, value.length);
        }

        // Array
        if (Array.isArray(value)) {
            const copy = [];
            seen.set(value, copy);
            for (let i = 0; i < value.length; i++) {
                copy[i] = Snapshotter.#deepClone(value[i], seen);
            }
            return copy;
        }

        // Plain object (Object.create(null) or {})
        if (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) {
            const copy = Object.create(Object.getPrototypeOf(value));
            seen.set(value, copy);
            for (const key of Reflect.ownKeys(value)) {
                copy[key] = Snapshotter.#deepClone(value[key], seen);
            }
            return copy;
        }

        // Anything else (class instances, functions, Maps, Sets…) – ref only
        return value;
    }
}

export { Snapshotter };
