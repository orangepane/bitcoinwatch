/* sw.js — offline app shell. Cache-first for same-origin assets;
   cross-origin (mempool instance, price APIs) always goes to the network. */
"use strict";

var VERSION = "bitcoinwatch-v1";

var ASSETS = [
	"./",
	"./index.html",
	"./manifest.webmanifest",
	"./css/style.css",
	"./js/store.js",
	"./js/widgets.js",
	"./js/poller.js",
	"./js/ui.js",
	"./fonts/red-hat-mono-400.woff2",
	"./fonts/red-hat-mono-500.woff2",
	"./fonts/red-hat-mono-600.woff2",
	"./fonts/red-hat-mono-700.woff2",
	"./img/logo.svg",
];

self.addEventListener("install", function (e) {
	e.waitUntil(
		caches
			.open(VERSION)
			.then(function (cache) {
				return cache.addAll(ASSETS);
			})
			.then(function () {
				return self.skipWaiting();
			})
	);
});

self.addEventListener("activate", function (e) {
	e.waitUntil(
		caches
			.keys()
			.then(function (keys) {
				return Promise.all(
					keys
						.filter(function (k) {
							return k !== VERSION;
						})
						.map(function (k) {
							return caches.delete(k);
						})
				);
			})
			.then(function () {
				return self.clients.claim();
			})
	);
});

self.addEventListener("fetch", function (e) {
	var url = new URL(e.request.url);

	// never intercept data feeds — they must be live
	if (url.origin !== self.location.origin) return;
	if (e.request.method !== "GET") return;

	// navigations: network first, fall back to cached shell when offline
	if (e.request.mode === "navigate") {
		e.respondWith(
			fetch(e.request).catch(function () {
				return caches.match("./index.html");
			})
		);
		return;
	}

	/* static assets: stale-while-revalidate. Cache-first alone would pin the very
	   first js/css a visitor ever downloaded, since index.html is network-first
	   but its asset URLs never change. Serve the cached copy now, refresh for
	   the next load. */
	e.respondWith(
		caches.match(e.request).then(function (hit) {
			var fresh = fetch(e.request)
				.then(function (res) {
					if (res.ok) {
						var copy = res.clone();
						caches.open(VERSION).then(function (cache) {
							cache.put(e.request, copy);
						});
					}
					return res;
				})
				.catch(function () {
					return hit; // offline: cached copy or a genuine network error
				});
			if (!hit) return fresh;
			e.waitUntil(fresh);
			return hit;
		})
	);
});
