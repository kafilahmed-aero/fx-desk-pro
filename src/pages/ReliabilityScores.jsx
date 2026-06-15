import { useEffect, useState } from "react";
import { Award, AlertCircle, CheckCircle2, ShieldAlert, TrendingUp, HelpCircle } from "lucide-react";
import { fetchWithCredentials } from "../services/apiClient";

function ReliabilityScores() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;
    
    fetchWithCredentials("/reliability-scores")
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

  const getTierColorClass = (tier) => {
    switch (tier) {
      case "A+":
        return "text-indigo-600 bg-indigo-50 border-indigo-200 dark:text-indigo-400 dark:bg-indigo-500/10 dark:border-indigo-500/20";
      case "A":
        return "text-emerald-600 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-500/10 dark:border-emerald-500/20";
      case "B":
        return "text-blue-600 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-500/10 dark:border-blue-500/20";
      case "C":
        return "text-amber-600 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-500/10 dark:border-amber-500/20";
      case "D":
        return "text-rose-600 bg-rose-50 border-rose-200 dark:text-rose-400 dark:bg-rose-500/10 dark:border-rose-500/20";
      default: // UNRATED
        return "text-slate-600 bg-slate-50 border-slate-200 dark:text-slate-400 dark:bg-slate-500/10 dark:border-slate-500/20";
    }
  };

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

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-sm font-semibold text-slate-500 dark:text-slate-400">
        Loading reliability scores...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 dark:border-rose-500/20 dark:bg-rose-500/10">
        <p className="flex items-center gap-2 text-sm font-bold text-rose-600 dark:text-rose-400">
          <AlertCircle size={18} />
          Error Loading Reliability Scores Page
        </p>
        <p className="mt-2 text-xs text-rose-500/90 dark:text-rose-400/80">{error}</p>
      </div>
    );
  }

  return (
    <div className="animate-dashboard-in">
      <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
        <Award size={16} />
        Signal Reliability Metrics
      </p>
      <h2 className="mt-2 text-3xl font-bold text-blue-500 dark:text-blue-400 sm:text-4xl">
        Reliability Scores
      </h2>
      
      {/* Informative Banner */}
      <div className="mt-6 flex flex-col gap-4 rounded-2xl border border-blue-100 bg-blue-50/50 p-4 dark:border-blue-500/10 dark:bg-blue-950/20 sm:flex-row sm:items-start">
        <HelpCircle size={20} className="shrink-0 text-blue-500 mt-0.5" />
        <div className="text-xs leading-5 text-slate-600 dark:text-slate-300">
          <span className="font-bold">Scoring Engine Details:</span> Computes a normalized score (0-100) using:
          <br />
          <code>reliabilityScore = (winRate * 50% + targetAchievement * 25% + (1 - expiryRate) * 15% + volumeFactor * 10%) * 100</code>
          <br />
          Tiers: A+ (≥90), A (80-89.9), B (70-79.9), C (60-69.9), D (&lt;60). Channels with less than 20 completed signals are flagged as <strong>UNRATED</strong> to ensure statistical reliability.
        </div>
      </div>

      <div className="mt-8 overflow-hidden rounded-2xl border border-white/70 bg-white/75 shadow-xl shadow-slate-200/70 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.06] dark:shadow-black/10">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/50 text-xs font-bold uppercase tracking-wider text-slate-500 dark:border-white/10 dark:bg-white/[0.02] dark:text-slate-400">
                <th className="px-5 py-4">Channel</th>
                <th className="px-5 py-4 text-center">Reliability Score</th>
                <th className="px-5 py-4 text-center">Confidence Tier</th>
                <th className="px-5 py-4">Eligibility</th>
                <th className="px-5 py-4 text-center">Completed</th>
                <th className="px-5 py-4 text-center">Win Rate</th>
                <th className="px-5 py-4 text-center">Target Achievement</th>
                <th className="px-5 py-4 text-center">Expiry Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/65 dark:divide-white/5">
              {data.length === 0 ? (
                <tr>
                  <td colSpan="8" className="px-5 py-8 text-center text-xs font-medium text-slate-400 dark:text-slate-500">
                    No reliability score records available.
                  </td>
                </tr>
              ) : (
                data.map((item) => (
                  <tr 
                    key={item.channel} 
                    className="transition hover:bg-slate-50/40 dark:hover:bg-white/[0.02]"
                  >
                    <td className="px-5 py-4.5 font-bold text-slate-900 dark:text-white">
                      {item.channel}
                    </td>
                    <td className="px-5 py-4.5 text-center">
                      <span className="inline-flex items-center gap-1 text-sm font-extrabold text-blue-600 dark:text-blue-400">
                        <TrendingUp size={14} className="text-blue-500" />
                        {item.reliabilityScore.toFixed(1)}
                      </span>
                    </td>
                    <td className="px-5 py-4.5 text-center">
                      <span className={`inline-block border rounded-lg px-2.5 py-1 text-xs font-extrabold shadow-sm ${getTierColorClass(item.confidenceTier)}`}>
                        {item.confidenceTier}
                      </span>
                    </td>
                    <td className="px-5 py-4.5">
                      {item.isReliabilityEligible ? (
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
                    <td className="px-5 py-4.5 text-center font-semibold text-slate-700 dark:text-slate-300">
                      {item.completedSignals}
                    </td>
                    <td className="px-5 py-4.5 text-center">
                      <span className={`inline-block border rounded-lg px-2.5 py-1 text-xs font-bold shadow-sm ${getWinRateColorClass(item.winRate)}`}>
                        {formatPercentage(item.winRate)}
                      </span>
                    </td>
                    <td className="px-5 py-4.5 text-center font-semibold text-slate-700 dark:text-slate-300">
                      {formatPercentage(item.targetAchievementRate)}
                    </td>
                    <td className="px-5 py-4.5 text-center font-semibold text-slate-500">
                      {formatPercentage(item.expiryRate)}
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

export default ReliabilityScores;
