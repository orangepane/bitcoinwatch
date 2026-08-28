# BitcoinWatch

A live Bitcoin network display that runs entirely in the browser. No backend, no trackers, no third-party scripts.

**[Open BitcoinWatch →](https://orangepane.github.io/bitcoinwatch/)** or clone it and run it yourself (see [Run](#run)).

## What it shows

- Block height, sats per dollar (moscow time), mempool size, next-block fee rate
- BTC price in USD, blocks to halving, network hashrate, retarget estimate
- Money supply, issuance remaining, % mined, market cap: derived locally, not fetched

Default board: height, price, sats per dollar, mempool, halving countdown, retarget. Add, remove, and configure displays freely; a display can rotate through several stats.

## Features

- Add, remove, and configure displays; a display can rotate through several stats
- Fullscreen mode per display
- Installable PWA: opens offline and shows last-known values
- Custom mempool instance in settings. Public instances see your IP; your own does not.
- Polls height every 10s, mempool, fees, and price every 30s, mining stats every 60s; pauses when the tab is hidden

## Run

```sh
python3 -m http.server 8000
```

Open http://localhost:8000. Opening `index.html` directly also works, but PWA install needs http(s).

## Data sources

- Chain: the [mempool](https://mempool.space) REST API (default `https://mempool.space/api`; change it in settings). Height, mempool, fees, hashrate, difficulty adjustment. If the configured instance fails, the feed fails over to public mirrors (`mempool.emzy.de`, `mempool.bitaroo.net`), and the footer shows whichever instance last answered.
- Price: Kraken public API, with CoinGecko and Bitfinex as fallbacks. Every request is time-boxed to 8 seconds.
- Supply math is integer arithmetic on the block height: each epoch pays 50/2^epoch BTC per block, halving every 210,000 blocks. The real ledger sits slightly below the formula because a handful of historical coinbases underpaid their subsidy. The difference is rounding noise.

## Why a mempool instance and not your own bitcoind?

`bitcoind`'s RPC server sends no CORS headers and has no option to allow them, so a browser page cannot talk to it directly. `monerod` can (via `--rpc-access-control-origins`), which is why MoneroWatch points at a node. The browser-friendly equivalent of "your node" is a self-hosted [mempool](https://github.com/mempool/mempool) instance, which serves its REST API with CORS enabled.

Point settings at it, e.g. `http://192.168.1.10:4080/api`.

Two browser rules to know:

- **A plain-`http` instance needs a plain-`http` page.** Browsers block `http` requests from an `https` page (mixed content), so a LAN instance will not work on the hosted version. The request fails silently and the widgets stop updating. Run BitcoinWatch locally for that, or give your instance TLS and use an `https` URL. The default public instance is `https`, so the hosted version works out of the box.
- The origin must match exactly: scheme, host, and port. Use `https://orangepane.github.io` for the hosted version when configuring a reverse proxy, `http://localhost:8000` for a local one.

## Sister projects

- [MoneroWatch](https://orangepane.github.io/monerowatch/): the same display for monero. Block height, hashrate, block reward, tx pool, XMR price.
- [btc-ticker](https://orangepane.github.io/btc-ticker/): the same idea, simpler. A live BTC price in 6 currencies on one static page.

Fonts are Red Hat Mono (SIL OFL 1.1). The Bitcoin logo is the public domain symbol by Bitboy; the PWA icons are generated from the official vector.
