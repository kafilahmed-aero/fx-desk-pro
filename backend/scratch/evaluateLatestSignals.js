import "dotenv/config";
import { executePipelineE2E } from "../src/services/pipelineIntegration.js";
import { resetPairStateStore } from "../src/services/pairStateEngine.js";

async function main() {
  console.log("Logging into backend API to fetch parsed signals...");
  const loginRes = await fetch("http://localhost:5000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "trader@example.com", password: "password" })
  });
  
  if (!loginRes.ok) {
    console.error("Login failed:", await loginRes.text());
    return;
  }
  
  const { token } = await loginRes.json();
  
  console.log("Fetching latest signals...");
  const signalsRes = await fetch(`http://localhost:5000/api/signals?token=${token}`);
  const signals = await signalsRes.json();
  console.log(`Total parsed signals to evaluate: ${signals.length}`);

  for (const signal of signals) {
    // Reset pair state to isolate the signal evaluation
    resetPairStateStore();

    console.log(`\nEvaluating signal: ${signal.channel}:${signal.messageId} - ${signal.pair} ${signal.action} @ ${signal.entry}`);
    const rawMessage = {
      text: signal.rawText,
      channel: signal.channel,
      messageId: signal.messageId,
      date: Math.floor(new Date(signal.timestamp).getTime() / 1000)
    };

    // Run E2E pipeline
    const report = await executePipelineE2E(rawMessage, {
      mockMarketPrice: { price: signal.entry || 2000, status: "HEALTHY", source: "MOCK" },
      mockActiveOpportunities: [signal.pair],
      accountState: { balance: 10000, maxRiskPercent: 1.0, maxLotLimit: 10.0 }
    });

    console.log(`Pipeline Status: ${report.status}`);
    if (report.status === "SUCCESS") {
      console.log("APPROVED Trade payload details:", JSON.stringify(report.mt5Payload, null, 2));
    } else {
      console.log("Blocked/Rejected reasons:", report.errors);
    }
  }
}

main().catch(console.error);
