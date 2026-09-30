/* chat.js — journey-start consultation + task-assist islands.
   Calls the frozen API contract in docs/api.md (§5, §8). Works without
   JS: the surrounding form POSTs and the page re-renders server-side.
   `action` stays the page route (no-JS); `data-api` is the JSON endpoint
   this island uses when JS is available. */
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

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) { node.className = cls; }
    if (text) { node.textContent = text; }
    return node;
  }

  function addMessage(list, role, text) {
    var li = el('li', 'chat-msg chat-msg-' + role);
    li.appendChild(el('p', null, text));
    list.appendChild(li);
    list.scrollTop = list.scrollHeight;
    return li;
  }

  /* Citations + suggestedAction from docs/api.md §8 — plain DOM, no innerHTML. */
  function addCitations(li, citations) {
    if (!citations || !citations.length) { return; }
    var ul = el('ul', 'citation-list');
    for (var i = 0; i < citations.length; i++) {
      var a = el('a', null, citations[i].title || 'Source');
      a.href = citations[i].url || '#';
      if (a.href.indexOf('http') === 0) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      }
      var item = el('li');
      item.appendChild(a);
      ul.appendChild(item);
    }
    li.appendChild(ul);
  }

  function addSuggestedAction(li, action, root) {
    if (!action || !action.label) { return; }
    var btn = el('button', 'btn btn-primary btn-sm', action.label);
    btn.type = 'button';
    btn.addEventListener('click', function () {
      var href = root.getAttribute('data-task-page');
      if (action.type === 'complete_task' && root.getAttribute('data-complete-url')) {
        /* Route through the task page so the confirm flow (dialog + no-JS
           fallback) applies — never complete silently from chat. */
        href = root.getAttribute('data-task-page');
      }
      if (href) { window.location.assign(href); }
    });
    var wrap = el('p', 'chat-action');
    wrap.appendChild(btn);
    li.appendChild(wrap);
  }

  function initIsland(root) {
    var form = root.querySelector('form[data-chat]');
    if (!form) { return; }
    var list = root.querySelector('[data-chat-log]');
    var statusEl = root.querySelector('[data-chat-status]');
    var input = form.querySelector('textarea, input[type="text"]');
    var endpoint = form.getAttribute('data-api') || form.getAttribute('action');
    var questionEl = root.querySelector('[data-question]');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var content = input && input.value ? input.value.trim() : '';
      if (!content) { return; }

      addMessage(list, 'user', content);
      input.value = '';
      var submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) { submitBtn.disabled = true; }
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
          var li = addMessage(list, 'assistant', r.data.reply || '');
          addCitations(li, r.data.citations);
          addSuggestedAction(li, r.data.suggestedAction, root);
          if (r.data.ask && r.data.ask.type === 'question' && questionEl) {
            questionEl.textContent = r.data.reply || '';
          }
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
          if (submitBtn) { submitBtn.disabled = false; }
          root.removeAttribute('aria-busy');
          if (input) { input.focus(); }
        });
    });

    /* SSE streaming is an optional enhancement (docs/api.md §10). The POST
       fallback above is the default; SSE is wired in Phase 4 when the
       backend publishes the stream endpoint (feature detection per ADR-0001). */
    var streamUrl = form.getAttribute('data-stream');
    if (streamUrl && typeof window.EventSource !== 'undefined') {
      /* Reserved for Phase 4 wiring. */
    }
  }

  var roots = document.querySelectorAll('[data-chat-island]');
  for (var i = 0; i < roots.length; i++) { initIsland(roots[i]); }
})();
