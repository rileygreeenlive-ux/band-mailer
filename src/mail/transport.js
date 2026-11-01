const nodemailer = require("nodemailer");

const PROVIDER = (process.env.MAIL_PROVIDER || "smtp").toLowerCase();
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let smtp = null;
function smtpClient() {
  if (!smtp) {
    const port = Number(process.env.SMTP_PORT || 465);
    smtp = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 30_000,
      greetingTimeout: 30_000,
      socketTimeout: 30_000,
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
    });
  }
  return smtp;
}

async function viaSmtp(m) {
  const info = await smtpClient().sendMail({
    from: `"${m.fromName}" <${m.from}>`,
    to: m.to, cc: m.cc, bcc: m.bcc,
    replyTo: m.replyTo || undefined,
    subject: m.subject, text: m.text, html: m.html, headers: m.headers,
  });
  return { id: info.messageId, provider: "smtp" };
}

async function viaPostmark(m) {
  const r = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Postmark-Server-Token": process.env.POSTMARK_TOKEN,
    },
    body: JSON.stringify({
      From: `"${m.fromName}" <${m.from}>`,
      To: (m.to || []).join(","),
      Cc: (m.cc || []).join(",") || undefined,
      Bcc: (m.bcc || []).join(",") || undefined,
      ReplyTo: m.replyTo || undefined,
      Subject: m.subject, TextBody: m.text, HtmlBody: m.html,
      Headers: Object.entries(m.headers || {}).map(([Name, Value]) => ({ Name, Value })),
      MessageStream: process.env.POSTMARK_STREAM || "outbound",
      TrackOpens: false,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(j.Message || `postmark ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return { id: j.MessageID, provider: "postmark" };
}

async function viaResend(m) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RESEND_KEY}`,
    },
    body: JSON.stringify({
      from: `"${m.fromName}" <${m.from}>`,
      to: m.to, cc: m.cc, bcc: m.bcc,
      reply_to: m.replyTo || undefined,
      subject: m.subject, text: m.text, html: m.html, headers: m.headers,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(j.message || `resend ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return { id: j.id, provider: "resend" };
}

const SENDERS = { smtp: viaSmtp, postmark: viaPostmark, resend: viaResend };

module.exports = async function send(message) {
  const fn = SENDERS[PROVIDER];
  if (!fn) throw new Error(`unknown MAIL_PROVIDER: ${PROVIDER}`);
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fn(message);
    } catch (e) {
      lastErr = e;
      if ((e.status && !RETRYABLE.has(e.status)) || attempt === 2) break;
      await sleep(400 * 2 ** attempt);
    }
  }
  throw lastErr;
};

module.exports.provider = PROVIDER;
