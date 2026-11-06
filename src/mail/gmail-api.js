const nodemailer = require("nodemailer");

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.settings.basic",
  "https://www.googleapis.com/auth/gmail.modify",
];

let cached = { token: null, exp: 0 };

async function accessToken() {
  if (cached.token && Date.now() < cached.exp) return cached.token;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.access_token) {
    throw new Error(`gmail token refresh failed (${response.status}): ${JSON.stringify(json)}`);
  }

  cached = {
    token: json.access_token,
    exp: Date.now() + Math.max(0, (json.expires_in - 60) * 1000),
  };
  return cached.token;
}

async function send(message) {
  const composer = nodemailer.createTransport({ streamTransport: true, buffer: true });
  const info = await composer.sendMail({
    from: `"${message.fromName}" <${message.from || process.env.MAIL_FROM}>`,
    to: message.to,
    cc: message.cc,
    bcc: message.bcc,
    replyTo: message.replyTo || undefined,
    subject: message.subject,
    text: message.text,
    html: message.html,
    headers: message.headers,
  });
  const raw = info.message
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
            Authorization: "Bearer " + await accessToken(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`gmail send failed (${response.status}): ${JSON.stringify(json)}`);
    error.status = response.status;
    throw error;
  }
  return { id: json.id, provider: "gmail-api" };
}

module.exports = { accessToken, send, SCOPES };
