module.exports = function toText(brand, content, opts = {}) {
  const c = { ...brand.defaults, ...content };
  const paras = (Array.isArray(c.paragraphs) ? c.paragraphs : [c.paragraphs]).filter(Boolean);
  return [
    c.title, "", c.greeting, "", ...paras, "", "Best regards,", c.signatureName,
    c.organization, "", brand.name, brand.address,
    opts.unsubscribeUrl ? `Unsubscribe: ${opts.unsubscribeUrl}` : "",
  ].filter((l) => l !== undefined && l !== "").join("\n");
};
