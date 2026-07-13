import "dotenv/config";
import mongoose from "mongoose";
import { RawMessage } from "../src/models/rawMessageModel.js";
import { ParsedSignal } from "../src/models/parsedSignalModel.js";

async function run() {
  try {
    const API_BASE = "https://fxdesk-backend.onrender.com/api";
    console.log("Logging into production backend...");
    const loginRes = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "kafil123@gmail.com",
        password: "A1122334455a@",
        remember: true
      })
    });

    if (!loginRes.ok) {
      console.error("Login failed!");
      return;
    }

    const setCookie = loginRes.headers.get("set-cookie");
    const cookieHeader = setCookie ? setCookie.split(";")[0] : "";
    console.log("Logged in successfully.");

    console.log("\nFetching live system health from Render...");
    const healthRes = await fetch(`${API_BASE}/system/health`, {
      headers: { Cookie: cookieHeader }
    });
    if (healthRes.ok) {
      const data = await healthRes.json();
      console.log("HEALTH RESPONSE:", JSON.stringify(data, null, 2));
    } else {
      console.log("Health fetch failed with status:", healthRes.status);
    }

    console.log("\nFetching live telegram health from Render...");
    const telRes = await fetch(`${API_BASE}/system/telegram`, {
      headers: { Cookie: cookieHeader }
    });
    if (telRes.ok) {
      const data = await telRes.json();
      console.log("TELEGRAM HEALTH RESPONSE:", JSON.stringify(data, null, 2));
    } else {
      console.log("Telegram health fetch failed with status:", telRes.status);
    }

    console.log("\nFetching live stability metrics from Render...");
    const stabRes = await fetch(`${API_BASE}/health/live-stability`);
    if (stabRes.ok) {
      const data = await stabRes.json();
      console.log("LIVE STABILITY RESPONSE:", JSON.stringify(data, null, 2));
    } else {
      console.log("Live stability fetch failed with status:", stabRes.status);
    }

  } catch (err) {
    console.error("Error running script:", err);
  }
}

run();
