import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { classifyMessage } from "../parsers/noiseFilter.js";
import { parseSignalMessage } from "../parsers/signalParser.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureRoot = path.resolve(__dirname, "../../test-messages");
const cliOptions = parseCliOptions(process.argv.slice(2));
const actionableClassifications = new Set([
  "NEW_SIGNAL",
  "UPDATE_SIGNAL",
  "RESULT_SIGNAL",
  "MARKET_ANALYSIS",
  "CANCEL_SIGNAL",
]);

const datasets = loadFixtureDatasets();
const fixtures = datasets.flatMap((dataset) =>
  dataset.fixtures.map((fixture) => ({
    ...fixture,
    datasetName: dataset.name,
  }))
);
const results = fixtures.map((fixture, index) => replayFixture(fixture, index));
const failed = results.filter((result) => !result.passed);
const replayReport = createReplayReport(datasets, fixtures, results);

for (const result of results) {
  const status = result.passed ? "PASS" : "FAIL";
  console.log(
    `${status} #${result.index + 1} ${result.classification} confidence=${result.confidence}`
  );

  if (!result.passed) {
    console.log(`  dataset: ${result.datasetName}`);
    console.log(`  rawText: ${result.rawText}`);
    for (const mismatch of result.mismatches) {
      console.log(`  - ${mismatch}`);
    }
  }
}

console.log("");
console.log("Replay summary");
console.log(`Datasets: ${datasets.map((dataset) => dataset.name).join(", ")}`);
console.log(`Total examples: ${replayReport.totalExamples}`);
console.log(`Passed examples: ${replayReport.passedExamples}`);
console.log(`Failed examples: ${replayReport.failedExamples}`);
console.log(`Success rate: ${toPercent(replayReport.successRate)}`);
console.log(`Extraction accuracy: ${toPercent(replayReport.extractionAccuracy)}`);
printDatasetSummaries(replayReport.categorySummaries);

if (cliOptions.writeBaselinePath) {
  fs.mkdirSync(path.dirname(cliOptions.writeBaselinePath), { recursive: true });
  fs.writeFileSync(
    cliOptions.writeBaselinePath,
    `${JSON.stringify(replayReport, null, 2)}\n`
  );
  console.log(`Baseline written: ${path.relative(process.cwd(), cliOptions.writeBaselinePath)}`);
}

if (cliOptions.baselinePath) {
  const baselineReport = JSON.parse(fs.readFileSync(cliOptions.baselinePath, "utf8"));
  const regressionReport = compareWithBaseline(baselineReport, replayReport);
  printRegressionReport(regressionReport, cliOptions.baselinePath);

  if (regressionReport.hasRegression) {
    process.exitCode = 1;
  }
}

if (failed.length > 0) {
  console.log(
    `Failed indexes: ${failed.map((result) => result.index + 1).join(", ")}`
  );
  process.exitCode = 1;
}

function replayFixture(fixture, index) {
  const rawMessage = {
    channel: "replay-fixture",
    messageId: index + 1,
    ...(fixture.rawMessage || {}),
    text: fixture.rawMessage?.text ?? fixture.rawText ?? "",
    timestamp: new Date().toISOString(),
  };
  const classificationResult = classifyMessage(rawMessage);
  const parsedSignal = actionableClassifications.has(
    classificationResult.classification
  )
    ? parseSignalMessage(rawMessage, classificationResult.classification)
    : null;
  const comparison = compareFixture(
    fixture,
    classificationResult.classification,
    parsedSignal
  );

  return {
    index,
    datasetName: fixture.datasetName,
    rawText: fixture.rawText ?? fixture.rawMessage?.text ?? fixture.rawMessage?.caption ?? "",
    classification: classificationResult.classification,
    confidence: parsedSignal?.extractionConfidence ?? 0,
    passed: comparison.mismatches.length === 0,
    mismatches: comparison.mismatches,
    checkedFields: comparison.checkedFields,
    fieldChecks: comparison.fieldChecks,
    passedFieldChecks: comparison.passedFieldChecks,
  };
}

function loadFixtureDatasets() {
  const datasetPaths = cliOptions.datasetPath
    ? [cliOptions.datasetPath]
    : sortDatasetPathsForReplay(
        fs
          .readdirSync(fixtureRoot)
          .filter((fileName) => fileName.endsWith(".json"))
          .filter((fileName) => fileName !== "regression-baseline.json")
          .sort()
          .map((fileName) => path.join(fixtureRoot, fileName))
      );

  return datasetPaths.map((datasetPath) => ({
    name: normalizePath(path.relative(process.cwd(), datasetPath)),
    fixtures: JSON.parse(fs.readFileSync(datasetPath, "utf8")),
  }));
}

function sortDatasetPathsForReplay(datasetPaths) {
  if (!cliOptions.baselinePath) {
    return datasetPaths;
  }

  const baselineOrder = getBaselineDatasetOrder();

  if (baselineOrder.size === 0) {
    return datasetPaths;
  }

  return [...datasetPaths].sort((left, right) => {
    const leftName = normalizePath(path.relative(process.cwd(), left));
    const rightName = normalizePath(path.relative(process.cwd(), right));
    const leftIndex = baselineOrder.get(leftName) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = baselineOrder.get(rightName) ?? Number.MAX_SAFE_INTEGER;

    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }

    return leftName.localeCompare(rightName);
  });
}

function getBaselineDatasetOrder() {
  try {
    const baselineReport = JSON.parse(fs.readFileSync(cliOptions.baselinePath, "utf8"));
    return new Map(
      (baselineReport.datasetNames || []).map((datasetName, index) => [datasetName, index])
    );
  } catch {
    return new Map();
  }
}

function createReplayReport(datasets, fixtures, results) {
  const totalFieldChecks = results.reduce((sum, result) => sum + result.fieldChecks, 0);
  const passedFieldChecks = results.reduce(
    (sum, result) => sum + result.passedFieldChecks,
    0
  );

  return {
    generatedAt: new Date().toISOString(),
    fixtureRoot: normalizePath(path.relative(process.cwd(), fixtureRoot)),
    datasetNames: datasets.map((dataset) => dataset.name),
    totalExamples: fixtures.length,
    passedExamples: results.filter((result) => result.passed).length,
    failedExamples: results.filter((result) => !result.passed).length,
    successRate: safeRatio(
      results.filter((result) => result.passed).length,
      fixtures.length
    ),
    extractionAccuracy: safeRatio(passedFieldChecks, totalFieldChecks),
    categorySummaries: createDatasetSummaries(results),
    fixtures: results.map((result) => ({
      index: result.index,
      fixtureKey: createFixtureKey(result),
      datasetName: result.datasetName,
      rawText: result.rawText,
      classification: result.classification,
      confidence: result.confidence,
      passed: result.passed,
      mismatches: result.mismatches,
      checkedFields: result.checkedFields,
      fieldChecks: result.fieldChecks,
      passedFieldChecks: result.passedFieldChecks,
    })),
  };
}

function createDatasetSummaries(results) {
  const summaries = new Map();

  for (const result of results) {
    const summary = summaries.get(result.datasetName) || {
      total: 0,
      passed: 0,
      fieldChecks: 0,
      passedFieldChecks: 0,
    };

    summary.total += 1;
    summary.passed += result.passed ? 1 : 0;
    summary.fieldChecks += result.fieldChecks;
    summary.passedFieldChecks += result.passedFieldChecks;
    summaries.set(result.datasetName, summary);
  }

  return [...summaries.entries()].map(([datasetName, summary]) => ({
    datasetName,
    total: summary.total,
    passed: summary.passed,
    failed: summary.total - summary.passed,
    fieldChecks: summary.fieldChecks,
    passedFieldChecks: summary.passedFieldChecks,
    successRate: safeRatio(summary.passed, summary.total),
    extractionAccuracy: safeRatio(summary.passedFieldChecks, summary.fieldChecks),
  }));
}

function printDatasetSummaries(summaries) {
  console.log("");
  console.log("Category accuracy");

  for (const summary of summaries) {
    console.log(
      `${summary.datasetName}: ${summary.passed}/${summary.total} passed, ` +
        `success=${toPercent(summary.successRate)}, ` +
        `extraction=${toPercent(summary.extractionAccuracy)}`
    );
  }
}

function compareFixture(fixture, actualClassification, parsedSignal) {
  const mismatches = [];
  const checkedFields = {
    classification: actualClassification,
  };
  let fieldChecks = 0;
  let passedFieldChecks = 0;

  const classificationPassed = actualClassification === fixture.expectedClassification;
  fieldChecks += 1;
  passedFieldChecks += classificationPassed ? 1 : 0;

  if (!classificationPassed) {
    mismatches.push(
      `classification expected ${fixture.expectedClassification}, received ${actualClassification}`
    );
  }

  if (!actionableClassifications.has(fixture.expectedClassification)) {
    return {
      mismatches,
      fieldChecks,
      passedFieldChecks,
    };
  }

  if (!parsedSignal) {
    mismatches.push("expected parsed signal, received null");
    return {
      mismatches,
      fieldChecks,
      passedFieldChecks,
    };
  }

  for (const [field, expectedValue] of Object.entries(fixture.expectedFields || {})) {
    fieldChecks += 1;
    const actualValue = parsedSignal[field];
    checkedFields[field] = actualValue;
    const passed = valuesMatch(actualValue, expectedValue);
    passedFieldChecks += passed ? 1 : 0;

    if (!passed) {
      mismatches.push(
        `${field} expected ${formatValue(expectedValue)}, received ${formatValue(actualValue)}`
      );
    }
  }

  return {
    mismatches,
    checkedFields,
    fieldChecks,
    passedFieldChecks,
  };
}

function compareWithBaseline(baselineReport, currentReport) {
  const baselineCategories = new Map(
    baselineReport.categorySummaries.map((summary) => [summary.datasetName, summary])
  );
  const currentCategories = new Map(
    currentReport.categorySummaries.map((summary) => [summary.datasetName, summary])
  );
  const categoryComparisons = currentReport.categorySummaries.map((currentSummary) => {
    const baselineSummary = baselineCategories.get(currentSummary.datasetName);

    return {
      datasetName: currentSummary.datasetName,
      beforeSuccessRate: baselineSummary?.successRate ?? null,
      afterSuccessRate: currentSummary.successRate,
      beforeExtractionAccuracy: baselineSummary?.extractionAccuracy ?? null,
      afterExtractionAccuracy: currentSummary.extractionAccuracy,
      successDelta:
        baselineSummary ? currentSummary.successRate - baselineSummary.successRate : null,
      extractionDelta:
        baselineSummary
          ? currentSummary.extractionAccuracy - baselineSummary.extractionAccuracy
          : null,
    };
  });
  const removedCategories = baselineReport.categorySummaries.filter(
    (summary) => !currentCategories.has(summary.datasetName)
  );
  const baselineFixtures = new Map(
    baselineReport.fixtures.map((fixture) => [fixture.fixtureKey, fixture])
  );
  const currentFixtures = new Map(
    currentReport.fixtures.map((fixture) => [fixture.fixtureKey, fixture])
  );
  const newlyBrokenFixtures = currentReport.fixtures.filter((fixture) => {
    const baselineFixture = baselineFixtures.get(fixture.fixtureKey);
    return baselineFixture?.passed && !fixture.passed;
  });
  const extractionDifferences = currentReport.fixtures
    .map((fixture) => {
      const baselineFixture = baselineFixtures.get(fixture.fixtureKey);

      if (!baselineFixture) {
        return null;
      }

      const changedFields = Object.entries(fixture.checkedFields || {}).filter(
        ([field, value]) => !valuesMatch(value, baselineFixture.checkedFields?.[field])
      );

      if (changedFields.length === 0) {
        return null;
      }

      return {
        fixtureKey: fixture.fixtureKey,
        datasetName: fixture.datasetName,
        rawText: fixture.rawText,
        changedFields: changedFields.map(([field, after]) => ({
          field,
          before: baselineFixture.checkedFields?.[field],
          after,
        })),
      };
    })
    .filter(Boolean);
  const missingHistoricalFixtures = baselineReport.fixtures.filter(
    (fixture) => !currentFixtures.has(fixture.fixtureKey)
  );
  const hasCategoryRegression = categoryComparisons.some((comparison) => {
    return (
      comparison.successDelta !== null &&
      (comparison.successDelta < 0 || comparison.extractionDelta < 0)
    );
  });

  return {
    hasRegression:
      hasCategoryRegression ||
      newlyBrokenFixtures.length > 0 ||
      missingHistoricalFixtures.length > 0 ||
      removedCategories.length > 0,
    categoryComparisons,
    removedCategories,
    newlyBrokenFixtures,
    missingHistoricalFixtures,
    extractionDifferences,
  };
}

function printRegressionReport(regressionReport, baselinePath) {
  console.log("");
  console.log("Regression comparison");
  console.log(`Baseline: ${normalizePath(path.relative(process.cwd(), baselinePath))}`);

  for (const comparison of regressionReport.categoryComparisons) {
    console.log(
      `${comparison.datasetName}: success ${toBaselinePercent(comparison.beforeSuccessRate)} -> ` +
        `${toPercent(comparison.afterSuccessRate)}, extraction ` +
        `${toBaselinePercent(comparison.beforeExtractionAccuracy)} -> ` +
        `${toPercent(comparison.afterExtractionAccuracy)}`
    );
  }

  if (regressionReport.newlyBrokenFixtures.length > 0) {
    console.log("");
    console.log("Newly broken fixtures");
    for (const fixture of regressionReport.newlyBrokenFixtures) {
      console.log(`- ${fixture.fixtureKey}`);
      for (const mismatch of fixture.mismatches) {
        console.log(`  ${mismatch}`);
      }
    }
  }

  if (regressionReport.extractionDifferences.length > 0) {
    console.log("");
    console.log("Extraction differences");
    for (const diff of regressionReport.extractionDifferences.slice(0, 25)) {
      console.log(`- ${diff.fixtureKey}`);
      for (const change of diff.changedFields) {
        console.log(
          `  ${change.field}: ${formatValue(change.before)} -> ${formatValue(change.after)}`
        );
      }
    }

    if (regressionReport.extractionDifferences.length > 25) {
      console.log(`... ${regressionReport.extractionDifferences.length - 25} more`);
    }
  }

  if (regressionReport.missingHistoricalFixtures.length > 0) {
    console.log("");
    console.log(
      `Missing historical fixtures: ${regressionReport.missingHistoricalFixtures.length}`
    );
  }

  if (regressionReport.removedCategories.length > 0) {
    console.log("");
    console.log(
      `Removed categories: ${regressionReport.removedCategories
        .map((summary) => summary.datasetName)
        .join(", ")}`
    );
  }
}

function valuesMatch(actual, expected) {
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      actual.every((value, index) => numbersOrValuesMatch(value, expected[index]))
    );
  }

  return numbersOrValuesMatch(actual, expected);
}

function numbersOrValuesMatch(actual, expected) {
  if (typeof actual === "number" && typeof expected === "number") {
    return Math.abs(actual - expected) < 0.00001;
  }

  if (isPlainObject(actual) && isPlainObject(expected)) {
    const actualEntries = Object.entries(actual);
    const expectedEntries = Object.entries(expected);

    return (
      actualEntries.length === expectedEntries.length &&
      expectedEntries.every(([key, value]) => numbersOrValuesMatch(actual[key], value))
    );
  }

  return actual === expected;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatValue(value) {
  return JSON.stringify(value);
}

function parseCliOptions(args) {
  const options = {
    datasetPath: null,
    baselinePath: null,
    writeBaselinePath: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--baseline") {
      options.baselinePath = path.resolve(args[index + 1]);
      index += 1;
    } else if (arg === "--write-baseline") {
      options.writeBaselinePath = path.resolve(args[index + 1]);
      index += 1;
    } else if (!arg.startsWith("--") && !options.datasetPath) {
      options.datasetPath = path.resolve(arg);
    }
  }

  return options;
}

function createFixtureKey(result) {
  return `${result.datasetName}#${result.index}:${hashText(result.rawText)}`;
}

function hashText(text) {
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }

  return hash.toString(16);
}

function safeRatio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function normalizePath(value) {
  return value.replace(/\\/g, "/");
}

function toBaselinePercent(value) {
  return value === null ? "new" : toPercent(value);
}

function toPercent(value) {
  if (!Number.isFinite(value)) {
    return "0.00%";
  }

  return `${(value * 100).toFixed(2)}%`;
}
