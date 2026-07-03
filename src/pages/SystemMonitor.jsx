import { useEffect, useState } from "react";
import {
  Activity,
  Cpu,
  Database,
  RefreshCw,
  Server,
  AlertCircle,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  Compass,
  ShieldCheck
} from "lucide-react";
import { fetchWithCredentials } from "../services/apiClient";

function SystemMonitor() {
  const [health, setHealth] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchSystemData = () => {
    setRefreshing(true);
    Promise.all([
      fetchWithCredentials("/system/health").then(async (res) => {
        if (!res.ok) throw new Error("Failed to load system health");
        return res.json();
      }),
      fetchWithCredentials("/system/metrics").then(async (res) => {
        if (!res.ok) throw new Error("Failed to load metrics");
        return res.json();
      })
    ])
      .then(([healthData, metricsData]) => {
        setHealth(healthData);
        setMetrics(metricsData);
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
    fetchSystemData();
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
            <div className="mt-4 divide-y divide-slate-100 dark:divide-white/5">
              <div className="flex items-center justify-between py-3">
                <span className="font-bold text-slate-800 dark:text-white">Telegram Ingestion listener</span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                  health.activeServices.telegramListener ? "bg-blue-500/10 text-blue-500" : "bg-slate-500/10 text-slate-500"
                }`}>
                  {health.activeServices.telegramListener ? "ACTIVE" : "INACTIVE"}
                </span>
              </div>
              <div className="flex items-center justify-between py-3">
                <span className="font-bold text-slate-800 dark:text-white">Keep-Alive self pinger scheduler</span>
                <span className="rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-bold text-blue-500">
                  ACTIVE
                </span>
              </div>
              <div className="flex items-center justify-between py-3">
                <span className="font-bold text-slate-800 dark:text-white">Market Price Cache Aggregator</span>
                <span className="rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-bold text-blue-500">
                  ACTIVE
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Merged Daily Metrics & Outcomes Dashboard */}
      {metrics && (
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          {/* Daily Activity Metrics */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
            <h3 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
              <Compass className="text-blue-500" size={20} />
              Daily Activity Metrics
            </h3>
            <div className="mt-4 space-y-3.5 text-sm">
              <div className="flex justify-between border-b border-slate-100 pb-2.5 dark:border-white/5">
                <span className="text-slate-500 dark:text-slate-400 font-semibold">Raw Messages Received</span>
                <span className="text-slate-850 dark:text-slate-200 font-bold">
                  {metrics.dailyMetrics.rawMessagesToday}
                </span>
              </div>
              <div className="flex justify-between border-b border-slate-100 pb-2.5 dark:border-white/5">
                <span className="text-slate-500 dark:text-slate-400 font-semibold">Signals Parsed Today</span>
                <span className="text-blue-500 font-bold">
                  {metrics.dailyMetrics.signalsParsedToday}
                </span>
              </div>
              <div className="flex justify-between border-b border-slate-100 pb-2.5 dark:border-white/5">
                <span className="text-slate-500 dark:text-slate-400 font-semibold">Promotions Filtered</span>
                <span className="text-slate-800 dark:text-slate-200 font-bold">
                  {metrics.dailyMetrics.promotionsFiltered}
                </span>
              </div>
              <div className="flex justify-between border-b border-slate-100 pb-2.5 dark:border-white/5">
                <span className="text-slate-500 dark:text-slate-400 font-semibold">Updates & Results Filtered</span>
                <span className="text-slate-800 dark:text-slate-200 font-bold">
                  {metrics.dailyMetrics.resultsFiltered}
                </span>
              </div>
              <div className="flex justify-between border-b border-slate-100 pb-2.5 dark:border-white/5">
                <span className="text-slate-500 dark:text-slate-400 font-semibold">Active Opportunities</span>
                <span className="text-emerald-500 font-bold">
                  {metrics.dailyMetrics.activeOpportunities}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400 font-semibold">Notifications Dispatched</span>
                <span className="text-indigo-500 font-bold">
                  {metrics.dailyMetrics.notificationsSent}
                </span>
              </div>
            </div>
          </div>

          {/* Real Trade Outcomes */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
            <h3 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
              <ShieldCheck className="text-emerald-500" size={20} />
              Real Trade Outcomes Today
            </h3>
            <div className="mt-6 grid grid-cols-2 gap-4">
              <div className="rounded-xl bg-emerald-500/10 p-3.5 border border-emerald-500/15 text-center">
                <ArrowUpRight className="text-emerald-500 mx-auto" size={20} />
                <span className="mt-1.5 block text-xs font-bold text-emerald-500/85 uppercase">Full TPs</span>
                <p className="mt-1 text-2xl font-bold text-emerald-500">{metrics.tradeMetrics.fullTpToday}</p>
              </div>
              <div className="rounded-xl bg-blue-500/10 p-3.5 border border-blue-500/15 text-center">
                <ArrowUpRight className="text-blue-500 mx-auto" size={20} />
                <span className="mt-1.5 block text-xs font-bold text-blue-500/85 uppercase">Partial TPs</span>
                <p className="mt-1 text-2xl font-bold text-blue-500">{metrics.tradeMetrics.partialTpToday}</p>
              </div>
              <div className="rounded-xl bg-rose-500/10 p-3.5 border border-rose-500/15 text-center">
                <ArrowDownRight className="text-rose-500 mx-auto" size={20} />
                <span className="mt-1.5 block text-xs font-bold text-rose-500/85 uppercase">SL Hits</span>
                <p className="mt-1 text-2xl font-bold text-rose-500">{metrics.tradeMetrics.slHitToday}</p>
              </div>
              <div className="rounded-xl bg-slate-500/10 p-3.5 border border-slate-500/15 text-center">
                <Compass className="text-slate-400 mx-auto" size={20} />
                <span className="mt-1.5 block text-xs font-bold text-slate-400/85 uppercase">Expired</span>
                <p className="mt-1 text-2xl font-bold text-slate-400 dark:text-slate-200">{metrics.tradeMetrics.expiredToday}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SystemMonitor;
