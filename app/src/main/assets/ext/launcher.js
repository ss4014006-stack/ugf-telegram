// Floating logo + slide-up panel. Runs on the Telegram page (top frame only).
(function () {
  if (window.top !== window) return;
  var BASE = '/__ugf/';
  var host, btn, backdrop, sheet, frame, open = false;

  function readSaved() {
    try { return JSON.parse(localStorage.getItem('ugf_store') || '{}'); } catch (e) { return {}; }
  }
  function pushSettings(settings) {
    window.postMessage({ type: 'AUDIO_SETTINGS_UPDATE', settings: settings }, '*');
  }
  // Apply saved sliders right away so the voice effect is active even if the panel was never opened.
  var saved = readSaved(); saved.power = true; pushSettings(saved);

  // Panel -> page (settings changed)
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d) return;
    if (d.ugf === 1 && d.msg && d.msg.type === 'UPDATE_AUDIO_SETTINGS') pushSettings(d.msg.settings);
    // injected.js -> panel (level meter)
    if (d.type === 'AUDIO_LEVEL' && e.source === window && frame && frame.contentWindow) {
      frame.contentWindow.postMessage({ ugfLevel: { type: 'AUDIO_LEVEL', level: d.level } }, '*');
    }
  });

  function build() {
    if (host) return;
    host = document.createElement('div');
    host.id = 'ugf-host';
    host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;';

    btn = document.createElement('img');
    btn.src = BASE + 'assets/ui-fighter-icon-48.png';
    btn.alt = 'UI GOD FATHER';
    var pos = { x: null, y: null };
    try { pos = JSON.parse(localStorage.getItem('ugf_pos') || '{}'); } catch (e) {}
    var size = 46;
    var x = pos.x != null ? pos.x : window.innerWidth - size - 8;
    var y = pos.y != null ? pos.y : Math.round(window.innerHeight * 0.4);
    btn.style.cssText = 'position:fixed;width:' + size + 'px;height:' + size + 'px;border-radius:14px;' +
      'border:2px solid #ff741c;box-shadow:0 4px 14px rgba(0,0,0,.55);opacity:.92;touch-action:none;' +
      'background:#000;object-fit:cover;user-select:none;-webkit-user-select:none;';
    function place() {
      x = Math.max(0, Math.min(window.innerWidth - size, x));
      y = Math.max(0, Math.min(window.innerHeight - size, y));
      btn.style.left = x + 'px'; btn.style.top = y + 'px';
    }
    place();
    window.addEventListener('resize', place);

    var sx, sy, ox, oy, moved = false, down = false;
    btn.addEventListener('touchstart', function (e) {
      var t = e.touches[0]; sx = t.clientX; sy = t.clientY; ox = x; oy = y; moved = false; down = true;
    }, { passive: true });
    btn.addEventListener('touchmove', function (e) {
      if (!down) return;
      var t = e.touches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) > 8) moved = true;
      if (moved) { x = ox + dx; y = oy + dy; place(); e.preventDefault(); }
    }, { passive: false });
    btn.addEventListener('touchend', function () {
      down = false;
      if (moved) { try { localStorage.setItem('ugf_pos', JSON.stringify({ x: x, y: y })); } catch (e) {} }
      else toggle();
    });
    if (!('ontouchstart' in window)) btn.addEventListener('click', toggle);

    backdrop = document.createElement('div');
    backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:none;';
    backdrop.addEventListener('click', toggle);

    sheet = document.createElement('div');
    sheet.style.cssText = 'position:fixed;left:50%;bottom:0;transform:translateX(-50%);width:100%;max-width:440px;' +
      'height:90vh;display:none;background:#080707;border-radius:22px 22px 0 0;overflow:hidden;' +
      'box-shadow:0 -8px 30px rgba(0,0,0,.6);';
    var close = document.createElement('div');
    close.textContent = '✕';
    close.style.cssText = 'position:absolute;right:12px;top:8px;z-index:2;width:34px;height:34px;line-height:34px;' +
      'text-align:center;color:#ffc36c;font:700 16px sans-serif;background:rgba(20,12,12,.85);' +
      'border:1px solid rgba(255,116,28,.5);border-radius:10px;';
    close.addEventListener('click', toggle);
    frame = document.createElement('iframe');
    frame.style.cssText = 'width:100%;height:100%;border:0;background:#080707;';
    frame.setAttribute('allow', 'microphone');
    sheet.appendChild(frame); sheet.appendChild(close);

    host.appendChild(backdrop); host.appendChild(sheet); host.appendChild(btn);
    document.documentElement.appendChild(host);
  }

  function toggle() {
    open = !open;
    if (open && !frame.getAttribute('src')) frame.src = BASE + 'popup.html';
    backdrop.style.display = open ? 'block' : 'none';
    sheet.style.display = open ? 'block' : 'none';
    btn.style.display = open ? 'none' : 'block';
  }

  function ready() { build(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
  // Telegram may rebuild <body>; make sure our host stays attached.
  setInterval(function () { if (host && !host.isConnected) document.documentElement.appendChild(host); }, 2000);
})();
