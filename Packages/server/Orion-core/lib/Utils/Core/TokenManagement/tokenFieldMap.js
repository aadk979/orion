/**
 * Token Field Shorthand Map
 * 
 * Maps verbose JWT payload field names to compact abbreviations to reduce token size.
 * Provides bidirectional conversion so downstream consumers always see verbose names.
 */

const SHORT_MAP = {
    uid: 'u',
    email: 'e',
    authMethod: 'am',
    role: 'r',
    securityTier: 'st',
    accessTokenLinkCode: 'lc',
    hashedDeviceFingerprint: 'hdf',
    ipRange: 'ir',
    tokenData: 'td',
    tokenId: 'ti',
    type: 't',
    refreshCount: 'rc',
    maxRefreshes: 'mr',
};

// Auto-derive verbose map from short map
const VERBOSE_MAP = Object.fromEntries(
    Object.entries(SHORT_MAP).map(([verbose, short]) => [short, verbose])
);

const TYPE_SHORT_MAP = {
    'ACCESS_TOKEN': 'at',
    'REFRESH_TOKEN': 'rt',
    'RESOURCE_TOKEN': 'rst'
};

const TYPE_VERBOSE_MAP = Object.fromEntries(
    Object.entries(TYPE_SHORT_MAP).map(([verbose, short]) => [short, verbose])
);

// Nested keys that live inside tokenData/td
const TOKEN_DATA_KEYS = ['tokenId', 'type', 'accessTokenLinkCode', 'securityTier'];

function toShortPayload(payload) {
    const result = {};

    for (const [key, value] of Object.entries(payload)) {
        if (key === 'tokenData' && value && typeof value === 'object') {
            const shortNested = {};
            for (const [nk, nv] of Object.entries(value)) {
                if (nk === 'type' && TYPE_SHORT_MAP[nv]) {
                    shortNested[SHORT_MAP[nk] || nk] = TYPE_SHORT_MAP[nv];
                } else {
                    shortNested[SHORT_MAP[nk] || nk] = nv;
                }
            }
            result[SHORT_MAP.tokenData] = shortNested;
        } else {
            let finalValue = value;
            if (key === 'authMethod') {
                finalValue = getShortFormAuthMethod(value);
            }
            result[SHORT_MAP[key] || key] = finalValue;
        }
    }

    return result;
}

function toVerbosePayload(decoded) {
    const result = {};

    for (const [key, value] of Object.entries(decoded)) {
        if (key === 'td' && value && typeof value === 'object') {
            const verboseNested = {};
            for (const [nk, nv] of Object.entries(value)) {
                if (nk === 't' && TYPE_VERBOSE_MAP[nv]) {
                    verboseNested[VERBOSE_MAP[nk] || nk] = TYPE_VERBOSE_MAP[nv];
                } else {
                    verboseNested[VERBOSE_MAP[nk] || nk] = nv;
                }
            }
            result.tokenData = verboseNested;
        } else {
            let finalValue = value;
            if (key === 'am') {
                finalValue = getLongFormAuthMethod(value);
            }
            result[VERBOSE_MAP[key] || key] = finalValue;
        }
    }

    return result;
}

const AUTH_METHOD_MAP_LONG_TO_SHORT = {
    "PASSKEY": "PK",
    "PASSWORD": "P",
    "PROVIDER-GOOGLE": "PG",
    "PROVIDER-GITHUB": "PGH",
    "PROVIDER-DISCORD": "PD",
    "PROVIDER-SLACK": "PS",
    "PROVIDER-MICROSOFT": "PM",
    "PROVIDER-FACEBOOK": "PFB",
    "PROVIDER-AMAZON": "PA",
    "PROVIDER-APPLE": "PAP",
    "PROVIDER-TWITTER": "PT",
    "PROVIDER-LINKEDIN": "PL",
    "PROVIDER-REDDIT": "PR",
    "PROVIDER-SPOTIFY": "PSP"
};

const AUTH_METHOD_MAP_SHORT_TO_LONG = {
    "PK": "PASSKEY",
    "P": "PASSWORD",
    "PG": "PROVIDER-GOOGLE",
    "PGH": "PROVIDER-GITHUB",
    "PD": "PROVIDER-DISCORD",
    "PS": "PROVIDER-SLACK",
    "PM": "PROVIDER-MICROSOFT",
    "PFB": "PROVIDER-FACEBOOK",
    "PA": "PROVIDER-AMAZON",
    "PAP": "PROVIDER-APPLE",
    "PT": "PROVIDER-TWITTER",
    "PL": "PROVIDER-LINKEDIN",
    "PR": "PROVIDER-REDDIT",
    "PSP": "PROVIDER-SPOTIFY"
};

function getShortFormAuthMethod(am) {
    return AUTH_METHOD_MAP_LONG_TO_SHORT[am] || am;
}

function getLongFormAuthMethod(am) {
    return AUTH_METHOD_MAP_SHORT_TO_LONG[am] || am;
}

export { SHORT_MAP, VERBOSE_MAP, toShortPayload, toVerbosePayload, getLongFormAuthMethod, getShortFormAuthMethod };