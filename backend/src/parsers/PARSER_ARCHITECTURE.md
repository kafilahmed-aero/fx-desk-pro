# Parser Evolution Contract

Parser changes must be regression-safe. New support should be layered on top of existing behavior, not replace previously working formats.

## Required Flow

The parser pipeline is organized as:

1. Normalization
2. Classification
3. Entity extraction
4. Signal interpretation
5. Confidence scoring

When adding a new message style, prefer a new extraction helper or classifier score branch over rewriting broad existing logic.

## Regression Rules

- Run `npm run parser:regression` before accepting parser changes.
- The command replays every historical JSON fixture category in `test-messages`.
- Accuracy must not decrease for older categories.
- Previously passing fixtures must not become broken.
- If behavior intentionally changes, update fixtures and regenerate the baseline with `npm run parser:baseline` only after reviewing the regression report.

## Fixture Categories

Current replay categories include:

- `clean-complete-signals`
- `partial-incomplete-signals`
- `market-commentary-signals`
- `short-fast-signals`

Future categories such as `update-signals`, `promo-noise`, and `result-signals` should be added as separate JSON files so they automatically join the full replay.

## Safety Rule

If the parser is uncertain, it should partially extract stable fields and leave missing values as `null` instead of failing the whole message.
