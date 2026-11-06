const express = require("express");
const rateLimit = require("express-rate-limit");
const brands = require("../config");
const fs = require("fs");
const path = require("path");
const render = require("../mail/render");
const toText = require("../mail/text");
const headers = require("../mail/headers");
const send = require("../mail/transport");
const { accessToken } = require("../mail/gmail-api");
const { render: renderTemplate, parseRecipients, readMeta } = require("../templates/render");
const log = require("../lib/log");
const suppressed = require("../lib/suppressed");
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
    const token = await accessToken();
    const tokenInfo = await fetch(
      "https://oauth2.googleapis.com/tokeninfo?access_token=" + encodeURIComponent(token)
    ).then((response) => response.json().catch(() => ({})));
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs", {
      headers: { Authorization: "Bearer " + token },
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`sendAs lookup failed (${response.status}): ${JSON.stringify(json)}`);
    const primary = (json.sendAs || []).find((entry) => entry.isPrimary);
    res.json({
      email: primary?.sendAsEmail || "",
      isPrimary: Boolean(primary),
      treatAsAlias: primary?.treatAsAlias,
      verificationStatus: primary?.verificationStatus || "",
      scopes: String(tokenInfo.scope || "").split(" ").filter(Boolean),
    });
  } catch (error) {
    console.error(error);
    try {
      const token = await accessToken();
      const tokenInfo = await fetch(
        "https://oauth2.googleapis.com/tokeninfo?access_token=" + encodeURIComponent(token)
      ).then((response) => response.json().catch(() => ({})));
      res.status(502).json({
        error: error.message,
        scopes: String(tokenInfo.scope || "").split(" ").filter(Boolean),
      });
    } catch (diagnosticError) {
      res.status(502).json({ error: error.message, diagnostic: diagnosticError.message });
    }
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


router.post("/templates/:id/preview", (req, res) => {
  const { variables } = req.body || {};
  try {
    const { html } = renderTemplate(req.params.id, {
      ...(variables || {}),
      unsubscribeUrl: process.env.UNSUBSCRIBE_URL || "",
    });
    res.type("html").send(html);
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2:3b";

router.post("/ai/draft", asyncRoute(async (req, res) => {
  const { prompt, templateId } = req.body || {};
  if (!prompt || !templateId) return res.status(400).json({ error: "prompt and templateId required" });
  let meta;
  try { meta = readMeta(templateId); }
  catch (e) { return res.status(404).json({ error: "unknown template: " + templateId }); }
  const varSpec = meta.variables.map(v => `- ${v.key} (${v.label})${v.multiline ? " [multiline]" : ""}`).join("\n");
  const systemPrompt = `You fill in email template variables. Return ONLY a JSON object. Keys must exactly match the variable names. Add a "subject" key for the email subject. Use the prompt to infer values; for anything not in the prompt, use a sensible default implied by the label. No markdown, no explanation.`;
  const userPrompt = `Template: ${meta.name}\nVariables:\n${varSpec}\n\nPrompt: ${prompt}`;
  try {
    const r = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL, stream: false, format: "json",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        options: { temperature: 0.3, num_predict: 1024 },
      }),
    });
    if (!r.ok) throw new Error("Ollama " + r.status + ": " + (await r.text()).slice(0, 200));
    const data = await r.json();
    const raw = data.message?.content || "";
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("No JSON in AI response: " + raw.slice(0, 120));
    const parsed = JSON.parse(m[0]);
    res.json({ ok: true, variables: parsed, subject: parsed.subject || meta.defaultSubject });
  } catch (e) {
    if (/fetch failed|ECONNREFUSED/i.test(e.message))
      return res.status(503).json({ error: "AI model not running. Start it with: ollama serve" });
    throw e;
  }
}));

router.get("/gmail/recent", asyncRoute(async (req, res) => {
  const n = Math.min(Number(req.query.n) || 10, 25);
  const token = await accessToken();
  const r = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${n}&q=-category:updates -category:promotions`,
    { headers: { Authorization: "Bearer " + token } }
  );
  const data = await r.json();
  if (!r.ok) throw new Error("Gmail fetch failed: " + (data.error?.message || r.status));

  const messages = [];
  for (const m of (data.messages || [])) {
    const full = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`,
      { headers: { Authorization: "Bearer " + token } }
    ).then(x => x.json());

    const headers = {};
    for (const h of (full.payload?.headers || [])) {
      headers[h.name.toLowerCase()] = h.value;
    }

    // Extract body (plain text preferred)
    let body = "";
    const parts = full.payload?.mimeType?.includes("alternative")
      ? full.payload.parts
      : [full.payload];
    for (const p of parts || []) {
      if (p.mimeType === "text/plain" && p.body?.data) {
        body = Buffer.from(p.body.data, "base64").toString("utf8");
        break;
      }
    }
    if (!body) {
      for (const p of parts || []) {
        if (p.body?.data) {
          body = Buffer.from(p.body.data, "base64").toString("utf8");
          break;
        }
      }
    }

    messages.push({
      id: full.id,
      threadId: full.threadId,
      from: headers["from"] || "",
      to: headers["to"] || "",
      subject: headers["subject"] || "",
      messageId: headers["message-id"] || "",
      references: headers["references"] || "",
      date: headers["date"] || "",
      body: body.slice(0, 2000),
      labelIds: full.labelIds || [],
    });
  }
  res.json(messages);
}));

router.post("/auto-respond", asyncRoute(async (req, res) => {
  const { from, subject, body, templateId, messageId, references, gmailMessageId } = req.body || {};
  if (!from || !body) return res.status(400).json({ error: "from and body required" });

  const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
  const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2:3b";

  // ── Step 1: Classify template (skip if templateId provided) ──
  let tplId = templateId;
  if (!tplId) {
    const { list } = require("../templates/render");
    const templates = list();
    const tplList = templates.map(t => `- ${t.id}: ${t.name} (${t.category})`).join("\n");

    const classifyPrompt = `Given this incoming email, which template should we use to reply?
Templates:
${tplList}

Incoming email:
From: ${from}
Subject: ${subject || "(none)"}
Body: ${body.slice(0, 500)}

Respond with ONLY the template ID. No explanation.`;

    try {
      const r = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OLLAMA_MODEL, stream: false,
          messages: [{ role: "user", content: classifyPrompt }],
          options: { temperature: 0.1, num_predict: 50 },
        }),
      });
      const data = await r.json();
      const raw = (data.message?.content || "").trim().toLowerCase();
      const match = templates.find(t => raw.includes(t.id));
      if (!match) throw new Error("AI could not classify: " + raw.slice(0, 80));
      tplId = match.id;
    } catch (e) {
      return res.status(422).json({ error: "Template classification failed: " + e.message });
    }
  }

  // ── Step 2: Extract variables from the mail ──
  const { readMeta } = require("../templates/render");
  const meta = readMeta(tplId);
  const defaults = {};
  for (const v of meta.variables) defaults[v.key] = v.default || "";

  const varSpec = meta.variables.map(v =>
    `- ${v.key} (${v.label}) default: "${defaults[v.key]}"`
  ).join("\n");

  const extractPrompt = `Fill in these email template variables based on the incoming email.
If a value can't be determined from the email, use the default.
Return ONLY a JSON object with the variable keys.

Variables:
${varSpec}

Incoming email:
From: ${from}
Subject: ${subject || "(none)"}
Body: ${body.slice(0, 1000)}`;

  let vars = { ...defaults };
  try {
    const r = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL, stream: false, format: "json",
        messages: [{ role: "user", content: extractPrompt }],
        options: { temperature: 0.2, num_predict: 1024 },
      }),
    });
    const data = await r.json();
    const raw = data.message?.content || "";
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      for (const [k, v] of Object.entries(parsed)) {
        if (k in defaults && typeof v === "string") vars[k] = v;
      }
    }
  } catch (e) {
    console.error("Variable extraction failed, using defaults:", e.message);
  }

  // ── Step 3: Render ──
  const { render: renderTemplate } = require("../templates/render");
  const unsubUrl = process.env.UNSUBSCRIBE_URL || "";
  const unsubOne = unsubUrl ? unsubUrl + "?e=" + encodeURIComponent(from) : "";
  const { html, text } = renderTemplate(tplId, { ...vars, unsubscribeUrl: unsubOne });

  // ── Step 4: Send (reply to original sender) ──
  const replyHeaders = {};
  if (messageId) {
    replyHeaders["In-Reply-To"] = messageId;
    replyHeaders["References"] = references || messageId;
  }
  if (unsubOne) {
    replyHeaders["List-Unsubscribe"] = "<" + unsubOne + ">";
    replyHeaders["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  const finalSubject = messageId && !/^re:/i.test(subject || "")
    ? "Re: " + (subject || meta.defaultSubject)
    : (subject || meta.defaultSubject);

  const send = require("../mail/transport");
  const result = await send({
    to: from,
    subject: finalSubject,
    html, text,
    from: process.env.MAIL_FROM,
    fromName: process.env.MAIL_ORG || "BMLG Records",
    replyTo: process.env.MAIL_FROM,
    headers: replyHeaders,
  });

  if (messageId) {
    try {
      const token2 = await accessToken();
      const targetId = req.body.gmailMessageId || gmailMessageId;
      if (targetId) {
        await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${targetId}/modify`,
          {
            method: "post",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + token2 },
            body: JSON.stringify({ addLabelIds: ["auto-responded"] }),
          }
        );
      }
    } catch (e) { console.error("label failed", e.message); }
  }

  res.json({
    ok: true,
    templateId: tplId,
    variables: vars,
    provider: result.provider,
    id: result.id,
  });
}));


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
  to = await suppressed.filter(to);
  if (!to.length) return res.status(400).json({ error: "all recipients suppressed" });
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

  const recipients = await suppressed.filter(parseRecipients(to));
  if (!recipients.length) return res.status(400).json({ error: "all recipients suppressed" });
  const unsubscribeUrl = process.env.UNSUBSCRIBE_URL || "";
  const unsubOne = unsubscribeUrl ? unsubscribeUrl + "?e=" + encodeURIComponent(recipients[0]) : "";
  const { html, text, meta } = renderTemplate(templateId, { ...(variables || {}), unsubscribeUrl: unsubOne });
  const result = await send({
    to: recipients.join(", "),
    subject: subject || meta.defaultSubject,
    html,
    text,
    from: process.env.MAIL_FROM,
    fromName: process.env.MAIL_ORG || "BMLG Records",
    replyTo: process.env.MAIL_FROM,
    headers: unsubOne ? {
      "List-Unsubscribe": "<" + unsubOne + ">",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    } : {},
  });
  res.json({ ok: true, provider: result.provider, id: result.id, count: recipients.length });
}));

router.get("/unsubscribe", handleUnsub);
router.post("/unsubscribe", handleUnsub);

async function handleUnsub(req, res) {
  const email = String((req.query.e || (req.body || {}).e || "")).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return res.status(400).type("html").send("<p>Missing or invalid address.</p>");
  await suppressed.add(email);
  res.type("html").send(`<p>${email.replace(/</g, "&lt;").replace(/>/g, "&gt;")} has been unsubscribed.</p>`);
}
router.get("/health", (_req, res) =>
  res.json({
    ok: true,
    provider: send.provider,
    brands: Object.keys(brands),
    from: process.env.MAIL_FROM,
  })
);

module.exports = router;
