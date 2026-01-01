import ipaddr from 'ipaddr.js';
import geoip from 'geoip-lite';
import crypto from 'crypto';
import asnLookup from 'ip-to-asn';
import { logger } from './logger.js';

/**
 * Configuration for risk assessment scoring
 */
const RISK_CONFIG = {
    WEIGHTS: {
        EXACT_CIDR_MATCH: 30,
        SUBNET_SIMILARITY: 20,
        GEO_LOCATION: 20,
        ASN_MATCH: 20,
        IP_REPUTATION: 5,
        PATTERN_ANALYSIS: 5
    },

    THRESHOLDS: {
        STRICT: 75,
        NORMAL: 60,
        LENIENT: 45,
        PERMISSIVE: 30
    },

    EXACT_MATCH_BONUS: 100,
    SAME_SUBNET_24: 90,
    SAME_SUBNET_16: 70,
    SAME_SUBNET_8: 50,
    SAME_COUNTRY: 40,
    SAME_REGION: 60,
    SAME_CITY: 80,
    DIFFERENT_CONTINENT: 0,

    PRIVATE_IP_BONUS: 20,
    CARRIER_GRADE_NAT_BONUS: 15,
    CLOUD_PROVIDER_PENALTY: -10
};

/**
 * Haversine formula for distance between lat/lon
 */
function geoDistance(lat1, lon1, lat2, lon2) {
    const toRad = deg => (deg * Math.PI) / 180;
    const R = 6371; // Earth radius km

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/**
 * Get canonical IP range
 */
function getIpRange(ip) {
    const addr = ipaddr.parse(ip);
    if (addr.kind() === 'ipv4') {
        const parts = ip.split('.');
        parts[3] = '0';
        return `${parts.join('.')}/24`;
    } else if (addr.kind() === 'ipv6') {
        const segments = addr.parts.slice(0, 4);
        while (segments.length < 8) segments.push(0);
        const masked = new ipaddr.IPv6(segments);
        return `${masked.toNormalizedString()}/64`;
    }
    throw new Error('Invalid IP');
}

/**
 * Subnet similarity score
 */
function calculateSubnetSimilarity(ip1, ip2) {
    const addr1 = ipaddr.parse(ip1);
    const addr2 = ipaddr.parse(ip2);
    if (addr1.kind() !== addr2.kind()) return 0;

    if (addr1.kind() === 'ipv4') {
        const p1 = ip1.split('.').map(Number);
        const p2 = ip2.split('.').map(Number);

        if (ip1 === ip2) return RISK_CONFIG.EXACT_MATCH_BONUS;
        if (p1[0] === p2[0] && p1[1] === p2[1] && p1[2] === p2[2]) return RISK_CONFIG.SAME_SUBNET_24;
        if (p1[0] === p2[0] && p1[1] === p2[1]) return RISK_CONFIG.SAME_SUBNET_16;
        if (p1[0] === p2[0]) return RISK_CONFIG.SAME_SUBNET_8;
        return 0;
    }

    // IPv6 similarity
    const seg1 = addr1.parts,
        seg2 = addr2.parts;
    if (ip1 === ip2) return RISK_CONFIG.EXACT_MATCH_BONUS;

    let matching = 0;
    for (let i = 0; i < 4; i++) {
        if (seg1[i] === seg2[i]) matching++;
        else break;
    }

    if (matching === 4) return RISK_CONFIG.SAME_SUBNET_24;
    if (matching === 3) return RISK_CONFIG.SAME_SUBNET_16;
    if (matching === 2) return RISK_CONFIG.SAME_SUBNET_8;
    if (matching === 1) return RISK_CONFIG.SAME_SUBNET_8 / 2;
    return 0;
}

/**
 * Geo score using distance + country/region/city
 */
function calculateGeoScore(ip1, ip2) {
    const g1 = geoip.lookup(ip1);
    const g2 = geoip.lookup(ip2);
    if (!g1 || !g2) return 50;

    if (g1.city && g2.city && g1.city === g2.city) return RISK_CONFIG.SAME_CITY;
    if (g1.region === g2.region && g1.country === g2.country) return RISK_CONFIG.SAME_REGION;
    if (g1.country === g2.country) return RISK_CONFIG.SAME_COUNTRY;

    if (g1.ll && g2.ll) {
        const dist = geoDistance(g1.ll[0], g1.ll[1], g2.ll[0], g2.ll[1]);
        if (dist < 500) return 60; // nearby
        if (dist < 1500) return 40; // same region
        if (dist < 5000) return 20; // same continent-ish
    }
    return RISK_CONFIG.DIFFERENT_CONTINENT;
}

/**
 * ASN check (ISP consistency)
 */
async function calculateAsnScore(ip1, ip2) {
    try {
        const a1 = await asnLookup(ip1);
        const a2 = await asnLookup(ip2);
        if (!a1 || !a2) return 50;
        return a1.asn === a2.asn ? 100 : 20; // Same ASN = very strong
    } catch {
        return 50;
    }
}

/**
 * Reputation + mobile pattern (unchanged)
 */
function analyzeIpReputation(ip) {
    const addr = ipaddr.parse(ip);
    let score = 50;
    if (addr.range() === 'private') score += RISK_CONFIG.PRIVATE_IP_BONUS;

    if (addr.kind() === 'ipv4') {
        const parts = ip.split('.').map(Number);
        const first = parts[0];
        if (first === 100 && parts[1] >= 64 && parts[1] <= 127) {
            score += RISK_CONFIG.CARRIER_GRADE_NAT_BONUS;
        }
        const cloudRanges = [3, 13, 20, 34, 35, 40, 52, 54];
        if (cloudRanges.includes(first)) score += RISK_CONFIG.CLOUD_PROVIDER_PENALTY;
    }
    return Math.max(0, Math.min(100, score));
}

function detectMobilePattern(ip) {
    const addr = ipaddr.parse(ip);
    let score = 50;
    if (addr.kind() === 'ipv4') {
        const first = Number(ip.split('.')[0]);
        if (first === 100) score += 30;
        if ([166, 167, 172, 192].includes(first)) score += 15;
    }
    return Math.max(0, Math.min(100, score));
}

/**
 * Full risk assessment
 */
async function assessRisk(currentIp, referenceIp, options = {}) {
    const { threshold = RISK_CONFIG.THRESHOLDS.NORMAL, weights = RISK_CONFIG.WEIGHTS, enableDetailedLogging = false } = options;

    const scores = {
        cidrMatch: 0,
        subnetSimilarity: calculateSubnetSimilarity(currentIp, referenceIp),
        geoLocation: calculateGeoScore(currentIp, referenceIp),
        asnMatch: await calculateAsnScore(currentIp, referenceIp),
        ipReputation: analyzeIpReputation(currentIp),
        patternAnalysis: detectMobilePattern(currentIp)
    };

    try {
        const currentAddr = ipaddr.parse(currentIp);
        const referenceRange = ipaddr.parseCIDR(getIpRange(referenceIp));
        if (currentAddr.match(referenceRange)) scores.cidrMatch = 100;
    } catch {}

    const totalScore =
        (scores.cidrMatch * weights.EXACT_CIDR_MATCH) / 100 +
        (scores.subnetSimilarity * weights.SUBNET_SIMILARITY) / 100 +
        (scores.geoLocation * weights.GEO_LOCATION) / 100 +
        (scores.asnMatch * weights.ASN_MATCH) / 100 +
        (scores.ipReputation * weights.IP_REPUTATION) / 100 +
        (scores.patternAnalysis * weights.PATTERN_ANALYSIS) / 100;

    const accepted = totalScore >= threshold;
    const riskLevel = totalScore >= 75 ? 'low' : totalScore >= 60 ? 'medium' : totalScore >= 40 ? 'high' : 'critical';

    const result = {
        accepted,
        score: Math.round(totalScore * 10) / 10,
        riskLevel,
        threshold
    };

    if (enableDetailedLogging) {
        result.breakdown = scores;
        result.weights = weights;
    }
    return result;
}

/**
 * Main IP validation
 */
async function isIpInRange(ip, cidr, options = {}) {
    try {
        const addr = ipaddr.parse(ip);
        const range = ipaddr.parseCIDR(cidr);
        if (addr.match(range)) return true;

        const referenceIp = cidr.split('/')[0];
        const assessment = await assessRisk(ip, referenceIp, options);
        return assessment.accepted;
    } catch (e) {
        logger.error('IP validation error:', e.message);
        return false;
    }
}

/**
 * Get detailed breakdown
 */
async function getIpRiskAssessment(currentIp, referenceIp, options = {}) {
    return await assessRisk(currentIp, referenceIp, {
        ...options,
        enableDetailedLogging: true
    });
}

/**
 * IP extraction + fingerprint helpers
 */
function getIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded ? forwarded.split(',')[0].trim() : req.connection.remoteAddress;
    return ipaddr.parse(ip).toString();
}

function generateIpFingerprint(ip, userId, secret) {
    const data = `${ip}:${userId}`;
    return crypto.createHmac('sha256', secret).update(data).digest('hex').substring(0, 16);
}

function verifyIpFingerprint(ip, userId, fingerprint, secret) {
    const expected = generateIpFingerprint(ip, userId, secret);
    return fingerprint.length === expected.length && crypto.timingSafeEqual(Buffer.from(fingerprint), Buffer.from(expected));
}

const packageExports = {
    getIpRange,
    getIp,
    isIpInRange
};

export { getIpRange, getIp, isIpInRange, getIpRiskAssessment, generateIpFingerprint, verifyIpFingerprint, RISK_CONFIG, packageExports };
