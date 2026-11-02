const express = require("express");
const { list, render } = require("../templates/render");
const router = express.Router();

router.get("/", (_req, res) => res.json(list()));

router.get("/:id/preview", (req, res) => {
  try {
    const { html } = render(req.params.id, req.query);
    res.type("html").send(html);
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

module.exports = router;
