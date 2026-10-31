const REQUIRED = ["UI_USER", "UI_PASSWORD", "SEND_API_KEY", "MAIL_FROM", "MAIL_PROVIDER"];
const PROVIDER_KEYS = {
  smtp: ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"],
  postmark: ["POSTMARK_TOKEN"],
  resend: ["RESEND_KEY"],
};

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function validate() {
  const prod = process.env.NODE_ENV === "production";
  const missing = REQUIRED.filter((k) => !process.env[k]);
  const provider = (process.env.MAIL_PROVIDER || "").toLowerCase();

  let providerMissing = [];
  if (provider && PROVIDER_KEYS[provider]) {
    providerMissing = PROVIDER_KEYS[provider].filter((k) => !process.env[k]);
  } else if (provider) {
    missing.push(`MAIL_PROVIDER=${provider} (unknown)`);
  }

  if (missing.length) die("❌ missing env:\n  " + missing.join("\n  "));

  if (providerMissing.length) {
    const msg = "⚠ missing provider env (sends will fail):\n  " + providerMissing.join("\n  ");
    if (prod) die(msg);
    console.warn(msg);
  }

  if (prod) {
    for (const k of ["UI_PASSWORD", "SEND_API_KEY"]) {
      if (process.env[k].length < 24) die(`❌ ${k} must be ≥24 chars in production`);
    }
    if (!/^https:\/\//.test(process.env.PUBLIC_BASE_URL || "")) {
      die("❌ PUBLIC_BASE_URL must be https in production");
    }
  }
}

module.exports = { validate };
