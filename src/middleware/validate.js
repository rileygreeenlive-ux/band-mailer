const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

function parseList(v, label) {
  if (v === undefined || v === null || v === "") return [];
  const arr = Array.isArray(v) ? v : String(v).split(/[,;\s]+/);
  const out = arr.map((s) => s.trim()).filter(Boolean);
  if (out.length > 10) throw new Error(`${label}: max 10 addresses`);
  const bad = out.filter((e) => !EMAIL.test(e));
  if (bad.length) throw new Error(`${label}: invalid ${bad.join(", ")}`);
  return out;
}

function buildContent(body) {
  const c = {};
  if (body.title !== undefined) c.title = String(body.title).slice(0, 200);
  if (body.greeting !== undefined) c.greeting = String(body.greeting).slice(0, 200);
  if (body.preheader !== undefined) c.preheader = String(body.preheader).slice(0, 200);
  if (body.signatureName !== undefined) c.signatureName = String(body.signatureName).slice(0, 120);
  if (body.organization !== undefined) c.organization = String(body.organization).slice(0, 120);
  if (body.paragraphs !== undefined) {
    const p = Array.isArray(body.paragraphs)
      ? body.paragraphs
      : String(body.paragraphs).split(/\n\s*\n/);
    c.paragraphs = p.map((s) => String(s).slice(0, 5000)).filter((s) => s.trim() !== "");
  }
  return c;
}

module.exports = { parseList, buildContent, EMAIL };
