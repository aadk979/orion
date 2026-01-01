import { decryptAESGCM, decryptPrivate, exportPublicKey, generateKeyPair, importKeyFromBase64 } from '../../Utils/CryptoModule';

async function getDIP({ Api, getAuthHeader, nameSpace }) {
    const { authHead } = await getAuthHeader(null, 'NO_BEARER');

    const keyPair = await generateKeyPair(2048);

    const exportedPubKey = await exportPublicKey(keyPair.publicKey);

    const packet = {
        packet: {
            publicKey: exportedPubKey
        }
    };

    const res = await Api.fetch(`/${nameSpace}/api/v1/action/configure-dip`, 'POST', authHead, packet, null, null);
    const data = await res.json();

    if (data.error && data.errorData.errorCode !== 'DIP-DISABLED') {
        throw new Error('Unable to configure DIP!');
    }

    let decryptedData;

    try {
        const decryptedAESKey = await decryptPrivate(data.data.encryptedTransportKey, keyPair.privateKey);

        decryptedData = await decryptAESGCM(data.data.encryptedData, importKeyFromBase64(decryptedAESKey));
    } catch (e) {
        throw new Error('Unable to configure DIP!');
    }

    return data.error ? data : JSON.parse(decryptedData);
}

export { getDIP };
