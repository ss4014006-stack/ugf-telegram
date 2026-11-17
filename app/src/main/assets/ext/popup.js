const SLIDER_DEFS = [
  { id: 'volume', label: 'VOLUME', min: 1, max: 9000, step: 10, def: 3000 },
  { id: 'micGain', label: 'MIC GAIN', min: 0, max: 9000, step: 10, def: 2500 },
  { id: 'bass', label: 'BASS', min: 0, max: 9000, step: 10, def: 250 },
  { id: 'treble', label: 'TREBLE', min: 0, max: 9000, step: 10, def: 500 },
  { id: 'sharpness', label: 'SHARPNESS', min: 0, max: 9000, step: 10, def: 500 },
  { id: 'echo', label: 'ECHO', min: 0, max: 100, step: 1, def: 15 },
  { id: 'noiseGate', label: 'NOISE GATE', min: 0, max: 100, step: 1, def: 0 },
  { id: 'compression', label: 'COMPRESSOR', min: 0, max: 100, step: 1, def: 55 },
  { id: 'limiter', label: 'LIMITER', min: 0, max: 100, step: 1, def: 80 }
];
const sliderIds = SLIDER_DEFS.map(s => s.id);
const DEFAULTS = Object.fromEntries(SLIDER_DEFS.map(s => [s.id, s.def]));
const PRESETS = {
  preset1: { volume: 5500, micGain: 5000, bass: 2500, treble: 3000, sharpness: 3000, echo: 8, noiseGate: 0, compression: 45, limiter: 70 },
  preset2: { volume: 7500, micGain: 7000, bass: 5000, treble: 5500, sharpness: 5500, echo: 15, noiseGate: 5, compression: 65, limiter: 82 },
  preset3: { volume: 9000, micGain: 9000, bass: 9000, treble: 9000, sharpness: 9000, echo: 25, noiseGate: 8, compression: 80, limiter: 90 }
};
let saveTimeout;
let sendTimeout;

function updateValueDisplay(id, value) {
  const node = document.getElementById(`${id}Value`);
  if (node) node.textContent = `${Math.round(Number(value))}`;
}

function updateTrackFill(id) {
  const input = document.getElementById(id);
  if (!input) return;
  const min = Number(input.min), max = Number(input.max), value = Number(input.value);
  const pct = ((value - min) / (max - min)) * 100;
  input.style.background = `linear-gradient(90deg, #8e2cff 0%, #dca8ff ${pct}%, #24142f ${pct}%, #24142f 100%)`;
}

function sendSettings() {
  const settings = Object.fromEntries(sliderIds.map(id => [id, Number(document.getElementById(id).value)]));
  settings.power = document.body.dataset.power === 'on';
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]) return;
    try { chrome.tabs.sendMessage(tabs[0].id, { type: 'UPDATE_AUDIO_SETTINGS', settings }); } catch (_) {}
  });
}

function applySettings(settings, notify) {
  for (const id of sliderIds) {
    if (settings[id] === undefined) continue;
    const input = document.getElementById(id);
    input.value = settings[id];
    updateValueDisplay(id, settings[id]);
    updateTrackFill(id);
  }
  chrome.storage.local.set(settings);
  sendSettings();
  if (notify) showToast(notify);
}

function showToast(text) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = text;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 200); }, 1300);
}

function setPowerVisual(on) {
  const toggle = document.getElementById('powerToggle');
  const logo = document.getElementById('powerLogo');
  const text = document.getElementById('toggleText');
  document.body.dataset.power = on ? 'on' : 'off';
  toggle.setAttribute('aria-pressed', String(on));
  toggle.setAttribute('aria-label', on ? 'Turn voice processing off' : 'Turn voice processing on');
  logo.src = on ? 'assets/ui-fighter-tiger.jpg' : 'assets/normal-mic.png';
  text.textContent = on ? 'UI GOD FATHER SUMIT V3 AUDIO ON' : 'CLEAN MIC BYPASS';
  sendSettings();
}


function syncQuickButtons() {
  const pairs = [['gateQuick','noiseGate'],['compQuick','compression'],['limitQuick','limiter']];
  for (const [btnId, sliderId] of pairs) {
    const btn = document.getElementById(btnId);
    const slider = document.getElementById(sliderId);
    if (!btn || !slider) continue;
    const active = Number(slider.value) > 0;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
    const label = btn.querySelector('b');
    if (label) label.textContent = active ? 'ON' : 'OFF';
  }
}

function bindQuickControls() {
  const pairs = [['gateQuick','noiseGate'],['compQuick','compression'],['limitQuick','limiter']];
  pairs.forEach(([btnId, sliderId]) => {
    const btn = document.getElementById(btnId);
    const slider = document.getElementById(sliderId);
    if (!btn || !slider) return;
    btn.addEventListener('click', () => {
      const active = !btn.classList.contains('active');
      const next = active ? (sliderId === 'noiseGate' ? 25 : sliderId === 'compression' ? 55 : 80) : 0;
      slider.value = next;
      updateValueDisplay(sliderId, next);
      updateTrackFill(sliderId);
      syncQuickButtons();
      chrome.storage.local.set({[sliderId]: Number(next)});
      sendSettings();
    });
  });
}

function init() {
  bindQuickControls();

  chrome.storage.local.get([...sliderIds, 'power'], result => {
    for (const def of SLIDER_DEFS) {
      const value = result[def.id] ?? def.def;
      const input = document.getElementById(def.id);
      if (!input) continue;
      input.value = value;
      updateValueDisplay(def.id, value);
      updateTrackFill(def.id);
    }
    syncQuickButtons();
    if (result.power !== undefined) setPowerVisual(result.power);
    sendSettings();
  });

  for (const id of sliderIds) {
    const input = document.getElementById(id);
    if (!input) continue;
    input.addEventListener('input', event => {
      const value = Number(event.target.value);
      updateValueDisplay(id, value);
      updateTrackFill(id);
      syncQuickButtons();
      const cs=document.getElementById('controlStatus'); if(cs) cs.textContent=`LIVE • ${id.toUpperCase()} = ${Math.round(value)}`;
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => chrome.storage.local.set({ [id]: value }), 120);
      clearTimeout(sendTimeout);
      sendTimeout = setTimeout(sendSettings, 60);
    });
  }

  document.getElementById('resetBtn').addEventListener('click', () => applySettings(DEFAULTS, 'AMPLIFIER SETTINGS RESET'));
  Object.entries(PRESETS).forEach(([id, settings]) => {
    document.getElementById(id).addEventListener('click', () => { applySettings(settings, `${id.toUpperCase()} ACTIVE`); const b=document.getElementById('boostBadge'); if(b) b.textContent=id==='preset3'?'ULTRA BOOST ACTIVE':id==='preset2'?'POWER BOOST ACTIVE':'BALANCED POWER'; });
  });
  chrome.runtime.onMessage.addListener(message => {
    if (message.type !== 'AUDIO_LEVEL') return;
    const level = Math.max(0, Math.min(100, Number(message.level) || 0));
    const bar = document.getElementById('levelBar');
    const value = document.getElementById('levelValue');
    const status = document.getElementById('meterStatus');
    if (bar) bar.style.height = `${Math.max(3, level)}%`;
    if (value) value.textContent = `${Math.round(level)}%`;
    if (status) status.textContent = level > 92 ? 'HOT' : level > 65 ? 'ACTIVE' : 'READY';
  });
  document.getElementById('powerToggle').addEventListener('click', () => {
    const on = document.body.dataset.power !== 'on';
    setPowerVisual(on);
  });
  setPowerVisual(true);
}

document.addEventListener('DOMContentLoaded', init);
