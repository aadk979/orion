import fs from 'fs';
import path from 'path';
import { compileSDK } from './sdkBuilder.js'; // your existing compileSDK function

const libDir = path.resolve('lib');
let timeout;

function watchLib() {
    fs.watch(libDir, { recursive: true }, (eventType, filename) => {
        if (!filename.endsWith('.js')) return;

        console.log(`📝 Detected change in ${filename}, waiting 1s...`);

        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(async () => {
            console.log('🚀 Rebuilding Orion SDK...');
            await compileSDK('lib/Root.js', 'dist/orion.beta.sdk.js');
            await compileSDK('lib/Root.js', '../../Testing/assets/orion.beta.sdk.js');
            console.log('✨ Build complete!');
        }, 1000); // 1 seconds debounce
    });

    console.log(`👀 Watching ${libDir} for JS changes...`);
}

watchLib();
