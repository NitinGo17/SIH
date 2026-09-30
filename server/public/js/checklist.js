/* checklist.js — task requirement checkboxes + Mark-as-Completed confirm.
   No-JS fallback: forms POST and the page re-renders with new state. */
(function () {
  'use strict';

  function post(url, body) {
    var headers = { 'Content-Type': 'application/json' };
    var csrf = document.querySelector('meta[name="csrf-token"]');
    if (csrf) { headers['X-CSRF-Token'] = csrf.getAttribute('content'); }
    return window.fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body || {})
    });
  }

  /* Requirement checkboxes — optimistic, reconciled by the server response. */
  var boxes = document.querySelectorAll('[data-task-requirement]');
  for (var i = 0; i < boxes.length; i++) {
    boxes[i].addEventListener('change', function () {
      var box = this;
      var label = box.getAttribute('data-task-requirement');
      var taskId = box.getAttribute('data-task-id');
      post('/api/tasks/' + taskId + '/requirements', { label: label, done: box.checked })
        .then(function (res) {
          if (!res.ok) {
            box.checked = !box.checked; /* revert */
            if (window.ManakAI && window.ManakAI.toast) {
              window.ManakAI.toast('We couldn\u2019t save that change. It will not be lost on this page.', 'error');
            }
          }
        })
        .catch(function () {
          box.checked = !box.checked;
          window.dispatchEvent(new CustomEvent('fetch-error'));
        });
    });
  }

  /* Mark as Completed — native <dialog> where supported, window.confirm fallback. */
  var completes = document.querySelectorAll('[data-complete-task]');
  for (var j = 0; j < completes.length; j++) {
    completes[j].addEventListener('click', function (e) {
      var url = this.getAttribute('data-complete-task');
      var dialog = document.getElementById('complete-dialog');
      var proceed = function () {
        post(url, {}).then(function (res) {
          return res.json();
        }).then(function (data) {
          if (data && data.nextTask && data.nextTask.id) {
            window.location.assign('/journey/' + data.nextTask.journeyId +
              '/task/' + data.nextTask.id + '?completed=1');
          } else {
            window.location.assign(window.location.pathname + '?completed=1');
          }
        }).catch(function () {
          if (window.ManakAI && window.ManakAI.toast) {
            window.ManakAI.toast('We couldn\u2019t reach the server. Your checklist hasn\u2019t been changed.', 'error');
          }
          window.dispatchEvent(new CustomEvent('fetch-error'));
        });
      };

      if (dialog && typeof dialog.showModal === 'function') {
        e.preventDefault();
        var yes = dialog.querySelector('[data-confirm]');
        var notYet = dialog.querySelector('[data-cancel]');
        var onYes = function () { dialog.close(); proceed(); };
        var onNo = function () { dialog.close(); };
        yes.addEventListener('click', onYes);
        notYet.addEventListener('click', onNo);
        dialog.addEventListener('close', function () {
          yes.removeEventListener('click', onYes);
          notYet.removeEventListener('click', onNo);
        });
        dialog.showModal();
      }
      /* Without <dialog>: the button is a plain form submit (progressive
         enhancement — the server route re-renders the confirm page). */
    });
  }
})();
