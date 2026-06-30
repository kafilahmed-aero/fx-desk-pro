import { useEffect, useState } from "react";
import { MessageSquare, RefreshCw, AlertCircle, AlertTriangle, CheckCircle, HelpCircle } from "lucide-react";
import { fetchWithCredentials } from "../services/apiClient";

function ChannelOperations() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchChannelData = () => {
    setRefreshing(true);
    fetchWithCredentials("/system/telegram")
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load channel operations: ${res.statusText}`);
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
    fetchChannelData();
  }, []);

  const getStatusBadge = (status) => {
    switch (status) {
      case "HEALTHY":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-bold text-emerald-500">
            <CheckCircle size={12} />
            HEALTHY
          </span>
        );
      case "DEGRADED":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-bold text-amber-500">
            <AlertTriangle size={12} />
            DEGRADED
          </span>
        );
      case "OFFLINE":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2.5 py-0.5 text-xs font-bold text-rose-500">
            <AlertCircle size={12} />
            OFFLINE
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/10 px-2.5 py-0.5 text-xs font-bold text-slate-500">
            <HelpCircle size={12} />
            UNRATED
          </span>
        );
    }
  };

  const getTierColorClass = (tier) => {
    switch (tier) {
      case "A+": return "text-indigo-500 font-bold";
      case "A": return "text-emerald-500 font-bold";
      case "B": return "text-blue-500 font-bold";
      case "C": return "text-amber-500 font-bold";
      case "D": return "text-rose-500 font-bold";
      default: return "text-slate-400";
    }
  };

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-sm font-semibold text-slate-500 dark:text-slate-400">
        Loading channel operations...
      </div>
    );
  }

  return (
    <div className="animate-dashboard-in">
      <div className="flex items-center justify-between">
        <div>
          <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            <MessageSquare size={16} />
            Telegram Sources
          </p>
          <h2 className="mt-2 text-3xl font-bold text-blue-500 dark:text-blue-400 sm:text-4xl">
            Channel Operations
          </h2>
        </div>
        <button
          onClick={fetchChannelData}
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
            Error Loading Channel Operations
          </p>
          <p className="mt-2 text-xs text-rose-500/90 dark:text-rose-400/80">{error}</p>
        </div>
      )}

      {data && (
        <>
          {/* Summary stats */}
          <div className="mt-8 grid gap-4 grid-cols-2 md:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Total Configured</span>
              <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{data.totalChannels}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Accessible / Connected</span>
              <p className="mt-1 text-2xl font-bold text-emerald-500">{data.accessibleChannels}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Failed / Restricted</span>
              <p className="mt-1 text-2xl font-bold text-rose-500">{data.failedChannels}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Last Poll Cycle</span>
              <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-200 truncate">
                {data.lastPollTimestamp ? new Date(data.lastPollTimestamp).toLocaleTimeString() : "Never"}
              </p>
            </div>
          </div>

          {/* Channel list */}
          <div className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-[#080e1b]/40">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50 text-slate-500 dark:border-white/5 dark:bg-white/[0.02]">
                    <th className="px-5 py-4 font-semibold">Channel Username / Ref</th>
                    <th className="px-5 py-4 font-semibold text-center">Status</th>
                    <th className="px-5 py-4 font-semibold text-center">Today's parsed</th>
                    <th className="px-5 py-4 font-semibold text-center">Today's noise</th>
                    <th className="px-5 py-4 font-semibold text-center">Accuracy</th>
                    <th className="px-5 py-4 font-semibold text-center">Reliability</th>
                    <th className="px-5 py-4 font-semibold text-center">Tier</th>
                    <th className="px-5 py-4 font-semibold text-right">Last message received</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {data.channels.map((ch) => (
                    <tr key={ch.ref} className="hover:bg-slate-50/50 dark:hover:bg-white/[0.02]">
                      <td className="px-5 py-4">
                        <span className="font-bold text-slate-800 dark:text-slate-100 block">@{ch.ref}</span>
                        {ch.lastMessageText && (
                          <span className="text-xs text-slate-400 dark:text-slate-500 block truncate max-w-xs mt-0.5">
                            {ch.lastMessageText}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-center">{getStatusBadge(ch.status)}</td>
                      <td className="px-5 py-4 text-center font-bold text-slate-800 dark:text-slate-200">
                        {ch.signalsToday}
                      </td>
                      <td className="px-5 py-4 text-center text-slate-500">
                        {ch.resultsToday}
                      </td>
                      <td className="px-5 py-4 text-center font-bold text-emerald-500">
                        {ch.parsingSuccessRate}%
                      </td>
                      <td className="px-5 py-4 text-center font-bold text-slate-800 dark:text-slate-200">
                        {ch.reliabilityScore !== null ? ch.reliabilityScore.toFixed(1) : "-"}
                      </td>
                      <td className="px-5 py-4 text-center font-bold">
                        <span className={getTierColorClass(ch.confidenceTier)}>{ch.confidenceTier}</span>
                      </td>
                      <td className="px-5 py-4 text-right text-xs text-slate-400 dark:text-slate-500 font-medium">
                        {ch.lastMessageReceived ? new Date(ch.lastMessageReceived).toLocaleString() : "Never"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default ChannelOperations;
