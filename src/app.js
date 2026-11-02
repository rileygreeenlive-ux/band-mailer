const path = require("path");
const express = require("express");
const helmet = require("helmet");
const auth = require("./middleware/auth");
const api = require("./routes/api");
const pages = require("./routes/pages");
const templates = require("./routes/templates");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        scriptSrc: ["'self'"],
        frameAncestors: ["'self'"],
        objectSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

app.use(express.json({ limit: "256kb" }));
app.use(express.static(path.join(__dirname, "..", "public"), { index: false }));

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.use("/api", auth, api);
app.use("/api/templates", templates);
app.use("/", pages);

app.use((_req, res) => res.status(404).json({ error: "not found" }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "internal error" });
});

module.exports = app;
