const path = require("path");
const express = require("express");
const auth = require("../middleware/auth");

const router = express.Router();
const publicDir = path.join(__dirname, "..", "..", "public");

router.get("/unsubscribe", (req, res) => {
  const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  res.redirect("/api/unsubscribe" + query);
});

router.get("/subscribe", (req, res) => {
  const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  res.redirect("/api/subscribe" + query);
});

router.use(auth);

router.get("/", (_req, res) => res.sendFile("index.html", { root: publicDir }));

module.exports = router;
