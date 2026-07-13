import { useEffect, useState } from "react";
import { getAiDiagnosticsData } from "../services/signalService";
import { ShieldAlert, PieChart, Activity, Code, ChevronDown, ChevronUp, Sparkles, AlertTriangle, RefreshCw } from "lucide-react";

function AiDiagnosticsCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [responseOpen, setResponseOpen] = useState(false);

  async function fetchDiagnostics() {
    setLoading(true);
    try {
      const res = await getAiDiagnosticsData();
      setData(res);
      setError(null);
    } catch (err) {
      console.error("Failed to load AI diagnostics", err);
      setError("Diagnostics data unavailable");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchDiagnostics();
    const interval = setInterval(fetchDiagnostics, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, []);

  if (loading && !data) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white/80 p-6 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.06] animate-pulse">
        <div className="h-6 w-1/4 rounded bg-slate-200 dark:bg-slate-800 mb-4"></div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 rounded bg-slate-200 dark:bg-slate-800"></div>
          ))}
        </div>
      </div>
    );
  }

  const d = data || {
    total: 0,
    buys: 0,
    sells: 0,
    holds: 0,
    holdPct: 0,
    avgConfidence: 0,
    avgGenerationTime: 0,
    contradictionCount: 0,
    holdStats: { totalEvaluated: 0, avoidedLosing: 0, missedProfitable: 0, optimalCount: 0, accuracyRate: 100 },
    latestPrompt: "No prompt sampled yet",
    latestRawResponse: "No response sampled yet"
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white/85 p-6 shadow-xl backdrop-blur-xl transition-all duration-300 dark:border-white/10 dark:bg-[#0B1220]/80 dark:shadow-black/10">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-teal-500 via-emerald-500 to-indigo-500"></div>

      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-slate-200/70 pb-4 dark:border-white/10 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-lg font-bold text-slate-950 dark:text-white flex items-center gap-2">
          <Activity className="text-teal-500" size={20} />
          <span>🤖 Decision Validation & System Diagnostics</span>
        </h3>
        <button
          onClick={fetchDiagnostics}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-650 hover:bg-slate-100 transition-colors dark:border-white/5 dark:bg-white/[0.02] dark:text-slate-400 dark:hover:bg-white/[0.06]"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50/50 p-4 text-xs font-bold text-rose-650 dark:border-rose-500/10 dark:bg-rose-500/5 dark:text-rose-400 flex items-center gap-2">
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      {/* Grid Metrics */}
      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
        <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-white/5 dark:bg-white/[0.02]">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Total Cycles</p>
          <p className="mt-1 text-base font-black text-slate-900 dark:text-white">{d.total}</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-white/5 dark:bg-white/[0.02]">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">BUY / SELL Count</p>
          <p className="mt-1 text-base font-black text-slate-900 dark:text-white">
            <span className="text-emerald-500">{d.buys}</span> / <span className="text-rose-500">{d.sells}</span>
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-white/5 dark:bg-white/[0.02]">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">HOLDs</p>
          <p className="mt-1 text-base font-black text-slate-900 dark:text-white">{d.holds} ({d.holdPct}%)</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-white/5 dark:bg-white/[0.02]">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Avg Confidence</p>
          <p className="mt-1 text-base font-black text-blue-500">{d.avgConfidence}%</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-white/5 dark:bg-white/[0.02]">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Avg Latency</p>
          <p className="mt-1 text-base font-black text-purple-500">{d.avgGenerationTime} ms</p>
        </div>

        <div className={`rounded-xl border p-4 ${d.contradictionCount > 0 ? "border-rose-300 bg-rose-500/10" : "border-slate-200 bg-slate-50/50 dark:border-white/5 dark:bg-white/[0.02]"}`}>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Contradictions</p>
          <p className={`mt-1 text-base font-black flex items-center gap-1 ${d.contradictionCount > 0 ? "text-rose-500" : "text-slate-900 dark:text-white"}`}>
            {d.contradictionCount}
            {d.contradictionCount > 0 && <AlertTriangle size={14} className="animate-bounce" />}
          </p>
        </div>
      </div>

      {/* HOLD Accuracy and Quality section */}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 p-5 dark:border-white/5 bg-slate-50/[0.15]">
          <h4 className="text-xs font-extrabold uppercase tracking-widest text-slate-500 border-b border-slate-200/50 pb-2 dark:border-white/5 dark:text-slate-400 mb-3 flex items-center gap-1.5">
            <PieChart size={14} className="text-teal-500" />
            HOLD Accuracy Analysis
          </h4>
          <div className="grid grid-cols-3 gap-4 text-center mb-4">
            <div>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-semibold">Evaluated</p>
              <p className="mt-1 text-sm font-black text-slate-700 dark:text-slate-350">{d.holdStats.totalEvaluated}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-semibold">Avoided Loss</p>
              <p className="mt-1 text-sm font-black text-emerald-500">{d.holdStats.avoidedLosing}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-semibold">Missed Profit</p>
              <p className="mt-1 text-sm font-black text-rose-500">{d.holdStats.missedProfitable}</p>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200/50 bg-slate-100/30 p-3.5 dark:border-white/5">
            <div className="flex justify-between items-center text-xs">
              <span className="font-extrabold text-slate-800 dark:text-slate-200">Hindsight Optimal HOLD Rate</span>
              <span className="font-black text-teal-600 dark:text-teal-400">{d.holdStats.accuracyRate}%</span>
            </div>
            <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className="h-full rounded-full bg-teal-500 transition-all duration-500"
                style={{ width: `${d.holdStats.accuracyRate}%` }}
              ></div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 p-5 dark:border-white/5 bg-slate-50/[0.15]">
          <h4 className="text-xs font-extrabold uppercase tracking-widest text-slate-500 border-b border-slate-200/50 pb-2 dark:border-white/5 dark:text-slate-400 mb-3 flex items-center gap-1.5">
            <ShieldAlert size={14} className="text-indigo-500" />
            Diagnostics Status
          </h4>
          <div className="space-y-3 text-xs font-semibold text-slate-650 dark:text-slate-350">
            <div className="flex justify-between">
              <span className="text-slate-400">Database Connection:</span>
              <span className="font-black text-emerald-500">CONNECTED</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Decision Validation Logs:</span>
              <span className="font-black text-teal-500">ACTIVE</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Storage Optimization Mode:</span>
              <span className="font-black text-indigo-500">ENABLED (Structured Summary)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Outcome Evaluation Loops:</span>
              <span className="font-black text-purple-500">RUNNING (15m, 30m, 1h, 4h)</span>
            </div>
          </div>
        </div>
      </div>

      {/* API Budget & Model Diagnostics Dashboard */}
      <div className="mt-5 rounded-xl border border-slate-200 p-5 dark:border-white/5 bg-slate-50/[0.15]">
        <h4 className="text-xs font-extrabold uppercase tracking-widest text-slate-500 border-b border-slate-200/50 pb-2 dark:border-white/5 dark:text-slate-400 mb-3 flex items-center gap-1.5">
          <Sparkles size={14} className="text-emerald-500" />
          API Budget & Fallback Diagnostics
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Primary Model */}
          <div className="rounded-xl border border-slate-200 bg-slate-100/30 p-3.5 dark:border-white/5 dark:bg-white/[0.01]">
            <p className="text-[10px] uppercase font-bold text-slate-400">Primary (LLM Provider)</p>
            <div className="flex justify-between items-center mt-2">
              <span className="text-xs font-black text-slate-700 dark:text-slate-350">
                Requests: {d.modelManager?.models?.["gemini-2.5-flash"]?.requestsToday || 0}
              </span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                d.modelManager?.models?.["gemini-2.5-flash"]?.status === "HEALTHY" ? "bg-emerald-500/10 text-emerald-500" :
                d.modelManager?.models?.["gemini-2.5-flash"]?.status === "HALF_OPEN" ? "bg-amber-500/10 text-amber-500" :
                d.modelManager?.models?.["gemini-2.5-flash"]?.status === "DEGRADED" ? "bg-blue-500/10 text-blue-500" :
                "bg-rose-500/10 text-rose-500"
              }`}>
                {d.modelManager?.models?.["gemini-2.5-flash"]?.status || "HEALTHY"}
              </span>
            </div>
            <p className="text-[10px] text-slate-400 mt-2 font-bold">Success Rate: {d.modelManager?.models?.["gemini-2.5-flash"]?.successRate || "100"}%</p>
          </div>

          {/* Secondary Model */}
          <div className="rounded-xl border border-slate-200 bg-slate-100/30 p-3.5 dark:border-white/5 dark:bg-white/[0.01]">
            <p className="text-[10px] uppercase font-bold text-slate-400">Secondary (LLM Provider)</p>
            <div className="flex justify-between items-center mt-2">
              <span className="text-xs font-black text-slate-700 dark:text-slate-350">
                Requests: {d.modelManager?.models?.["gemini-2.5-flash-lite"]?.requestsToday || 0}
              </span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                d.modelManager?.models?.["gemini-2.5-flash-lite"]?.status === "HEALTHY" ? "bg-emerald-500/10 text-emerald-500" :
                d.modelManager?.models?.["gemini-2.5-flash-lite"]?.status === "HALF_OPEN" ? "bg-amber-500/10 text-amber-500" :
                d.modelManager?.models?.["gemini-2.5-flash-lite"]?.status === "DEGRADED" ? "bg-blue-500/10 text-blue-500" :
                "bg-rose-500/10 text-rose-500"
              }`}>
                {d.modelManager?.models?.["gemini-2.5-flash-lite"]?.status || "HEALTHY"}
              </span>
            </div>
            <p className="text-[10px] text-slate-400 mt-2 font-bold">Success Rate: {d.modelManager?.models?.["gemini-2.5-flash-lite"]?.successRate || "100"}%</p>
          </div>

          {/* Fallback Telemetry & Source */}
          <div className="rounded-xl border border-slate-200 bg-slate-100/30 p-3.5 dark:border-white/5 dark:bg-white/[0.01]">
            <p className="text-[10px] uppercase font-bold text-slate-400">Active Pipeline Routing</p>
            <div className="mt-2 space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Total Fallbacks:</span>
                <span className="font-black text-indigo-500">{d.modelManager?.fallbacksCount || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Cache Lookups:</span>
                <span className="font-black text-purple-500">{d.modelManager?.cacheAccessCount || 0}</span>
              </div>
              <div className="flex justify-between mt-1 pt-1 border-t border-slate-200/50 dark:border-white/5">
                <span className="text-slate-400">Active Source:</span>
                <span className="font-black text-teal-500">{d.modelManager?.mostUsedModel || "GEMINI_FLASH"}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Prompts and Response collapsible drawer */}
      <div className="mt-5 border-t border-slate-200/60 pt-4 dark:border-white/5 space-y-4">
        <h4 className="text-xs font-extrabold uppercase tracking-widest text-slate-500 flex items-center gap-1.5 dark:text-slate-400">
          <Code size={14} className="text-teal-500" />
          LLM Prompt & Response Inspector (Sampled QA / Contradiction)
        </h4>

        {/* Collapsible Prompt */}
        <div className="rounded-xl border border-slate-200/60 overflow-hidden dark:border-white/5 bg-slate-50/20">
          <button
            onClick={() => setPromptOpen(!promptOpen)}
            className="w-full flex items-center justify-between p-3.5 text-left text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.02]"
          >
            <span>Latest Sampled System Prompt</span>
            {promptOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {promptOpen && (
            <div className="p-4 border-t border-slate-200/60 dark:border-white/5 bg-[#080E1A] dark:bg-black/40">
              <pre className="text-[10px] leading-relaxed text-slate-300 font-mono overflow-x-auto whitespace-pre-wrap max-h-60">
                {d.latestPrompt}
              </pre>
            </div>
          )}
        </div>

        {/* Collapsible Raw Response */}
        <div className="rounded-xl border border-slate-200/60 overflow-hidden dark:border-white/5 bg-slate-50/20">
          <button
            onClick={() => setResponseOpen(!responseOpen)}
            className="w-full flex items-center justify-between p-3.5 text-left text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.02]"
          >
            <span>Latest Sampled Raw LLM Response</span>
            {responseOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {responseOpen && (
            <div className="p-4 border-t border-slate-200/60 dark:border-white/5 bg-[#080E1A] dark:bg-black/40">
              <pre className="text-[10px] leading-relaxed text-emerald-400 font-mono overflow-x-auto whitespace-pre-wrap max-h-60">
                {d.latestRawResponse}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default AiDiagnosticsCard;
