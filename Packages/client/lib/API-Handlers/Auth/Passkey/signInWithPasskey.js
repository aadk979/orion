import { startAuthentication } from '../../../External-Scripts/webAuthn.js';
import { orionVault } from '../../../Utils/OrionVault.js';

async function signInWithPasskey({ Api, getAuthHeader, dipConfig, This, email }) {
    const authHeader = await getAuthHeader(false, 'NO_AUTH_BEARER');

    const dipSignature1 = await Api.prepareDataForDIP({ packet: { email: email } }, dipConfig);

    const dipOptions1 = {
        ...dipConfig,
        dipState: 'ACTIVE',
        dipSignature: dipSignature1.dipSignature,
        salt: dipSignature1.salt,
        timestamp: dipSignature1.timestamp
    };

    const res = await Api.fetch(
        `/${This.systemConfig.nameSpace}/api/v1/action/generate-passkey-authentication-options`,
        'POST',
        authHeader.authHead,
        { packet: { email: email } },
        dipOptions1,
        null
    );

    const data = await res.json();
    if (data.error) return { error: true, errorCode: 'CLIENT-PASSKEY-AUTH-OPTIONS-FAILED' };

    const passkeyAuthentication = await startAuthentication({ optionsJSON: data.data.options });

    const encryptedPayload = await Api.prepareDataForEncryption({ authenticationResponse: passkeyAuthentication, email: email });

    const postEncryptionPayload = {
        packet: { encryptedString: encryptedPayload.encryptedString }
    };

    const dipSignature = await Api.prepareDataForDIP(postEncryptionPayload, dipConfig);

    const dipOptions = {
        ...dipConfig,
        dipState: 'ACTIVE',
        dipSignature: dipSignature.dipSignature,
        salt: dipSignature.salt,
        timestamp: dipSignature.timestamp
    };

    const finalRes = await Api.fetch(
        `/${This.systemConfig.nameSpace}/api/v1/action/sign-in-with-passkey-authentication`,
        'POST',
        authHeader.authHead,
        postEncryptionPayload,
        dipOptions,
        encryptedPayload.encryption
    );

    const data2 = await finalRes.json();

    if (data2.error) return { error: true, errorCode: 'CLIENT-UNABLE-TO-AUTHENTICATE-PASSKEY' };

    await orionVault.setItem('USER_EMAIL', email);

    This.setUserSignedInState(true);

    return { error: false, complete: true };
}

export { signInWithPasskey };
