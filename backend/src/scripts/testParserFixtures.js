import { classifyMessage } from "../parsers/noiseFilter.js";
import { parserFixtures } from "../parsers/parserFixtures.js";
import { parseSignalMessage } from "../parsers/signalParser.js";

let failed = 0;

for (const fixture of parserFixtures) {
  const classification = classifyMessage(fixture.rawMessage);
  const parsed = isActionable(classification.classification)
    ? parseSignalMessage(fixture.rawMessage, classification.classification)
    : null;
  const errors = validateFixture(fixture, classification.classification, parsed);

  if (errors.length > 0) {
    failed += 1;
    console.error(`FAIL ${fixture.name}`);
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    console.error({
      classification: classification.classification,
      normalizedText: classification.normalized.normalizedText,
      parsed,
    });
  } else {
    console.log(`PASS ${fixture.name}`);
  }
}

if (failed > 0) {
  console.error(`${failed} parser fixture(s) failed`);
  process.exitCode = 1;
} else {
  console.log(`${parserFixtures.length} parser fixture(s) passed`);
}

function validateFixture(fixture, classification, parsed) {
  const expected = fixture.expected;
  const errors = [];

  assertEqual(errors, "classification", classification, expected.classification);

  if (expected.parsed === false) {
    if (parsed !== null) {
      errors.push("expected message to be skipped, but parser returned a signal");
    }

    return errors;
  }

  assertEqual(errors, "pair", parsed?.pair, expected.pair);
  assertEqual(errors, "action", parsed?.action, expected.action);
  assertEqual(errors, "entry", parsed?.entry, expected.entry);
  assertEqual(errors, "stopLoss", parsed?.stopLoss, expected.stopLoss);
  assertEqual(errors, "hiddenStopLoss", parsed?.hiddenStopLoss, expected.hiddenStopLoss);
  assertEqual(errors, "managementAction", parsed?.managementAction, expected.managementAction);
  assertEqual(errors, "signalStatus", parsed?.signalStatus, expected.signalStatus);
  assertEqual(errors, "signalState", parsed?.signalState, expected.signalState);
  assertEqual(errors, "freshnessScore", parsed?.freshnessScore, expected.freshnessScore);
  assertParserMetadata(errors, parsed);

  if (expected.resultActionType !== undefined) {
    assertEqual(errors, "resultAction.type", parsed?.resultAction?.type, expected.resultActionType);
  }

  if (expected.targets !== undefined) {
    assertArrayEqual(errors, "targets", parsed?.targets, expected.targets);
  }

  if (expected.pipTargets !== undefined) {
    assertArrayEqual(errors, "pipTargets", parsed?.pipTargets, expected.pipTargets);
  }

  if (expected.entryRange !== undefined) {
    assertArrayEqual(errors, "entryRange", parsed?.entryRange, expected.entryRange);
  }

  return errors;
}

function assertEqual(errors, field, actual, expected) {
  if (expected === undefined) {
    return;
  }

  if (actual !== expected) {
    errors.push(`${field}: expected ${expected}, received ${actual}`);
  }
}

function assertArrayEqual(errors, field, actual = [], expected = []) {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    errors.push(`${field}: expected [${expected.join(", ")}], received [${actual.join(", ")}]`);
  }
}

function assertParserMetadata(errors, parsed) {
  if (!parsed) {
    return;
  }

  if (!parsed.createdAt || Number.isNaN(new Date(parsed.createdAt).getTime())) {
    errors.push("createdAt: expected valid ISO date");
  }

  if (!["VERY_FRESH", "FRESH", "AGING", "STALE"].includes(parsed.freshnessScore)) {
    errors.push(`freshnessScore: expected freshness bucket, received ${parsed.freshnessScore}`);
  }

  if (!["ACTIVE", "PARTIAL", "CLOSED", "CANCELLED"].includes(parsed.signalState)) {
    errors.push(`signalState: expected active-state value, received ${parsed.signalState}`);
  }
}

function isActionable(classification) {
  return ["NEW_SIGNAL", "UPDATE_SIGNAL", "RESULT_SIGNAL"].includes(classification);
}
