/* nav.js — toast helper, menu auto-close, bottom-nav behavior.
   Progressive enhancement only: the site works without this file. */
(function () {
  'use strict';

  /* Toasts — used by other islands. Region lives in layout.eta. */
  function toast(message, kind) {
    var region = document.getElementById('toast-region');
    if (!region) { return; }
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' toast-' + kind : '');
    var icon = kind === 'error' ? 'alert' : 'check';
    el.innerHTML =
      '<svg class="icon" aria-hidden="true" focusable="false"><use href="/icons.svg#' + icon + '"/></svg>' +
      '<span></span>';
    el.lastElementChild.textContent = message; /* textContent: no HTML injection */
    region.appendChild(el);
    window.setTimeout(function () { el.remove(); }, 5000);
  }
  window.ManakAI = window.ManakAI || {};
  window.ManakAI.toast = toast;

  /* Close the no-JS hamburger menu after choosing a link (it stays open otherwise). */
  var toggle = document.getElementById('nav-toggle');
  var nav = document.querySelector('.site-nav');
  if (toggle && nav) {
    nav.addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('a')) { toggle.checked = false; }
    });
    /* Close on Escape and return focus to the toggle label. */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && toggle.checked) {
        toggle.checked = false;
        var label = document.querySelector('label[for="nav-toggle"]');
        if (label) { label.focus(); }
      }
    });
  }
})();
