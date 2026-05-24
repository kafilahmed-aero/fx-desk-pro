import { useEffect, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  Cpu,
  Gauge,
  LineChart,
  Radio,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import PairCard from "../components/PairCard";
import { useTheme } from "../context/ThemeContext";
import {
  getChartData,
  getForexPairs,
  getRecentSignals,
} from "../services/signalService";

const activityTemplates = [
  { message: "New GOLD BUY signal detected", type: "buy" },
  { message: "EURUSD confidence increased", type: "confidence" },
  { message: "USDJPY target reached", type: "target" },
  { message: "GBPUSD strength crossed 55%", type: "confidence" },
  { message: "GOLD spread tightened", type: "market" },
  { message: "USDJPY SELL pressure rising", type: "sell" },
];

function Dashboard() {
  const { isDark } = useTheme();
  const [pairs, setPairs] = useState([]);
  const [liveSignals, setLiveSignals] = useState([]);
  const [signalChartData, setSignalChartData] = useState([]);
  const [strengthChartData, setStrengthChartData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activityFeed, setActivityFeed] = useState([
    {
      message: "New GOLD BUY signal detected",
      type: "buy",
      time: "Now",
    },
    {
      message: "EURUSD confidence increased",
      type: "confidence",
      time: "12s ago",
    },
    {
      message: "USDJPY target reached",
      type: "target",
      time: "34s ago",
    },
  ]);

  const totalSignals = pairs.length;
  const buySignals = pairs.filter((pair) => pair.color === "green").length;
  const sellSignals = pairs.filter((pair) => pair.color === "red").length;
  const bullishPairs = pairs.filter((pair) => pair.color === "green");
  const bearishPairs = pairs.filter((pair) => pair.color === "red");
  const buySignalStrength = bullishPairs.reduce(
    (total, pair) => total + pair.percentage,
    0
  );
  const sellSignalStrength = bearishPairs.reduce(
    (total, pair) => total + pair.percentage,
    0
  );
  const totalSignalStrength = buySignalStrength + sellSignalStrength;
  const consensusScore = totalSignalStrength
    ? ((buySignalStrength - sellSignalStrength) / totalSignalStrength) * 100
    : 0;
  const consensusConfidence = totalSignalStrength
    ? Math.min(100, Math.round(Math.abs(consensusScore) + 52))
    : 0;
  const marketDirection =
    consensusScore >= 35
      ? "Strong Buy"
      : consensusScore >= 10
      ? "Buy"
      : consensusScore > -10
      ? "Neutral"
      : consensusScore > -35
      ? "Sell"
      : "Strong Sell";
  const strongestBullishPair = bullishPairs.reduce(
    (strongest, pair) =>
      pair.percentage > strongest.percentage ? pair : strongest,
    { name: "-", percentage: 0 }
  );
  const strongestBearishPair = bearishPairs.reduce(
    (strongest, pair) =>
      pair.percentage > strongest.percentage ? pair : strongest,
    { name: "-", percentage: 0 }
  );
  const isBullishConsensus = consensusScore > 9;
  const isBearishConsensus = consensusScore < -9;
  const consensusTone = isBullishConsensus
    ? isDark
      ? "text-green-400"
      : "text-emerald-700"
    : isBearishConsensus
    ? isDark
      ? "text-red-400"
      : "text-rose-700"
    : isDark
    ? "text-blue-400"
    : "text-blue-700";
  const consensusGlow = isBullishConsensus
    ? isDark
      ? "from-green-400/20 via-emerald-400/10 to-cyan-400/10 shadow-green-400/10"
      : "from-emerald-50 via-white to-sky-50 shadow-slate-900/5"
    : isBearishConsensus
    ? isDark
      ? "from-red-400/20 via-rose-400/10 to-orange-400/10 shadow-red-400/10"
      : "from-rose-50 via-white to-orange-50 shadow-slate-900/5"
    : isDark
    ? "from-blue-400/20 via-cyan-400/10 to-slate-400/10 shadow-blue-400/10"
    : "from-blue-50 via-white to-slate-50 shadow-slate-900/5";
  const marketSummary = isBullishConsensus
    ? `Current market sentiment indicates bullish momentum driven by ${strongestBullishPair.name} and broad buy-side strength.`
    : isBearishConsensus
    ? `Current market sentiment indicates bearish pressure led by ${strongestBearishPair.name} and elevated sell-side confidence.`
    : `Current market sentiment is balanced, with ${strongestBullishPair.name} bullish strength offset by ${strongestBearishPair.name} sell pressure.`;
  const strongestPair = pairs.reduce(
    (strongest, pair) =>
      pair.percentage > strongest.percentage ? pair : strongest,
    { name: "-", percentage: 0 }
  );

  const stats = [
    { label: "Total Signals", value: totalSignals, accent: "text-blue-400", icon: Zap },
    { label: "Buy Signals", value: buySignals, accent: "text-green-400", icon: TrendingUp },
    { label: "Sell Signals", value: sellSignals, accent: "text-red-400", icon: TrendingDown },
    {
      label: "Strongest Pair",
      value: strongestPair.name,
      accent: "text-cyan-300",
      icon: Gauge,
    },
  ];
  const skeletonStats = [
    "Total Signals",
    "Buy Signals",
    "Sell Signals",
    "Strongest Pair",
  ];
  const chartTooltipStyle = {
    backgroundColor: isDark ? "#111827" : "#ffffff",
    border: isDark
      ? "1px solid rgba(255, 255, 255, 0.1)"
      : "1px solid rgb(226, 232, 240)",
    borderRadius: "8px",
    color: isDark ? "#fff" : "#0F172A",
  };
  const chartTickColor = isDark ? "#94A3B8" : "#64748B";
  const getConfidenceColor = (confidence) => {
    if (confidence >= 75) {
      return "text-green-400";
    }

    if (confidence >= 60) {
      return "text-blue-300";
    }

    return "text-amber-300";
  };
  const getStatusClasses = (status) => {
    if (status === "Hit Target") {
      return "border-green-400/20 bg-green-400/10 text-green-300";
    }

    if (status === "Expired") {
      return "border-slate-500/20 bg-slate-500/10 text-slate-300";
    }

    return "border-blue-400/20 bg-blue-400/10 text-blue-300";
  };
  const getActivityClasses = (type) => {
    if (type === "buy" || type === "target") {
      return "border-green-400/20 bg-green-400/10 text-green-400";
    }

    if (type === "sell") {
      return "border-red-400/20 bg-red-400/10 text-red-400";
    }

    return "border-blue-400/20 bg-blue-400/10 text-blue-400 dark:text-blue-300";
  };

  useEffect(() => {
    const loadDashboardData = async () => {
      const [forexPairs, recentSignals, chartData] = await Promise.all([
        getForexPairs(),
        getRecentSignals(),
        getChartData(),
      ]);

      setPairs(forexPairs);
      setLiveSignals(recentSignals);
      setSignalChartData(chartData.signalChartData);
      setStrengthChartData(chartData.strengthChartData);
      setIsLoading(false);
    };

    loadDashboardData();
  }, []);

  useEffect(() => {
    if (isLoading || liveSignals.length === 0) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setLiveSignals((signals) => {
        const signalIndex = Math.floor(Math.random() * signals.length);

        return signals.map((signal, index) => {
          if (index !== signalIndex) {
            return signal;
          }

          const direction = Math.random() > 0.5 ? 1 : -1;
          const change = Math.floor(Math.random() * 5) + 1;
          const confidence = Math.min(
            95,
            Math.max(45, signal.confidence + direction * change)
          );

          return { ...signal, confidence };
        });
      });
    }, 3500);

    return () => window.clearInterval(intervalId);
  }, [isLoading, liveSignals.length]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const nextActivity =
        activityTemplates[Math.floor(Math.random() * activityTemplates.length)];

      setActivityFeed((items) => [
        {
          ...nextActivity,
          time: "Now",
        },
        ...items.slice(0, 4).map((item, index) => ({
          ...item,
          time: index === 0 ? "8s ago" : item.time,
        })),
      ]);
    }, 4200);

    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <>
      <div className="animate-dashboard-in mb-8 flex min-w-0 flex-col gap-4 rounded-3xl border border-white/60 bg-white/70 p-5 shadow-xl shadow-slate-200/60 backdrop-blur-2xl dark:border-white/10 dark:bg-white/[0.06] dark:shadow-black/10 sm:flex-row sm:items-end sm:justify-between xl:mb-10">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            <LineChart size={16} />
            Market Overview
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-950 dark:text-white sm:text-4xl">
            Forex Consensus Dashboard
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">
            Premium signal intelligence with live confidence movement and market-strength visualization.
          </p>
        </div>
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
          {isLoading ? (
            <span className="inline-flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-400/30 border-t-blue-400"></span>
              Loading market data
            </span>
          ) : (
            `${totalSignals} tracked pairs`
          )}
        </p>
      </div>

      <section className="animate-dashboard-in animation-delay-100 mb-8 grid min-w-0 grid-cols-1 gap-5 xl:mb-10 xl:grid-cols-3">
        <div className="min-w-0 rounded-2xl border border-white/70 bg-white/75 p-5 shadow-xl shadow-slate-200/70 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.06] dark:shadow-black/10 xl:col-span-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="inline-flex items-center gap-2 text-lg font-semibold text-slate-950 dark:text-white">
                <Radio className="text-emerald-500 dark:text-emerald-300" size={19} />
                Realtime Signal Pulse
              </h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Synthetic terminal stream for market movement and signal changes.
              </p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-emerald-500 dark:text-emerald-300">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400"></span>
              Streaming
            </span>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              { label: "Latency", value: "24ms", tone: "text-emerald-400" },
              { label: "Events/min", value: "18", tone: "text-blue-400" },
              { label: "Signal health", value: "99.2%", tone: "text-cyan-300" },
            ].map((metric) => (
              <div
                key={metric.label}
                className="rounded-2xl border border-slate-200 bg-white/70 p-4 dark:border-white/10 dark:bg-white/[0.04]"
              >
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                  {metric.label}
                </p>
                <p className={`mt-2 text-2xl font-bold ${metric.tone}`}>
                  {metric.value}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="min-w-0 rounded-2xl border border-white/70 bg-white/75 p-5 shadow-xl shadow-slate-200/70 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.06] dark:shadow-black/10">
          <h3 className="inline-flex items-center gap-2 text-lg font-semibold text-slate-950 dark:text-white">
            <Sparkles className="text-blue-500 dark:text-blue-300" size={19} />
            Activity Feed
          </h3>
          <div className="mt-4 space-y-3">
            {activityFeed.map((item, index) => (
              <div
                key={`${item.message}-${index}`}
                className="animate-dashboard-in flex items-start gap-3 rounded-2xl border border-slate-200 bg-white/70 p-3 transition hover:-translate-y-0.5 hover:border-blue-400/30 dark:border-white/10 dark:bg-white/[0.04]"
              >
                <span
                  className={`mt-1 h-2.5 w-2.5 rounded-full border ${getActivityClasses(
                    item.type
                  )}`}
                ></span>
                <div className="min-w-0 flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {item.message}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">{item.time}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="animate-dashboard-in animation-delay-200 mb-8 grid min-w-0 grid-cols-1 gap-5 xl:mb-10 xl:grid-cols-5">
        <div
          className={`relative min-w-0 overflow-hidden rounded-3xl border border-white/70 bg-gradient-to-br ${consensusGlow} p-5 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.06] xl:col-span-3`}
        >
          <div className="absolute -right-16 -top-16 h-40 w-40 rounded-full bg-sky-200/30 blur-3xl dark:bg-blue-400/10"></div>
          <div className="relative flex min-w-0 flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                <BrainCircuit size={17} />
                AI Consensus Engine
              </p>
              <h3 className={`mt-3 text-4xl font-black tracking-tight ${consensusTone}`}>
                {isLoading ? "Analyzing" : marketDirection}
              </h3>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
                {isLoading
                  ? "Aggregating signal strength, confidence, and directional bias."
                  : marketSummary}
              </p>

              <div className="mt-5 grid min-w-0 grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:grid-cols-4">
                {[
                  { label: "Buy Signals", value: buySignals, tone: "text-green-400" },
                  { label: "Sell Signals", value: sellSignals, tone: "text-red-400" },
                  {
                    label: "Bull Leader",
                    value: strongestBullishPair.name,
                    tone: "text-cyan-300",
                  },
                  {
                    label: "Bear Leader",
                    value: strongestBearishPair.name,
                    tone: "text-orange-300",
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="min-w-0 rounded-2xl border border-white/60 bg-white/65 p-3 shadow-lg shadow-slate-200/40 dark:border-white/10 dark:bg-white/[0.05] dark:shadow-black/10"
                  >
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                      {item.label}
                    </p>
                    <p className={`mt-2 text-xl font-bold ${item.tone}`}>
                      {isLoading ? "-" : item.value}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex shrink-0 justify-center lg:min-w-48">
              <div
                className="relative flex h-44 w-44 items-center justify-center rounded-full transition-all duration-700"
                style={{
                  background: `conic-gradient(${
                    isBearishConsensus ? "#f87171" : "#22d3ee"
                  } ${consensusConfidence * 3.6}deg, ${
                    isDark ? "rgba(255,255,255,0.08)" : "rgba(148,163,184,0.22)"
                  } 0deg)`,
                }}
              >
                <div className="flex h-32 w-32 flex-col items-center justify-center rounded-full border border-white/60 bg-white/85 shadow-inner dark:border-white/10 dark:bg-[#0B1120]/90">
                  <span className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                    Confidence
                  </span>
                  <span className={`mt-2 text-3xl font-black ${consensusTone}`}>
                    {isLoading ? "--" : consensusConfidence}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="min-w-0 rounded-3xl border border-white/70 bg-white/75 p-5 shadow-xl shadow-slate-200/70 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.06] dark:shadow-black/10 xl:col-span-2">
          <h3 className="inline-flex items-center gap-2 text-lg font-semibold text-slate-950 dark:text-white">
            <Cpu className="text-blue-500 dark:text-blue-300" size={19} />
            Model Inputs
          </h3>
          <div className="mt-5 space-y-4">
            {[
              {
                label: "Buy-side strength",
                value: buySignalStrength,
                max: totalSignalStrength || 1,
                color: "bg-green-400",
              },
              {
                label: "Sell-side strength",
                value: sellSignalStrength,
                max: totalSignalStrength || 1,
                color: "bg-red-400",
              },
              {
                label: "Consensus certainty",
                value: consensusConfidence,
                max: 100,
                color: "bg-cyan-400",
              },
            ].map((input) => (
              <div key={input.label}>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">
                    {input.label}
                  </span>
                  <span className="font-bold text-slate-500 dark:text-slate-400">
                    {isLoading ? "--" : Math.round(input.value)}
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-slate-200 dark:bg-slate-700">
                  <div
                    className={`h-2.5 rounded-full ${input.color} transition-all duration-700`}
                    style={{
                      width: isLoading
                        ? "30%"
                        : `${Math.min(100, (input.value / input.max) * 100)}%`,
                    }}
                  ></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="animate-dashboard-in animation-delay-100 mb-8 grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:mb-10 xl:grid-cols-4 xl:gap-5">
        {isLoading
          ? skeletonStats.map((label) => (
              <div
                key={label}
                className="min-w-0 rounded-lg border border-slate-200 bg-white p-5 shadow-xl shadow-slate-200/70 transition-colors duration-300 dark:border-white/10 dark:bg-[#111827] dark:shadow-none"
              >
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</p>
                <div className="mt-4 h-9 w-20 animate-pulse rounded bg-slate-200 dark:bg-slate-700/70"></div>
              </div>
            ))
              : stats.map((stat) => {
                  const Icon = stat.icon;
                  return (
                    <div
                      key={stat.label}
                      className="group min-w-0 rounded-2xl border border-white/70 bg-white/75 p-5 shadow-xl shadow-slate-200/70 backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-blue-400/30 hover:shadow-blue-500/15 dark:border-white/10 dark:bg-white/[0.06] dark:shadow-black/10"
                    >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                          {stat.label}
                        </p>
                        <p className={`mt-3 text-3xl font-bold ${stat.accent}`}>
                          {stat.value}
                        </p>
                      </div>
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-500 transition group-hover:scale-110 dark:bg-blue-400/10 dark:text-blue-300">
                        <Icon size={20} />
                      </div>
                    </div>
                  </div>
                  );
                })}
          </section>

      <section className="animate-dashboard-in animation-delay-200 mb-8 grid min-w-0 grid-cols-1 gap-6 xl:mb-10 xl:grid-cols-5">
        <div className="min-w-0 rounded-2xl border border-white/70 bg-white/75 p-4 shadow-xl shadow-slate-200/70 backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-blue-400/25 hover:shadow-blue-500/15 dark:border-white/10 dark:bg-white/[0.06] dark:shadow-black/10 sm:p-5 xl:col-span-2">
          <div className="mb-4">
            <h3 className="inline-flex items-center gap-2 text-lg font-semibold text-slate-950 dark:text-white">
              <BarChart3 className="text-blue-500 dark:text-blue-300" size={19} />
              Buy vs Sell Signals
            </h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Signal distribution</p>
          </div>

          <div className="h-52 sm:h-72">
            {isLoading ? (
              <div className="flex h-full items-center justify-center">
                <div className="h-36 w-36 animate-pulse rounded-full border-[22px] border-slate-200 dark:border-slate-700/70"></div>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Pie
                    data={signalChartData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius="58%"
                    outerRadius="82%"
                    paddingAngle={4}
                    stroke="none"
                  >
                    {signalChartData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-5 text-sm font-medium text-slate-600 dark:text-slate-300">
            {isLoading
              ? ["Buy", "Sell"].map((item) => (
                  <div key={item} className="flex items-center gap-2">
                    <span className="h-3 w-3 animate-pulse rounded-full bg-slate-200 dark:bg-slate-700"></span>
                    {item}
                  </div>
                ))
              : signalChartData.map((item) => (
                  <div key={item.name} className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: item.color }}
                    ></span>
                    {item.name}
                  </div>
                ))}
          </div>
        </div>

        <div className="min-w-0 rounded-2xl border border-white/70 bg-white/75 p-4 shadow-xl shadow-slate-200/70 backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-blue-400/25 hover:shadow-blue-500/15 dark:border-white/10 dark:bg-white/[0.06] dark:shadow-black/10 sm:p-5 xl:col-span-3">
          <div className="mb-4">
            <h3 className="inline-flex items-center gap-2 text-lg font-semibold text-slate-950 dark:text-white">
              <Gauge className="text-cyan-500 dark:text-cyan-300" size={19} />
              Pair Strength
            </h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Percentage confidence by instrument
            </p>
          </div>

          <div className="h-56 sm:h-72">
            {isLoading ? (
              <div className="flex h-full items-end gap-4 px-3 pb-4">
                {[68, 48, 56, 78].map((height, index) => (
                  <div
                    key={index}
                    className="flex flex-1 flex-col items-center gap-3"
                  >
                    <div
                      className="w-full animate-pulse rounded-t-lg bg-slate-200 dark:bg-slate-700/70"
                      style={{ height: `${height}%` }}
                    ></div>
                    <div className="h-3 w-12 animate-pulse rounded bg-slate-200 dark:bg-slate-700/70"></div>
                  </div>
                ))}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={strengthChartData}
                  margin={{ top: 8, right: 6, left: -18, bottom: 0 }}
                >
                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: chartTickColor, fontSize: 12 }}
                  />
                  <YAxis
                    domain={[0, 100]}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: chartTickColor, fontSize: 12 }}
                  />
                  <Tooltip
                    contentStyle={chartTooltipStyle}
                    cursor={{ fill: "rgba(59, 130, 246, 0.08)" }}
                  />
                  <Bar dataKey="strength" radius={[8, 8, 0, 0]}>
                    {strengthChartData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </section>

      <section className="animate-dashboard-in animation-delay-300 mb-8 min-w-0 overflow-hidden rounded-2xl border border-white/70 bg-white/75 shadow-xl shadow-slate-200/70 backdrop-blur-xl transition-all duration-300 hover:border-blue-400/25 hover:shadow-blue-500/15 dark:border-white/10 dark:bg-white/[0.06] dark:shadow-black/10 xl:mb-10">
        <div className="flex flex-col gap-2 border-b border-slate-200 p-4 dark:border-white/10 sm:flex-row sm:items-end sm:justify-between sm:p-5">
          <div>
            <h3 className="inline-flex items-center gap-2 text-lg font-semibold text-slate-950 dark:text-white">
              <Clock3 className="text-blue-500 dark:text-blue-300" size={19} />
              Recent Signals
            </h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Latest generated forex trade ideas
            </p>
          </div>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
            {isLoading ? "Loading updates" : `${liveSignals.length} updates`}
          </p>
        </div>

        <div className="space-y-3 p-3 sm:p-4 xl:hidden">
          {isLoading
            ? [0, 1, 2, 3].map((card) => (
                <div
                  key={card}
                  className="rounded-2xl border border-slate-200 bg-white/70 p-4 dark:border-white/10 dark:bg-white/[0.04]"
                >
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="h-4 w-24 animate-pulse rounded bg-slate-200 dark:bg-slate-700/70"></div>
                    <div className="h-6 w-16 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-700/70"></div>
                  </div>
                  <div className="space-y-3">
                    {[80, 144, 112, 96].map((width, index) => (
                      <div
                        key={index}
                        className="h-3 animate-pulse rounded bg-slate-200 dark:bg-slate-700/70"
                        style={{ width }}
                      ></div>
                    ))}
                  </div>
                </div>
              ))
            : liveSignals.map((signal) => (
                <div
                  key={`${signal.pair}-${signal.time}`}
                  className="rounded-2xl border border-slate-200 bg-white/70 p-4 text-sm shadow-lg shadow-slate-200/50 transition hover:border-blue-400/30 dark:border-white/10 dark:bg-white/[0.04] dark:shadow-black/10"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                        Pair
                      </p>
                      <p className="mt-1 text-lg font-bold text-slate-950 dark:text-white">
                        {signal.pair}
                      </p>
                    </div>
                    <span
                      className={`inline-flex min-w-16 justify-center rounded-lg border px-3 py-1 text-xs font-bold shadow-sm ${
                        signal.color === "green"
                          ? "border-green-400/20 bg-green-400/10 text-green-400 shadow-green-400/10"
                          : "border-red-400/20 bg-red-400/10 text-red-400 shadow-red-400/10"
                      }`}
                    >
                      {signal.signal === "BUY" ? (
                        <ArrowUpRight className="mr-1" size={13} />
                      ) : (
                        <ArrowDownRight className="mr-1" size={13} />
                      )}
                      {signal.signal}
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-3 min-[380px]:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Entry
                      </p>
                      <p className="mt-1 font-semibold text-slate-700 dark:text-slate-200">
                        {signal.entry}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Target
                      </p>
                      <p className="mt-1 font-semibold text-slate-700 dark:text-slate-200">
                        {signal.target}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Confidence
                      </span>
                      <span
                        className={`font-bold ${getConfidenceColor(
                          signal.confidence
                        )}`}
                      >
                        {signal.confidence}%
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700">
                      <div
                        className={`h-2 rounded-full transition-all duration-700 ${
                          signal.color === "green" ? "bg-green-400" : "bg-red-400"
                        }`}
                        style={{ width: `${signal.confidence}%` }}
                      ></div>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <span
                      className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1 text-xs font-semibold ${getStatusClasses(
                        signal.status
                      )}`}
                    >
                      {signal.status === "Hit Target" ? (
                        <Target size={13} />
                      ) : signal.status === "Expired" ? (
                        <Clock3 size={13} />
                      ) : (
                        <CheckCircle2 size={13} />
                      )}
                      {signal.status}
                    </span>
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      {signal.time}
                    </span>
                  </div>
                </div>
              ))}
        </div>

        <div className="hidden pb-2 xl:block">
          <table className="w-full min-w-[820px] text-left">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-widest text-slate-500 dark:border-white/10">
                <th className="px-5 py-4 font-semibold">Pair</th>
                <th className="px-5 py-4 font-semibold">Signal</th>
                <th className="px-5 py-4 font-semibold">Confidence</th>
                <th className="px-5 py-4 font-semibold">Entry</th>
                <th className="px-5 py-4 font-semibold">Target</th>
                <th className="px-5 py-4 font-semibold">Status</th>
                <th className="px-5 py-4 font-semibold">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-white/10">
              {isLoading
                ? [0, 1, 2, 3].map((row) => (
                    <tr key={row} className="text-sm text-slate-600 dark:text-slate-300">
                      {[96, 64, 152, 72, 72, 92, 68].map((width, index) => (
                        <td key={index} className="px-5 py-4">
                          <div
                            className="h-4 animate-pulse rounded bg-slate-200 dark:bg-slate-700/70"
                            style={{ width }}
                          ></div>
                        </td>
                      ))}
                    </tr>
                  ))
                : liveSignals.map((signal) => (
                    <tr
                      key={`${signal.pair}-${signal.time}`}
                      className="group text-sm text-slate-600 transition-all duration-200 hover:bg-blue-500/[0.06] dark:text-slate-300 dark:hover:bg-white/[0.05]"
                    >
                      <td className="px-5 py-4 font-semibold text-slate-950 dark:text-white">
                        <span className="transition group-hover:text-blue-500 dark:group-hover:text-blue-200">
                          {signal.pair}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex min-w-16 justify-center rounded-lg border px-3 py-1 text-xs font-bold shadow-sm transition duration-300 group-hover:scale-105 ${
                            signal.color === "green"
                              ? "border-green-400/20 bg-green-400/10 text-green-400 shadow-green-400/10"
                              : "border-red-400/20 bg-red-400/10 text-red-400 shadow-red-400/10"
                          }`}
                        >
                          {signal.signal === "BUY" ? (
                            <ArrowUpRight className="mr-1" size={13} />
                          ) : (
                            <ArrowDownRight className="mr-1" size={13} />
                          )}
                          {signal.signal}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <span
                            className={`w-10 font-bold ${getConfidenceColor(
                              signal.confidence
                            )}`}
                          >
                            {signal.confidence}%
                          </span>
                          <div className="h-2 w-24 rounded-full bg-slate-200 dark:bg-slate-700">
                            <div
                              className={`h-2 rounded-full transition-all duration-700 ${
                                signal.color === "green"
                                  ? "bg-green-400"
                                  : "bg-red-400"
                              }`}
                              style={{ width: `${signal.confidence}%` }}
                            ></div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">{signal.entry}</td>
                      <td className="px-5 py-4">{signal.target}</td>
                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1 text-xs font-semibold ${getStatusClasses(
                            signal.status
                          )}`}
                        >
                          {signal.status === "Hit Target" ? (
                            <Target size={13} />
                          ) : signal.status === "Expired" ? (
                            <Clock3 size={13} />
                          ) : (
                            <CheckCircle2 size={13} />
                          )}
                          {signal.status}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-slate-500 dark:text-slate-400">
                        {signal.time}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-10 min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-900/5 dark:border-white/10 dark:bg-[#111827] dark:shadow-xl">

  <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
    <div className="min-w-0">
      <h2 className="text-3xl font-bold text-slate-950 dark:text-white">
        AI Consensus Engine
      </h2>

      <p className="mt-1 text-slate-500 dark:text-gray-400">
        Aggregated market sentiment from multiple forex signals
      </p>
    </div>

    <div className="self-start rounded-full bg-green-500/20 px-4 py-2 font-semibold text-green-400 sm:self-auto">
      STRONG BUY
    </div>
  </div>

  <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 xl:gap-6">

    <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-5 dark:border-white/5 dark:bg-[#0B1120]">
      <p className="text-sm text-slate-500 dark:text-gray-400">
        Buy Signals
      </p>

      <h3 className="text-4xl font-bold text-green-400 mt-2">
        12
      </h3>
    </div>

    <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-5 dark:border-white/5 dark:bg-[#0B1120]">
      <p className="text-sm text-slate-500 dark:text-gray-400">
        Sell Signals
      </p>

      <h3 className="text-4xl font-bold text-red-400 mt-2">
        4
      </h3>
    </div>

    <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-5 dark:border-white/5 dark:bg-[#0B1120]">
      <p className="text-sm text-slate-500 dark:text-gray-400">
        Confidence
      </p>

      <h3 className="text-4xl font-bold text-blue-400 mt-2">
        78%
      </h3>
    </div>

    <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-5 dark:border-white/5 dark:bg-[#0B1120]">
      <p className="text-sm text-slate-500 dark:text-gray-400">
        Strongest Pair
      </p>

      <h3 className="text-4xl font-bold text-yellow-400 mt-2">
        GOLD
      </h3>
    </div>

  </div>

  <div className="mt-8 min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-6 dark:border-white/5 dark:bg-[#0B1120]">

    <h3 className="mb-3 text-xl font-semibold text-slate-950 dark:text-white">
      AI Market Summary
    </h3>

    <p className="leading-relaxed text-slate-600 dark:text-gray-300">
      Current market sentiment indicates strong bullish momentum driven by GOLD and GBPUSD strength. Buy-side confidence remains dominant across aggregated forex signals while bearish pressure on USDJPY continues to weaken.
    </p>

  </div>

</div>

      <section className="animate-dashboard-in animation-delay-400 grid min-w-0 grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4 xl:gap-7">
        {isLoading
          ? [0, 1, 2, 3].map((card) => (
              <div
                key={card}
                className="min-w-0 rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/70 dark:border-white/10 dark:bg-[#111827] dark:shadow-none"
              >
                <div className="mb-5 h-7 w-24 animate-pulse rounded bg-slate-200 dark:bg-slate-700/70"></div>
                <div className="mb-5 h-9 w-32 animate-pulse rounded bg-slate-200 dark:bg-slate-700/70"></div>
                <div className="h-3 w-full rounded-full bg-slate-200 dark:bg-slate-700">
                  <div className="h-3 w-2/3 animate-pulse rounded-full bg-slate-300 dark:bg-slate-600"></div>
                </div>
              </div>
            ))
          : pairs.map((pair, index) => (
              <PairCard
                key={index}
                name={pair.name}
                signal={pair.signal}
                color={pair.color}
                percentage={pair.percentage}
              />
            ))}
      </section>
      <footer className="mt-12 text-center text-sm text-slate-400 pb-8">
  <p>
    FX Desk Pro • AI-Powered Forex Consensus Dashboard
  </p>

  <p className="mt-2">
    Built by Md Kafil Ahmed
  </p>
</footer>
    </>
  );
}

export default Dashboard;
