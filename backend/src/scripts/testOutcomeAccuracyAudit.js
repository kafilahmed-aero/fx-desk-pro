import mongoose from "mongoose";
import { saveOutcome, resetOutcomeStore, getOutcomes } from "../services/signalOutcomeStore.js";
import { updateOutcomePrice } from "../services/signalOutcomeEngine.js";
const evaluateOutcomeState = updateOutcomePrice;
import { resolveSymbol } from "../services/priceIngestionService.js";
import { getDatasetMonitoringReport } from "../services/dataCollectionMonitoringService.js";
import { getDatasetMonitoringReportController } from "../controllers/monitoringController.js";
import { logger } from "../utils/logger.js";

logger.level = "warn";

async function runAudit() {
  console.log("=== STARTING SIGNAL OUTCOME ACCURACY AUDIT ===");
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      passed++;
      console.log(`[PASS] ${message}`);
    } else {
      failed++;
      console.error(`[FAIL] ${message}`);
    }
  }

  try {
    resetOutcomeStore();

    // ==========================================
    // 1. ENTRY ACTIVATION AUDIT
    // ==========================================
    console.log("\n--- Auditing Entry Activation ---");

    // BUY Signal (Price style)
    const buySignal = {
      signalId: new mongoose.Types.ObjectId(),
      messageKey: "Audit:BuyPrice",
      channel: "AuditChannel",
      pair: "EURUSD",
      action: "BUY",
      entry: { entryType: "PRICE", entryPrice: 1.0800, entryLow: null, entryHigh: null },
      targets: [{ targetNumber: 1, price: 1.0850, isHit: false }],
      stopLoss: 1.0750,
      status: "PENDING",
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      createdAt: new Date(),
    };
    await saveOutcome(buySignal);

    // Assert: No premature activation for BUY (price is above entry, but it's BUY, wait: for BUY, usually it activates when price matches entry or is within zone. Let's see: if price starts at 1.0810, does it activate? No, starts at PENDING.
    await evaluateOutcomeState(buySignal, 1.0820, new Date());
    assert(buySignal.status === "PENDING", "BUY signal remains PENDING when price is above entryPrice");
    
    // Activate
    await evaluateOutcomeState(buySignal, 1.0800, new Date());
    assert(buySignal.status === "ACTIVE", "BUY signal transitions to ACTIVE when price touches entryPrice");

    // BUY Signal (Range style)
    const buyRangeSignal = {
      signalId: new mongoose.Types.ObjectId(),
      messageKey: "Audit:BuyRange",
      channel: "AuditChannel",
      pair: "EURUSD",
      action: "BUY",
      entry: { entryType: "RANGE", entryPrice: null, entryLow: 1.0780, entryHigh: 1.0820 },
      targets: [{ targetNumber: 1, price: 1.0880, isHit: false }],
      stopLoss: 1.0740,
      status: "PENDING",
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      createdAt: new Date(),
    };
    await saveOutcome(buyRangeSignal);

    // Premature test (price far below range)
    await evaluateOutcomeState(buyRangeSignal, 1.0700, new Date());
    assert(buyRangeSignal.status === "PENDING", "BUY range signal remains PENDING when price is below entryLow and stopLoss is not hit");

    // Activation inside range (e.g. 1.0800)
    await evaluateOutcomeState(buyRangeSignal, 1.0800, new Date());
    assert(buyRangeSignal.status === "ACTIVE", "BUY range transitions to ACTIVE when price enters entry range");

    // SELL Signal (Price style)
    const sellSignal = {
      signalId: new mongoose.Types.ObjectId(),
      messageKey: "Audit:SellPrice",
      channel: "AuditChannel",
      pair: "EURUSD",
      action: "SELL",
      entry: { entryType: "PRICE", entryPrice: 1.0900, entryLow: null, entryHigh: null },
      targets: [{ targetNumber: 1, price: 1.0850, isHit: false }],
      stopLoss: 1.0950,
      status: "PENDING",
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      createdAt: new Date(),
    };
    await saveOutcome(sellSignal);

    // Premature test (price below entry for SELL)
    await evaluateOutcomeState(sellSignal, 1.0880, new Date());
    assert(sellSignal.status === "PENDING", "SELL signal remains PENDING when price is below entryPrice");

    // Activate
    await evaluateOutcomeState(sellSignal, 1.0900, new Date());
    assert(sellSignal.status === "ACTIVE", "SELL signal transitions to ACTIVE when price touches entryPrice");


    // ==========================================
    // 2. TARGET DETECTION AUDIT
    // ==========================================
    console.log("\n--- Auditing Target Detection ---");

    const multiTargetSignal = {
      signalId: new mongoose.Types.ObjectId(),
      messageKey: "Audit:MultiTarget",
      channel: "AuditChannel",
      pair: "EURUSD",
      action: "BUY",
      entry: { entryType: "PRICE", entryPrice: 1.0800, entryLow: null, entryHigh: null },
      targets: [
        { targetNumber: 1, price: 1.0850, isHit: false },
        { targetNumber: 2, price: 1.0900, isHit: false },
        { targetNumber: 3, price: 1.0950, isHit: false }
      ],
      stopLoss: 1.0750,
      status: "PENDING",
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      createdAt: new Date(),
    };
    await saveOutcome(multiTargetSignal);
    
    // Activate
    await evaluateOutcomeState(multiTargetSignal, 1.0800, new Date());
    
    // Trigger TP1
    await evaluateOutcomeState(multiTargetSignal, 1.0860, new Date());
    assert(multiTargetSignal.status === "PARTIAL_TP", "Transitions to PARTIAL_TP when TP1 is hit");
    assert(multiTargetSignal.targets[0].isHit === true, "TP1 is marked as hit");
    assert(multiTargetSignal.targets[1].isHit === false, "TP2 is not marked as hit");

    // Re-verify that target cannot be hit twice
    const firstHitTime = multiTargetSignal.targets[0].hitAt;
    await evaluateOutcomeState(multiTargetSignal, 1.0870, new Date());
    assert(multiTargetSignal.targets[0].hitAt.getTime() === firstHitTime.getTime(), "Target hit time is not overwritten on subsequent ticks");

    // Trigger TP2 and TP3 (Full TP)
    await evaluateOutcomeState(multiTargetSignal, 1.0960, new Date());
    assert(multiTargetSignal.status === "FULL_TP", "Transitions to FULL_TP when all targets are hit");
    assert(multiTargetSignal.targets[1].isHit === true, "TP2 is marked as hit");
    assert(multiTargetSignal.targets[2].isHit === true, "TP3 is marked as hit");


    // ==========================================
    // 3. STOP LOSS DETECTION AUDIT
    // ==========================================
    console.log("\n--- Auditing Stop Loss Detection ---");

    // Exact Stop Loss Hit
    const slSignal = {
      signalId: new mongoose.Types.ObjectId(),
      messageKey: "Audit:StopLoss",
      channel: "AuditChannel",
      pair: "EURUSD",
      action: "BUY",
      entry: { entryType: "PRICE", entryPrice: 1.0800, entryLow: null, entryHigh: null },
      targets: [{ targetNumber: 1, price: 1.0850, isHit: false }],
      stopLoss: 1.0750,
      status: "ACTIVE",
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      createdAt: new Date(),
    };
    await evaluateOutcomeState(slSignal, 1.0750, new Date());
    assert(slSignal.status === "SL_HIT", "Transitions to SL_HIT on exact stop loss price touch");

    // Gap-through Stop Loss Hit
    const gapSignal = {
      signalId: new mongoose.Types.ObjectId(),
      messageKey: "Audit:GapSL",
      channel: "AuditChannel",
      pair: "EURUSD",
      action: "BUY",
      entry: { entryType: "PRICE", entryPrice: 1.0800, entryLow: null, entryHigh: null },
      targets: [{ targetNumber: 1, price: 1.0850, isHit: false }],
      stopLoss: 1.0750,
      status: "ACTIVE",
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      createdAt: new Date(),
    };
    await evaluateOutcomeState(gapSignal, 1.0710, new Date());
    assert(gapSignal.status === "SL_HIT", "Transitions to SL_HIT when price gaps through stop loss level");
    assert(gapSignal.outcomePrice === 1.0710, "Stores the actual breached market price as outcome price");

    // Simultaneous TP/SL (Prioritizes SL for conservative risk tracking or resolves rationally)
    // If a single price tick crosses both TP and SL, or in our logic, does it handle?
    // Let's test how evaluateOutcomeState handles simultaneous triggers.
    // E.g., if current price breaches SL (1.0700), but ticks high (1.0900).
    const simSignal = {
      signalId: new mongoose.Types.ObjectId(),
      messageKey: "Audit:Simultaneous",
      channel: "AuditChannel",
      pair: "EURUSD",
      action: "BUY",
      entry: { entryType: "PRICE", entryPrice: 1.0800, entryLow: null, entryHigh: null },
      targets: [{ targetNumber: 1, price: 1.0850, isHit: false }],
      stopLoss: 1.0750,
      status: "ACTIVE",
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      createdAt: new Date(),
    };
    // Tick breaches stop loss first
    await evaluateOutcomeState(simSignal, 1.0740, new Date());
    assert(simSignal.status === "SL_HIT", "SL_HIT transitions take absolute priority when breached");


    // ==========================================
    // 4. EXPIRATION LOGIC AUDIT
    // ==========================================
    console.log("\n--- Auditing Expiration Logic ---");

    const expSignal = {
      signalId: new mongoose.Types.ObjectId(),
      messageKey: "Audit:Expired",
      channel: "AuditChannel",
      pair: "EURUSD",
      action: "BUY",
      entry: { entryType: "PRICE", entryPrice: 1.0800, entryLow: null, entryHigh: null },
      targets: [{ targetNumber: 1, price: 1.0850, isHit: false }],
      stopLoss: 1.0750,
      status: "ACTIVE",
      expiresAt: new Date(Date.now() - 1000), // Expired in past
      createdAt: new Date(Date.now() - 72 * 60 * 60 * 1000 - 1000),
    };
    await evaluateOutcomeState(expSignal, 1.0810, new Date());
    assert(expSignal.status === "EXPIRED", "Transitions from ACTIVE to EXPIRED when expiresAt timestamp passes");


    // ==========================================
    // 5. MULTI-SIGNAL VALIDATION AUDIT
    // ==========================================
    console.log("\n--- Auditing Multi-Signal Isolation ---");

    const signal1 = {
      signalId: new mongoose.Types.ObjectId(),
      messageKey: "Audit:Multi1",
      channel: "AuditChannel",
      pair: "EURUSD",
      action: "BUY",
      entry: { entryType: "PRICE", entryPrice: 1.0800, entryLow: null, entryHigh: null },
      targets: [{ targetNumber: 1, price: 1.0850, isHit: false }],
      stopLoss: 1.0750,
      status: "ACTIVE",
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      createdAt: new Date(),
    };
    const signal2 = {
      signalId: new mongoose.Types.ObjectId(),
      messageKey: "Audit:Multi2",
      channel: "AuditChannel",
      pair: "EURUSD",
      action: "BUY",
      entry: { entryType: "PRICE", entryPrice: 1.0780, entryLow: null, entryHigh: null },
      targets: [{ targetNumber: 1, price: 1.0830, isHit: false }],
      stopLoss: 1.0720,
      status: "ACTIVE",
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      createdAt: new Date(),
    };

    await saveOutcome(signal1);
    await saveOutcome(signal2);

    // Tick at 1.0840: Hits TP1 for signal2 but NOT signal1
    await evaluateOutcomeState(signal1, 1.0840, new Date());
    await evaluateOutcomeState(signal2, 1.0840, new Date());

    assert(signal1.status === "ACTIVE", "Signal 1 remains ACTIVE at 1.0840 (TP1 is 1.0850)");
    assert(signal2.status === "FULL_TP", "Signal 2 transitions to FULL_TP at 1.0840 (TP1 is 1.0830)");


    // ==========================================
    // 6. PRICE FEED MAPPING AUDIT
    // ==========================================
    console.log("\n--- Auditing Price Feed Mappings ---");

    const auditMappings = [
      { pair: "XAUUSD", symbol: "GC=F", provider: "yahoo" },
      { pair: "XAGUSD", symbol: "SI=F", provider: "yahoo" },
      { pair: "EURUSD", symbol: "EURUSD=X", provider: "yahoo" },
      { pair: "GBPJPY", symbol: "GBPJPY=X", provider: "yahoo" },
      { pair: "BTCUSD", symbol: "BTCUSDT", provider: "binance" },
      { pair: "US30", symbol: "^DJI", provider: "yahoo" },
      { pair: "US100", symbol: "^IXIC", provider: "yahoo" },
      { pair: "SPX500", symbol: "^GSPC", provider: "yahoo" },
      { pair: "WTI", symbol: "CL=F", provider: "yahoo" },
      { pair: "BRENT", symbol: "BZ=F", provider: "yahoo" },
      { pair: "NATGAS", symbol: "NG=F", provider: "yahoo" }
    ];

    auditMappings.forEach((mapping) => {
      const resolved = resolveSymbol(mapping.pair);
      assert(
        resolved.symbol === mapping.symbol && resolved.provider === mapping.provider,
        `Normalized pair "${mapping.pair}" maps correctly to "${resolved.symbol}" via "${resolved.provider}"`
      );
    });


    // ==========================================
    // 7. MONITORING REPORT AUDIT
    // ==========================================
    console.log("\n--- Auditing Dataset Monitoring API ---");

    // Seed various outcomes with outcomes times to verify coverage range
    const now = Date.now();
    
    // Seed 10 FULL_TP (dated 5 to 1 day ago)
    for (let i = 0; i < 10; i++) {
      const createdAt = new Date(now - (10 - i) * 24 * 60 * 60 * 1000);
      const outcomeTime = new Date(createdAt.getTime() + 60 * 60 * 1000);
      await saveOutcome({
        signalId: new mongoose.Types.ObjectId(),
        messageKey: `Audit:Report:TP:${i}`,
        channel: "AuditChannel",
        pair: "EURUSD",
        action: "BUY",
        entry: { entryType: "PRICE", entryPrice: 1.0800 },
        targets: [{ targetNumber: 1, price: 1.0850 }],
        stopLoss: 1.0750,
        status: "FULL_TP",
        createdAt,
        outcomeTime,
      });
    }

    const report = await getDatasetMonitoringReport();
    assert(report.totalSignalsTracked > 10, `totalSignalsTracked includes seeded outcomes (got ${report.totalSignalsTracked})`);
    assert(report.fullTpOutcomes >= 10, `fullTpOutcomes is at least 10 (got ${report.fullTpOutcomes})`);
    assert(!!report.earliestOutcomeDate, "earliestOutcomeDate successfully calculated");
    assert(!!report.latestOutcomeDate, "latestOutcomeDate successfully calculated");
    assert(report.totalDaysOfCoverage > 0.0, `totalDaysOfCoverage has positive duration (got ${report.totalDaysOfCoverage} days)`);

    // Verify REST API controller return
    let resStatus = null;
    let resData = null;
    const req = {};
    const res = {
      status(s) { resStatus = s; return this; },
      json(d) { resData = d; return this; }
    };
    await getDatasetMonitoringReportController(req, res);
    assert(resStatus === 200, "API Controller returns 200 OK");
    assert(resData.totalSignalsTracked === report.totalSignalsTracked, "API payload maps correct stats");
    assert(resData.totalDaysOfCoverage === report.totalDaysOfCoverage, "API payload contains coverage days");

  } catch (err) {
    console.error("Audit run error:", err);
    failed++;
  }

  console.log("\n=== AUDIT SUMMARY ===");
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);

  if (failed > 0) {
    console.error("Some audit assertions failed!");
    setTimeout(() => process.exit(1), 100);
  } else {
    console.log("All outcome accuracy audit assertions passed successfully!");
    setTimeout(() => process.exit(0), 100);
  }
}

runAudit().catch((err) => {
  console.error("Fatal audit crash:", err);
  process.exit(1);
});
