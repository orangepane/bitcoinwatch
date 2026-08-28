/* store.js — in-memory state + localStorage persistence */
window.BW = window.BW || {};
(function (BW) {
	"use strict";

	var LS_CONFIG = "bitcoinwatch.config.v1";
	var LS_INSTANCE = "bitcoinwatch.instanceUrl.v1";
	var LS_VALUES = "bitcoinwatch.values.v1";
	var DEFAULT_INSTANCE = "https://mempool.space/api";

	var DEFAULT_MODES = ["blockHeight", "price", "satsPerDollar", "mempoolCount", "blocksToHalving", "retarget"];

	function newId() {
		return "d" + Math.random().toString(36).slice(2, 9);
	}

	function defaultConfig() {
		return {
			items: DEFAULT_MODES.map(function (m) {
				return { id: newId(), modes: [m] };
			}),
		};
	}

	/* displays are identified by a stable id, not by array position — removing one
	   must not shift rotation or fullscreen state onto a different display */
	function normalize(config) {
		config.items = config.items
			.filter(function (it) {
				return it && Array.isArray(it.modes);
			})
			.map(function (it) {
				if (!it.id) it.id = newId();
				return it;
			});
		return config;
	}

	function loadConfig() {
		try {
			var raw = localStorage.getItem(LS_CONFIG);
			if (raw) {
				var c = JSON.parse(raw);
				if (c && Array.isArray(c.items)) return normalize(c);
			}
		} catch (e) {
			/* private mode / corrupt data — fall through */
		}
		return defaultConfig();
	}

	function loadInstance() {
		try {
			return localStorage.getItem(LS_INSTANCE) || DEFAULT_INSTANCE;
		} catch (e) {
			return DEFAULT_INSTANCE;
		}
	}

	function loadValues() {
		try {
			var raw = localStorage.getItem(LS_VALUES);
			if (raw) {
				var v = JSON.parse(raw);
				if (v && typeof v === "object") return v;
			}
		} catch (e) {}
		return {};
	}

	var saved = loadValues();

	var state = {
		values: saved.values || {}, // widgetId -> last value (persisted: offline shows last-known)
		updatedAt: saved.updatedAt || {}, // widgetId -> timestamp of last success
		status: {
			chain: { ok: null, host: null }, // host = instance that last answered
			price: { ok: null, source: null },
		},
		pulse: 0,
		config: loadConfig(),
		instanceUrl: loadInstance(),
	};

	var subs = {};

	function notify(key) {
		(subs[key] || []).slice().forEach(function (fn) {
			fn(state[key]);
		});
	}

	BW.store = {
		DEFAULT_INSTANCE: DEFAULT_INSTANCE,
		newId: newId,

		get: function (key) {
			return state[key];
		},

		subscribe: function (key, fn) {
			(subs[key] = subs[key] || []).push(fn);
			return function () {
				subs[key] = subs[key].filter(function (f) {
					return f !== fn;
				});
			};
		},

		/* batched: one write and one render per poll, not one per field */
		setValues: function (map) {
			var now = Date.now();
			Object.keys(map).forEach(function (id) {
				state.values[id] = map[id];
				state.updatedAt[id] = now;
			});
			try {
				localStorage.setItem(
					LS_VALUES,
					JSON.stringify({ values: state.values, updatedAt: state.updatedAt })
				);
			} catch (e) {}
			notify("values");
		},

		getUpdatedAt: function (id) {
			return state.updatedAt[id] || 0;
		},

		setStatus: function (kind, patch) {
			Object.assign(state.status[kind], patch);
			notify("status");
		},

		setConfig: function (config) {
			state.config = normalize(config);
			try {
				localStorage.setItem(LS_CONFIG, JSON.stringify(state.config));
			} catch (e) {}
			notify("config");
		},

		resetConfig: function () {
			this.setConfig(defaultConfig());
		},

		setInstanceUrl: function (url) {
			state.instanceUrl = url;
			try {
				localStorage.setItem(LS_INSTANCE, url);
			} catch (e) {}
			notify("instanceUrl");
		},

		tickPulse: function () {
			state.pulse += 1;
			notify("pulse");
		},
	};
})(window.BW);
