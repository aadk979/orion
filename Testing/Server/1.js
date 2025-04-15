const { generateEncryptionKey } = require("../../Packages/server/lib/Utils/CryptoFunctions");
const { isValidEmail } = require("../../Packages/server/lib/Utils/Validator");

async function x(params) {
    const d = await generateEncryptionKey();
    console.log(d);
}

x();