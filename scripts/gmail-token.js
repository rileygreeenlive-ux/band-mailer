const http = require("http");
const { URL } = require("url");

const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET } = process.env;
const PORT = 53682;
const REDIRECT = `http://localhost:${PORT}`;

const authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
  client_id: GMAIL_CLIENT_ID,
  redirect_uri: REDIRECT,
  response_type: "code",
  scope: "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.settings.basic",
  access_type: "offline",
  prompt: "consent",
});

console.log("Open this, approve, then wait:\n\n" + authUrl + "\n");

const server = http.createServer(async (req, res) => {
  const code = new URL(req.url, REDIRECT).searchParams.get("code");
  if (!code) return res.end("no code");
  res.end("Done — check the terminal.");
  server.close();

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GMAIL_CLIENT_ID,
      client_secret: GMAIL_CLIENT_SECRET,
      redirect_uri: REDIRECT,
      grant_type: "authorization_code",
    }),
  });
  const json = await response.json();
  console.log("\nREFRESH TOKEN:\n" + (json.refresh_token || JSON.stringify(json)));
});

server.listen(PORT);
