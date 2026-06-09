import fs from "fs";
import path from "path";
import { normalizeMessageText } from "./src/parsers/messageNormalizer.js";
import { createPairTokenPattern } from "./src/parsers/pairDetector.js";

const numberPattern = "\\d{1,6}(?:\\.\\d{1,5})?";
const pairPrefix = `(?:\\s*#?\\s*(?:${createPairTokenPattern().source}))?`;

// Current (Old) patterns
const oldPatterns = [
  new RegExp(`\\bENT(?:RY|RIES)?\\b\\s*(?:ZONE|PRICE|AREA)?\\s*[:@-]?\\s*(${numberPattern})(?:\\s*[-/]\\s*(${numberPattern}))?`, "i"),
  new RegExp(`\\b(?:BUY|SELL|LONG|SHORT)\\s+(?:LIMIT|STOP)\\b\\s*[:@-]?\\s*(${numberPattern})(?:\\s*[-/]\\s*(${numberPattern}))?`, "i"),
];

// Proposed (New) patterns (Priority 3 & 4)
const newPatterns = [
  new RegExp(`\\bENT(?:RY|RIES)?\\b\\s*(?:ZONE|PRICE|AREA)?\\s*[:@-]?\\s*${pairPrefix}\\s*[:@-]?\\s*(${numberPattern})(?:\\s*[-/]\\s*(${numberPattern}))?`, "i"),
  new RegExp(`\\b(?:CURRENT\\s+PRICE|CMP)\\b\\s*[:@-]?\\s*${pairPrefix}\\s*[:@-]?\\s*(${numberPattern})(?:\\s*[-/]\\s*(${numberPattern}))?`, "i"),
  new RegExp(`\\b(?:BUY|SELL|LONG|SHORT)\\s+(?:LIMIT|STOP)\\b\\s*[:@-]?\\s*${pairPrefix}\\s*[:@-]?\\s*(${numberPattern})(?:\\s*[-/]\\s*(${numberPattern}))?`, "i"),
];

function testMatch(compactText, patterns) {
  for (const pattern of patterns) {
    const match = compactText.match(pattern);
    if (match?.[1]) {
      return {
        matched: true,
        pattern: pattern.toString(),
        val1: match[1],
        val2: match[2] || null
      };
    }
  }
  return { matched: false };
}

// Load fixtures
const fixtureRoot = "./test-messages";
const files = fs.readdirSync(fixtureRoot).filter(f => f.endsWith(".json") && f !== "regression-baseline.json");

import { parserFixtures } from "./src/parsers/parserFixtures.js";

const allMessages = [];
for (const file of files) {
  const content = JSON.parse(fs.readFileSync(path.join(fixtureRoot, file), "utf8"));
  for (const item of content) {
    const text = item.rawText || item.rawMessage?.text || "";
    allMessages.push({
      file,
      text,
      expected: item.expectedFields || {}
    });
  }
}

for (const devFixture of parserFixtures) {
  allMessages.push({
    file: "parserFixtures.js",
    text: devFixture.rawMessage.text,
    expected: devFixture.expected
  });
}


console.log(`Loaded ${allMessages.length} historical messages.`);

const diffs = [];
for (const msg of allMessages) {
  const normalized = normalizeMessageText(msg.text);
  const oldRes = testMatch(normalized.compactText, oldPatterns);
  const newRes = testMatch(normalized.compactText, newPatterns);
  
  if (oldRes.matched !== newRes.matched || oldRes.val1 !== newRes.val1 || oldRes.val2 !== newRes.val2) {
    diffs.push({
      text: msg.text,
      file: msg.file,
      oldRes,
      newRes,
      expected: msg.expected
    });
  }
}

console.log(`Found ${diffs.length} messages with differences.`);

// Output all differences
for (const d of diffs) {
  console.log("---");
  console.log(`File: ${d.file}`);
  console.log(`Raw Text:\n${d.text}`);
  console.log(`Old regex: ${JSON.stringify(d.oldRes)}`);
  console.log(`New regex: ${JSON.stringify(d.newRes)}`);
  console.log(`Expected Entry: ${d.expected.entry || JSON.stringify(d.expected.entryRange)}`);
}
