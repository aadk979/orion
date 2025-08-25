const ipaddr = require('ipaddr.js');

function getIpRange(ip) {
  const addr = ipaddr.parse(ip);

  if (addr.kind() === 'ipv4') {
    const parts = ip.split('.');
    parts[3] = '0';
    return `${parts.join('.')}/24`;
  } else if (addr.kind() === 'ipv6') {
    const segments = addr.parts.slice(0, 4);
    while (segments.length < 8) {
      segments.push(0);
    }
    const masked = new ipaddr.IPv6(segments);
    return `${masked.toNormalizedString()}/64`;
  } else {
    throw new Error('Invalid IP');
  }
}

function isIpInRange(ip, cidr) {
  const addr = ipaddr.parse(ip);
  const range = ipaddr.parseCIDR(cidr);
  return addr.match(range);
}

function getIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded ? forwarded.split(',')[0].trim() : req.connection.remoteAddress;
  return ipaddr.parse(ip).toString();
}

module.exports = { getIpRange , getIp , isIpInRange }