# Nifty Strategy Builder

Live NIFTY 50 option strategy builder and suggester, hosted on GitHub Pages.

## What it does
- Live NSE option chain (LTP, OI, change in OI, IV) refreshed every 15 s in market hours
- Nifty 50 and India VIX (with 1-year percentile), PCR, max pain, OI support/resistance
- Market read: trend (20/50 EMA, 5-day move), volatility regime, events before expiry, headline tone
- Limited-loss, unlimited-profit scanner: ratio backspreads, strap/strip, straddle/strangle, long options, re-ranked every refresh within your max-loss budget
- Trade tracking: Take trade, live P&L (booked + open), alerts when a short strike is tested, delta drifts, the market read flips, VIX jumps, an event is near, or stop/target is hit
- Adjustment engine: simulates rolls, hedges, spread rolls, delta hedges, re-centring and exits on the live chain; recommends only adjustments that reduce the loss if Nifty moves 1.5σ against you
- Top 3 suggested strategies with reasons, live-priced strikes, max profit/loss, breakevens, POP
- Builder: entry vs LTP, live MTM, payoff chart, Greeks, days-forward and IV sliders
- Installable PWA

## Files
- `index.html`, `manifest.json`, `sw.js`, icons: the app (upload to the repo root)
- `worker.js`: Cloudflare Worker that fetches NSE, Yahoo, Google News and the Forex Factory calendar

## Setup
1. Cloudflare dashboard > Compute > Workers > Create > Start with Hello World, name it `nifty-options-proxy`, Deploy.
2. Edit code, delete everything, paste `worker.js`, Deploy.
3. Test: open `https://nifty-options-proxy.mailztoganesh.workers.dev/chain` (should show rows of strikes).
4. Upload the other files to this repo and enable Settings > Pages (main / root).
If the Worker URL differs, set it in the app under Settings.

Rules-based suggestions only; not trading advice.
good
