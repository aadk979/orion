/**
 * IP address resolution and range containment.
 *
 * WHAT WAS REMOVED
 *
 * This module used to carry a ~200-line risk-scoring engine — subnet
 * similarity, geolocation distance, ASN comparison, cloud-range and
 * mobile-carrier heuristics — behind `assessRisk`, `isIpPlausiblyRelated`,
 * `getIpRiskAssessment`, and an IP/user HMAC pair. None of it had a single
 * caller anywhere in the tree. It was dragging in `geoip-lite` (a bundled
 * database, ~100MB resident per process, and stale within months of any given
 * release) and `ip-to-asn` (a network call) for functionality nothing invoked.
 *
 * The judgement behind removing rather than wiring it up: a similarity score
 * built from geography and ASN is a weak signal that reads as a strong one,
 * and the system now has an actual cryptographic binding (RFC 9449 DPoP) doing
 * the job those heuristics were reaching for. Reintroducing graduated IP risk
 * is a deliberate design decision with real inputs, not something to leave
 * lying around pre-built and unreferenced.
 *
 * What remains is what is actually used: resolve the client address, reduce it
 * to a range, and answer whether an address falls inside one.
 */
import ipaddr from 'ipaddr.js';
import { logger } from './logger.js';

/**
 * Canonical range for an address.
 *
 * IPv4 is reduced to /24 and IPv6 to /64. The /64 is not arbitrary: it is the
 * standard subnet size a host is assigned, and RFC 4941 privacy extensions
 * rotate the interface identifier WITHIN it, so a /64 is what stays stable for
 * a device that has not actually moved.
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
 * Strict CIDR containment. This is a PREDICATE, not a heuristic.
 *
 * It once fell back to a similarity score when containment failed, so an
 * address in a different subnet could still be accepted on geographic
 * resemblance — a "binding" that accepted addresses it was not bound to. The
 * ranges above are already the intended tolerance; anything looser has to be
 * an explicit risk decision, made by the caller, not a silent one made here.
 *
 * Fails closed on malformed input.
 */
async function isIpInRange(ip, cidr) {
    try {
        return ipaddr.parse(ip).match(ipaddr.parseCIDR(cidr));
    } catch (e) {
        logger.error('IP validation error:', e.message);
        return false;
    }
}

/**
 * Resolves the client IP for a request.
 *
 * SECURITY: this must never read `X-Forwarded-For` directly. The leftmost entry
 * of that header is written by the client, and this value feeds token range
 * binding, step-up tokens, password reset, device authorization, the OAuth
 * callback and every IP rate-limit bucket — trusting a client-supplied value
 * there voids all of them at once.
 *
 * `req.ip` is Express's resolution, which honours the app's `trust proxy`
 * setting: with no trusted proxy it is the socket peer and the header is
 * ignored entirely; with one configured, Express walks the forwarded chain from
 * the right and stops at the first untrusted hop. Configure the hop count or
 * proxy CIDRs via `systemConfig.server.trustProxy` (see onStartConfigurations).
 *
 * Falls back to the raw socket address for non-Express callers.
 */
function getIp(req) {
    const ip = req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress;

    if (!ip) {
        throw new Error('getIp: unable to resolve a client IP for this request');
    }

    return ipaddr.parse(ip).toString();
}

const packageExports = {
    getIpRange,
    getIp,
    isIpInRange
};

export { getIpRange, getIp, isIpInRange, packageExports };
