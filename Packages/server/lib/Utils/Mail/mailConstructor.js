const fs = require("fs");
const path = require("path");

const numToPathMap = {
    1: "./email_templates/deviceAuthorization.txt"
}

function generateEmailFromTemplate(numPath, data) {
  const template = fs.readFileSync(path.resolve(numToPathMap[numPath]), "utf-8");

  const subjectMatch = template.match(/<SUBJECT>(.*?)<\/SUBJECT>/s);
  if (!subjectMatch) {
    throw new Error("Template is missing a <SUBJECT>...</SUBJECT> block.");
  }

  const subject = subjectMatch[1].trim();
  let body = template.replace(subjectMatch[0], "").trim();

  for (const [key, value] of Object.entries(data)) {
    const placeholder = new RegExp(`<${key}>`, "g");
    body = body.replace(placeholder, value);
  }

  return { subject, body };
}

module.exports = { generateEmailFromTemplate }