const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "..", "logs");
fs.mkdirSync(DIR, { recursive: true });
const FILE = path.join(DIR, "send.jsonl");

module.exports = function log(row) {
  fs.appendFile(FILE, JSON.stringify(row) + "\n", () => {});
};
