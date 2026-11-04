const $ = (id) => document.getElementById(id);
const escHtml = (s) => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

const FIELDS = ["to","cc","bcc","subject","preheader","title","greeting","paragraphs","signatureName","organization"];
const BODY_FIELDS = ["preheader","title","greeting","paragraphs","signatureName","organization"];

let brand = "";
let mode = "free";       // "free" | "template"
let pvMode = "raw";      // "raw" | "inbox"
let rawHtml = "";        // last rendered email HTML
let currentTemplate = null;

// ── Free-form helpers ──────────────────────────────────
const content = () => Object.fromEntries(BODY_FIELDS.map((k) => [k, $(k).value]));
const draftKey = () => "draft:" + brand;

function save() {
  localStorage.setItem(draftKey(), JSON.stringify(Object.fromEntries(FIELDS.map((k) => [k, $(k).value]))));
}
function load() {
  const raw = localStorage.getItem(draftKey());
  const o = raw ? JSON.parse(raw) : {};
  for (const k of FIELDS) $(k).value = o[k] ?? "";
}

// ── Template helpers ───────────────────────────────────
function templateDraftKey() { return "tdraft:" + (currentTemplate?.id || ""); }

function saveTemplateDraft() {
  if (!currentTemplate) return;
  const vars = collectTemplateVars();
  localStorage.setItem(templateDraftKey(), JSON.stringify({
    to: $("t-to").value,
    subject: $("t-subject").value,
    vars,
  }));
}

function loadTemplateDraft() {
  if (!currentTemplate) return;
  const raw = localStorage.getItem(templateDraftKey());
  if (!raw) return;
  const o = JSON.parse(raw);
  $("t-to").value = o.to || "";
  $("t-subject").value = o.subject || "";
  for (const [k, v] of Object.entries(o.vars || {})) {
    const el = $(`var-${k}`);
    if (el) el.value = v;
  }
}

function collectTemplateVars() {
  const vars = {};
  document.querySelectorAll("#t-vars [data-key]").forEach(el => {
    vars[el.dataset.key] = el.value;
  });
  return vars;
}

function renderVarInputs(tpl) {
  const c = $("t-vars");
  c.innerHTML = tpl.variables.map(v => {
    const val = escHtml(v.default || "");
    const id = `var-${v.key}`;
    if (v.multiline) {
      return `<div class="var-field">
        <label for="${id}">${escHtml(v.label)}</label>
        <textarea id="${id}" data-key="${v.key}" rows="4">${val}</textarea>
      </div>`;
    }
    return `<div class="var-field">
      <label for="${id}">${escHtml(v.label)}</label>
      <input id="${id}" data-key="${v.key}" value="${val}">
    </div>`;
  }).join("");

  c.querySelectorAll("input, textarea").forEach(el => {
    el.addEventListener("input", () => { saveTemplateDraft(); templatePreview(); });
  });
}

// ── Preview ────────────────────────────────────────────
let timer;
function schedulePreview(fn) {
  clearTimeout(timer);
  timer = setTimeout(fn, 250);
}

function freePreview() {
  schedulePreview(async () => {
    const r = await fetch(`/api/preview/${brand}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(content()),
    });
    rawHtml = await r.text();
    showPreview();
  });
}

function templatePreview() {
  if (!currentTemplate) return;
  schedulePreview(async () => {
    const r = await fetch(`/api/templates/${currentTemplate.id}/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variables: collectTemplateVars() }),
    });
    rawHtml = await r.text();
    showPreview();
  });
}

function showPreview() {
  if (pvMode === "raw") {
    $("pv").srcdoc = rawHtml;
  } else {
    $("pv").srcdoc = buildInboxFrame();
  }
}

function buildInboxFrame() {
  const senderName = $("brand").options[$("brand").selectedIndex]?.text || "BMLG Records";
  const subject = mode === "template"
    ? ($("t-subject").value || currentTemplate?.defaultSubject || "Preview")
    : ($("subject").value || "Preview");
  const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const initial = (senderName[0] || "B").toUpperCase();

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f6f8fc}
.frame{max-width:720px;margin:0 auto;background:#fff;min-height:100vh}
.topbar{display:flex;align-items:center;gap:12px;padding:16px 20px 12px;border-bottom:1px solid #e8eaed}
.avatar{width:40px;height:40px;border-radius:50%;background:#c5221f;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:16px;flex-shrink:0}
.meta{flex:1;min-width:0}
.from{font-weight:500;font-size:14px;color:#202124}
.time{font-weight:400;color:#5f6368;font-size:12px;margin-left:8px}
.subj{font-size:14px;color:#202124;margin-top:2px}
.to{font-size:12px;color:#5f6368;margin-top:2px}
.unsub{padding:8px 20px;background:#f8f9fa;border-bottom:1px solid #e8eaed;font-size:12px;color:#5f6368}
</style></head>
<body>
<div class="frame">
  <div class="topbar">
    <div class="avatar">${initial}</div>
    <div class="meta">
      <div class="from">${escHtml(senderName)}<span class="time">${now}</span></div>
      <div class="subj">${escHtml(subject)}</div>
      <div class="to">to me</div>
    </div>
  </div>
  <div class="unsub">Unsubscribe</div>
  <iframe id="inner" style="width:100%;border:0;min-height:500px;display:block"></iframe>
</div>
<script>document.getElementById("inner").srcdoc=${JSON.stringify(rawHtml)};<\/script>
</body></html>`;
}

// ── Status ─────────────────────────────────────────────
function status(msg, cls, el) {
  const target = el || $("status");
  target.textContent = msg;
  target.className = cls || "";
}

// ── Mode switching ─────────────────────────────────────
function switchMode(m) {
  mode = m;
  $("mode-free").classList.toggle("active", m === "free");
  $("mode-template").classList.toggle("active", m === "template");
  $("panel-free").style.display = m === "free" ? "" : "none";
  $("panel-template").style.display = m === "template" ? "" : "none";
  $("brand").style.display = m === "free" ? "" : "none";
  $("template").style.display = m === "template" ? "" : "none";
}

// ── Boot ───────────────────────────────────────────────
async function boot() {
  // Load brands
  const brandsList = await (await fetch("/api/brands")).json();
  $("brand").innerHTML = brandsList.map(b => `<option value="${b.slug}">${escHtml(b.name)}</option>`).join("");
  brand = brandsList[0]?.slug || "";
  const d = brandsList[0]?.defaults || {};
  for (const k of BODY_FIELDS) $(k).value = Array.isArray(d[k]) ? d[k].join("\n\n") : (d[k] ?? "");
  $("subject").value = d.title || "";
  load();

  // Load templates
  try {
    const templates = await (await fetch("/api/templates")).json();
    localStorage.setItem("templates-cache", JSON.stringify(templates));  // ← add this line
    $("template").innerHTML = templates.map(t =>
      `<option value="${t.id}">${escHtml(t.category)} — ${escHtml(t.name)}</option>`
    ).join("");
    currentTemplate = templates[0] || null;
    if (currentTemplate) {
      $("t-subject").value = currentTemplate.defaultSubject || "";
      renderVarInputs(currentTemplate);
    }
  } catch (e) {
    console.error("templates load failed", e);
  }

  // Wire up events
  $("brand").addEventListener("change", () => { brand = $("brand").value; load(); freePreview(); });
  $("f").addEventListener("input", () => { save(); freePreview(); });
  $("reset").addEventListener("click", () => { localStorage.removeItem(draftKey()); location.reload(); });

  $("template").addEventListener("change", () => {
    const id = $("template").value;
    const all = JSON.parse(localStorage.getItem("templates-cache") || "[]");
    currentTemplate = all.find(t => t.id === id) || null;
    if (currentTemplate) {
      $("t-subject").value = currentTemplate.defaultSubject || "";
      renderVarInputs(currentTemplate);
      loadTemplateDraft();
      templatePreview();
    }
  });

  $("t-to").addEventListener("input", saveTemplateDraft);
  $("t-subject").addEventListener("input", () => { saveTemplateDraft(); templatePreview(); });

  // Mode toggle
  $("mode-free").addEventListener("click", () => switchMode("free"));
  $("mode-template").addEventListener("click", () => switchMode("template"));

  // Preview toggle
  $("pv-raw").addEventListener("click", () => { pvMode = "raw"; $("pv-raw").classList.add("active"); $("pv-inbox").classList.remove("active"); showPreview(); });
  $("pv-inbox").addEventListener("click", () => { pvMode = "inbox"; $("pv-inbox").classList.add("active"); $("pv-raw").classList.remove("active"); showPreview(); });

  // Free-form send
  $("f").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("send").disabled = true;
    status("Sending…");
    try {
      const r = await fetch(`/api/send/${brand}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: $("to").value, cc: $("cc").value, bcc: $("bcc").value,
          subject: $("subject").value, ...content(),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.status);
      status(`✅ Sent — id ${j.id} via ${j.provider}`, "ok");
    } catch (err) {
      status(`❌ ${err.message}`, "err");
    } finally {
      $("send").disabled = false;
    }
  });

  // Template send
  $("tf").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentTemplate) return;
    $("t-send").disabled = true;
    status("Sending…", "", $("t-status"));
    try {
      const r = await fetch("/api/send-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: currentTemplate.id,
          to: $("t-to").value,
          subject: $("t-subject").value || currentTemplate.defaultSubject,
          variables: collectTemplateVars(),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.status);
      status(`✅ Sent — id ${j.id} via ${j.provider} (${j.count} recipient${j.count !== 1 ? "s" : ""})`, "ok", $("t-status"));
    } catch (err) {
      status(`❌ ${err.message}`, "err", $("t-status"));
    } finally {
      $("t-send").disabled = false;
    }
  });

  $("t-reset").addEventListener("click", () => {
    if (currentTemplate) localStorage.removeItem(templateDraftKey());
    location.reload();
  });

  // Initial preview
  freePreview();
}

boot();