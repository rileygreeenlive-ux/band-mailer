const $ = (s) => document.querySelector(s);
const api = (p, options = {}) => fetch('/api' + p, options);

const MAX = 50;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RECENT = 'bm.recent';

const state = { templates: [], id: null, values: {}, to: [], subject: '', ready: false, sending: false };

function sync() {
  $('#send').disabled = !(state.ready && state.id && state.to.length && state.subject.trim() && !state.sending);
  $('#send').textContent = state.sending ? 'Sending…' : 'Send';
}

async function boot() {
  $('#wake').hidden = false;
  try {
    await api('/health');
    state.ready = true;
    $('#wake').hidden = true;
  } catch {
    $('#wake').textContent = 'Server unreachable — reload to retry.';
  }
  sync();
  const response = await api('/templates');
  if (!response.ok) throw new Error('Unable to load templates');
  state.templates = await response.json();
  drawPicker();
  drawRecent();
}

function drawPicker() {
  const query = $('#search').value.trim().toLowerCase();
  const box = $('#picker');
  box.textContent = '';
  const groups = {};
  for (const template of state.templates) {
    if (query && !template.name.toLowerCase().includes(query) && !template.category.toLowerCase().includes(query)) continue;
    (groups[template.category] ||= []).push(template);
  }
  for (const [category, items] of Object.entries(groups)) {
    const heading = document.createElement('div');
    heading.className = 'cat';
    heading.textContent = category;
    box.append(heading);
    for (const template of items) {
      const button = document.createElement('button');
      button.className = 'item' + (template.id === state.id ? ' on' : '');
      button.textContent = template.name;
      button.onclick = () => pick(template.id);
      box.append(button);
    }
  }
}

function pick(id) {
  const template = state.templates.find((item) => item.id === id);
  if (!template) return;
  state.id = id;
  state.values = {};
  state.subject = template.defaultSubject || '';
  $('#subject').value = state.subject;
  drawPicker();
  drawVars(template);
  preview();
  sync();
}

function drawVars(template) {
  const box = $('#vars');
  box.textContent = '';
  for (const variable of template.variables) {
    const label = document.createElement('label');
    label.className = 'field';
    const span = document.createElement('span');
    span.textContent = variable.label || variable.key;
    const element = document.createElement(variable.multiline ? 'textarea' : 'input');
    element.value = variable.default ?? '';
    if (variable.multiline) element.rows = 3;
    element.oninput = () => {
      state.values[variable.key] = element.value;
      preview();
    };
    state.values[variable.key] = element.value;
    label.append(span, element);
    box.append(label);
  }
}

let timer;
function preview() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (!state.id) return;
    const query = new URLSearchParams(state.values).toString();
    $('#frame').src = `/api/templates/${encodeURIComponent(state.id)}/preview?${query}`;
  }, 300);
}

function drawChips() {
  const box = $('#chips');
  box.textContent = '';
  state.to.forEach((email, index) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = email;
    const remove = document.createElement('button');
    remove.textContent = '×';
    remove.onclick = () => {
      state.to.splice(index, 1);
      drawChips();
      sync();
    };
    chip.append(remove);
    box.append(chip);
  });
}

function addChip(raw) {
  const value = raw.trim().replace(/[,;]$/, '');
  if (!value || !EMAIL.test(value) || state.to.includes(value) || state.to.length >= MAX) return false;
  state.to.push(value);
  drawChips();
  sync();
  return true;
}

function saveRecent(ok) {
  const list = JSON.parse(localStorage.getItem(RECENT) || '[]');
  list.unshift({ id: state.id, to: [...state.to], values: { ...state.values }, subject: state.subject, ok, at: Date.now() });
  localStorage.setItem(RECENT, JSON.stringify(list.slice(0, 10)));
  drawRecent();
}

function drawRecent() {
  const box = $('#recent');
  box.textContent = '';
  const list = JSON.parse(localStorage.getItem(RECENT) || '[]');
  if (!list.length) return;
  const heading = document.createElement('div');
  heading.className = 'cat';
  heading.textContent = 'Recent';
  box.append(heading);
  for (const recent of list) {
    const button = document.createElement('button');
    button.className = 'item';
    button.textContent = `${recent.ok ? '✓' : '✕'} ${recent.subject}`;
    button.title = recent.to.join(', ');
    button.onclick = () => {
      pick(recent.id);
      state.to = [...recent.to];
      state.values = { ...recent.values };
      state.subject = recent.subject;
      $('#subject').value = recent.subject;
      drawChips();
      drawVars(state.templates.find((item) => item.id === recent.id));
      preview();
      sync();
    };
    box.append(button);
  }
}

async function send() {
  state.sending = true;
  sync();
  const result = $('#result');
  result.hidden = false;
  result.className = 'result';
  result.textContent = 'Sending…';
  try {
    const response = await api('/send-template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateId: state.id,
        to: state.to.join(', '),
        subject: state.subject,
        variables: state.values,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'send failed');
    result.className = 'result ok';
    result.textContent = `Sent to ${data.count} — id ${data.id}`;
    saveRecent(true);
  } catch (error) {
    result.className = 'result bad';
    result.textContent = error.message;
    saveRecent(false);
  }
  state.sending = false;
  sync();
}

$('#search').oninput = drawPicker;
$('#subject').oninput = (event) => {
  state.subject = event.target.value;
  sync();
};
$('#to').onkeydown = (event) => {
  if (['Enter', ',', ';', 'Tab'].includes(event.key) && addChip(event.target.value)) {
    event.target.value = '';
    event.preventDefault();
  } else if (event.key === 'Backspace' && !event.target.value && state.to.length) {
    state.to.pop();
    drawChips();
    sync();
  }
};
$('#to').onblur = (event) => {
  if (addChip(event.target.value)) event.target.value = '';
};
$('#send').onclick = send;
document.querySelectorAll('.preview-bar button').forEach((button) => {
  button.onclick = () => {
    document.querySelectorAll('.preview-bar button').forEach((item) => item.classList.remove('on'));
    button.classList.add('on');
    $('#frame').style.width = button.dataset.w + 'px';
  };
});

boot();
