// Mini "chrome.*" replacement so the original popup.js works inside the app.
(function () {
  var KEY = 'ugf_store';
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } }
  function save(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} }
  var listeners = [];
  window.chrome = {
    storage: { local: {
      get: function (keys, cb) {
        var s = load(), out = {};
        (Array.isArray(keys) ? keys : [keys]).forEach(function (k) { if (s[k] !== undefined) out[k] = s[k]; });
        cb && cb(out);
      },
      set: function (obj) { var s = load(); for (var k in obj) s[k] = obj[k]; save(s); }
    } },
    tabs: {
      query: function (q, cb) { cb([{ id: 1 }]); },
      sendMessage: function (id, msg) { parent.postMessage({ ugf: 1, msg: msg }, '*'); }
    },
    runtime: { onMessage: { addListener: function (fn) { listeners.push(fn); } } }
  };
  window.addEventListener('message', function (e) {
    if (e.source !== parent || !e.data || !e.data.ugfLevel) return;
    listeners.forEach(function (fn) { fn(e.data.ugfLevel); });
  });
  var st = document.createElement('style');
  st.textContent = 'html,body{width:100%!important;max-width:none!important}body{padding:8px 8px 40px!important}';
  document.head.appendChild(st);
})();
