/**
 * Shared, deterministic fixture data used across suites.
 */

export const emails = {
    valid: ['user@example.com', 'a.b+tag@sub.domain.co', 'first.last@gmail.com', 'x@y.io'],
    invalid: ['', 'plainaddress', '@no-local.com', 'no-at.com', 'spaces in@email.com', 'trailing@dot.', 'a@b']
};

export const passwords = {
    // zxcvbn score >= 3 is considered "safe" by the Validator
    strong: ['correct-horse-battery-staple-9', 'Tr0ub4dour&3xtra-Long-Phrase'],
    weak: ['password', '123456', 'qwerty', 'aaaaaa', 'letmein']
};

export const ipv4 = {
    a: '192.168.1.10',
    sameSlash24: '192.168.1.250',
    sameSlash16: '192.168.99.5',
    sameSlash8: '192.0.0.1',
    different: '8.8.8.8',
    privateHost: '10.0.0.5',
    cgnat: '100.64.0.1'
};

export const ipv6 = {
    a: '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
    sameGroup: '2001:0db8:85a3:0000:ffff:ffff:ffff:ffff'
};

/**
 * A 32-byte key suitable for AES-256-GCM, deterministic for round-trip tests.
 */
export function aesKey() {
    return Buffer.alloc(32, 7);
}

export const sampleObject = {
    id: 42,
    nested: { flag: true, list: [1, 2, 3] },
    label: 'orion'
};
