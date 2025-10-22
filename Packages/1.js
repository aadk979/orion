import fs from "fs";
import path from "path";

const folderPath = "./server";

const getLineCount = (filePath) => {
  const content = fs.readFileSync(filePath, "utf8");
  return content.split(/\r?\n/).length;
};

const traverse = (dir, depth = 0) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const indent = "  ".repeat(depth);

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      console.log(`${indent}📁 ${entry.name}/`);
      traverse(path.join(dir, entry.name), depth + 1);
    } else if (entry.name.endsWith(".js")) {
      const filePath = path.join(dir, entry.name);
      const lines = getLineCount(filePath);
      console.log(`${indent}📜 ${entry.name} — ${lines} lines`);
    }
  }
};

console.log(`📦 Folder Structure & Line Counts for: ${folderPath}\n`);
traverse(folderPath);
