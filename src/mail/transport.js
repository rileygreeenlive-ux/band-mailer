const nodemailer = require("nodemailer");

const PROVIDER = (process.env.MAIL_PROVIDER || "smtp").toLowerCase();
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let smtp = null;
function smtpClient() {
  if (!smtp) {
    const port = Number(process.env.SMTP_PORT || 465);
    smtp = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
    });
  }
  return smtp;
}

async function viaSmtp(message) {
  const info = await smtpClient().sendMail({
    from: `"${message.fromName}" <${message.from}>`,
    to: message.to,
    cc: message.cc,
    bcc: message.bcc,
    replyTo: message.replyTo || undefined,
    subject: message.subject,
    text: message.text,
    html: message.html,
    headers: message.headers,
  });
  return { id: info.messageId, provider: "smtp" };
}

async function viaPostmark(message) {
  const response = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Postmark-Server-Token": process.env.POSTMARK_TOKEN,
    },
    body: JSON.stringify({
      From: `"${message.fromName}" <${message.from}>`,
      To: (message.to || []).join(","),
      Cc: (message.cc || []).join(",") || undefined,
      Bcc: (message.bcc || []).join(",") || undefined,
      ReplyTo: message.replyTo || undefined,
      Subject: message.subject,
      TextBody: message.text,
      HtmlBody: message.html,
      Headers: Object.entries(message.headers || {}).map(([Name, Value]) => ({ Name, Value })),
      MessageStream: process.env.POSTMARK_STREAM || "outbound",
      TrackOpens: false,
    }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(json.Message || `postmark ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return { id: json.MessageID, provider: "postmark" };
}

async function viaResend(message) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RESEND_KEY}`,
    },
    body: JSON.stringify({
      from: `"${message.fromName}" <${message.from}>`,
      to: message.to,
      cc: message.cc,
      bcc: message.bcc,
      reply_to: message.replyTo || undefined,
      subject: message.subject,
      text: message.text,
      html: message.html,
      headers: message.headers,
    }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(json.message || `resend ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return { id: json.id, provider: "resend" };
}

const SENDERS = { smtp: viaSmtp, postmark: viaPostmark, resend: viaResend };

module.exports = async function send(message) {
  const sender = SENDERS[PROVIDER];
  if (!sender) throw new Error(`unknown MAIL_PROVIDER: ${PROVIDER}`);
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await sender(message);
    } catch (error) {
      lastError = error;
      if ((error.status && !RETRYABLE.has(error.status)) || attempt === 2) break;
      await sleep(400 * 2 ** attempt);
    }
  }
  throw lastError;
};

module.exports.provider = PROVIDER;
