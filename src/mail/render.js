const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const f = (b, size, lh) =>
  `font-family:${b.fontStack};font-size:${size}px;line-height:${lh};color:${b.ink};`;

function banner(b) {
  if (b.bannerUrl)
    return `<img src="${esc(b.bannerUrl)}" width="600" alt="${esc(b.bannerAlt || b.name)}" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;">`;
  return `<div style="background:${b.bannerBg};color:#fff;font-family:Arial,Helvetica,sans-serif;font-weight:bold;font-size:28px;letter-spacing:2px;text-align:center;padding:48px 10px;">${b.bannerText}</div>`;
}

function footer(b, unsubUrl) {
  const logo = b.logoUrl
    ? `<img src="${esc(b.logoUrl)}" width="120" alt="${esc(b.name)}" style="display:block;margin:0 auto 14px;border:0;max-width:120px;height:auto;">`
    : "";
  return `<tr><td align="center" style="padding:32px 40px 40px;border-top:1px solid #ddd6c6;font-family:${b.fontStack};font-size:12px;line-height:1.7;color:${b.muted};">
    ${logo}
    <div>${esc(b.name)}</div>
    ${b.address ? `<div>${esc(b.address)}</div>` : ""}
    ${unsubUrl ? `<div style="padding-top:10px;"><a href="${esc(unsubUrl)}" style="color:${b.muted};">Unsubscribe</a></div>` : ""}
  </td></tr>`;
}

module.exports = function render(brand, content, opts = {}) {
  const c = { ...brand.defaults, ...content };
  const paras = (Array.isArray(c.paragraphs) ? c.paragraphs : [c.paragraphs])
    .filter((p) => String(p ?? "").trim() !== "");

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${esc(c.title)}</title></head>
<body style="margin:0;padding:0;background:${brand.pageBg};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(c.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${brand.pageBg}">
<tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${brand.cardBg};">
    <tr><td style="padding:0 0 40px;">${banner(brand)}</td></tr>
    <tr><td style="padding:0 40px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:0 0 28px;${f(brand, 19, 1.5)}">${esc(c.title)}</td></tr>
        <tr><td style="padding:0 0 24px;${f(brand, 17, 1.75)}">${esc(c.greeting)}</td></tr>
        ${paras.map((t) => `<tr><td style="padding:0 0 24px;${f(brand, 17, 1.75)}">${esc(t)}</td></tr>`).join("")}
        <tr><td style="padding:8px 0 0;${f(brand, 17, 1.75)}">Best regards,</td></tr>
        <tr><td style="padding:18px 0 0;${f(brand, 17, 1.6)}">${esc(c.signatureName)}</td></tr>
        ${c.organization ? `<tr><td style="padding:16px 0 0;${f(brand, 17, 1.6)}">${esc(c.organization)}</td></tr>` : ""}
        <tr><td style="padding:0 0 44px;"></td></tr>
      </table>
    </td></tr>
    ${footer(brand, opts.unsubscribeUrl)}
  </table>
</td></tr>
</table>
</body></html>`;
};
