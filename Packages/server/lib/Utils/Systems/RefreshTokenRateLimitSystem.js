import cron from 'node-cron';

class RefreshRateLimiter {
  constructor(windowMs = 60 * 1000, maxRequests = 10, sessionTTL = 24 * 60 * 60 * 1000) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.sessionTTL = sessionTTL; // session lifetime
    this.rateLimitMap = new Map(); // sessionId -> { count, start, createdAt }

    // Cron job to clean up expired sessions every minute
    cron.schedule('* * * * *', () => {
      const now = Date.now();
      for (const [sessionId, record] of this.rateLimitMap.entries()) {
        if (now - record.createdAt >= this.sessionTTL) {
          this.rateLimitMap.delete(sessionId);
        }
      }
    });
  }

  canRefresh(sessionId) {
    const now = Date.now();
    const record = this.rateLimitMap.get(sessionId);
    if (!record) return true; // if session not in map, allow refresh (first use)
    return record.count < this.maxRequests || now - record.start > this.windowMs;
  }

  increment(sessionId) {
    const now = Date.now();
    let record = this.rateLimitMap.get(sessionId);

    if (!record) {
      // First refresh for this session
      record = { count: 1, start: now, createdAt: now };
    } else {
      if (now - record.start > this.windowMs) {
        // Window expired, reset count
        record.count = 1;
        record.start = now;
      } else {
        record.count += 1;
      }
    }

    this.rateLimitMap.set(sessionId, record);
  }
}

export { RefreshRateLimiter };;
