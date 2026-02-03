# invest-quant

8-agent quant advisory pipeline for stock analysis. Serves as the analytical brain for [auto-trader](https://github.com/dooosp/auto-trader).

**Zero LLM** — all analysis is rule-based and quantitative.

## Agents

| Agent | Role |
|-------|------|
| Fundamental | DART filings → financial ratio scoring |
| Factor | Multi-factor scoring (value, momentum, quality, size) |
| Backtest | Walk-forward backtesting with strategy engine |
| Risk | VaR calculation + Kelly criterion position sizing |
| Monitor | Drawdown surveillance + concentration alerts |
| Integration | Aggregates all agents → composite advisory score |

## Architecture

```
REST API (Express + Helmet)
  ├─ /fundamental  → DART client → ratio calculator → sector comparator
  ├─ /factor       → Python bridge → factor scoring
  ├─ /backtest     → data collector → strategy engine → walk-forward
  ├─ /risk         → VaR calculator → position sizer
  ├─ /monitor      → drawdown tracker → alert engine
  └─ /advisory     → integration engine (weighted composite)
```

## Stack

- **Runtime**: Node.js + Python (factor module)
- **Data**: DART OpenAPI (Korean corporate filings)
- **Security**: Helmet, auth middleware, input validation
- **Testing**: Jest (6 test suites)

## Setup

```bash
cp .env.example .env   # Add DART_API_KEY
npm install
npm start              # REST server on :3003
npm test               # Run test suites
```
