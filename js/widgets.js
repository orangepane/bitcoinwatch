/* widgets.js — widget registry: id, name, description copy, format() */
window.BW = window.BW || {};
(function (BW) {
	"use strict";

	function int(v) {
		return Math.round(v).toLocaleString("en-US");
	}

	function signed(v) {
		return (v > 0 ? "+" : "") + v.toFixed(1) + "%";
	}

	function compactUSD(v) {
		if (v >= 1e12) return "$" + (v / 1e12).toFixed(2) + " T";
		if (v >= 1e9) return "$" + (v / 1e9).toFixed(1) + " B";
		if (v >= 1e6) return "$" + (v / 1e6).toFixed(1) + " M";
		return "$" + int(v);
	}

	BW.widgets = {
		blockHeight: {
			name: "Block Height",
			desc: "blocks in the chain · a new one every ~10 minutes",
			format: int,
		},
		price: {
			name: "BTC Price",
			desc: "market price of bitcoin in USD",
			format: function (v) {
				return "$" + v.toLocaleString("en-US", {
					minimumFractionDigits: 2,
					maximumFractionDigits: 2,
				});
			},
		},
		satsPerDollar: {
			name: "Sats per Dollar",
			desc: "moscow time · 1 BTC = 100,000,000 sats",
			format: int,
		},
		mempoolCount: {
			name: "Mempool",
			desc: "transactions waiting to be mined",
			format: function (v) {
				return int(v) + (v === 1 ? " tx" : " txs");
			},
		},
		feeRate: {
			name: "Next Block Fee",
			desc: "fastest fee rate right now · sat/vB",
			format: function (v) {
				return int(v) + " sat/vB";
			},
		},
		blocksToHalving: {
			name: "Blocks to Halving",
			desc: "subsidy halves every 210,000 blocks · ~10 min each",
			format: int,
		},
		supply: {
			name: "Money Supply",
			desc: "issued so far · capped at 21,000,000 BTC",
			format: function (v) {
				return int(v) + " BTC";
			},
		},
		issuanceRemaining: {
			name: "Issuance Remaining",
			desc: "left of the 21 million · forever shrinking",
			format: function (v) {
				return int(v) + " BTC";
			},
		},
		pctMined: {
			name: "% Mined",
			desc: "share of the 21 million already issued",
			format: function (v) {
				return v.toFixed(2) + "%";
			},
		},
		marketCap: {
			name: "Market Cap",
			desc: "supply × price",
			format: compactUSD,
		},
		hashrate: {
			name: "Network Hashrate",
			desc: "3-day average aggregate · exahashes per second",
			format: function (v) {
				return (v / 1e18).toFixed(1) + " EH/s";
			},
		},
		retarget: {
			name: "Retarget Estimate",
			desc: "difficulty change at the next adjustment · every 2016 blocks",
			format: signed,
		},
		difficulty: {
			name: "Difficulty",
			desc: "raw block threshold · the price of a hash",
			format: int,
		},
	};

	BW.widgetIds = Object.keys(BW.widgets);
})(window.BW);
