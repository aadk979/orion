import { Orion } from './orion.beta.sdk.js';
import { SERVER_URL } from './config.js';

const orion = new Orion({
    serverUrl: SERVER_URL,
    nameSpace: 'alpine',
    slug: ''
});

export { orion, SERVER_URL };
