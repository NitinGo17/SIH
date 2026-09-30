/* offline.js — service worker registration + offline banner.
   The banner is plain-CSS hidden; JS only toggles it. No-JS users simply
   see browser-native offline errors. */
(function () {
  'use strict';

  var banner = document.getElementById('offline-banner');

  function update() {
    if (!banner) { return; }
    if (navigator.onLine) {
      banner.hidden = true;
    } else {
      banner.hidden = false;
    }
  }

  window.addEventListener('online', function () {
    update();
    if (window.ManakAI && window.ManakAI.toast) {
      window.ManakAI.toast('You are back online.', 'success');
    }
  });
  window.addEventListener('offline', function () {
    update();
    if (window.ManakAI && window.ManakAI.toast) {
      window.ManakAI.toast('You appear to be offline.', 'error');
    }
  });

  /* Detect a silent lie: navigator.onLine true but requests failing. */
  window.addEventListener('fetch-error', function () {
    if (banner) { banner.hidden = false; }
  });

  update();

  /* Register the service worker only where supported. */
  if ('serviceWorker' in navigator && window.location.protocol === 'https:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {
        /* Registration is an enhancement; failures are non-fatal. */
      });
    });
  }
})();
