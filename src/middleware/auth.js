const safeEq = require("../lib/safe-eq");

module.exports = function auth(req, res, next) {
  if (safeEq(req.get("x-api-key"), process.env.SEND_API_KEY)) return next();
  const h = req.get("authorization") || "";
  if (h.startsWith("Basic ")) {
    const [u, p] = Buffer.from(h.slice(6), "base64").toString().split(":");
    if (safeEq(u, process.env.UI_USER) && safeEq(p, process.env.UI_PASSWORD)) return next();
  }
  res.set("WWW-Authenticate", 'Basic realm="mail"').status(401).send("auth required");
};
