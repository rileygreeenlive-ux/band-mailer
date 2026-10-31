const $ = (id) => document.getElementById(id);
const FIELDS = ["to","cc","bcc","subject","preheader","title","greeting","paragraphs","signatureName","organization"];
const BODY_FIELDS = ["preheader","title","greeting","paragraphs","signatureName","organization"];
let brand = "";

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

async function boot() {
  const list = await (await fetch("/api/brands")).json();
  $("brand").innerHTML = list.map((b) => `<option value="${b.slug}">${b.name}</option>`).join("");
  brand = list[0]?.slug || "";
  const d = list[0]?.defaults || {};
  for (const k of BODY_FIELDS) $(k).value = Array.isArray(d[k]) ? d[k].join("\n\n") : (d[k] ?? "");
  $("subject").value = d.title || "";
  load();
  preview();
}

let timer;
function preview() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const r = await fetch(`/api/preview/${brand}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(content()),
    });
    $("pv").srcdoc = await r.text();
  }, 250);
}

function status(msg, cls) {
  $("status").textContent = msg;
  $("status").className = cls || "";
}

$("brand").addEventListener("change", () => { brand = $("brand").value; load(); preview(); });
$("f").addEventListener("input", () => { save(); preview(); });
$("reset").addEventListener("click", () => { localStorage.removeItem(draftKey()); location.reload(); });

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

boot();
