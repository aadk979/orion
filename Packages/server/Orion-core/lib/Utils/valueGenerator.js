import crypto from 'crypto';

const generateRequestId = (prefix = 'NP', length = 32) => {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    const array = new Uint32Array(length);
    crypto.getRandomValues(array);
    for (let i = 0; i < length; i++) {
        result += charset[array[i] % charset.length];
    }
    return 'REQ_' + prefix.toUpperCase() + '-' + result;
};

const generateId = (prefix = 'NP', length = 32) => {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    const array = new Uint32Array(length);
    crypto.getRandomValues(array);
    for (let i = 0; i < length; i++) {
        result += charset[array[i] % charset.length];
    }
    return 'ID_' + prefix.toUpperCase() + '-' + result;
};

const generateRandomNumber = length => {
    const charset = '0123456789';
    let result = '';
    const array = new Uint32Array(length);
    crypto.getRandomValues(array);
    for (let i = 0; i < length; i++) {
        result += charset[array[i] % charset.length];
    }
    return result;
};

const generateChallenge = byteLength => {
    const value = crypto.randomBytes(byteLength).toString('hex');
    return value;
};

const packageExports = {
    generateRequestId,
    generateId,
    generateRandomNumber,
    generateChallenge
};

const emailPrefixList = {
    'gmail.com': 'GM',
    'googlemail.com': 'GM-B',
    'yahoo.com': 'YH',
    'outlook.com': 'OL',
    'hotmail.com': 'HM',
    'live.com': 'LV',
    'icloud.com': 'IC',
    'me.com': 'ME',
    'aol.com': 'AOL',
    'protonmail.com': 'PM',
    'proton.me': 'PM-B',
    'tutanota.com': 'TN',
    'gmx.com': 'GMX',
    'mail.com': 'ML',
    'zoho.com': 'ZO',
    'yandex.com': 'YN',
    'qq.com': 'QQ',
    'fastmail.com': 'FM'
};

const generateUID = () => {
    const randomId = crypto.randomUUID();
    return randomId;
};

export { generateUID, generateChallenge, generateRequestId, generateRandomNumber, generateId, emailPrefixList, packageExports };
