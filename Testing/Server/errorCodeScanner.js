import fs from 'fs';
import path from 'path';

const targetDir = '../../Packages/server/Orion-core/lib'; // change this
const ignoreDirs = ['node_modules', 'Errors']; // add any folder names you want to skip
const outputFile = './errorCodes.json'; // where to save JSON output

const regex = /(['"])([A-Z]+(?:-[A-Z]+)+)\1/g; // matches "ALL-CAPS-WORDS" or 'ALL-CAPS-WORDS'

function getUniqueObjects(arr, property) {
    const map = new Map();
    arr.forEach(obj => {
        if (!map.has(obj[property])) {
            map.set(obj[property], obj);
        }
    });
    return Array.from(map.values());
}

function scanDir(dir) {
    const results = [];

    function traverse(currentPath) {
        const entries = fs.readdirSync(currentPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(currentPath, entry.name);

            if (entry.isDirectory()) {
                if (ignoreDirs.includes(entry.name)) continue;
                traverse(fullPath);
            } else if (entry.isFile()) {
                try {
                    const content = fs.readFileSync(fullPath, 'utf8');
                    const matches = [...content.matchAll(regex)].map(m => ({
                        file: fullPath,
                        match: m[2]
                    }));
                    results.push(...getUniqueObjects(matches, 'match'));
                } catch (err) {
                    console.warn(`⚠️ Skipping unreadable file: ${fullPath}`);
                }
            }
        }
    }

    traverse(dir);
    return results;
}

// === Run ===
const found = scanDir(targetDir);

if (found.length === 0) {
    console.log('✅ No matches found.');
} else {
    console.log(`🔍 Found ${found.length} matches. Writing to ${outputFile}...`);

    // Convert to grouped JSON (organized by directory)
    const grouped = {};
    for (const { file, match } of found) {
        const relDir = path.dirname(file).split('Errors')[1] || '';
        const key = relDir.replace(/\\/g, '/').replace(/^\/|\/$/g, '') || 'root';
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(match);
    }

    const jsonOutput = {
        totalMatches: found.length,
        generatedAt: new Date().toISOString(),
        groupedByDirectory: grouped,
        allMatches: found.map(({ match, file }) => ({ code: match, file }))
    };

    fs.writeFileSync(outputFile, JSON.stringify(jsonOutput, null, 2), 'utf8');
    console.log(`✅ JSON file saved to ${outputFile}`);
}
