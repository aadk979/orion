// compiler.js
import { build } from "esbuild";
import path from "path";
import fs from "fs";

async function compileSDK(entryFile, outFile, format = "esm") {
  try {
    await build({
      entryPoints: [entryFile],
      bundle: true,
      outfile: outFile,
      format,     // "esm" for import/export, "cjs" for require()
      sourcemap: true,
      minify: true,
    });

    console.log(`✅ SDK compiled in ${format} format: ${path.resolve(outFile)}`);
  } catch (err) {
    console.error("❌ Build failed:", err);
  }
}

// Usage: node compiler.js lib/Root.js dist/sdk.js esm
const entry = process.argv[2] || "lib/Root.js";
const out = process.argv[3] || "dist/sdk.js";
const format = process.argv[4] || "esm"; // esm or cjs

fs.mkdirSync(path.dirname(out), { recursive: true });
compileSDK(entry, out, format);
