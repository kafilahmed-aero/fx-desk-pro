import { useEffect, useState } from "react";
import { Shield, RefreshCw, AlertCircle, AlertTriangle, CheckCircle2, Activity } from "lucide-react";
import { fetchWithCredentials } from "../services/apiClient";

function ParserDiagnostics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchParserData = () => {
    setRefreshing(true);
    fetchWithCredentials("/system/parser")
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load parser diagnostics: ${res.statusText}`);
        }
        const json = await res.json();
        setData(json);
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
      fetchParserData();
    }, 0);
  }, []);

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-sm font-semibold text-slate-500 dark:text-slate-400">
        Loading parser diagnostics...
      </div>
    );
  }

  return (
    <div className="animate-dashboard-in">
      <div className="flex items-center justify-between">
        <div>
          <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            <Shield size={16} />
            Diagnostics & Integrity
          </p>
          <h2 className="mt-2 text-3xl font-bold text-blue-500 dark:text-blue-400 sm:text-4xl">
            Parser Diagnostics
          </h2>
        </div>
        <button
          onClick={fetchParserData}
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
            Error Loading Parser Diagnostics
          </p>
          <p className="mt-2 text-xs text-rose-500/90 dark:text-rose-400/80">{error}</p>
        </div>
      )}

      {data && (
        <>
          {/* Parser metrics widgets */}
          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                  Successfully Parsed Today
                </span>
                <CheckCircle2 className="text-emerald-500" size={18} />
              </div>
              <p className="mt-2 text-3xl font-bold text-slate-900 dark:text-white">
                {data.parsedTodayCount}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                  Parsing Success Rate
                </span>
                <Activity className="text-blue-500" size={18} />
              </div>
              <p className="mt-2 text-3xl font-bold text-blue-500">
                {data.successPercentage}%
              </p>
            </div>
          </div>

          <div className="mt-8 grid gap-8 lg:grid-cols-2">
            {/* Suspicious active/partial signals */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
              <h3 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
                <AlertTriangle className="text-amber-500" size={20} />
                Suspicious Active Signals (<span className="text-slate-500">{data.suspiciousSignals.length}</span>)
              </h3>
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                Active signals with impossible values (e.g. entry/targets/SL &lt;= 10)
              </p>

              <div className="mt-4 space-y-4 max-h-[400px] overflow-y-auto pr-1">
                {data.suspiciousSignals.length === 0 ? (
                  <p className="text-sm font-semibold text-emerald-500 text-center py-8">
                    ✓ 0 suspicious active signals found. Consensus state is clean.
                  </p>
                ) : (
                  data.suspiciousSignals.map((sig) => (
                    <div key={sig.id} className="rounded-xl border border-amber-100 bg-amber-50/30 p-3.5 dark:border-amber-500/10 dark:bg-amber-500/[0.02]">
                      <div className="flex justify-between items-start">
                        <span className="font-bold text-slate-800 dark:text-slate-100 text-sm">@{sig.channel}</span>
                        <span className="text-xs text-rose-500 font-bold bg-rose-500/10 rounded-full px-2 py-0.5">
                          {sig.pair}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-slate-400 dark:text-slate-500 italic truncate max-w-full">
                        "{sig.rawText}"
                      </p>
                      <div className="mt-2 flex gap-4 text-xs font-semibold text-slate-600 dark:text-slate-400">
                        <span>Entry: {sig.entry}</span>
                        <span>SL: {sig.stopLoss}</span>
                        <span>TPs: {sig.targets.join(", ")}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Unparsed candidate signals */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
              <h3 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
                <AlertCircle className="text-blue-500" size={20} />
                Unparsed Candidates (<span className="text-slate-500">{data.unparsedCandidates.length}</span>)
              </h3>
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                Messages containing signal keywords (BUY/SELL/GOLD) that were skipped
              </p>

              <div className="mt-4 space-y-4 max-h-[400px] overflow-y-auto pr-1">
                {data.unparsedCandidates.length === 0 ? (
                  <p className="text-sm font-semibold text-slate-500 text-center py-8">
                    No unparsed candidate messages logged today.
                  </p>
                ) : (
                  data.unparsedCandidates.map((cand, idx) => (
                    <div key={idx} className="rounded-xl border border-slate-100 bg-slate-50/50 p-3.5 dark:border-white/5 dark:bg-white/[0.02]">
                      <div className="flex justify-between items-start">
                        <span className="font-bold text-slate-800 dark:text-slate-200 text-sm">@{cand.channel}</span>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500">
                          {new Date(cand.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-slate-700 dark:text-slate-300 font-medium whitespace-pre-line">
                        {cand.rawText}
                      </p>
                      <p className="mt-2 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                        Reason: {cand.failureReason}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default ParserDiagnostics;
