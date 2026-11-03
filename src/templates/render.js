const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "../../templates");
const PARTIALS = path.join(DIR, "_partials");
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function loadMeta(id) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error("bad template id");
  const p = path.join(DIR, id, "meta.json");
  if (!fs.existsSync(p)) throw new Error("unknown template");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function list() {
  return fs.readdirSync(DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
    .map((d) => loadMeta(d.name))
    .map(({ id, name, category, defaultSubject, variables }) =>
      ({ id, name, category, defaultSubject, variables }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

function expandPartials(html) {
  return html.replace(/\{\{>\s*([a-z0-9-]+)\s*\}\}/g, (_, name) => {
    const p = path.join(PARTIALS, name + ".html");
    if (!fs.existsSync(p)) throw new Error("missing partial: " + name);
    return fs.readFileSync(p, "utf8");
  });
}

function validate(id, vars) {
  const meta = loadMeta(id);
  const known = new Set(meta.variables.map((v) => v.key));
  const unknown = Object.keys(vars || {}).filter((k) => !known.has(k));
  if (unknown.length) throw new Error("unknown variables: " + unknown.join(", "));
  return meta;
}

function render(id, vars) {
  const meta = validate(id, vars);
  const merged = {};
  for (const v of meta.variables) merged[v.key] = vars[v.key] ?? v.default ?? "";
  merged.logoUrl = (process.env.PUBLIC_BASE_URL || "") + "/logo.png";
  merged.organization = process.env.MAIL_ORG || "BMLG Records";

  const raw = expandPartials(fs.readFileSync(path.join(DIR, id, "template.html"), "utf8"));
  const html = raw.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const value = esc(merged[k] ?? "");
    return meta.variables.find((v) => v.key === k)?.multiline ? value.replace(/\n/g, "<br>") : value;
  });
  const text = meta.variables
    .filter((variable) => !/Url$/i.test(variable.key))
    .map((variable) => merged[variable.key])
    .filter((value) => String(value || "").trim())
    .join("\n\n");
  return { html, text, meta };
}

function parseRecipients(to) {
  const recipients = String(to || "").split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  if (!recipients.length) throw new Error("no recipients");
  if (recipients.length > 50) throw new Error("max 50 recipients");
  const invalid = recipients.filter((address) => !EMAIL.test(address));
  if (invalid.length) throw new Error("invalid address: " + invalid.join(", "));
  return recipients;
}

module.exports = { list, render, validate, parseRecipients };
