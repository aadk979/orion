const fs = require("fs");
const path = require("path");

const folderPath = process.argv[2]; // pass folder path as argument
if (!folderPath) {
    console.error("Please provide a folder path.");
    process.exit(1);
}

const exts = [".js"];

function countLinesInDir(dir) {
    let totalLines = 0;
    const breakdown = {};

    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
        if (item.name === "node_modules") continue; // skip node_modules

        const fullPath = path.join(dir, item.name);

        if (item.isDirectory()) {
            const { total, breakdown: subBreakdown } = countLinesInDir(fullPath);
            totalLines += total;
            for (const ext in subBreakdown) {
                breakdown[ext] = (breakdown[ext] || 0) + subBreakdown[ext];
            }
        } else {
            const ext = path.extname(item.name);
            if (exts.includes(ext)) {
                const lines = fs.readFileSync(fullPath, "utf-8").split("\n").length;
                totalLines += lines;
                breakdown[ext] = (breakdown[ext] || 0) + lines;
            }
        }
    }

    return { total: totalLines, breakdown };
}

const { total, breakdown } = countLinesInDir(folderPath);
console.log("Breakdown by file type:", breakdown);
console.log("Total lines of code:", total);
