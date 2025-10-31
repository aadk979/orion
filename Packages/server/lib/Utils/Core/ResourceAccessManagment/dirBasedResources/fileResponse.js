import { fileToBase64, getFileType } from "./convertors.js";
import path from "path";

const respondWithFile = async (response, exist, filePath, viewMode = false) => {
  if (!exist) {
    response.status(404).send("The requested resource could not be found! 404");
    return;
  }

  const fileBase64 = fileToBase64(filePath);
  const fileBuffer = Buffer.from(fileBase64, "base64");
  let type = await getFileType(fileBase64, filePath);

  const ext = path.extname(filePath).toLowerCase();
  const codeExtensions = [
    ".js",
    ".mjs",
    ".cjs",
    ".ts",
    ".jsx",
    ".tsx",
    ".d.ts",
    ".html",
    ".htm",
    ".css",
    ".scss",
    ".sass",
    ".less",
    ".styl",
    ".json",
    ".json5",
    ".jsonc",
    ".xml",
    ".yaml",
    ".yml",
    ".py",
    ".pyw",
    ".pyc",
    ".pyo",
    ".pyx",
    ".java",
    ".class",
    ".jar",
    ".war",
    ".c",
    ".h",
    ".cpp",
    ".cc",
    ".cxx",
    ".hpp",
    ".hh",
    ".cs",
    ".csx",
    ".php",
    ".phtml",
    ".rb",
    ".erb",
    ".go",
    ".rs",
    ".swift",
    ".kt",
    ".kts",
    ".dart",
    ".scala",
    ".hs",
    ".ex",
    ".exs",
    ".erl",
    ".clj",
    ".cljs",
    ".lua",
    ".pl",
    ".pm",
    ".sh",
    ".bash",
    ".zsh",
    ".fish",
    ".ps1",
    ".sql",
    ".r",
    ".R",
    ".m",
    ".jl",
    ".groovy",
    ".fs",
    ".fsx",
    ".vb",
    ".asm",
    ".s",
    ".f",
    ".f90",
    ".cob",
    ".pas",
    ".pp",
    ".tex",
    ".md",
    ".markdown",
    ".ini",
    ".cfg",
    ".conf",
    ".toml",
    "Makefile",
    "Dockerfile",
    ".tf",
    ".vim",
    ".ino",
  ];

  if (viewMode && codeExtensions.includes(ext)) {
    type = "text/plain; charset=utf-8";
  }

  response.removeHeader("Content-Security-Policy");
  response.removeHeader("X-Content-Type-Options");
  response.removeHeader("X-Download-Options");

  response.set("Content-Type", type);

  if (viewMode) {
    response.setHeader("Content-Disposition", "inline");
  }

  response.send(fileBuffer);
};

export { respondWithFile };