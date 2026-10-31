require("dotenv").config();
const { validate } = require("./config/env");
validate();

const app = require("./app");

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";

const server = app.listen(port, host, () => console.log(`✅ http://${host}:${port}`));

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    console.log(`${sig} — draining`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}