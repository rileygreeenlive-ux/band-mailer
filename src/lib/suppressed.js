const fs = require("fs");
const path = require("path");

const FILE = path.join(process.cwd(), "data", "suppressed.json");

async function read() {
  try {
    const list = JSON.parse(await fs.promises.readFile(FILE, "utf8"));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function add(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return false;
  const list = await read();
  if (list.includes(e)) return false;
  list.push(e);
  await fs.promises.mkdir(path.dirname(FILE), { recursive: true });
  await fs.promises.writeFile(FILE, JSON.stringify(list, null, 2));
  return true;
}

async function filter(addresses) {
  const list = await read();
  if (!list.length) return addresses;
  const set = new Set(list);
  return addresses.filter((a) => !set.has(String(a).trim().toLowerCase()));
}

async function remove(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return false;
  const list = await read();
  const next = list.filter((item) => item !== e);
  if (next.length === list.length) return false;
  await fs.promises.mkdir(path.dirname(FILE), { recursive: true });
  await fs.promises.writeFile(FILE, JSON.stringify(next, null, 2));
  return true;
}

module.exports = { read, add, filter, remove };
