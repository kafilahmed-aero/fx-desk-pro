import assert from "assert";
import express from "express";
import http from "http";
import WebSocket from "ws";
import mongoose from "mongoose";
import { AiRecommendationOutcome } from "../models/aiRecommendationOutcomeModel.js";
import { startMt5SyncService, stopMt5SyncService, connectedClients } from "../services/mt5SyncService.js";
import { executeBridgeOrder } from "../services/signalExecutionBridgeService.js";

// Stub model findOne to return null and prevent database requests
AiRecommendationOutcome.findOne = async () => null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function buildMockReadyContext(overrides = {}) {
  return {
    signalId: 4001,
    channelId: "test-chan-1",
    channelName: "TestChannel",
    symbol: "XAUUSD",
    direction: "BUY",
    entry: 2030,
    entryFrom: null,
    entryTo: null,
    stopLoss: 2020,
    takeProfits: [2045],
    receivedTimestamp: "2026-07-17T12:00:00.000Z",
    parserTimestamp: "2026-07-17T12:00:00.000Z",
    pipelineStatus: "SCHEDULED",
    executionStatus: "NOT_STARTED",
    order: {
      type: "MARKET",
      plannedEntry: 2030,
      entryZone: { lower: 2030, upper: 2030 },
      currentMarketPrice: 2030,
      planningTimestamp: "2026-07-17T12:00:01.000Z",
      planningReason: "PRICE_INSIDE_ENTRY_ZONE",
      status: "PLANNED",
      executionMode: "MARKET",
      executionStatus: "READY_FOR_EXECUTION",
      scheduledAt: "2026-07-17T12:00:02.000Z",
      nextEvaluationTime: null,
      schedulerVersion: "1.0.0",
      schedulerReason: "MARKET_ORDER",
      ticket: null,
      fillPrice: null,
      placedAt: null
    },
    monitoring: {
      status: "NOT_STARTED",
      startedAt: null,
      lastUpdate: null
    },
    outcome: {
      result: null,
      closedAt: null,
      profit: null,
      pips: null
    },
    rating: {
      processed: false
    },
    ...overrides
  };
}

async function runTests() {
  console.log("=== MT5 Execution Bridge Test Suite ===\n");
  const TEST_PORT = 19080;
  const TEST_TOKEN = "test-bridge-token-999";
  process.env.MT5_BRIDGE_PORT = String(TEST_PORT);
  process.env.MT5_BRIDGE_AUTH_TOKEN = TEST_TOKEN;

  // Stub mongoose connection state
  Object.defineProperty(mongoose.connection, "readyState", {
    get: () => 1,
    configurable: true
  });

  // Initialize unified HTTP/WS Server for MT5 Sync Service
  startMt5SyncService();

  // Connect mock EA Client
  const wsUrl = `ws://localhost:${TEST_PORT}?token=${TEST_TOKEN}`;
  const clientWs = new WebSocket(wsUrl);

  clientWs.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.event === "REGISTER" && msg.status === "SUCCESS") {
      // console.log("  [Mock EA] Connected & Registered.");
    }
  });

  await sleep(100);

  // Send register event to authenticate
  clientWs.send(JSON.stringify({
    event: "REGISTER",
    broker: "MockBroker",
    server: "MockServer",
    accountNumber: "999888",
    token: TEST_TOKEN,
    eaVersion: "2.00",
    protocolVersion: 2
  }));

  await sleep(200);
  assert(connectedClients.size === 1, "Mock client should be registered in mt5SyncService.");

  let passed = true;

  // Test 1: Successful Execution Walkthrough
  try {
    console.log("[Test 1] Testing Success execution flow (ORDER_FILLED)...");
    const ctx = buildMockReadyContext();

    // Trigger mock ORDER_FILLED message from the EA after a short pause
    setTimeout(() => {
      clientWs.send(JSON.stringify({
        event: "ORDER_FILLED",
        recommendationId: "4001",
        ticket: 882200,
        fillPrice: 2030.15,
        fillTime: "2026-07-17 12:00:05",
        slippage: 0.15,
        spread: 0.1,
        latencyMs: 120
      }));
    }, 100);

    const executed = await executeBridgeOrder(ctx);

    if (
      executed.pipelineStatus === "EXECUTED" &&
      executed.order.executionStatus === "EXECUTED" &&
      executed.order.ticket === "882200" &&
      executed.order.fillPrice === 2030.15 &&
      executed.order.executionResult === "SUCCESS" &&
      executed.order.executedAt !== undefined &&
      executed.order.plannedEntry === 2030 // planning data preserved
    ) {
      console.log("  PASS: Properly updated success context deal parameters.");
    } else {
      console.error("  FAIL: Success context mismatch:", executed.order);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Exception in Test 1:", err.message);
    passed = false;
  }

  // Test 2: Failed Execution Walkthrough
  try {
    console.log("\n[Test 2] Testing Failure execution flow (TRADE_FAILED)...");
    const ctx = buildMockReadyContext({ signalId: 4002 });
    ctx.order.plannedEntry = 2035;

    // Trigger mock TRADE_FAILED message from the EA
    setTimeout(() => {
      clientWs.send(JSON.stringify({
        event: "TRADE_FAILED",
        recommendationId: "4002",
        reason: "Insufficient Margin",
        retcode: 10019
      }));
    }, 100);

    const executed = await executeBridgeOrder(ctx);

    if (
      executed.pipelineStatus === "SCHEDULED" && // pipeline status remains SCHEDULED
      executed.order.executionStatus === "FAILED" &&
      executed.order.executionResult === "FAILED" &&
      executed.order.failureReason === "Insufficient Margin" &&
      executed.order.failedAt !== undefined &&
      executed.order.plannedEntry === 2035 // preserved
    ) {
      console.log("  PASS: Properly updated failed context parameters.");
    } else {
      console.error("  FAIL: Failure context mismatch:", executed.order);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Exception in Test 2:", err.message);
    passed = false;
  }

  // Test 3: Timeout Execution Walkthrough
  try {
    console.log("\n[Test 3] Testing Timeout execution flow...");
    const ctx = buildMockReadyContext({ signalId: 4003 });

    // Let it timeout (no client message sent)
    const executed = await executeBridgeOrder(ctx, { timeoutMs: 150 });

    if (
      executed.pipelineStatus === "SCHEDULED" &&
      executed.order.executionStatus === "FAILED" &&
      executed.order.executionResult === "FAILED" &&
      executed.order.failureReason.includes("timed out") &&
      executed.order.failedAt !== undefined
    ) {
      console.log("  PASS: Properly handled connection timeout and updated failedAt parameters.");
    } else {
      console.error("  FAIL: Timeout context mismatch:", executed.order);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Exception in Test 3:", err.message);
    passed = false;
  }

  // Test 4: Ingestion Guards
  try {
    console.log("\n[Test 4] Testing Ingestion guards for non-ready contexts...");

    // Case A: Unscheduled pipelineStatus
    const ctxA = buildMockReadyContext({ pipelineStatus: "PLANNED" });
    const resA = await executeBridgeOrder(ctxA);
    assert(resA === ctxA, "Unscheduled contexts should be bypassed immediately.");

    // Case B: WAITING_FOR_PRICE executionStatus
    const ctxB = buildMockReadyContext();
    ctxB.order.executionStatus = "WAITING_FOR_PRICE";
    const resB = await executeBridgeOrder(ctxB);
    assert(resB === ctxB, "Waiting contexts should be bypassed immediately.");

    console.log("  PASS: Guards bypassed unpromoted/unready contexts cleanly.");
  } catch (err) {
    console.error("  FAIL: Exception in Test 4:", err.message);
    passed = false;
  }

  // Clean up
  clientWs.close();
  stopMt5SyncService();

  console.log("\n==========================================");
  if (passed) {
    console.log("ALL BRIDGE TESTS PASSED!");
    process.exit(0);
  } else {
    console.error("BRIDGE TESTS FAILED!");
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
