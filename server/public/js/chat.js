/* chat.js — journey-start consultation + task-assist islands.
   Calls the frozen API contract in docs/api.md (§5, §8). Works without
   JS: the surrounding form POSTs and the page re-renders server-side. */
(function () {
  'use strict';

  var STATUS_LINES = [
    'Analyzing your product\u2026',
    'Checking applicable requirements\u2026',
    'Building your compliance journey\u2026'
  ];

  function setStatusLine(el, text) {
    if (!el) { return; }
    el.textContent = text || '';
  }

  function nextStatusLine(el) {
    var i = 0;
    setStatusLine(el, STATUS_LINES[0]);
    var timer = window.setInterval(function () {
      i = (i + 1) % STATUS_LINES.length;
      setStatusLine(el, STATUS_LINES[i]);
    }, 2200);
    return function stop() { window.clearInterval(timer); };
  }

  function addMessage(list, role, text) {
    var li = document.createElement('li');
    li.className = 'chat-msg chat-msg-' + role;
    var p = document.createElement('p');
    p.textContent = text;
    li.appendChild(p);
    list.appendChild(li);
    list.scrollTop = list.scrollHeight;
  }

  function initIsland(root) {
    var form = root.querySelector('form[data-chat]');
    if (!form) { return; }
    var list = root.querySelector('[data-chat-log]');
    var statusEl = root.querySelector('[data-chat-status]');
    var input = form.querySelector('textarea, input[type="text"]');
    var endpoint = form.getAttribute('action');
    var streamUrl = form.getAttribute('data-stream');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var content = input && input.value ? input.value.trim() : '';
      if (!content) { return; }

      addMessage(list, 'user', content);
      input.value = '';
      form.querySelector('button[type="submit"]').disabled = true;
      var stop = nextStatusLine(statusEl);
      root.setAttribute('aria-busy', 'true');

      var body = JSON.stringify({ content: content });
      var headers = { 'Content-Type': 'application/json' };
      var csrf = document.querySelector('meta[name="csrf-token"]');
      if (csrf) { headers['X-CSRF-Token'] = csrf.getAttribute('content'); }

      window.fetch(endpoint, { method: 'POST', headers: headers, body: body })
        .then(function (res) {
          return res.json().then(function (data) {
            return { ok: res.ok, data: data };
          });
        })
        .then(function (r) {
          stop();
          if (!r.ok) {
            var msg = r.data && r.data.error && r.data.error.message
              ? r.data.error.message
              : 'ManakAI couldn\u2019t complete that request. Your checklist hasn\u2019t been changed.';
            addMessage(list, 'error', msg);
            setStatusLine(statusEl, '');
            return;
          }
          addMessage(list, 'assistant', r.data.reply || '');
          setStatusLine(statusEl, '');
          if (r.data.phase === 'done' && root.getAttribute('data-on-done')) {
            window.location.assign(root.getAttribute('data-on-done'));
          }
        })
        .catch(function () {
          stop();
          addMessage(list, 'error',
            'We couldn\u2019t reach ManakAI. Check your connection and try again \u2014 your progress is saved.');
          setStatusLine(statusEl, '');
          window.dispatchEvent(new CustomEvent('fetch-error'));
        })
        .then(function () {
          form.querySelector('button[type="submit"]').disabled = false;
          root.removeAttribute('aria-busy');
          if (input) { input.focus(); }
        });
    });

    /* SSE streaming is an optional enhancement (docs/api.md §10). The POST
       fallback above is the default; SSE is only wired when the route publishes
       a stream endpoint and EventSource exists (feature detection per ADR-0001). */
    if (streamUrl && typeof window.EventSource !== 'undefined') {
      /* Placeholder for Phase 4 wiring: stream endpoint is created by the
         backend issue. Nothing to subscribe to yet. */
    }
  }

  var roots = document.querySelectorAll('[data-chat-island]');
  for (var i = 0; i < roots.length; i++) { initIsland(roots[i]); }
})();
