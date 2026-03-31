import { Orion } from './orion.beta.sdk.js';

const orion = new Orion({
    serverUrl: 'http://localhost:3495',
    nameSpace: 'alpine',
    slug: 'slug'
});

export { orion };
