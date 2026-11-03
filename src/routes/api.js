const express = require("express");
const rateLimit = require("express-rate-limit");
const brands = require("../config");
const render = require("../mail/render");
const toText = require("../mail/text");
const headers = require("../mail/headers");
const send = require("../mail/transport");
const { accessToken } = require("../mail/gmail-api");
const { render: renderTemplate, parseRecipients } = require("../templates/render");
const log = require("../lib/log");
const { parseList, buildContent } = require("../middleware/validate");

const router = express.Router();
const asyncRoute = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch((e) => {
    console.error(e);
    res.status(502).json({ error: e.message });
  });

const limiter = rateLimit({
  windowMs: 60_000,
  max: Number(process.env.MAX_PER_MINUTE || 30),
  standardHeaders: true,
  legacyHeaders: false,
});

const getBrand = (slug) => brands[slug] || null;

router.get("/brands", (_req, res) =>
  res.json(Object.entries(brands).map(([slug, b]) => ({ slug, name: b.name, defaults: b.defaults })))
);

router.get("/gmail/profile", async (_req, res) => {
  try {
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs", {
      headers: { Authorization: "Bearer " + await accessToken() },
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`sendAs lookup failed (${response.status}): ${JSON.stringify(json)}`);
    const primary = (json.sendAs || []).find((entry) => entry.isPrimary);
    res.json({
      email: primary?.sendAsEmail || "",
      isPrimary: Boolean(primary),
      treatAsAlias: primary?.treatAsAlias,
      verificationStatus: primary?.verificationStatus || "",
    });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: error.message });
  }
});

router.get("/templates/sendas", async (_req, res) => {
  try {
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs", {
      headers: { Authorization: "Bearer " + await accessToken() },
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`sendAs lookup failed (${response.status}): ${JSON.stringify(json)}`);
    const aliases = (json.sendAs || [])
      .filter((entry) => entry.verificationStatus === "accepted")
      .map((entry) => ({
        email: entry.sendAsEmail,
        name: entry.displayName || "",
        isPrimary: Boolean(entry.isPrimary),
      }));
    res.json(aliases.length ? aliases : [{ email: process.env.MAIL_FROM, name: "" }]);
  } catch (error) {
    console.error(error);
    res.json([{ email: process.env.MAIL_FROM, name: "" }]);
  }
});

router.get("/diag", async (_req, res) => {
  const out = {};
  try {
    log({ at: new Date().toISOString(), ok: true, diag: true });
    out.log = "ok";
  } catch (e) {
    out.log = "THROW: " + e.message;
  }
  out.logDir = process.env.LOG_DIR || "";
  out.smtpPort = process.env.SMTP_PORT || "";
  out.passLen = (process.env.SMTP_PASS || "").length;
  out.smtpKeys = Object.keys(process.env).filter((key) => /SMTP/i.test(key));
  out.resendKeyLen = (process.env.RESEND_KEY || "").length;

  try {
    const response = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${process.env.RESEND_KEY || ""}` },
      signal: AbortSignal.timeout(10_000),
    });
    out.resend = response.status;
  } catch (e) {
    out.resend = `THROW ${e.message}`;
  }
  res.set("Cache-Control", "no-store");
  res.json(out);
});

router.post("/preview/:brand", (req, res) => {
  const brand = getBrand(req.params.brand);
  if (!brand) return res.status(404).json({ error: "unknown brand" });
  res.type("html").send(
    render(brand, buildContent(req.body || {}), { unsubscribeUrl: process.env.UNSUBSCRIBE_URL })
  );
});

router.post("/send/:brand", limiter, asyncRoute(async (req, res) => {
  const brand = getBrand(req.params.brand);
  if (!brand) return res.status(404).json({ error: "unknown brand" });

  const body = req.body || {};
  let to, cc, bcc;
  try {
    to = parseList(body.to, "to");
    cc = parseList(body.cc, "cc");
    bcc = parseList(body.bcc, "bcc");
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  if (!to.length) return res.status(400).json({ error: "to required" });
  if (!body.subject || !String(body.subject).trim())
    return res.status(400).json({ error: "subject required" });

  const content = buildContent(body);
  const unsub = process.env.UNSUBSCRIBE_URL
    ? `${process.env.UNSUBSCRIBE_URL}?e=${encodeURIComponent(to[0])}`
    : "";

  const started = Date.now();
  try {
    const out = await send({
      from: process.env.MAIL_FROM,
      fromName: brand.fromName,
      to, cc, bcc,
      replyTo: brand.replyTo || process.env.MAIL_FROM,
      subject: String(body.subject).slice(0, 200),
      html: render(brand, content, { unsubscribeUrl: unsub }),
      text: toText(brand, content, { unsubscribeUrl: unsub }),
      headers: headers(unsub),
    });

    try {
      log({ at: new Date().toISOString(), ok: true, brand: req.params.brand, to, cc, bcc, ...out, ms: Date.now() - started });
    } catch (e) {
      console.error("send log failed", e);
    }
    res.json({ ok: true, ...out });
  } catch (e) {
    console.error(e);
    try {
      log({ at: new Date().toISOString(), ok: false, brand: req.params.brand, to, cc, bcc, error: e.message, ms: Date.now() - started });
    } catch (logError) {
      console.error("send log failed", logError);
    }
    res.status(502).json({ error: e.message });
  }
}));

router.post("/send-template", asyncRoute(async (req, res) => {
  const { templateId, to, subject, variables } = req.body || {};
  if (!templateId || !to) return res.status(400).json({ error: "templateId and to required" });
  if (subject && subject.length > 200) return res.status(400).json({ error: "subject too long" });

  const recipients = parseRecipients(to);
  const { html, text, meta } = renderTemplate(templateId, variables || {});
  const unsubscribeUrl = process.env.UNSUBSCRIBE_URL || "";
  const result = await send({
    to: recipients.join(", "),
    subject: subject || meta.defaultSubject,
    html,
    text,
    from: process.env.MAIL_FROM,
    fromName: process.env.MAIL_ORG || "BMLG Records",
    replyTo: process.env.MAIL_FROM,
    headers: unsubscribeUrl ? {
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    } : {},
  });
  res.json({ ok: true, provider: result.provider, id: result.id, count: recipients.length });
}));

router.get("/health", (_req, res) =>
  res.json({
    ok: true,
    provider: send.provider,
    brands: Object.keys(brands),
    from: process.env.MAIL_FROM,
  })
);

module.exports = router;
