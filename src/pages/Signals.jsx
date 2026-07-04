import { useEffect, useState } from "react";
import { RadioTower, RefreshCw, AlertCircle } from "lucide-react";
import { getParsedSignals } from "../services/signalService";
import XauusdAiAdvisorCard from "../components/XauusdAiAdvisorCard";

function Signals() {
  const [signals, setSignals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const fetchSignalsData = async (showRefreshing = false) => {
    if (showRefreshing) setIsRefreshing(true);
    setRefreshTrigger((prev) => prev + 1);
    try {
      const data = await getParsedSignals();
      setSignals(data);
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load signals");
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    let isMounted = true;
    let isRequestActive = false;

    const load = async () => {
      if (isRequestActive) return;
      isRequestActive = true;
      setRefreshTrigger((prev) => prev + 1);
      try {
        const data = await getParsedSignals();
        if (isMounted) {
          setSignals(data);
          setError("");
        }
      } catch (err) {
        if (isMounted) {
          setError(err.message || "Failed to load signals");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
        isRequestActive = false;
      }
    };

    load();
    const interval = window.setInterval(load, 30000);

    return () => {
      isMounted = false;
      window.clearInterval(interval);
    };
  }, []);

  const formatTime = (dateStr) => {
    if (!dateStr) return "N/A";
    const date = new Date(dateStr);
    const today = new Date();
    const isToday =
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear();

    const timeStr = date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    if (isToday) {
      return timeStr;
    }

    const dateStrFormatted = date.toLocaleDateString([], {
      month: "short",
      day: "numeric",
    });
    return `${dateStrFormatted} ${timeStr}`;
  };

  const formatEntry = (entry, entryRange) => {
    if (Array.isArray(entryRange) && entryRange.length === 2) {
      return `${entryRange[0]}-${entryRange[1]}`;
    }
    return entry !== undefined && entry !== null ? entry : "N/A";
  };

  const formatTargets = (targets, remainingTargets, target) => {
    const getTargetPrice = (t) => {
      if (typeof t === "number") return t;
      if (t && typeof t === "object") {
        return t.price ?? t.target ?? JSON.stringify(t);
      }
      return t;
    };

    const targetsToUse =
      Array.isArray(remainingTargets) && remainingTargets.length > 0
        ? remainingTargets
        : targets;

    if (Array.isArray(targetsToUse) && targetsToUse.length > 0) {
      return targetsToUse
        .map(getTargetPrice)
        .filter((v) => v !== undefined && v !== null)
        .join(",");
    }

    return target !== undefined && target !== null ? target : "N/A";
  };

  const getStatusStyle = (state) => {
    const status = (state || "ACTIVE").toUpperCase();
    switch (status) {
      case "ACTIVE":
        return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20";
      case "PARTIAL":
        return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20";
      case "CLOSED":
        return "bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20";
      case "EXPIRED":
        return "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20";
      case "CANCELLED":
        return "bg-gray-500/10 text-gray-600 dark:text-gray-400 border border-gray-500/20";
      default:
        return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20";
    }
  };

  const getActionColor = (action) => {
    const act = (action || "").toUpperCase();
    if (act === "BUY") return "text-emerald-500 dark:text-emerald-400 font-bold";
    if (act === "SELL") return "text-rose-500 dark:text-rose-400 font-bold";
    return "text-slate-500 dark:text-slate-400";
  };

  if (loading && !isRefreshing) {
    return (
      <div className="animate-dashboard-in">
        <div className="flex items-center justify-between">
          <div>
            <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              <RadioTower size={16} />
              Signal Center
            </p>
            <h2 className="mt-2 text-3xl font-bold text-blue-500 dark:text-blue-400 sm:text-4xl">
              Signals
            </h2>
          </div>
        </div>
        <div className="mt-8 flex h-[40vh] items-center justify-center text-sm font-semibold text-slate-500 dark:text-slate-400">
          Loading signal inbox feed...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="animate-dashboard-in">
        <div className="flex items-center justify-between">
          <div>
            <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              <RadioTower size={16} />
              Signal Center
            </p>
            <h2 className="mt-2 text-3xl font-bold text-blue-500 dark:text-blue-400 sm:text-4xl">
              Signals
            </h2>
          </div>
          <button
            onClick={() => fetchSignalsData(true)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm shadow-slate-900/5 transition hover:bg-slate-50 active:scale-95 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-200 dark:hover:bg-white/10"
          >
            <RefreshCw size={18} />
          </button>
        </div>
        <div className="mt-8 rounded-2xl border border-rose-200 bg-rose-50 p-5 dark:border-rose-500/20 dark:bg-rose-500/10">
          <p className="flex items-center gap-2 text-sm font-bold text-rose-600 dark:text-rose-400">
            <AlertCircle size={18} />
            Error Loading Signals
          </p>
          <p className="mt-2 text-xs text-rose-500/90 dark:text-rose-400/80">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-dashboard-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            <RadioTower size={16} />
            Signal Center
          </p>
          <h2 className="mt-2 text-3xl font-bold text-blue-500 dark:text-blue-400 sm:text-4xl">
            Signals
          </h2>
        </div>
        <button
          onClick={() => fetchSignalsData(true)}
          disabled={isRefreshing}
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm shadow-slate-900/5 transition hover:bg-slate-50 active:scale-95 disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-200 dark:hover:bg-white/10"
          title="Refresh signal feed"
        >
          <RefreshCw size={18} className={isRefreshing ? "animate-spin" : ""} />
        </button>
      </div>

      {/* AI Advisor Card */}
      <div className="mt-8">
        <XauusdAiAdvisorCard refreshTrigger={refreshTrigger} />
      </div>

      {/* Feed Table container */}
      <div className="mt-8 overflow-hidden rounded-2xl border border-white/70 bg-white/75 shadow-xl shadow-slate-200/70 backdrop-blur-xl transition-colors duration-300 dark:border-white/10 dark:bg-white/[0.06] dark:shadow-black/10">
        <div className="overflow-x-auto">
          {signals.length === 0 ? (
            <div className="py-12 text-center text-slate-500 dark:text-slate-400 font-semibold text-sm">
              No parsed signals found in the database.
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/10 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-slate-50/50 dark:bg-black/10">
                  <th className="py-4 px-6">Time</th>
                  <th className="py-4 px-6">Channel</th>
                  <th className="py-4 px-6">Signal</th>
                  <th className="py-4 px-6">Values</th>
                  <th className="py-4 px-6 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5 text-sm">
                {signals.map((signal) => {
                  const entryText = formatEntry(signal.entry, signal.entryRange);
                  const tpText = formatTargets(
                    signal.targets,
                    signal.remainingTargets,
                    signal.target
                  );
                  const slText =
                    signal.effectiveStopLoss ?? signal.stopLoss ?? "N/A";
                  const valuesText = `Entry: ${entryText} | TP: ${tpText} | SL: ${slText}`;

                  return (
                    <tr
                      key={signal._id}
                      className="hover:bg-slate-50/40 dark:hover:bg-white/[0.02] transition-colors duration-150"
                    >
                      <td className="py-4 px-6 font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {formatTime(signal.createdAt || signal.timestamp)}
                      </td>
                      <td className="py-4 px-6 font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                        {signal.channelTitle || signal.channel}
                      </td>
                      <td className="py-4 px-6 whitespace-nowrap">
                        <span className="font-bold text-slate-900 dark:text-white mr-1.5">
                          {signal.pair}
                        </span>
                        <span className={getActionColor(signal.action)}>
                          {signal.action}
                        </span>
                      </td>
                      <td className="py-4 px-6 font-mono text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {valuesText}
                      </td>
                      <td className="py-4 px-6 text-center whitespace-nowrap">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider ${getStatusStyle(
                            signal.signalState || signal.signalStatus
                          )}`}
                        >
                          {signal.signalState ||
                            signal.signalStatus ||
                            "ACTIVE"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default Signals;
