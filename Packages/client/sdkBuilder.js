import { build } from "esbuild";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { minify } from "terser";

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

async function compileSDK(entryFile, outFile, { format = "esm" } = {}) {
  try {
    const result = await build({
      entryPoints: [entryFile],
      bundle: true,
      format,
      sourcemap: false,
      minify: false, // we’ll do our own minification
      keepNames: true,
      write: false,
    });

    let output = result.outputFiles[0].text;

    // Use Terser with NO mangling
    const minified = await minify(output, {
      compress: {
        dead_code: true,
        passes: 2,
      },
      mangle: false, // 🚫 prevents any renaming — keeps parameter names intact
      format: {
        comments: false,
      },
    });

    output = minified.code;

    const hash = crypto.createHash("sha256").update(output).digest("hex");

    const finalOutput = `// Orion SDK Build\n// SHA256: ${hash}\n${banner}\n${output}`;
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, finalOutput);

    console.log(`✅ SDK built → ${path.resolve(outFile)}`);
    console.log(`🔹 SHA256: ${hash}`);
  } catch (err) {
    console.error("❌ Build failed:", err);
  }
}

(async () => {
  const entry = process.argv[2] || "lib/Root.js";
  const outDirs = ["dist", "../../Testing/assets"];
  console.log("🚀 Building Orion SDK (no mangling)...");
  for (const dir of outDirs) {
    await compileSDK(entry, `${dir}/orion.beta.sdk.js`, { format: "esm" });
  }
  console.log("✨ Build complete!");
})();

export { compileSDK }