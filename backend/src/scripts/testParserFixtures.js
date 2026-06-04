import { classifyMessage } from "../parsers/noiseFilter.js";
import { parserFixtures } from "../parsers/parserFixtures.js";
import { parseSignalMessage } from "../parsers/signalParser.js";

let failed = 0;
const coverage = createCoverageReport();

for (const fixture of parserFixtures) {
  const classification = classifyMessage(fixture.rawMessage);
  const parsed = isActionable(classification.classification)
    ? parseSignalMessage(fixture.rawMessage, classification.classification)
    : null;
  const errors = validateFixture(fixture, classification.classification, parsed);
  recordCoverage(coverage, classification.classification, parsed, errors);

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

printCoverageReport(coverage);

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

function createCoverageReport() {
  return {
    totalFixtures: 0,
    passedFixtures: 0,
    failedFixtures: 0,
    classificationCounts: {},
    pairCounts: {},
    extractedFields: {
      pair: 0,
      action: 0,
      entry: 0,
      targets: 0,
      stopLoss: 0,
    },
  };
}

function recordCoverage(coverageReport, classification, parsed, errors) {
  coverageReport.totalFixtures += 1;

  if (errors.length === 0) {
    coverageReport.passedFixtures += 1;
  } else {
    coverageReport.failedFixtures += 1;
  }

  coverageReport.classificationCounts[classification] =
    (coverageReport.classificationCounts[classification] || 0) + 1;

  if (parsed?.pair) {
    coverageReport.pairCounts[parsed.pair] = (coverageReport.pairCounts[parsed.pair] || 0) + 1;
  }

  if (parsed?.pair) coverageReport.extractedFields.pair += 1;
  if (parsed?.action) coverageReport.extractedFields.action += 1;
  if (parsed?.entry !== null && parsed?.entry !== undefined) {
    coverageReport.extractedFields.entry += 1;
  }
  if (parsed?.targets?.length > 0) coverageReport.extractedFields.targets += 1;
  if (parsed?.stopLoss !== null && parsed?.stopLoss !== undefined) {
    coverageReport.extractedFields.stopLoss += 1;
  }
}

function printCoverageReport(coverageReport) {
  console.log("Parser coverage report");
  console.log(`- fixtures: ${coverageReport.passedFixtures}/${coverageReport.totalFixtures} passed`);
  console.log(`- failed: ${coverageReport.failedFixtures}`);
  console.log(`- classifications: ${formatCounts(coverageReport.classificationCounts)}`);
  console.log(`- pairs: ${formatCounts(coverageReport.pairCounts)}`);
  console.log(`- extracted fields: ${formatCounts(coverageReport.extractedFields)}`);
}

function formatCounts(counts) {
  const entries = Object.entries(counts);

  return entries.length === 0
    ? "none"
    : entries.map(([key, value]) => `${key}=${value}`).join(", ");
}
