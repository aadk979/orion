import crypto from "crypto";

const TOTAL_KEYS = 30;
const KEY_SIZE = 3072;

const rsaKeys = [];

console.log(`🔐 Generating ${TOTAL_KEYS} RSA-${KEY_SIZE} key pairs...`);

const start = performance.now();

for (let i = 0; i < TOTAL_KEYS; i++) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
        modulusLength: KEY_SIZE,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" }
    });

    rsaKeys.push({ publicKey, privateKey });
    console.log(`✅ Generated key pair ${i + 1}/${TOTAL_KEYS}`);
}

const end = performance.now();
const totalTime = ((end - start) / 1000).toFixed(3);

console.log(`\n⚙️  Total time taken: ${totalTime} seconds`);
console.log(`🧠 Total keys in memory: ${rsaKeys.length}`);
