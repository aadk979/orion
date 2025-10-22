import { build } from "esbuild";
import path from "path";
import fs from "fs";
import crypto from "crypto";

// ASCII banner
const banner = `
/*******************************************************************************
*                                                                              *
*     ██████╗ ██████╗ ██╗ ██████╗ ███╗   ██╗    ███████╗██████╗ ██╗  ██╗       *
*    ██╔═══██╗██╔══██╗██║██╔═══██╗████╗  ██║    ██╔════╝██╔══██╗██║ ██╔╝       *
*    ██║   ██║██████╔╝██║██║   ██║██╔██╗ ██║    ███████╗██║  ██║█████╔╝        *
*    ██║   ██║██╔══██╗██║██║   ██║██║╚██╗██║    ╚════██║██║  ██║██╔═██╗        *
*    ╚██████╔╝██║  ██║██║╚██████╔╝██║ ╚████║    ███████║██████╔╝██║  ██╗       *
*     ╚═════╝ ╚═╝  ╚═╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝    ╚══════╝╚═════╝ ╚═╝  ╚═╝       *
*                                                                              *
*******************************************************************************/
`;

async function compileSDK(entryFile, outFile, format = "esm") {
  try {
    // Build the bundle in memory first
    const result = await build({
      entryPoints: [entryFile],
      bundle: true,
      format,     // "esm" or "cjs"
      sourcemap: true,
      minify: true,
      write: false, // don't write yet
    });

    // esbuild returns an array of outputs (normally 1)
    const output = result.outputFiles[0].text;

    // Compute SHA-256 of the output
    const hash = crypto.createHash("sha256").update(output).digest("hex");

    // Final SDK content = banner at top + output + hash footer
    const finalOutput = `// Orion BETA SDK\n// Version Hash: ${hash}\n${banner}\n${output}`;

    // Ensure output directory exists
    fs.mkdirSync(path.dirname(outFile), { recursive: true });

    // Write final bundle to file
    fs.writeFileSync(outFile, finalOutput);

    console.log(`✅ SDK compiled in ${format} format: ${path.resolve(outFile)}`);
    console.log(`🔹 SHA-256: ${hash}`);
  } catch (err) {
    console.error("❌ Build failed:", err);
  }
}

// Usage: node compiler.js lib/Root.js dist/sdk.js esm
const entry = process.argv[2] || "lib/Root.js";
const out = process.argv[3] || "dist/sdk.js";
const format = process.argv[4] || "esm"; // esm or cjs

compileSDK(entry, out, format);
