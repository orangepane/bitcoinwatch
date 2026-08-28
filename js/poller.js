/* poller.js — data feeds.
   Instance: mempool REST API (default mempool.space; point settings at any instance,
   including a self-hosted one). bitcoind itself is unreachable from a browser: its
   RPC server sends no CORS headers and has no option to allow them.
   Height: 10s. Mempool+fees: 30s. Price: 30s, Kraken -> CoinGecko -> Bitfinex. Mining: 60s.
   Supply, issuance, halving countdown, market cap: derived client-side from height+price. */
window.BW = window.BW || {};
(function (BW) {
	"use strict";

	var CHAIN_MS = 10000;
	var POOL_MS = 30000;
	var PRICE_MS = 30000;
	var MINING_MS = 60000;
	var TIMEOUT_MS = 8000; // a hung instance must fail before the next tick fires

	var HALVING_INTERVAL = 210000; // blocks between subsidy halvings
	var CAP_SATS = 21000000 * 1e8; // 21M BTC in satoshis

	var PRICE_SOURCES = [
		{
			name: "Kraken",
			url: "https://api.kraken.com/0/public/Ticker?pair=XBTUSD",
			parse: function (j) {
				var r = j && j.result && (j.result.XXBTZUSD || j.result.XBTUSD);
				return r && r.c && parseFloat(r.c[0]); // last trade
			},
		},
		{
			name: "CoinGecko",
			url: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
			parse: function (j) {
				return j && j.bitcoin && j.bitcoin.usd;
			},
		},
		{
			name: "Bitfinex",
			url: "https://api.bitfinex.com/v1/pubticker/btcusd",
			parse: function (j) {
				return j && parseFloat(j.last_price);
			},
		},
	];

	var sticky = { price: 0 }; // keep using the last source that worked
	var timers = [];
	var running = false;

	/* every request is time-boxed: without this a hung socket never settles and
	   the next interval stacks another request on top of it, forever */
	function fetchJSON(url, opts) {
		var ctl = new AbortController();
		var timer = setTimeout(function () {
			ctl.abort();
		}, TIMEOUT_MS);
		opts = opts || {};
		opts.signal = ctl.signal;
		return fetch(url, opts)
			.then(function (res) {
				if (!res.ok) throw new Error("HTTP " + res.status);
				return res.json();
			})
			.finally(function () {
				clearTimeout(timer);
			});
	}

	function fetchText(url) {
		var ctl = new AbortController();
		var timer = setTimeout(function () {
			ctl.abort();
		}, TIMEOUT_MS);
		return fetch(url, { signal: ctl.signal })
			.then(function (res) {
				if (!res.ok) throw new Error("HTTP " + res.status);
				return res.text();
			})
			.finally(function () {
				clearTimeout(timer);
			});
	}

	function api(path) {
		var base = BW.store.get("instanceUrl").replace(/\/+$/, "");
		return base + path;
	}

	/* exact by protocol rules: each epoch pays 50/2^epoch BTC per block, integer
	   sats. The real ledger sits a hair below this — a handful of historical
	   coinbases underpaid their subsidy — but the delta is rounding noise. */
	function supplySats(height) {
		var sats = 0;
		var subsidy = 50 * 1e8;
		var h = 0;
		while (h < height) {
			var inEpoch = Math.min(HALVING_INTERVAL, height - h);
			sats += inEpoch * subsidy;
			subsidy = Math.floor(subsidy / 2);
			h += HALVING_INTERVAL;
		}
		return sats;
	}

	function pollChain() {
		fetchText(api("/blocks/tip/height"))
			.then(function (text) {
				var height = parseInt(text, 10);
				if (isNaN(height)) throw new Error("unparseable height");
				var sats = supplySats(height);
				var epoch = Math.floor(height / HALVING_INTERVAL);
				BW.store.setValues({
					blockHeight: height,
					blocksToHalving: (epoch + 1) * HALVING_INTERVAL - height,
					supply: sats / 1e8,
					issuanceRemaining: (CAP_SATS - sats) / 1e8,
					pctMined: (sats / CAP_SATS) * 100,
				});
				BW.store.setStatus("chain", { ok: true });
			})
			.catch(function () {
				BW.store.setStatus("chain", { ok: false });
			});
	}

	function pollPool() {
		Promise.all([fetchJSON(api("/mempool")), fetchJSON(api("/v1/fees/recommended"))])
			.then(function (r) {
				var pool = r[0];
				var fees = r[1];
				if (typeof pool.count !== "number") throw new Error("unparseable mempool");
				BW.store.setValues({
					mempoolCount: pool.count,
					feeRate: fees.fastestFee,
				});
			})
			.catch(function () {}); // mempool/fee cards just go stale
	}

	function pollMining() {
		Promise.all([
			fetchJSON(api("/v1/mining/hashrate/3d")),
			fetchJSON(api("/v1/difficulty-adjustment")),
		])
			.then(function (r) {
				BW.store.setValues({
					hashrate: r[0].currentHashrate,
					difficulty: r[0].currentDifficulty,
					retarget: Math.round(r[1].difficultyChange * 10) / 10,
				});
			})
			.catch(function () {}); // mining cards just go stale
	}

	/* walk the sources starting from the last one that worked; onValue gets the
	   first parseable answer, onFail runs only when every source is exhausted */
	function pollFeed(key, sources, onValue, onFail) {
		(function attempt(step) {
			if (step >= sources.length) {
				if (onFail) onFail();
				return;
			}
			var i = (sticky[key] + step) % sources.length;
			var s = sources[i];
			fetchJSON(s.url)
				.then(function (j) {
					var v = s.parse(j);
					if (!v || isNaN(v)) throw new Error("unparseable " + key);
					sticky[key] = i;
					onValue(v, s.name);
				})
				.catch(function () {
					attempt(step + 1);
				});
		})(0);
	}

	function pollPrice() {
		pollFeed(
			"price",
			PRICE_SOURCES,
			function (p, name) {
				var map = { price: p, satsPerDollar: 1e8 / p };
				var h = BW.store.get("values").blockHeight; // market cap needs a height
				if (h !== undefined) map.marketCap = (supplySats(h) / 1e8) * p;
				BW.store.setValues(map);
				BW.store.setStatus("price", { ok: true, source: name });
			},
			function () {
				BW.store.setStatus("price", { ok: false });
			}
		);
	}

	function every(ms, fn) {
		fn();
		timers.push(setInterval(fn, ms));
	}

	BW.poller = {
		CHAIN_MS: CHAIN_MS,
		POOL_MS: POOL_MS,
		PRICE_MS: PRICE_MS,
		MINING_MS: MINING_MS,

		start: function () {
			if (running) return;
			running = true;
			every(CHAIN_MS, pollChain);
			every(POOL_MS, pollPool);
			every(PRICE_MS, pollPrice);
			every(MINING_MS, pollMining);
		},

		stop: function () {
			running = false;
			timers.forEach(clearInterval);
			timers = [];
		},
	};
})(window.BW);
