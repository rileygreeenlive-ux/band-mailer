const ALLOW = new Set(["templates", "send-template", "health"]);

module.exports = async function handler(req, res) {
  const segs = [].concat(req.query.path || []);
  if (!segs.length || !ALLOW.has(segs[0])) {
    return res.status(404).json({ error: "not found" });
  }

  const { path: _path, ...query } = req.query;
  const qs = new URLSearchParams(query).toString();
  const url = process.env.BACKEND_URL + "/api/" + segs.join("/") + (qs ? "?" + qs : "");

  const init = {
    method: req.method,
    headers: { "x-api-key": process.env.SEND_API_KEY },
  };
  if (!["GET", "HEAD"].includes(req.method)) {
    init.headers["Content-Type"] = "application/json";
    init.body = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
  }

  try {
    const response = await fetch(url, init);
    res.status(response.status);
    res.setHeader("Content-Type", response.headers.get("content-type") || "application/json");
    res.send(await response.text());
  } catch {
    res.status(502).json({ error: "backend unreachable" });
  }
};
