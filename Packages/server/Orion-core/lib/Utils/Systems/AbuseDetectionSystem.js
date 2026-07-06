import { logger } from '../logger.js';

const THRESHOLDS = {
    authFailureWindowMs: 60_000,
    authFailureSoftBlock: 5,
    authFailureHardBlock: 10,
    blockDurationMs: 15 * 60_000,
    fpChurnWindowMs: 60_000,
    fpChurnThreshold: 10,
};

class AbuseDetectionSystem {
    constructor() {
        // ip → [{ timestamp }]
        this._authFailuresByIp = new Map();
        // ip → [{ fingerprint, timestamp }]
        this._fpChurnByIp = new Map();
        // ip → { blockedUntil }
        this._ipBlocks = new Map();
        // fingerprint → { blockedUntil }
        this._fpBlocks = new Map();
    }

    _pruneOldEntries(arr, windowMs) {
        const cutoff = Date.now() - windowMs;
        let i = 0;
        while (i < arr.length && arr[i].timestamp < cutoff) i++;
        if (i > 0) arr.splice(0, i);
    }

    recordAuthFailure(ip, fingerprint) {
        if (!ip) return;
        const now = Date.now();

        if (!this._authFailuresByIp.has(ip)) this._authFailuresByIp.set(ip, []);
        const failures = this._authFailuresByIp.get(ip);
        failures.push({ timestamp: now });
        this._pruneOldEntries(failures, THRESHOLDS.authFailureWindowMs);

        if (failures.length >= THRESHOLDS.authFailureHardBlock) {
            this._ipBlocks.set(ip, { blockedUntil: now + THRESHOLDS.blockDurationMs });
            logger.warn(`AbuseDetection: IP ${ip} blocked — ${failures.length} auth failures in window`);
        } else if (failures.length >= THRESHOLDS.authFailureSoftBlock) {
            logger.warn(`AbuseDetection: IP ${ip} soft threshold hit — ${failures.length} auth failures`);
        }

        if (fingerprint && ip) {
            if (!this._fpChurnByIp.has(ip)) this._fpChurnByIp.set(ip, []);
            const churnList = this._fpChurnByIp.get(ip);
            churnList.push({ fingerprint, timestamp: now });
            this._pruneOldEntries(churnList, THRESHOLDS.fpChurnWindowMs);

            const uniqueFps = new Set(churnList.map(e => e.fingerprint)).size;
            if (uniqueFps >= THRESHOLDS.fpChurnThreshold) {
                this._ipBlocks.set(ip, { blockedUntil: now + THRESHOLDS.blockDurationMs });
                logger.warn(`AbuseDetection: IP ${ip} blocked — fingerprint churn (${uniqueFps} unique fps)`);
            }
        }
    }

    recordFpBlock(fingerprint) {
        if (!fingerprint) return;
        this._fpBlocks.set(fingerprint, { blockedUntil: Date.now() + THRESHOLDS.blockDurationMs });
        logger.warn(`AbuseDetection: Fingerprint ${fingerprint.slice(0, 8)}... blocked`);
    }

    isBlocked(ip, fingerprint) {
        const now = Date.now();

        if (ip) {
            const ipBlock = this._ipBlocks.get(ip);
            if (ipBlock) {
                if (now < ipBlock.blockedUntil) {
                    return { blocked: true, reason: 'ip', unblockAt: ipBlock.blockedUntil };
                }
                this._ipBlocks.delete(ip);
            }
        }

        if (fingerprint) {
            const fpBlock = this._fpBlocks.get(fingerprint);
            if (fpBlock) {
                if (now < fpBlock.blockedUntil) {
                    return { blocked: true, reason: 'fingerprint', unblockAt: fpBlock.blockedUntil };
                }
                this._fpBlocks.delete(fingerprint);
            }
        }

        return { blocked: false };
    }

    unblock(actorId) {
        this._ipBlocks.delete(actorId);
        this._fpBlocks.delete(actorId);
        this._authFailuresByIp.delete(actorId);
        logger.info(`AbuseDetection: ${actorId} unblocked`);
    }

    getStats() {
        const now = Date.now();
        const activeIpBlocks = [...this._ipBlocks.values()].filter(v => now < v.blockedUntil).length;
        const activeFpBlocks = [...this._fpBlocks.values()].filter(v => now < v.blockedUntil).length;
        return { activeIpBlocks, activeFpBlocks };
    }
}

const abuseDetectionSystem = new AbuseDetectionSystem();

export { abuseDetectionSystem };
