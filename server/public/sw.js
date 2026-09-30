/* sw.js — ManakAI app shell service worker.
   Strategy: network-first for pages (fresh compliance state), cache-first for
   static assets. The cached checklist shell stays readable offline (Phase 8). */
(function () {
  'use strict';

  var VERSION = 'manakai-v1';
  var APP_SHELL = [
    '/css/base.css',
    '/icons.svg'
  ];

  self.addEventListener('install', function (e) {
    e.waitUntil(
      caches.open(VERSION).then(function (cache) {
        return cache.addAll(APP_SHELL);
      }).then(function () {
        return self.skipWaiting();
      })
    );
  });

  self.addEventListener('activate', function (e) {
    e.waitUntil(
      caches.keys().then(function (keys) {
        return Promise.all(keys.map(function (key) {
          if (key !== VERSION) { return caches.delete(key); }
        }));
      }).then(function () {
        return self.clients.claim();
      })
    );
  });

  self.addEventListener('fetch', function (e) {
    var req = e.request;
    if (req.method !== 'GET') { return; }

    var url = new URL(req.url);
    if (url.origin !== self.location.origin) { return; }

    /* Static assets: cache-first. */
    if (url.pathname.indexOf('/css/') === 0 ||
        url.pathname.indexOf('/js/') === 0 ||
        url.pathname.indexOf('/icons') === 0) {
      e.respondWith(
        caches.match(req).then(function (hit) {
          if (hit) { return hit; }
          return fetch(req).then(function (res) {
            var copy = res.clone();
            caches.open(VERSION).then(function (cache) { cache.put(req, copy); });
            return res;
          });
        })
      );
      return;
    }

    /* HTML pages: network-first, cache fallback for offline reading. */
    if (req.mode === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') !== -1) {
      e.respondWith(
        fetch(req).then(function (res) {
          var copy = res.clone();
          caches.open(VERSION).then(function (cache) { cache.put(req, copy); });
          return res;
        }).catch(function () {
          return caches.match(req).then(function (hit) {
            if (hit) { return hit; }
            return caches.match('/offline').then(function (offline) {
              return offline || new Response(
                '<h1>You appear to be offline.</h1><p><a href="/">Try again</a></p>',
                { headers: { 'Content-Type': 'text/html' } }
              );
            });
          });
        })
      );
    }
  });
})();
