import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Always build relative to this script’s location
const numToPathMap = {
    1: path.join(__dirname, 'email_templates', 'deviceAuthorization.txt'),
    2: path.join(__dirname, 'email_templates', 'passwordReset.txt')
};

function generateEmailFromTemplate(numPath, data) {
    const templatePath = numToPathMap[numPath];

    if (!fs.existsSync(templatePath)) {
        throw new Error(`Email template not found at: ${templatePath}`);
    }

    const template = fs.readFileSync(templatePath, 'utf-8');

    const subjectMatch = template.match(/<SUBJECT>(.*?)<\/SUBJECT>/s);
    if (!subjectMatch) {
        throw new Error('Template is missing a <SUBJECT>...</SUBJECT> block.');
    }

    const subject = subjectMatch[1].trim();
    let body = template.replace(subjectMatch[0], '').trim();

    for (const [key, value] of Object.entries(data)) {
        body = body.replace(new RegExp(`<${key}>`, 'g'), value);
    }

    return { subject, body };
}

export { generateEmailFromTemplate };