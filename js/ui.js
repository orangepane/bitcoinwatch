/* ui.js — rendering, interactions, marquee, settings */
window.BW = window.BW || {};
(function (BW) {
	"use strict";

	var FACTS = [
		"1 BTC = 100,000,000 sats",
		"moscow time · what a dollar costs in sats",
		"21 million · that is the whole point",
		"210,000 blocks per halving · roughly 4 years",
		"difficulty retargets every 2016 blocks",
		"the ten minute heartbeat · no one sets it",
		"sha-256 · mined by warehouses, not cpus",
		"the last sat mines around the year 2140",
		"fees are the market · the subsidy is the schedule",
		"zero third-party scripts on this page",
		"your instance · your rules",
	];

	var PULSE_MS = 30000; // multi-mode rotation cadence: settle, change, settle
	var MARQUEE_MS = 8000;
	var STALE_MS = 5000; // staleness must tick on its own — dead feeds send nothing

	var grid = document.getElementById("grid");
	var footStatus = document.getElementById("foot-status");
	var marquee = document.getElementById("marquee");
	var netDot = document.getElementById("net-dot");

	var cards = {}; // display id -> card element (kept across re-renders)
	var rotIdx = {}; // display id -> rotation offset for multi-mode cards
	var openPickerId = null;
	var fullscreenId = null;
	var lastHeight = null;

	/* ---------- svg icon helpers ---------- */

	function icon(paths) {
		var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("viewBox", "0 0 24 24");
		svg.setAttribute("fill", "none");
		svg.setAttribute("stroke", "currentColor");
		svg.setAttribute("stroke-width", "1.5");
		svg.setAttribute("aria-hidden", "true");
		paths.forEach(function (d) {
			var p = document.createElementNS("http://www.w3.org/2000/svg", "path");
			p.setAttribute("d", d);
			p.setAttribute("stroke-linecap", "round");
			p.setAttribute("stroke-linejoin", "round");
			svg.appendChild(p);
		});
		return svg;
	}

	var ICON_EXPAND = ["M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15v4.5M15 15h4.5m0-4.5l5.25 5.25"];
	var ICON_SHRINK = ["M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0L15 9m5.25 11.25h-4.5m4.5 0L15 15"];
	var ICON_X = ["M6 18L18 6M6 6l12 12"];
	var ICON_MODES = [
		"M17.004 10.407c.138.435-.216.842-.672.842h-3.465a.75.75 0 01-.65-.375l-1.732-3c-.229-.396-.053-.907.393-1.004a5.252 5.252 0 016.126 3.537z",
		"M8.12 8.464c.307-.338.838-.235 1.066.16l1.732 3a.75.75 0 010 .75l-1.732 3.001c-.229.396-.76.498-1.067.16A5.231 5.231 0 016.75 12c0-1.362.519-2.603 1.37-3.536z",
	];

	/* ---------- ring loader: 21 dots (the 21 million nod) ---------- */

	function makeRing() {
		var ring = document.createElement("div");
		ring.className = "ring";
		ring.setAttribute("role", "progressbar");
		ring.setAttribute("aria-label", "loading");
		for (var i = 0; i < 21; i++) {
			var dot = document.createElement("i");
			dot.style.setProperty("transform", "rotate(" + i * (360 / 21) + "deg) translateY(-430%)");
			dot.style.setProperty("animation-delay", (i * (1.6 / 21)).toFixed(3) + "s");
			ring.appendChild(dot);
		}
		return ring;
	}

	/* ---------- display cards ---------- */

	function activeMode(item) {
		if (!item.modes.length) return null;
		return item.modes[(rotIdx[item.id] || 0) % item.modes.length];
	}

	function eachItem(fn) {
		BW.store.get("config").items.forEach(function (item) {
			var card = cards[item.id];
			if (card) fn(card, item);
		});
	}

	function renderCard(card, item) {
		var values = BW.store.get("values");
		var mode = activeMode(item);
		var valueEl = card.querySelector(".card-value");
		var descEl = card.querySelector(".card-desc");

		if (!mode) {
			card.querySelector(".card-label-text").textContent = "";
			descEl.textContent = "";
			valueEl.classList.add("is-hint");
			valueEl.textContent = "click the modes icon to configure";
			return;
		}

		var w = BW.widgets[mode];
		card.querySelector(".card-label-text").textContent = w.name;
		descEl.textContent = w.desc;
		valueEl.classList.remove("is-hint");

		var v = values[mode];
		if (v === undefined) {
			if (!valueEl.querySelector(".ring")) {
				valueEl.textContent = "";
				valueEl.appendChild(makeRing());
			}
			return;
		}

		var text = w.format(v);
		if (valueEl.textContent === text) return;
		valueEl.textContent = text;
		// auto-fit: monospace advance ~0.6em, CSS scales font by char count
		valueEl.style.setProperty("--chars", String(text.length));
		if (mode === "blockHeight" && lastHeight !== null && v !== lastHeight) {
			valueEl.classList.remove("flash");
			void valueEl.offsetWidth; // restart animation
			valueEl.classList.add("flash");
		}
	}

	function renderValues() {
		eachItem(renderCard);
		var h = BW.store.get("values").blockHeight;
		if (h !== undefined) lastHeight = h;
	}

	// height-family stale after 2x10s; pool/price widgets after 2x30s; mining after 2x60s
	var STALE_BUDGET = {
		blockHeight: 20000,
		blocksToHalving: 20000,
		supply: 20000,
		issuanceRemaining: 20000,
		pctMined: 20000,
		mempoolCount: 60000,
		feeRate: 60000,
		price: 60000,
		satsPerDollar: 60000,
		marketCap: 60000,
		hashrate: 130000,
		retarget: 130000,
		difficulty: 130000,
	};

	function renderStaleness() {
		var updatedAt = BW.store.get("updatedAt");
		var now = Date.now();
		eachItem(function (card, item) {
			var mode = activeMode(item);
			if (!mode) return;
			var at = updatedAt[mode] || 0;
			card.classList.toggle("stale", at > 0 && now - at > STALE_BUDGET[mode]);
		});
	}

	/* ---------- mode picker ---------- */

	function buildModePicker(id) {
		var pop = document.createElement("div");
		pop.className = "mode-pop";
		pop.setAttribute("role", "menu");
		var h = document.createElement("h3");
		h.textContent = "modes for this display";
		pop.appendChild(h);

		var item = findItem(id);

		BW.widgetIds.forEach(function (mode) {
			var row = document.createElement("div");
			row.className = "mode-row";
			var cb = document.createElement("input");
			cb.type = "checkbox";
			cb.id = "mode-" + id + "-" + mode;
			cb.checked = item.modes.indexOf(mode) !== -1;
			var label = document.createElement("label");
			label.setAttribute("for", cb.id);
			var w = BW.widgets[mode];
			label.appendChild(document.createTextNode(w.name));
			var d = document.createElement("span");
			d.className = "mode-desc";
			d.textContent = w.desc;
			label.appendChild(d);
			// the card element survives a config change, so this popover stays open
			cb.addEventListener("change", function () {
				var c = BW.store.get("config");
				var modes = findItem(id, c).modes;
				var at = modes.indexOf(mode);
				if (at === -1) modes.push(mode);
				else modes.splice(at, 1);
				rotIdx[id] = 0;
				BW.store.setConfig(c);
			});
			row.appendChild(cb);
			row.appendChild(label);
			pop.appendChild(row);
		});
		return pop;
	}

	function findItem(id, config) {
		var items = (config || BW.store.get("config")).items;
		for (var i = 0; i < items.length; i++) {
			if (items[i].id === id) return items[i];
		}
		return null;
	}

	function closePicker() {
		if (openPickerId === null) return;
		var card = cards[openPickerId];
		if (card) {
			var pop = card.querySelector(".mode-pop");
			if (pop) pop.remove();
			card.classList.remove("picker-open");
		}
		openPickerId = null;
	}

	// only one popover at a time: both toggles stopPropagation, so the
	// outside-click handler never sees them and cannot dismiss the other
	function togglePicker(id) {
		var wasOpen = openPickerId === id;
		closePicker();
		closeSettings();
		if (wasOpen) return;
		var card = cards[id];
		if (!card) return;
		card.appendChild(buildModePicker(id));
		card.classList.add("picker-open");
		openPickerId = id;
	}

	/* ---------- fullscreen ---------- */

	function setFullscreenIcon(card, on) {
		var btn = card.querySelector(".btn-fs");
		btn.innerHTML = "";
		btn.appendChild(icon(on ? ICON_SHRINK : ICON_EXPAND));
		btn.setAttribute("aria-label", on ? "Exit fullscreen" : "Maximize display");
	}

	function exitFullscreen() {
		if (fullscreenId === null) return;
		var card = cards[fullscreenId];
		if (card) {
			card.classList.remove("fullscreen");
			setFullscreenIcon(card, false);
		}
		fullscreenId = null;
	}

	function toggleFullscreen(id) {
		var wasOpen = fullscreenId === id;
		exitFullscreen();
		if (wasOpen) return;
		var card = cards[id];
		if (!card) return;
		fullscreenId = id;
		card.classList.add("fullscreen");
		setFullscreenIcon(card, true);
		card.focus();
	}

	/* ---------- card construction ---------- */

	function makeCard(item) {
		var id = item.id;
		var card = document.createElement("section");
		card.className = "card";
		card.setAttribute("tabindex", "-1");

		var head = document.createElement("div");
		head.className = "card-head";

		var label = document.createElement("span");
		label.className = "card-label";
		var staleDot = document.createElement("i");
		staleDot.className = "stale-dot";
		staleDot.title = "data is stale";
		var labelText = document.createElement("span");
		labelText.className = "card-label-text";
		label.appendChild(staleDot);
		label.appendChild(labelText);

		var controls = document.createElement("div");
		controls.className = "card-controls";

		var btnModes = document.createElement("button");
		btnModes.type = "button";
		btnModes.className = "icon-btn";
		btnModes.setAttribute("aria-label", "Choose modes for this display");
		btnModes.appendChild(icon(ICON_MODES));
		btnModes.addEventListener("click", function (e) {
			e.stopPropagation();
			togglePicker(id);
		});

		var btnFs = document.createElement("button");
		btnFs.type = "button";
		btnFs.className = "icon-btn btn-fs";
		btnFs.setAttribute("aria-label", "Maximize display");
		btnFs.appendChild(icon(ICON_EXPAND));
		btnFs.addEventListener("click", function () {
			toggleFullscreen(id);
		});

		var btnRemove = document.createElement("button");
		btnRemove.type = "button";
		btnRemove.className = "icon-btn";
		btnRemove.setAttribute("aria-label", "Remove this display");
		btnRemove.appendChild(icon(ICON_X));
		btnRemove.addEventListener("click", function () {
			if (fullscreenId === id) exitFullscreen();
			if (openPickerId === id) closePicker();
			var c = BW.store.get("config");
			c.items = c.items.filter(function (it) {
				return it.id !== id;
			});
			BW.store.setConfig(c);
		});

		controls.appendChild(btnModes);
		controls.appendChild(btnFs);
		controls.appendChild(btnRemove);

		head.appendChild(label);
		head.appendChild(controls);

		var valueEl = document.createElement("div");
		valueEl.className = "card-value";

		var desc = document.createElement("div");
		desc.className = "card-desc";

		card.appendChild(head);
		card.appendChild(valueEl);
		card.appendChild(desc);
		return card;
	}

	/* Reconciles rather than rebuilding: a card element that is still in the
	   config keeps its DOM, so an open mode picker survives a config change. */
	function renderGrid() {
		var config = BW.store.get("config");

		if (!config.items.length) {
			cards = {};
			grid.innerHTML = "";
			var empty = document.createElement("div");
			empty.className = "empty-state";
			var btn = document.createElement("button");
			btn.type = "button";
			btn.textContent = "Add a display";
			btn.addEventListener("click", addDisplay);
			empty.appendChild(btn);
			grid.appendChild(empty);
			return;
		}

		var live = {};
		config.items.forEach(function (item, i) {
			var card = cards[item.id] || (cards[item.id] = makeCard(item));
			live[item.id] = true;
			if (grid.children[i] !== card) grid.insertBefore(card, grid.children[i] || null);
		});

		Object.keys(cards).forEach(function (id) {
			if (live[id]) return;
			cards[id].remove();
			delete cards[id];
			delete rotIdx[id];
		});
		Array.prototype.slice.call(grid.children).forEach(function (el) {
			if (!el.classList.contains("card")) el.remove(); // stale empty state
		});

		renderValues();
		renderStaleness();
	}

	function addDisplay(e) {
		if (e) e.stopPropagation(); // the outside-click handler would close the picker we open
		var c = BW.store.get("config");
		var item = { id: BW.store.newId(), modes: [] };
		c.items.push(item);
		BW.store.setConfig(c);
		togglePicker(item.id); // configure it right away — an empty card is useless
	}

	/* ---------- global dismiss ---------- */

	document.addEventListener("keydown", function (e) {
		if (e.key !== "Escape") return;
		exitFullscreen();
		closePicker();
		closeSettings();
	});

	document.addEventListener("click", function (e) {
		if (openPickerId !== null && !e.target.closest(".card")) closePicker();
		if (settingsPop && !e.target.closest(".settings-pop")) closeSettings();
	});

	/* ---------- footer status ---------- */

	function statusMark(ok) {
		var el = document.createElement("span");
		el.textContent = ok === null ? "…" : ok ? "✓" : "✗";
		if (ok !== null) el.className = ok ? "ok" : "bad";
		return el;
	}

	// spans let CSS drop the hostname / source name on narrow screens.
	// built as nodes, not innerHTML — the instance URL is user-supplied.
	function renderStatus() {
		var st = BW.store.get("status");
		// show whichever instance last answered — failover may have moved the feed
		var host = st.chain.host || BW.store.get("instanceUrl").replace(/^https?:\/\//, "");

		function part(prefix, detail, cls, ok) {
			var frag = document.createDocumentFragment();
			frag.appendChild(document.createTextNode(prefix));
			var d = document.createElement("span");
			d.className = cls;
			d.textContent = detail;
			frag.appendChild(d);
			frag.appendChild(document.createTextNode(" "));
			frag.appendChild(statusMark(ok));
			return frag;
		}

		footStatus.textContent = "";
		footStatus.appendChild(part("instance ", host, "st-node", st.chain.ok));
		footStatus.appendChild(document.createTextNode(" · "));
		footStatus.appendChild(part("price ", st.price.source || "none", "st-src", st.price.ok));

		var c = st.chain.ok,
			p = st.price.ok;
		netDot.className = "net-dot " + (c && p ? "ok" : c === false && p === false ? "down" : "degraded");
	}

	/* ---------- marquee facts ---------- */

	var factIdx = 0;
	function rotateFact() {
		marquee.classList.add("faded");
		setTimeout(function () {
			factIdx = (factIdx + 1) % FACTS.length;
			marquee.textContent = FACTS[factIdx];
			marquee.classList.remove("faded");
		}, 400);
	}

	/* ---------- settings popover ---------- */

	var settingsPop = null;
	function closeSettings() {
		if (settingsPop) settingsPop.remove();
		settingsPop = null;
	}

	// only http(s) reaches a mempool instance, and anything else would be stored verbatim
	function normalizeInstanceUrl(raw) {
		var url;
		try {
			url = new URL(raw);
		} catch (e) {
			return null;
		}
		if (url.protocol !== "http:" && url.protocol !== "https:") return null;
		return url.origin + url.pathname.replace(/\/+$/, "");
	}

	// An https page cannot reach an http instance — the browser blocks it as mixed
	// content and the fetch fails silently. Catch it here rather than let the
	// widgets quietly stop updating.
	function isMixedContent(url) {
		return location.protocol === "https:" && url.indexOf("http://") === 0;
	}

	function exampleInstanceUrl() {
		return location.protocol === "https:"
			? BW.store.DEFAULT_INSTANCE
			: "http://192.168.1.10:4080/api";
	}

	function openSettings() {
		closeSettings();
		closePicker();
		var pop = document.createElement("div");
		pop.className = "settings-pop";
		pop.setAttribute("role", "dialog");
		pop.setAttribute("aria-label", "Settings");

		var h = document.createElement("h2");
		h.textContent = "instance settings";
		pop.appendChild(h);

		var label = document.createElement("label");
		label.setAttribute("for", "instance-url");
		label.textContent = "mempool rest api base url";
		pop.appendChild(label);

		var input = document.createElement("input");
		input.id = "instance-url";
		input.type = "url";
		input.spellcheck = false;
		input.value = BW.store.get("instanceUrl");
		pop.appendChild(input);

		var hint = document.createElement("div");
		hint.className = "hint";
		hint.textContent =
			"public instances see your IP. run your own mempool and point here; it applies on next poll.";
		pop.appendChild(hint);

		var err = document.createElement("div");
		err.className = "hint err";
		pop.appendChild(err);

		var row = document.createElement("div");
		row.className = "row";

		var save = document.createElement("button");
		save.type = "button";
		save.textContent = "save";
		save.addEventListener("click", function () {
			var url = normalizeInstanceUrl(input.value.trim());
			if (!url) {
				err.textContent = "needs a full http:// or https:// url, e.g. " + exampleInstanceUrl();
				input.focus();
				return;
			}
			if (isMixedContent(url)) {
				err.textContent =
					"this page is https, so the browser blocks http instances. use an https instance, or run BitcoinWatch locally to reach this one.";
				input.focus();
				return;
			}
			BW.store.setInstanceUrl(url);
			closeSettings();
		});

		var reset = document.createElement("button");
		reset.type = "button";
		reset.textContent = "reset layout";
		reset.addEventListener("click", function () {
			BW.store.resetConfig();
			closeSettings();
		});

		row.appendChild(save);
		row.appendChild(reset);
		pop.appendChild(row);

		document.getElementById("nav").appendChild(pop);
		settingsPop = pop;
		input.focus();
		input.select();
	}

	/* ---------- init ---------- */

	document.getElementById("btn-add").addEventListener("click", addDisplay);
	document.getElementById("btn-settings").addEventListener("click", function (e) {
		e.stopPropagation();
		if (settingsPop) closeSettings();
		else openSettings();
	});

	BW.store.subscribe("config", renderGrid);
	BW.store.subscribe("values", renderValues);
	BW.store.subscribe("status", renderStatus);
	BW.store.subscribe("instanceUrl", renderStatus);
	BW.store.subscribe("pulse", function () {
		BW.store.get("config").items.forEach(function (item) {
			if (item.modes.length > 1) {
				rotIdx[item.id] = ((rotIdx[item.id] || 0) + 1) % item.modes.length;
			}
		});
		renderValues();
		renderStaleness();
	});

	// pause when tab hidden — no point polling a screen nobody is watching
	document.addEventListener("visibilitychange", function () {
		if (document.hidden) BW.poller.stop();
		else BW.poller.start();
	});

	// installable PWA: register the offline shell (needs http(s), not file://)
	if ("serviceWorker" in navigator && location.protocol !== "file:") {
		navigator.serviceWorker.register("./sw.js").catch(function () {});
	}

	marquee.textContent = FACTS[0];
	setInterval(rotateFact, MARQUEE_MS);
	setInterval(renderStaleness, STALE_MS);
	setInterval(function () {
		BW.store.tickPulse();
	}, PULSE_MS);

	renderGrid();
	renderStatus();
	BW.poller.start();
})(window.BW);
