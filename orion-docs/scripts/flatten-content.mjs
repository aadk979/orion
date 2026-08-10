import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sourceDir = path.join(__dirname, '../content');
const targetDir = path.join(__dirname, '../Contents-copy-txt');

// Create target directory if it doesn't exist
if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
}

function copyAndConvertFiles(dir) {
    const items = fs.readdirSync(dir);

    for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            // Recursively process subdirectories
            copyAndConvertFiles(fullPath);
        } else if (stat.isFile()) {
            // Process file
            const parsedPath = path.parse(fullPath);
            let targetFileName = `${parsedPath.name}.txt`;
            let targetPath = path.join(targetDir, targetFileName);

            // Handle name collisions
            let counter = 1;
            while (fs.existsSync(targetPath)) {
                targetFileName = `${parsedPath.name}_${counter}.txt`;
                targetPath = path.join(targetDir, targetFileName);
                counter++;
            }

            // Copy file
            fs.copyFileSync(fullPath, targetPath);
            console.log(`Copied ${fullPath} -> ${targetPath}`);
        }
    }
}

copyAndConvertFiles(sourceDir);
console.log('Done!');
