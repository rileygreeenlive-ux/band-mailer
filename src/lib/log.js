const fs = require("fs");
const path = require("path");

const configuredDir = process.env.LOG_DIR;
const DIR = configuredDir
  ? path.resolve(configuredDir)
  : path.join(__dirname, "..", "..", "logs");
fs.mkdirSync(DIR, { recursive: true });
const FILE = path.join(DIR, "send.jsonl");

module.exports = function log(row) {
  fs.appendFileSync(FILE, JSON.stringify(row) + "\n");
};
