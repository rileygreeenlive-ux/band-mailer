require("dotenv").config();
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const credentialPath = path.join(
  os.homedir(),
  "Downloads",
  "client_secret_857318468391-j6ltfdkb39de001iafolorrppd9g3p41.apps.googleusercontent.com.json"
);
const credentials = fs.existsSync(credentialPath)
  ? JSON.parse(fs.readFileSync(credentialPath, "utf8")).installed
  : null;
const clientId = process.env.GMAIL_CLIENT_ID || credentials?.client_id;
const clientSecret = process.env.GMAIL_CLIENT_SECRET || credentials?.client_secret;

function updateEnv(values) {
  const envPath = path.join(process.cwd(), ".env");
  let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const lines = env.split(/\r?\n/).filter(Boolean);

  for (const [key, value] of Object.entries(values)) {
    const index = lines.findIndex((line) => line.startsWith(`${key}=`));
    const entry = `${key}=${value}`;
    if (index === -1) lines.push(entry);
    else lines[index] = entry;
  }

  fs.writeFileSync(envPath, `${lines.join("\n")}\n`);
}

if (!clientId || !clientSecret) throw new Error("Gmail OAuth client credentials are missing");

const PORT = 53682;
const REDIRECT = `http://localhost:${PORT}/oauth2callback`;
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.settings.basic",
];

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", clientId);
authUrl.searchParams.set("redirect_uri", REDIRECT);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", SCOPES.join(" "));
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");
authUrl.searchParams.set("login_hint", "rileygreenmanageementteam@gmail.com");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== "/oauth2callback") return res.end("waiting");

  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  if (error) {
    res.end(`error: ${error}`);
    console.log("ERROR:", error);
    server.close();
    return;
  }
  if (!code) {
    res.end("no code");
    return;
  }

  const tokenResponse = await fetch("https://accounts.google.com/o/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT,
      grant_type: "authorization_code",
    }),
  });
  const token = await tokenResponse.json();

  if (!token.refresh_token) {
    res.end("no refresh token - see terminal");
    console.log("NO REFRESH TOKEN. Response:", JSON.stringify(token, null, 2));
    server.close();
    return;
  }

  updateEnv({
    GMAIL_CLIENT_ID: clientId,
    GMAIL_CLIENT_SECRET: clientSecret,
    GMAIL_REFRESH_TOKEN: token.refresh_token,
  });

  const sendAsResponse = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs",
    { headers: { Authorization: `Bearer ${token.access_token}` } }
  );
  const sendAs = await sendAsResponse.json();

  console.log("\n=== ACCOUNT CHECK ===");
  console.log(JSON.stringify((sendAs.sendAs || []).map((entry) => ({
    email: entry.sendAsEmail,
    isPrimary: entry.isPrimary,
    verificationStatus: entry.verificationStatus,
    treatAsAlias: entry.treatAsAlias,
  })), null, 2));
  console.log("\n=== REFRESH TOKEN ===");
  console.log(token.refresh_token);

  res.end("Done - check the terminal, you can close this tab.");
  server.close();
});

app.use((err, req, res, next) => {
  console.error(err);
  const status = err.statusCode || err.status || 500;
  res.status(status).json({ error: status >= 500 ? 'internal error' : err.message });
});

server.listen(PORT, () => {
  console.log("Open this URL in the IDE browser and sign in as the management account:\n");
  console.log(authUrl.toString(), "\n");
});
