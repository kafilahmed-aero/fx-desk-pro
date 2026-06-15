import { useEffect, useState } from "react";
import { Activity, AlertCircle, CheckCircle2, ShieldAlert, TrendingUp, Clock, HelpCircle } from "lucide-react";
import { fetchWithCredentials } from "../services/apiClient";

function PairPerformance() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;
    
    fetchWithCredentials("/pair-performance")
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load data: ${res.statusText}`);
        }
        const json = await res.json();
        if (isMounted) {
          // Sort results based on the specifications:
          // 1. isEligible DESC
          // 2. winRate DESC
          // 3. completedSignals DESC
          const sorted = [...json].sort((a, b) => {
            const eligibleA = a.isEligible ? 1 : 0;
            const eligibleB = b.isEligible ? 1 : 0;
            if (eligibleA !== eligibleB) {
              return eligibleB - eligibleA;
            }
            if (a.winRate !== b.winRate) {
              return b.winRate - a.winRate;
            }
            return b.completedSignals - a.completedSignals;
          });
          setData(sorted);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const getWinRateColorClass = (winRate) => {
    const rate = winRate * 100;
    if (rate >= 60) {
      return "text-emerald-600 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-500/10 dark:border-emerald-500/20";
    }
    if (rate >= 45) {
      return "text-amber-600 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-500/10 dark:border-amber-500/20";
    }
    return "text-rose-600 bg-rose-50 border-rose-200 dark:text-rose-400 dark:bg-rose-500/10 dark:border-rose-500/20";
  };

  const formatPercentage = (val) => {
    return `${(val * 100).toFixed(1)}%`;
  };

  const formatDuration = (val) => {
    if (val === 0 || !val) return "-";
    if (val < 60) return `${val.toFixed(0)}m`;
    const hours = val / 60;
    return `${hours.toFixed(1)}h`;
  };

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-sm font-semibold text-slate-500 dark:text-slate-400">
        Loading pair performance data...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 dark:border-rose-500/20 dark:bg-rose-500/10">
        <p className="flex items-center gap-2 text-sm font-bold text-rose-600 dark:text-rose-400">
          <AlertCircle size={18} />
          Error Loading Pair Performance Page
        </p>
        <p className="mt-2 text-xs text-rose-500/90 dark:text-rose-400/80">{error}</p>
      </div>
    );
  }

  return (
    <div className="animate-dashboard-in">
      <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
        <Activity size={16} />
        Asset Performance Audit
      </p>
      <h2 className="mt-2 text-3xl font-bold text-blue-500 dark:text-blue-400 sm:text-4xl">
        Pair Performance
      </h2>
      
      {/* Informative Banner */}
      <div className="mt-6 flex flex-col gap-4 rounded-2xl border border-blue-100 bg-blue-50/50 p-4 dark:border-blue-500/10 dark:bg-blue-950/20 sm:flex-row sm:items-start">
        <HelpCircle size={20} className="shrink-0 text-blue-500 mt-0.5" />
        <div className="text-xs leading-5 text-slate-600 dark:text-slate-300">
          <span className="font-bold">Asset-Level Eligibility:</span> A channel must reach at least <strong>20 completed signals</strong> for a specific trading pair before it is marked as <strong>Eligible</strong>. Non-eligible pairs are sorted to the bottom. Win Rate colors are coded as Green (≥ 60%), Yellow (45% - 59%), and Red (&lt; 45%). Asset aliases (e.g. GOLD vs XAUUSD) are automatically normalized and consolidated.
        </div>
      </div>

      <div className="mt-8 overflow-hidden rounded-2xl border border-white/70 bg-white/75 shadow-xl shadow-slate-200/70 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.06] dark:shadow-black/10">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/50 text-xs font-bold uppercase tracking-wider text-slate-500 dark:border-white/10 dark:bg-white/[0.02] dark:text-slate-400">
                <th className="px-5 py-4">Channel</th>
                <th className="px-5 py-4">Pair</th>
                <th className="px-5 py-4">Eligibility</th>
                <th className="px-5 py-4 text-center">Win Rate</th>
                <th className="px-5 py-4 text-center">Signals</th>
                <th className="px-5 py-4 text-center">Completed</th>
                <th className="px-5 py-4 text-center">Full TP</th>
                <th className="px-5 py-4 text-center">Partial TP</th>
                <th className="px-5 py-4 text-center">Stop Loss</th>
                <th className="px-5 py-4 text-center">Expired</th>
                <th className="px-5 py-4 text-right">Avg TP Time</th>
                <th className="px-5 py-4 text-right">Avg SL Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/65 dark:divide-white/5">
              {data.length === 0 ? (
                <tr>
                  <td colSpan="12" className="px-5 py-8 text-center text-xs font-medium text-slate-400 dark:text-slate-500">
                    No pair performance records available.
                  </td>
                </tr>
              ) : (
                data.map((item) => (
                  <tr 
                    key={item.channelPairKey} 
                    className="transition hover:bg-slate-50/40 dark:hover:bg-white/[0.02]"
                  >
                    <td className="px-5 py-4.5 font-bold text-slate-900 dark:text-white">
                      {item.channel}
                    </td>
                    <td className="px-5 py-4.5 font-semibold text-blue-600 dark:text-blue-400">
                      {item.pair}
                    </td>
                    <td className="px-5 py-4.5">
                      {item.isEligible ? (
                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2 py-1 text-xs font-bold text-emerald-500">
                          <CheckCircle2 size={13} />
                          Eligible
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-500/10 px-2 py-1 text-xs font-bold text-slate-500">
                          <ShieldAlert size={13} />
                          Pending ({(item.completedSignals || 0)}/{(item.minimumSignalsRequired || 20)})
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4.5 text-center">
                      <span className={`inline-block border rounded-lg px-2.5 py-1 text-xs font-bold shadow-sm ${getWinRateColorClass(item.winRate)}`}>
                        {formatPercentage(item.winRate)}
                      </span>
                    </td>
                    <td className="px-5 py-4.5 text-center font-semibold text-slate-700 dark:text-slate-300">
                      {item.totalSignals}
                    </td>
                    <td className="px-5 py-4.5 text-center font-semibold text-slate-700 dark:text-slate-300">
                      {item.completedSignals}
                    </td>
                    <td className="px-5 py-4.5 text-center font-semibold text-emerald-500">
                      {item.fullTpCount}
                    </td>
                    <td className="px-5 py-4.5 text-center font-semibold text-amber-500">
                      {item.partialTpCount}
                    </td>
                    <td className="px-5 py-4.5 text-center font-semibold text-rose-500">
                      {item.slHitCount}
                    </td>
                    <td className="px-5 py-4.5 text-center font-semibold text-slate-500">
                      {item.expiredCount}
                    </td>
                    <td className="px-5 py-4.5 text-right font-medium text-slate-600 dark:text-slate-400">
                      <span className="inline-flex items-center gap-1">
                        <TrendingUp size={12} className="text-emerald-500" />
                        {formatDuration(item.avgTpDurationMinutes)}
                      </span>
                    </td>
                    <td className="px-5 py-4.5 text-right font-medium text-slate-600 dark:text-slate-400">
                      <span className="inline-flex items-center gap-1">
                        <Clock size={12} className="text-rose-500" />
                        {formatDuration(item.avgSlDurationMinutes)}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default PairPerformance;
