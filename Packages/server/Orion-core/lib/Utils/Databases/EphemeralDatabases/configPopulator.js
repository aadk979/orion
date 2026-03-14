import { cronScheduler } from '../../Cron.js';
import { generateHmacKey } from '../../CryptoFunctions.js';
import { exportPublicKeyECC, generateKeyPairDedicated, generateKeyPairECC } from '../../dedicatedCrypto.js';
import { base64EncodeUint8 } from '../../Encoders.js';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { generateId } from '../../valueGenerator.js';

const populateEphemeralConfigs = async params => {
    const {
        db,
        values: { dipActive, encryptionActive, numberOfDipConfigs, numberOfEncryptionConfigs, configExp }
    } = params;

    const dipConfigArray = [];
    const encryptionConfigArray = [];

    let dipGroups = [];
    let encryptionGroups = [];

    if (dipActive) {
        for (let i = 0; i < numberOfDipConfigs; i += 5) {
            dipGroups.push(`DIP_GROUP[${i / 5}]`);
        }

        for (const group of dipGroups) {
            const configsPerGroup = numberOfDipConfigs / dipGroups.length;

            const groupConfigs = await Promise.all(
                Array.from({ length: configsPerGroup }).map(async () => {
                    const id = generateId('DIP_CONFIG');
                    const dipId = `${group}:*:${id}`;
                    const signatureKey = await generateHmacKey();
                    return { dipId, signatureKey, groupId: group, exp: configExp };
                })
            );

            dipConfigArray.push(...groupConfigs);
        }
    }

    if (encryptionActive) {
        for (let i = 0; i < numberOfEncryptionConfigs; i += 5) {
            encryptionGroups.push(`ENCRYPTION_GROUP[${i / 5}]`);
        }

        for (const group of encryptionGroups) {
            const configsPerGroup = numberOfEncryptionConfigs / encryptionGroups.length;

            const groupConfigs = await Promise.all(
                Array.from({ length: configsPerGroup }).map(async () => {
                    const id = generateId('ENCRYPTION_CONFIG');
                    const encryptionId = `${group}:*:${id}`;
                    const keys = await generateKeyPairECC('P-256');

                    // ECC keys are pre exported during generation for high throughput during key request since exporting the key during key reuquest itself adds time and complexity at the request level
                    const exportedKey = base64EncodeUint8(await exportPublicKeyECC(keys.publicKey));
                    return { encryptionId, privateKey: keys.privateKey, groupId: group, alg: 'ECC', size: 256, exportedKey, exp: configExp };
                })
            );

            encryptionConfigArray.push(...groupConfigs);
        }

        const nonPrimaryAlgs = ['ECC_384', 'RSA_2048', 'RSA_3072', 'RSA_4096'];
        const allowedConfigsPerNonPrimaryAlgsGroups = 2;

        for (const alg of nonPrimaryAlgs) {
            const group = `ENCRYPTION_GROUP[${alg}]`;
            const configsPerGroup = allowedConfigsPerNonPrimaryAlgsGroups;

            const groupConfigs = await Promise.all(
                Array.from({ length: configsPerGroup }).map(async () => {
                    const id = generateId('ENCRYPTION_CONFIG');
                    const encryptionId = `${group}:*:${id}`;
                    let keys;
                    let size;
                    let exportedKey;

                    if (alg.includes('RSA')) {
                        size = Number(alg.split('_')[1]);
                        keys = await generateKeyPairDedicated(size);
                    } else if (alg.includes('ECC')) {
                        size = Number(alg.split('_')[1]);
                        keys = await generateKeyPairECC(`${'P'}-${size}`);

                        // ECC keys are pre exported during generation for high throughput during key request since exporting the key during key reuquest itself adds time and complexity at the request level
                        exportedKey = base64EncodeUint8(await exportPublicKeyECC(keys.publicKey));
                    }

                    return {
                        encryptionId,
                        privateKey: keys.privateKey,
                        groupId: group,
                        alg: alg.split('_')[0],
                        size: size,
                        exportedKey,
                        exp: configExp
                    };
                })
            );

            encryptionConfigArray.push(...groupConfigs);
            encryptionGroups.push(group);
        }
    }

    for (const groupId of dipGroups) {
        const group = dipConfigArray.filter(v => v.groupId === groupId);
        await db.addData(groupId, group, configExp);
    }

    for (const groupId of encryptionGroups) {
        const group = encryptionConfigArray.filter(v => v.groupId === groupId);
        await db.addData(groupId, group, configExp);
    }

    globalAccessPoint.setValue('clusterMode', false);

    const encryptionConfigsAvailable = globalAccessPoint.encryptionConfigsAvailable();

    encryptionConfigsAvailable.push('ENCRYPTION_GROUP[ECC_384]', 'ENCRYPTION_GROUP[RSA_2048]', 'ENCRYPTION_GROUP[RSA_3072]', 'ENCRYPTION_GROUP[RSA_4096]');

    globalAccessPoint.setValue('encryptionConfigsAvailable', encryptionConfigsAvailable);

    cronScheduler.addEvent('configPopulation[dip,encryption]', populateEphemeralConfigs, '23h', params);

    return true;
};

export { populateEphemeralConfigs };