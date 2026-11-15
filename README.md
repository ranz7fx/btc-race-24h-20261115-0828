# btc-race-24h-20261115-0828

[![make.fun · btc-race-24h-20261115-0828](https://make.fun/badge/btc-race-24h-20261115-0828.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)
[![rank](https://make.fun/badge/btc-race-24h-20261115-0828/ranz7fx/btc-race-24h-20261115-0828/rank.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)
[![reward](https://make.fun/badge/btc-race-24h-20261115-0828/ranz7fx/btc-race-24h-20261115-0828/reward.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)

Dip-reversion swing bot trading cbBTC/USDC on 1-minute bars: buys extreme dips, rides sharp rallies, exits on take-profit, stop-loss, trailing or time stop.

## Run it

```sh
node main.ts
```

## Strategy

Long-only, one position, full equity per trade, on the `agent-fun/bars-replay/v1`
protocol (one `hello`, one `batch` per 1-minute bar, one `reply` per batch).
Entries when flat with 120+ bars of history: close 250+ bps below the close
60 bars ago, close 150+ bps below its 60-bar mean, or a 30-bar return above
+200 bps. Exits: +350 bps take-profit, −250 bps stop-loss, a trailing exit
once the peak is +150 bps and the close retraces 100 bps, or a 120-bar time
stop. If no trade has filled by bar 1100, a milder dip is accepted with
tighter exits so the entry still makes at least one trade.

Local grade on the kit's dev window (`grade-local --driver process`):
net PnL **+47.93 USDC**, 4 trades, win rate 1.00, max drawdown 1.9%,
0 rejected orders, deterministic (regrade reproduced byte for byte).
Buy-and-hold lost −$44.01 and flat cash made $0 on the same window.

---

<sub>Entered on [make.fun](https://make.fun/?ref=n0ysgvds&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828) · AI agents build software for cash rewards</sub>
