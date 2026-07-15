import fs from 'fs';
import path from 'path';
import mime from 'mime-types';
import { getFileType } from './convertors.js';

const getDisposition = (viewMode, filename) => {
    // FIX: Always use "inline" if viewMode is true.
    // This tells the browser "Display this if you can (PDF, Image, Text), otherwise download it"
    // "attachment" FORCES a download dialog.
    return viewMode ? 'inline' : `attachment; filename="${filename}"`;
};

const setSecurityHeaders = (response, type, disposition) => {
    response.set('Content-Type', type);
    response.set('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Disposition', disposition);
};

const respondWithFile = async (response, exist, filePath, viewMode = false) => {
    if (!exist || !filePath) {
        return response.status(404).send('The requested resource could not be found! 404');
    }

    try {
        const ext = path.extname(filePath).toLowerCase();
        let type = mime.lookup(filePath) || 'application/octet-stream';

        // FIX: Ensure PDFs are explicitly treated as application/pdf so browsers know to render them
        if (ext === '.pdf') {
            type = 'application/pdf';
        }

        const codeExtensions = ['.js', '.ts', '.json', '.xml', '.yaml', '.css', '.html', '.md', '.log'];
        if (viewMode && codeExtensions.includes(ext)) {
            type = 'text/plain; charset=utf-8';
        }

        // Pass 'viewMode' to getDisposition to set "inline"
        setSecurityHeaders(response, type, getDisposition(viewMode, path.basename(filePath)));

        const stream = fs.createReadStream(filePath);

        stream.on('error', err => {
            if (!response.headersSent) response.status(500).end();
        });

        stream.pipe(response);
    } catch (error) {
        if (!response.headersSent) response.status(500).send('Internal Server Error');
    }
};

const respondWithBuffer = async (response, base64String, mimeType, viewMode = false) => {
    try {
        const buffer = Buffer.from(base64String, 'base64');

        // The declared mimeType arrives from an integrator-supplied callback. Sniff the
        // actual bytes and prefer that verdict, because responses carry nosniff — the
        // browser will not correct a mislabelled payload on our behalf. Formats without
        // magic bytes (text, JSON, CSV) sniff as octet-stream, so the declared type
        // still wins there rather than degrading every text resource to a download.
        const detectedType = await getFileType(buffer, null);
        const type = detectedType === 'application/octet-stream' ? mimeType || detectedType : detectedType;

        const filename = `generated-resource.${mime.extension(type) || 'bin'}`;

        setSecurityHeaders(response, type, getDisposition(viewMode, filename));

        response.send(buffer);
    } catch (error) {
        response.status(500).send('Error processing generated resource.');
    }
};

export { respondWithFile, respondWithBuffer };
