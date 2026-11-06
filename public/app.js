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

  $("ai-btn").addEventListener("click", async () => {
    const prompt = $("ai-prompt").value.trim();
    if (!prompt || !currentTemplate) return;
    $("ai-btn").disabled = true;
    $("ai-status").textContent = "Drafting…";
    $("ai-status").className = "ai-status";
    try {
      const r = await fetch("/api/ai/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, templateId: currentTemplate.id }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.status);
      $("t-subject").value = j.subject || currentTemplate.defaultSubject;
      for (const [key, val] of Object.entries(j.variables)) {
        const el = $(`var-${key}`);
        if (el && typeof val === "string") el.value = val;
      }
      saveTemplateDraft();
      templatePreview();
      $("ai-status").textContent = "✅ Draft ready — review and edit before sending";
      $("ai-status").className = "ai-status ok";
    } catch (err) {
      $("ai-status").textContent = "❌ " + err.message;
      $("ai-status").className = "ai-status err";
    } finally {
      $("ai-btn").disabled = false;
    }
  });

  // Populate auto-respond template dropdown
  const arTpl = $("ar-template");
  if (arTpl && $("template")) {
    arTpl.innerHTML = `<option value="">Auto-detect template</option>` +
      $("template").innerHTML;
  }

  // Auto-respond
  $("ar-btn").addEventListener("click", async () => {
    const from = $("ar-from").value.trim();
    const body = $("ar-body").value.trim();
    if (!from || !body) {
      $("ar-status").textContent = "❌ Sender and body required";
      $("ar-status").className = "ai-status err";
      return;
    }
    $("ar-btn").disabled = true;
    $("ar-status").textContent = "⚡ Classifying → extracting → rendering → sending…";
    $("ar-status").className = "ai-status";
    try {
      const r = await fetch("/api/auto-respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          subject: $("ar-subject").value.trim(),
          body,
          templateId: $("ar-template").value || undefined,
          messageId: $("ar-btn").dataset.messageId || undefined,
          references: $("ar-btn").dataset.references || undefined,
          gmailMessageId: $("ar-btn").dataset.gmailMessageId || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.status);
      $("ar-status").textContent =
        `✅ Sent via ${j.provider} — template: ${j.templateId}\n` +
        `ID: ${j.id}`;
      $("ar-status").className = "ai-status ok";
    } catch (err) {
      $("ar-status").textContent = "❌ " + err.message;
      $("ar-status").className = "ai-status err";
    } finally {
      $("ar-btn").disabled = false;
    }
  });

  // Fetch recent Gmail messages
  $("fetch-recent").addEventListener("click", async () => {
    const list = $("recent-list");
    list.innerHTML = '<div class="ai-status">Fetching…</div>';
    try {
      const r = await fetch("/api/gmail/recent?n=10");
      const msgs = await r.json();
      if (!r.ok) throw new Error(msgs.error || r.status);
      if (!msgs.length) {
        list.innerHTML = '<div class="ai-status">No recent messages found.</div>';
        return;
      }
      list.innerHTML = msgs.map(m => `
        <div class="recent-item" data-id="${m.id}" data-thread="${m.threadId}"
             data-from="${escHtml(m.from)}" data-subject="${escHtml(m.subject)}"
             data-messageid="${escHtml(m.messageId)}" data-references="${escHtml(m.references)}"
             data-body="${escHtml(m.body)}">
          <div class="recent-meta">
            <strong>${escHtml(m.from)}</strong>
            <span class="recent-date">${escHtml(m.date)}</span>
          </div>
          <div class="recent-subject">${escHtml(m.subject)}</div>
          <div class="recent-body">${escHtml(m.body.slice(0, 120))}…</div>
          <button type="button" class="reply-btn">⚡ Reply</button>
        </div>
      `).join("");

      list.querySelectorAll(".reply-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const item = btn.closest(".recent-item");
          $("ar-from").value = item.dataset.from;
          $("ar-subject").value = item.dataset.subject;
          $("ar-body").value = item.dataset.body;
          // Store messageId + references + gmailMessageId for the reply
          item.dataset._used = "1";
          $("ar-btn").dataset.messageId = item.dataset.messageid;
          $("ar-btn").dataset.references = item.dataset.references;
          $("ar-btn").dataset.gmailMessageId = item.dataset.id;
          // Scroll to auto-respond and flash it
          document.querySelector(".auto-respond").scrollIntoView({ behavior: "smooth" });
          document.querySelector(".auto-respond").classList.add("flash");
          setTimeout(() => document.querySelector(".auto-respond").classList.remove("flash"), 1500);
        });
      });
    } catch (e) {
      list.innerHTML = `<div class="ai-status err">❌ ${escHtml(e.message)}</div>`;
    }
  });

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