# RELEASE NOTES — FX Desk Pro v1.0 (Deterministic Trading Engine)

We are proud to release **FX Desk Pro v1.0**, establishing a rock-solid, 100% deterministic trading platform. This release prepares the system for the upcoming Phase Φ (Project Phoenix Learning Engine) by introducing clear, modular, and test-verified subsystems for market context analysis, entry strategy selection, risk rules enforcement, and position management.

---

## 🎯 Major Architectural Overview

FX Desk Pro has transitioned from an LLM-first prototype to a deterministic, high-frequency, capital-preserving trading engine. The flow of data is decoupled into isolated, single-responsibility layers:

```
Telegram Consensus Signals
          │
          ▼
Market Intelligence Engine (Decoupled Evaluators: Trend, S/R, Session, Volatility, Spread)
          │
          ▼
Deterministic Decision Engine (Confidence Weights & Hard Rejection Policies)
          │
          ▼
Smart Entry Engine (MARKET / LIMIT / STOP / WAIT & Chasing Filters)
          │
          ▼
Trade Lifecycle Management Engine (Breakeven, Trailing Stop, and Partials State Machine)
          │
          ▼
Downstream Execution Pipeline (Risk Engine, Sizing, Validation, MT5 Bridge Adapter)
```

---

## 🚀 Key Subsystems & Completed Milestones

### 1. Market Intelligence Engine
* Evaluates real-time market context via 6 decoupled subsystem evaluators:
  * **Trend Evaluator**: Direction, multi-timeframe strength, and momentum alignment.
  * **Market Structure Evaluator**: Valuation zones (Discount / Premium / Equilibrium) and sweeps.
  * **Support & Resistance Evaluator**: Structural proximity to valid Order Blocks (OB) and Fair Value Gaps (FVG).
  * **Session Evaluator**: Session clocks (London, NY, Asian) and volatility limits.
  * **Volatility Evaluator**: Volatility categories (Stable, Compressed, Extreme).
  * **Spread Evaluator**: Broker spread checks.
* Produces recursively deep-frozen reports to act as a single source of truth for the system.

### 2. Integrated Decision Engine
* Orchestrates Consensus, Market Intelligence, Risk, and RRR contributing weights (`35 / 40 / 15 / 10`).
* Applies warning penalties and hard block policy filters (e.g. market closed, wide spreads, extreme volatility spikes) resolved dynamically via `systemConfigManager`.
* Outputs diagnostic `decisionBreakdown` metrics alongside complete market context snapshots.

### 3. Smart Entry Engine
* Optimization framework determining **HOW** to enter trades without modifying the entry decision itself.
* Recommends both primary and alternative execution strategies (MARKET, LIMIT, STOP, WAIT).
* Incorporates chasing filters to reject trades if the price has already travelled too close to the target TP.

### 4. Trade Lifecycle Management Engine
* Models the position management flow as a deterministic state machine:
  `POSITION_OPEN` ➔ `BREAK_EVEN_PROTECTED` ➔ `PARTIAL_TP1` ➔ `PARTIAL_TP2` ➔ `TRAILING_ACTIVE` ➔ `POSITION_CLOSED`
* Implements breakeven locks (which never move stop losses backward) and trailing stops.
* Integrates spread protection to freeze trailing stop actions during abnormal broker spread spikes.
* Supports staged partial take profits and stagnant exit timeouts.

### 5. MT5 Bridge & Stability Improvements
* Implemented reliable EA heartbeat monitoring, resolving heartbeat timeouts and missing PONG handler issues.
* Handled DB offline situations gracefully, bypassing REGISTER and PONG checks.
* Refined broker execution paths to reject invalid stops and tight SL spreads.
* UI naming cleanup mapping legacy "AI Advisor" labels to "Decision Engine" and "Market Intelligence" screens.

---

## 🛡️ Known Limitations

* **Weekend Trading**: Broker session freezes freeze `TimeCurrent()`, which stops active heartbeats unless market closed checks bypass them.
* **EA Reconnect Gaps**: When EA loses connection, order synchronizations can have lag, requiring fallback database polling.

---

## 🔮 Roadmap: Next Steps (Phase Φ — Project Phoenix)

With a stable, test-verified deterministic foundation in place, the next phase will introduce:
1. **Phoenix Learning Engine**: Observing deterministic execution actions and learning from historical trades.
2. **Dynamic Weights Optimization**: Using backtested results to fine-tune category weights automatically.
3. **Adaptive Thresholds**: Modifying RRR targets and volatility bounds based on market regime changes.
