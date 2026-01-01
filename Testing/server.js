// server.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

// Setup for ES module path resolution
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 5502;

// Serve all files inside the "assets" folder statically
app.use(express.static(path.join(__dirname, 'assets')));

// Optional: root route to confirm server is running
app.get('/', (req, res) => {
    res.send('<h2>Static file server is running on port 5502 🚀</h2>');
});

app.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
    console.log(`📁 Serving static files from: ${path.join(__dirname, 'assets')}`);
});
