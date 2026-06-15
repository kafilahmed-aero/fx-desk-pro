import { useEffect, useState } from "react";
import { Shield, AlertCircle, CheckCircle2, ShieldAlert, Calendar, BarChart3, HelpCircle } from "lucide-react";
import { fetchWithCredentials } from "../services/apiClient";

function IntelligenceReadiness() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;
    
    fetchWithCredentials("/outcome-summary")
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load data: ${res.statusText}`);
        }
        const json = await res.json();
        if (isMounted) {
          setData(json);
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

  const getReadinessBanner = (level) => {
    switch (level) {
      case "HIGH":
        return {
          title: "High Statistical Readiness",
          desc: "Sufficient historical outcomes have been collected. Weighted consensus is recommended to be activated.",
          colorClass: "border-emerald-200 bg-emerald-50 dark:border-emerald-500/20 dark:bg-emerald-950/20",
          textClass: "text-emerald-800 dark:text-emerald-400",
          iconColor: "text-emerald-500",
          badge: "bg-emerald-500 text-white"
        };
      case "MEDIUM":
        return {
          title: "Medium Statistical Readiness",
          desc: "Partial historical outcomes collected. Gathering more evidence. Weighted consensus is not recommended yet.",
          colorClass: "border-amber-200 bg-amber-50 dark:border-amber-500/20 dark:bg-amber-950/20",
          textClass: "text-amber-800 dark:text-amber-400",
          iconColor: "text-amber-500",
          badge: "bg-amber-500 text-white"
        };
      default: // LOW
        return {
          title: "Low Statistical Readiness",
          desc: "Insufficient historical outcomes collected. Keep collecting signal history to build confidence.",
          colorClass: "border-rose-200 bg-rose-50 dark:border-rose-500/20 dark:bg-rose-950/20",
          textClass: "text-rose-800 dark:text-rose-400",
          iconColor: "text-rose-500",
          badge: "bg-rose-500 text-white"
        };
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return "-";
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  };

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-sm font-semibold text-slate-500 dark:text-slate-400">
        Loading intelligence readiness metrics...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 dark:border-rose-500/20 dark:bg-rose-500/10">
        <p className="flex items-center gap-2 text-sm font-bold text-rose-600 dark:text-rose-400">
          <AlertCircle size={18} />
          Error Loading Intelligence Readiness Page
        </p>
        <p className="mt-2 text-xs text-rose-500/90 dark:text-rose-400/80">{error}</p>
      </div>
    );
  }

  const banner = getReadinessBanner(data.readinessLevel);

  return (
    <div className="animate-dashboard-in">
      <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
        <Shield size={16} />
        Consensus Safety Audit
      </p>
      <h2 className="mt-2 text-3xl font-bold text-blue-500 dark:text-blue-400 sm:text-4xl">
        Intelligence Readiness
      </h2>

      {/* Readiness Level Banner */}
      <div className={`mt-6 rounded-2xl border p-5 backdrop-blur-xl ${banner.colorClass}`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3">
            <CheckCircle2 size={24} className={`shrink-0 mt-0.5 ${banner.iconColor}`} />
            <div>
              <h3 className={`text-lg font-bold ${banner.textClass}`}>{banner.title}</h3>
              <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">
                {banner.desc}
              </p>
            </div>
          </div>
          <div className="shrink-0">
            <span className={`inline-block rounded-xl px-3.5 py-1 text-xs font-black uppercase tracking-wider ${banner.badge}`}>
              Readiness: {data.readinessLevel}
            </span>
          </div>
        </div>
        
        {/* Consensus Recommendation Banner Addition */}
        <div className="mt-4 border-t border-slate-200/50 pt-3 dark:border-white/10 flex items-center justify-between text-xs">
          <span className="font-semibold text-slate-500 dark:text-slate-400">Weighted Consensus Recommended:</span>
          {data.weightedConsensusRecommended ? (
            <span className="font-extrabold text-emerald-500 bg-emerald-500/10 px-2.5 py-0.5 rounded-lg border border-emerald-500/20">RECOMMENDED</span>
          ) : (
            <span className="font-extrabold text-slate-500 bg-slate-500/10 px-2.5 py-0.5 rounded-lg border border-slate-500/20">NOT RECOMMENDED</span>
          )}
        </div>
      </div>

      {/* Statistics Grid */}
      <div className="mt-8 grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-white/70 bg-white/75 p-5 shadow-lg shadow-slate-200/50 dark:border-white/10 dark:bg-white/[0.04] dark:shadow-none">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Total Tracked Signals</p>
          <p className="mt-2 text-3xl font-extrabold text-slate-900 dark:text-white">{data.totalSignalsTracked}</p>
          <div className="mt-2 text-xxs text-slate-500 dark:text-slate-400 flex justify-between">
            <span>Active: {data.activeSignals}</span>
            <span>Completed: {data.completedSignals}</span>
          </div>
        </div>
        
        <div className="rounded-2xl border border-white/70 bg-white/75 p-5 shadow-lg shadow-slate-200/50 dark:border-white/10 dark:bg-white/[0.04] dark:shadow-none">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Eligible Channels</p>
          <p className="mt-2 text-3xl font-extrabold text-slate-900 dark:text-white">{data.reliabilityEligibleChannels}</p>
          <p className="mt-2 text-xxs text-slate-500 dark:text-slate-400">Ineligible: {data.reliabilityIneligibleChannels} (Pending &lt; 20 signals)</p>
        </div>

        <div className="rounded-2xl border border-white/70 bg-white/75 p-5 shadow-lg shadow-slate-200/50 dark:border-white/10 dark:bg-white/[0.04] dark:shadow-none">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Eligible Channel-Pairs</p>
          <p className="mt-2 text-3xl font-extrabold text-slate-900 dark:text-white">{data.pairEligibleRecords}</p>
          <p className="mt-2 text-xxs text-slate-500 dark:text-slate-400">Ineligible: {data.pairIneligibleRecords} (Pending &lt; 20 signals)</p>
        </div>

        <div className="rounded-2xl border border-white/70 bg-white/75 p-5 shadow-lg shadow-slate-200/50 dark:border-white/10 dark:bg-white/[0.04] dark:shadow-none">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Confidence Criteria</p>
          <div className="mt-3 space-y-1.5 text-xxs font-semibold text-slate-700 dark:text-slate-300">
            <div className="flex justify-between">
              <span>Completed Outcomes (({data.completedSignals})/50+)</span>
              <span>{data.completedSignals >= 50 ? "✅" : "⚠️"}</span>
            </div>
            <div className="flex justify-between">
              <span>Eligible Channels (({data.reliabilityEligibleChannels})/1+)</span>
              <span>{data.reliabilityEligibleChannels >= 1 ? "✅" : "⚠️"}</span>
            </div>
            <div className="flex justify-between">
              <span>Eligible Pairs (({data.pairEligibleRecords})/2+)</span>
              <span>{data.pairEligibleRecords >= 2 ? "✅" : "⚠️"}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Outcome count distributions */}
      <div className="mt-6 rounded-2xl border border-white/70 bg-white/75 p-5 shadow-lg shadow-slate-200/50 dark:border-white/10 dark:bg-white/[0.04]">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
          <BarChart3 size={15} />
          Outcome Count Distributions
        </h3>
        <div className="mt-4 grid gap-4 grid-cols-2 md:grid-cols-5 text-center">
          <div className="rounded-xl border border-emerald-100 bg-emerald-500/5 p-3 dark:border-emerald-500/10">
            <span className="block text-xxs font-extrabold uppercase tracking-wide text-emerald-500">Full TP</span>
            <span className="block mt-1.5 text-xl font-black text-slate-900 dark:text-white">{data.fullTpCount}</span>
          </div>
          <div className="rounded-xl border border-amber-100 bg-amber-500/5 p-3 dark:border-amber-500/10">
            <span className="block text-xxs font-extrabold uppercase tracking-wide text-amber-500">Partial TP</span>
            <span className="block mt-1.5 text-xl font-black text-slate-900 dark:text-white">{data.partialTpCount}</span>
          </div>
          <div className="rounded-xl border border-rose-100 bg-rose-500/5 p-3 dark:border-rose-500/10">
            <span className="block text-xxs font-extrabold uppercase tracking-wide text-rose-500">Stop Loss</span>
            <span className="block mt-1.5 text-xl font-black text-slate-900 dark:text-white">{data.slHitCount}</span>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-500/5 p-3 dark:border-slate-500/10">
            <span className="block text-xxs font-extrabold uppercase tracking-wide text-slate-500">Expired</span>
            <span className="block mt-1.5 text-xl font-black text-slate-900 dark:text-white">{data.expiredCount}</span>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-500/5 p-3 dark:border-slate-500/10">
            <span className="block text-xxs font-extrabold uppercase tracking-wide text-slate-500">Cancelled</span>
            <span className="block mt-1.5 text-xl font-black text-slate-900 dark:text-white">{data.cancelledCount}</span>
          </div>
        </div>
      </div>

      {/* Historical coverage per channel */}
      <div className="mt-6 overflow-hidden rounded-2xl border border-white/70 bg-white/75 shadow-xl shadow-slate-200/70 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.06] dark:shadow-black/10">
        <div className="px-5 py-4 bg-slate-50/50 border-b border-slate-200 dark:bg-white/[0.02] dark:border-white/10 flex items-center gap-1.5">
          <Calendar size={15} className="text-slate-500" />
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Historical Coverage Per Channel</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/25 text-xs font-bold uppercase tracking-wider text-slate-500 dark:border-white/5 dark:bg-white/[0.01] dark:text-slate-400">
                <th className="px-5 py-4">Channel</th>
                <th className="px-5 py-4">First Signal Date</th>
                <th className="px-5 py-4">Latest Signal Date</th>
                <th className="px-5 py-4 text-right">Completed Outcomes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/65 dark:divide-white/5">
              {data.historicalCoverage.length === 0 ? (
                <tr>
                  <td colSpan="4" className="px-5 py-8 text-center text-xs font-medium text-slate-400 dark:text-slate-500">
                    No historical channel signal outcomes available.
                  </td>
                </tr>
              ) : (
                data.historicalCoverage.map((item) => (
                  <tr 
                    key={item.channel} 
                    className="transition hover:bg-slate-50/40 dark:hover:bg-white/[0.02]"
                  >
                    <td className="px-5 py-4.5 font-bold text-slate-900 dark:text-white">
                      {item.channel}
                    </td>
                    <td className="px-5 py-4.5 text-slate-600 dark:text-slate-400">
                      {formatDate(item.firstSignalDate)}
                    </td>
                    <td className="px-5 py-4.5 text-slate-600 dark:text-slate-400">
                      {formatDate(item.latestSignalDate)}
                    </td>
                    <td className="px-5 py-4.5 text-right font-semibold text-blue-600 dark:text-blue-400">
                      {item.completedSignals}
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

export default IntelligenceReadiness;
