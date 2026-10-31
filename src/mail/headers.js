const crypto = require("crypto");

module.exports = function headers(unsubUrl) {
  const h = { "X-Entity-Ref-ID": crypto.randomUUID() };
  if (unsubUrl) {
    h["List-Unsubscribe"] = `<${unsubUrl}>`;
    h["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  return h;
};
