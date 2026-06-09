# Top Parser Weaknesses

This document lists the parsed errors and failures identified during the execution of the certification campaign.

## 1. Ranked Failures by Frequency

| Error Category | Frequency | Description |
| :--- | :---: | :--- |
| **action_extraction_error** | 115 | Mismatch between expected and actual parse results. |
| **classification_mismatch** | 94 | Mismatch between expected and actual parse results. |
| **pair_extraction_error** | 48 | Mismatch between expected and actual parse results. |
| **stopLoss_extraction_error** | 22 | Mismatch between expected and actual parse results. |

---

## 2. Top Parser Weaknesses Detailed

### 1. Pip Shorthand Targets Mismatch (High Frequency)
* **Description**: Real channels frequently specify targets in pips (e.g. `TP: 100 PIPS`) instead of absolute price targets. The parser currently stores these in `pipTargets` but leaves the main numeric `targets` empty, leading to extraction mismatches on expected fields.
* **Frequency**: 0 occurrences.
* **Production Impact**: Medium. Signal matching and TP profit booking calculations rely on absolute targets. Without absolute prices, the dashboard cannot display target lines on charts unless it computes them using the entry price.

### 2. Classification Misclassifications (Medium Frequency)
* **Description**: Market Analysis, promotional setup copies, or edge cases containing partial signal words still sometimes get misclassified.
* **Frequency**: 94 occurrences.
* **Production Impact**: High. Leads to fake active signals polluting the consensus tables, or ignoring real user actions (breakevens/manual closes).

### 3. StopLoss/Entry extraction (Low Frequency)
* **Description**: Occasional decimal format splits or zone-range mismatches.
* **Frequency**: 22 occurrences.

---

## 3. Prioritized Parser Improvements Recommendations

1. **Improve Pip Target Mapping**:
   * **Production Impact**: High
   * **Regression Risk**: Low
   * **Description**: Map `pipTargets` (e.g., `TP: 100 pips`) into absolute price targets inside `parseSignalMessage` by adding or subtracting the pips from the entry price, based on signal direction (BUY adds, SELL subtracts). This makes targets actionable for consensus.

2. **Refine Edge-Case Multi-Pair Demotion**:
   * **Production Impact**: Medium
   * **Regression Risk**: Medium
   * **Description**: When a message contains multiple trading pairs (e.g., EURUSD and GBPUSD) in commentary, automatically classify as `MARKET_ANALYSIS` or `NOISE` instead of extracting entries, unless it is a clear multi-signal setup.
