/**
 * Sliding-window rate limiter — this node's send budget.
 *
 * Records the timestamp of each send and, when the window is full, waits
 * precisely until the oldest one falls out of it.
 *
 * It is not a per-group pause: the window follows the sends, so a node that has
 * been idle can send its next full window immediately and one that has just
 * burst waits exactly as long as it must. Providers throttle on a rolling
 * basis, so this matches what is actually being enforced upstream.
 */
class SlidingRateLimiter {
    constructor(limit, windowMs) {
        this.limit = Math.max(1, Number(limit) || 1);
        this.windowMs = Math.max(1, Number(windowMs) || 1);
        this.timestamps = [];
    }

    /** Milliseconds to wait before the next send is permitted (0 = now). */
    delayUntilAllowed(now = Date.now()) {
        this.timestamps = this.timestamps.filter(t => now - t < this.windowMs);
        if (this.timestamps.length < this.limit) return 0;
        return Math.max(0, this.windowMs - (now - this.timestamps[0]));
    }

    record(now = Date.now()) {
        this.timestamps.push(now);
    }

    async wait(sleep = ms => new Promise(resolve => setTimeout(resolve, ms))) {
        let delay = this.delayUntilAllowed();
        while (delay > 0) {
            await sleep(delay);
            delay = this.delayUntilAllowed();
        }
    }
}

export { SlidingRateLimiter };
