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

export { generateChallenge, generateRequestId, generateRandomNumber, generateId, packageExports };
