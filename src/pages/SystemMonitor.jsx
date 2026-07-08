import { useEffect, useState } from "react";
import {
  Activity,
  Cpu,
  Database,
  RefreshCw,
  Server,
  AlertCircle
} from "lucide-react";
import { fetchWithCredentials } from "../services/apiClient";

function SystemMonitor() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchSystemData = () => {
    setRefreshing(true);
    fetchWithCredentials("/system/health")
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load system health");
        return res.json();
      })
      .then((healthData) => {
        setHealth(healthData);
        setError(null);
      })
      .catch((err) => {
        setError(err.message);
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  };

  useEffect(() => {
    setTimeout(() => {
      fetchSystemData();
    }, 0);
    const interval = setInterval(fetchSystemData, 30000);
    return () => clearInterval(interval);
  }, []);

  const formatUptime = (seconds) => {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${d}d ${h}h ${m}m`;
  };

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-sm font-semibold text-slate-500 dark:text-slate-400">
        Loading system monitor...
      </div>
    );
  }

  return (
    <div className="animate-dashboard-in">
      <div className="flex items-center justify-between">
        <div>
          <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            <Activity size={16} />
            Operations Overview
          </p>
          <h2 className="mt-2 text-3xl font-bold text-blue-500 dark:text-blue-400 sm:text-4xl">
            System Monitor
          </h2>
        </div>
        <button
          onClick={fetchSystemData}
          disabled={refreshing}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-200 dark:hover:bg-white/10"
        >
          <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-5 dark:border-rose-500/20 dark:bg-rose-500/10">
          <p className="flex items-center gap-2 text-sm font-bold text-rose-600 dark:text-rose-400">
            <AlertCircle size={18} />
            Error Fetching System Data
          </p>
          <p className="mt-2 text-xs text-rose-500/90 dark:text-rose-400/80">{error}</p>
        </div>
      )}

      {health && (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {/* Node Server Uptime & Specs */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
            <h3 className="flex items-center gap-2.5 text-lg font-bold text-slate-900 dark:text-white">
              <Server className="text-blue-500" size={20} />
              Backend Server
            </h3>
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between border-b border-slate-100 pb-2.5 dark:border-white/5">
                <span className="text-slate-500 dark:text-slate-400 font-semibold">Status</span>
                <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-bold text-emerald-500">
                  {health.status}
                </span>
              </div>
              <div className="flex justify-between border-b border-slate-100 pb-2.5 dark:border-white/5">
                <span className="text-slate-500 dark:text-slate-400 font-semibold">Uptime</span>
                <span className="text-slate-800 dark:text-slate-200 font-bold">
                  {formatUptime(health.uptime)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400 font-semibold">Env Node</span>
                <span className="text-slate-800 dark:text-slate-200 font-bold">Production</span>
              </div>
            </div>
          </div>

          {/* Database Specs */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
            <h3 className="flex items-center gap-2.5 text-lg font-bold text-slate-900 dark:text-white">
              <Database className="text-indigo-500" size={20} />
              Database Engine
            </h3>
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between border-b border-slate-100 pb-2.5 dark:border-white/5">
                <span className="text-slate-500 dark:text-slate-400 font-semibold">Status</span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                  health.database.status === "CONNECTED"
                    ? "bg-emerald-500/10 text-emerald-500"
                    : "bg-rose-500/10 text-rose-500"
                }`}>
                  {health.database.status}
                </span>
              </div>
              <div className="flex justify-between border-b border-slate-100 pb-2.5 dark:border-white/5">
                <span className="text-slate-500 dark:text-slate-400 font-semibold">Provider</span>
                <span className="text-slate-800 dark:text-slate-200 font-bold">{health.database.provider}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400 font-semibold">Replication</span>
                <span className="text-slate-800 dark:text-slate-200 font-bold">Active ReplicaSet</span>
              </div>
            </div>
          </div>

          {/* Resource Usage */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
            <h3 className="flex items-center gap-2.5 text-lg font-bold text-slate-900 dark:text-white">
              <Cpu className="text-purple-500" size={20} />
              System Resources
            </h3>
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between border-b border-slate-100 pb-2.5 dark:border-white/5">
                <span className="text-slate-500 dark:text-slate-400 font-semibold">Memory Allocated</span>
                <span className="text-slate-800 dark:text-slate-200 font-bold">{health.memory.rss}</span>
              </div>
              <div className="flex justify-between border-b border-slate-100 pb-2.5 dark:border-white/5">
                <span className="text-slate-500 dark:text-slate-400 font-semibold">Heap Allocated</span>
                <span className="text-slate-800 dark:text-slate-200 font-bold">{health.memory.heapTotal}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400 font-semibold">Heap In-Use</span>
                <span className="text-slate-800 dark:text-slate-200 font-bold">{health.memory.heapUsed}</span>
              </div>
            </div>
          </div>

          {/* MT5 Bridge Connector Panel */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/[0.04] lg:col-span-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4 dark:border-white/5">
              <h3 className="flex items-center gap-2.5 text-lg font-bold text-slate-900 dark:text-white">
                <RefreshCw className={`text-blue-500 ${health.mt5Bridge?.status === "ACTIVE" ? "animate-spin" : ""}`} style={{ animationDuration: "3s" }} size={20} />
                MT5 Bridge Sync Gateway
              </h3>
              <div className="flex flex-wrap gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                  health.mt5Bridge?.status === "ACTIVE"
                    ? "bg-emerald-500/10 text-emerald-500"
                    : "bg-rose-500/10 text-rose-500"
                }`}>
                  Gateway: {health.mt5Bridge?.status || "INACTIVE"}
                </span>
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-600 dark:bg-white/5 dark:text-slate-400">
                  Uptime: {formatUptime(health.mt5Bridge?.uptimeSec || 0)}
                </span>
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-600 dark:bg-white/5 dark:text-slate-400">
                  Reconnects Today: {health.mt5Bridge?.reconnectsToday || 0}
                </span>
              </div>
            </div>

            {health.mt5Bridge?.clients && health.mt5Bridge.clients.length > 0 ? (
              <div className="mt-4 divide-y divide-slate-100 dark:divide-white/5">
                {health.mt5Bridge.clients.map((client, idx) => {
                  let badgeColor = "bg-rose-500/10 text-rose-500";
                  if (client.healthRating === "Excellent") badgeColor = "bg-emerald-500/10 text-emerald-500";
                  else if (client.healthRating === "Good") badgeColor = "bg-teal-500/10 text-teal-500";
                  else if (client.healthRating === "Warning") badgeColor = "bg-amber-500/10 text-amber-500";

                  return (
                    <div key={idx} className="flex flex-col md:flex-row md:items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
                      <div className="space-y-1">
                        <p className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                          {client.broker} — Account {client.accountNumber}
                          <span className={`inline-block w-2.5 h-2.5 rounded-full ${client.status === "CONNECTED" ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`}></span>
                        </p>
                        <p className="text-xs text-slate-400 dark:text-slate-500">
                          Server: <span className="font-semibold text-slate-500 dark:text-slate-400">{client.server}</span> | 
                          Client v{client.clientVersion} | Protocol v{client.protocolVersion}
                        </p>
                        <p className="text-xs text-slate-400 dark:text-slate-500">
                          Last ping: <span className="font-semibold text-slate-500 dark:text-slate-400">{new Date(client.lastSeen).toLocaleTimeString()}</span> | 
                          Connected: <span className="font-semibold text-slate-500 dark:text-slate-400">{client.connectionDurationMin} min</span>
                        </p>
                      </div>
                      <div className="flex items-center gap-4 text-right">
                        <div className="space-y-1">
                          <p className="text-xs text-slate-400">Connection Health</p>
                          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${badgeColor}`}>
                            {client.healthRating} ({client.healthScore}/100)
                          </span>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-slate-400">Errors / Reconnects</p>
                          <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                            {client.errorCount} err / {client.reconnectCount} rec
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-6 text-center py-6 text-slate-400 dark:text-slate-500 text-sm">
                No Expert Advisors currently connected to the cloud bridge.
              </div>
            )}
          </div>
        </div>
      )}

      {health && (
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          {/* Price Feeds */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Price Feed Latencies</h3>
            <div className="mt-4 divide-y divide-slate-100 dark:divide-white/5">
              <div className="flex items-center justify-between py-3">
                <div>
                  <p className="font-bold text-slate-800 dark:text-white">Yahoo Finance API</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    Tracked assets: XAUUSD, EURUSD, Indexes
                    {health.priceFeeds.yahoo.source && ` (Active Source: ${health.priceFeeds.yahoo.source})`}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-right">
                  <span className="text-xs font-semibold text-slate-500">{health.priceFeeds.yahoo.latencyMs} ms</span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                    health.priceFeeds.yahoo.status === "HEALTHY"
                      ? "bg-emerald-500/10 text-emerald-500"
                      : "bg-rose-500/10 text-rose-500"
                  }`}>
                    {health.priceFeeds.yahoo.status}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between py-3">
                <div>
                  <p className="font-bold text-slate-800 dark:text-white">Binance Exchange Feed</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    Tracked assets: BTCUSD, ETHUSD
                    {health.priceFeeds.binance.source && ` (Active Source: ${health.priceFeeds.binance.source})`}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-right">
                  <span className="text-xs font-semibold text-slate-500">{health.priceFeeds.binance.latencyMs} ms</span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                    health.priceFeeds.binance.status === "HEALTHY"
                      ? "bg-emerald-500/10 text-emerald-500"
                      : "bg-rose-500/10 text-rose-500"
                  }`}>
                    {health.priceFeeds.binance.status}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Background Task States */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Active Background Services</h3>
            <div className="mt-4 divide-y divide-slate-100 dark:divide-white/5 text-sm">
              <div className="flex items-center justify-between py-3">
                <div>
                  <span className="font-bold text-slate-800 dark:text-white block">Telegram Ingestion listener</span>
                  <span className="text-xs text-slate-400">Dynamic polling VIP channels feed</span>
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                  health.activeServices.telegramListener ? "bg-blue-500/10 text-blue-500" : "bg-slate-500/10 text-slate-500"
                }`}>
                  {health.activeServices.telegramListener ? "ACTIVE" : "INACTIVE"}
                </span>
              </div>
              <div className="flex items-center justify-between py-3">
                <div>
                  <span className="font-bold text-slate-800 dark:text-white block">MT5 Bridge Sync Gateway</span>
                  <span className="text-xs text-slate-400">
                    {health.mt5Bridge?.connectedClients || 0} clients connected to cloud /mt5
                  </span>
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                  health.mt5Bridge?.status === "ACTIVE"
                    ? "bg-emerald-500/10 text-emerald-500"
                    : "bg-slate-500/10 text-slate-500"
                }`}>
                  {health.mt5Bridge?.status || "INACTIVE"}
                </span>
              </div>
              <div className="flex items-center justify-between py-3">
                <div>
                  <span className="font-bold text-slate-800 dark:text-white block">Gemini Connection Client</span>
                  <span className="text-xs text-slate-400">Generative model gemini-2.5-flash context advisor</span>
                </div>
                <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-bold text-emerald-500">
                  ONLINE
                </span>
              </div>
              <div className="flex items-center justify-between py-3">
                <div>
                  <span className="font-bold text-slate-800 dark:text-white block">Pipeline Inflow Queue</span>
                  <span className="text-xs text-slate-400">Concurrency: 2 handlers | Capacity: 500 slots</span>
                </div>
                <span className="rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-bold text-blue-500">
                  IDLE
                </span>
              </div>
              <div className="flex items-center justify-between py-3">
                <div>
                  <span className="font-bold text-slate-800 dark:text-white block">Market Price Cache Aggregator</span>
                  <span className="text-xs text-slate-400">Yahoo and Binance price history sync</span>
                </div>
                <span className="rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-bold text-blue-500">
                  ACTIVE
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SystemMonitor;
