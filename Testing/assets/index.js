import { Orion } from './orion.beta.sdk.js';

const orion = new Orion({
    serverUrl: 'http://localhost:3495',
    nameSpace: 'alpine',
    slug: '5e67a4b39b7eb57d04256d62e8501507ff1bcde498ff8d0951fb8f13a68efdf1'
});

async function yurrrr() {
    // Initialize Orion
    await orion.initialize();

    await orion.signUpUser('aadk979@gmail.com', 'Amelie260908');
}

yurrrr();
