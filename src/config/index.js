const brands = require("./brands");

const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
const abs = (p) => (!p ? "" : /^https?:\/\//.test(p) ? p : base + p);

for (const brand of Object.values(brands)) {
  brand.bannerUrl = abs(brand.bannerUrl);
  brand.logoUrl = abs(brand.logoUrl);
}

module.exports = brands;