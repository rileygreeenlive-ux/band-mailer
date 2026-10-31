const path = require("path");
const express = require("express");
const auth = require("../middleware/auth");

const router = express.Router();
const publicDir = path.join(__dirname, "..", "..", "public");

router.use(auth);

router.get("/", (_req, res) => res.sendFile("index.html", { root: publicDir }));

module.exports = router;
