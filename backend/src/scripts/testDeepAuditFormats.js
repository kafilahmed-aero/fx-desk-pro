import { parseSignalMessage } from "../parsers/signalParser.js";

const testCases = [
  {
    channel: "SGP SCALPING GROWTH PROGRAM",
    text: "GOLD SELL 4020 /4025\n\n  TP1..4016\n  TP2..4012\n  TP3..4008\n  TP4..4004\n  TP5..4000\n\nSL....4035",
    expected: {
      pair: "XAUUSD",
      action: "SELL",
      entry: 4020,
      entryRange: [4020, 4025],
      targets: [4016, 4012, 4008, 4004, 4000],
      stopLoss: 4035,
    }
  },
  {
    channel: "Gold Trader Jack",
    text: "BUY GOLD @ 4050\n1_TP 4052\n2_TP 4055\n3_TP 4060\nSL 4000",
    expected: {
      pair: "XAUUSD",
      action: "BUY",
      entry: 4050,
      targets: [4052, 4055, 4060],
      stopLoss: 4000,
    }
  },
  {
    channel: "XAUUSD_SIGNALS222",
    text: "(XAU/USD) BUY 3995/3990\nTP1 4000\nSL 3965",
    expected: {
      pair: "XAUUSD",
      action: "BUY",
      entry: 3995,
      entryRange: [3990, 3995],
      targets: [4000],
      stopLoss: 3965,
    }
  },
  {
    channel: "Limitless FX",
    text: "GOLD BUY NOW\nZone: 3977-3972\nTP1: 3983\nTP2: 3987\nRisk Price: 3967",
    expected: {
      pair: "XAUUSD",
      action: "BUY",
      entry: 3977,
      entryRange: [3972, 3977],
      targets: [3983, 3987],
      stopLoss: 3967,
    }
  }
];

function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  return false;
}

let allPassed = true;

console.log("=== Deep Audit Channel Formats Parser Verification ===\n");

testCases.forEach((tc, idx) => {
  const rawMessage = {
    channel: tc.channel,
    messageId: idx + 1000,
    text: tc.text,
    timestamp: new Date().toISOString(),
  };

  const parsed = parseSignalMessage(rawMessage, "NEW_SIGNAL");

  let tcPassed = true;
  const mismatches = [];

  // Check expected fields
  for (const field of Object.keys(tc.expected)) {
    const expectedVal = tc.expected[field];
    const parsedVal = parsed[field];

    if (!deepEqual(expectedVal, parsedVal)) {
      tcPassed = false;
      mismatches.push(`${field}: expected ${JSON.stringify(expectedVal)}, received ${JSON.stringify(parsedVal)}`);
    }
  }

  if (tcPassed) {
    console.log(`PASS: ${tc.channel}`);
  } else {
    console.log(`FAIL: ${tc.channel}`);
    mismatches.forEach(m => console.log(`  - ${m}`));
    allPassed = false;
  }

  console.log("Parsed Output:");
  console.log(JSON.stringify({
    pair: parsed.pair,
    action: parsed.action,
    entry: parsed.entry,
    entryRange: parsed.entryRange,
    targets: parsed.targets,
    stopLoss: parsed.stopLoss
  }, null, 2));
  console.log("------------------------------------------\n");
});

if (allPassed) {
  console.log("ALL FORMAT TESTS PASSED!");
  process.exit(0);
} else {
  console.log("SOME FORMAT TESTS FAILED.");
  process.exit(1);
}
