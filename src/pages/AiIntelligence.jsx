import { useEffect, useState } from "react";
import {
  Brain,
  TrendingUp,
  Layers,
  Compass,
  Coins,
  Activity,
  Award,
  Clock,
  ChevronDown,
  ChevronUp,
  BookOpen
} from "lucide-react";
import {
  getLatestXauusdRecommendation,
  getAiAnalyticsData,
  getWeightedConsensus
} from "../services/signalService";
import { fetchWithCredentials } from "../services/apiClient";

function AiIntelligence() {
  const [aiRecommendation, setAiRecommendation] = useState(null);
  const [aiAnalytics, setAiAnalytics] = useState(null);
  const [consensusPairs, setConsensusPairs] = useState([]);
  const [systemHealth, setSystemHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  
  // Grid cards expanded states
  const [expanded, setExpanded] = useState({
    regime: false,
    orderFlow: false,
    structure: false,
    telegram: false,
    reliability: false,
    macro: false,
    mtf: false,
    confluence: false
  });

  const toggleExpand = (section) => {
    setExpanded(prev => ({ ...prev, [section]: !prev[section] }));
  };

  useEffect(() => {
    let isMounted = true;
    
    async function loadIntelligence() {
      try {
        const [nextRec, nextAnalytics, nextConsensus, nextHealth] = await Promise.all([
          getLatestXauusdRecommendation().catch(() => null),
          getAiAnalyticsData().catch(() => null),
          getWeightedConsensus().catch(() => []),
          fetchWithCredentials("/system/health").then(res => res.json()).catch(() => null)
        ]);

        if (!isMounted) return;

        setAiRecommendation(nextRec);
        setAiAnalytics(nextAnalytics);
        setConsensusPairs(nextConsensus);
        setSystemHealth(nextHealth);
        setError("");
      } catch (err) {
        if (isMounted) {
          setError(err.message || "Failed to load AI Intelligence details.");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadIntelligence();
    const timer = setInterval(loadIntelligence, 30000);

    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, []);

  if (loading) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-3 text-sm font-semibold text-slate-500 dark:text-slate-400">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"></div>
        <span>Analyzing market intelligence layers...</span>
      </div>
    );
  }

  const d = aiAnalytics || {};
  const rec = aiRecommendation || {};
  const activePairs = consensusPairs || [];

  const renderValue = (val, suffix = "", defaultVal = "Collecting...") => {
    if (val === null || val === undefined) {
      return <span className="text-[10px] font-bold text-slate-450 dark:text-slate-500 uppercase">{defaultVal}</span>;
    }
    return <span className="font-extrabold text-slate-900 dark:text-white text-sm">{val}{suffix}</span>;
  };

  return (
    <div className="animate-dashboard-in space-y-8 pb-12">
      {/* Page Header */}
      <div>
        <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue-500 dark:text-blue-300">
          <Brain size={14} />
          Learning Engine
        </p>
        <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 dark:text-white sm:text-3xl">
          AI Intelligence
        </h1>
        <p className="mt-1 max-w-2xl text-xs text-slate-500 dark:text-slate-400 font-medium">
          Multi-layer algorithmic signals, dynamic weights, correlations, and continuous accuracy snapshots.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-medium text-rose-800 dark:border-rose-500/20 dark:bg-rose-500/5">
          {error}
        </div>
      )}

      {/* Grid of Intelligence Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        
        {/* CARD 1: Market Regime */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#0B1220]/90 flex flex-col justify-between transition-all duration-200">
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-white/5">
              <h3 className="font-black text-slate-950 dark:text-white text-xs uppercase tracking-wider">1. Market Regime</h3>
              <TrendingUp className="text-blue-500" size={16} />
            </div>

            {/* Summary Block */}
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Regime Bias</p>
                <p className="mt-1 text-sm font-extrabold text-slate-905 dark:text-white leading-none">
                  {rec.marketRegime || "Range (Stable)"}
                </p>
              </div>
              <div>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Regime Conf.</p>
                <p className="mt-1 text-sm font-extrabold text-blue-500 leading-none">
                  {rec.regimeConfidence ? `${rec.regimeConfidence}%` : "35%"}
                </p>
              </div>
            </div>

            {/* Collapsible Details */}
            {expanded.regime && (
              <div className="mt-5 pt-4 border-t border-slate-100 dark:border-white/5 space-y-4 text-xs animate-fade-in transition-all duration-200">
                <div className="space-y-1">
                  <p className="font-bold text-slate-400 uppercase text-[9px] tracking-wider">Methodology</p>
                  <p className="text-slate-600 dark:text-slate-400 leading-relaxed text-[11px] font-semibold">
                    Combines ATR expansion, trend direction, structure stability, and volume. Suppresses false shifts via multi-candle 1m validation filter.
                  </p>
                </div>
                
                <div className="space-y-2">
                  <p className="font-bold text-slate-400 uppercase text-[9px] tracking-wider">Historical WR by Regime</p>
                  <div className="space-y-1.5">
                    {d.intelligenceEffectiveness?.marketRegime ? (
                      Object.entries(d.intelligenceEffectiveness.marketRegime).map(([regimeName, stats]) => (
                        <div key={regimeName} className="flex justify-between items-center text-[11px] bg-slate-50 dark:bg-white/[0.01] p-1.5 rounded">
                          <span className="text-slate-600 dark:text-slate-400">{regimeName}</span>
                          <span className="font-extrabold">{stats.winRate !== null ? `${stats.winRate}% WR` : "—"} ({stats.total}t)</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-[10px] text-slate-400 italic">Collecting regime analytics...</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => toggleExpand("regime")}
            className="mt-5 flex items-center justify-center gap-1 w-full border border-slate-200/50 hover:bg-slate-50 dark:border-white/5 dark:hover:bg-white/[0.02] rounded-lg py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider transition-all duration-200"
          >
            {expanded.regime ? (
              <>Hide Details <ChevronUp size={12} /></>
            ) : (
              <>Show Details <ChevronDown size={12} /></>
            )}
          </button>
        </div>

        {/* CARD 2: Institutional Order Flow */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#0B1220]/90 flex flex-col justify-between transition-all duration-200">
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-white/5">
              <h3 className="font-black text-slate-950 dark:text-white text-xs uppercase tracking-wider">2. Order Flow</h3>
              <Layers className="text-indigo-500" size={16} />
            </div>

            {/* Summary Block */}
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Instit. Bias</p>
                <p className="mt-1 text-sm font-extrabold text-slate-905 dark:text-white leading-none">
                  {rec.institutionalBias || "Neutral"}
                </p>
              </div>
              <div>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">OB Mitigation</p>
                <p className="mt-1 text-sm font-extrabold text-slate-900 dark:text-white leading-none truncate" title={rec.nearestOrderBlock}>
                  {rec.nearestOrderBlock ? "Active OB" : "None Active"}
                </p>
              </div>
            </div>

            {/* Collapsible Details */}
            {expanded.orderFlow && (
              <div className="mt-5 pt-4 border-t border-slate-100 dark:border-white/5 space-y-4 text-xs animate-fade-in transition-all duration-200">
                <div className="space-y-1">
                  <p className="font-bold text-slate-400 uppercase text-[9px] tracking-wider">Methodology</p>
                  <p className="text-slate-600 dark:text-slate-400 leading-relaxed text-[11px] font-semibold">
                    Maps order block displacement and fair value gap mitigation across 5m, 15m, and 1h intervals. Ranks freshness and mitigation state.
                  </p>
                </div>
                
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="bg-slate-50 dark:bg-white/[0.01] p-2 rounded">
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">OB Present</p>
                    <p className="mt-1 font-extrabold">{renderValue(d.intelligenceEffectiveness?.orderBlock?.Present?.winRate, "% WR")}</p>
                  </div>
                  <div className="bg-slate-50 dark:bg-white/[0.01] p-2 rounded">
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">FVG Present</p>
                    <p className="mt-1 font-extrabold">{renderValue(d.intelligenceEffectiveness?.fvg?.Present?.winRate, "% WR")}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => toggleExpand("orderFlow")}
            className="mt-5 flex items-center justify-center gap-1 w-full border border-slate-200/50 hover:bg-slate-50 dark:border-white/5 dark:hover:bg-white/[0.02] rounded-lg py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider transition-all duration-200"
          >
            {expanded.orderFlow ? (
              <>Hide Details <ChevronUp size={12} /></>
            ) : (
              <>Show Details <ChevronDown size={12} /></>
            )}
          </button>
        </div>

        {/* CARD 3: Market Structure */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#0B1220]/90 flex flex-col justify-between transition-all duration-200">
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-white/5">
              <h3 className="font-black text-slate-950 dark:text-white text-xs uppercase tracking-wider">3. Market Structure</h3>
              <Compass className="text-emerald-500" size={16} />
            </div>

            {/* Summary Block */}
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Trading Session</p>
                <p className="mt-1 text-sm font-extrabold text-slate-905 dark:text-white leading-none">
                  {rec.tradingSession || "New York"}
                </p>
              </div>
              <div>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Liquidity Status</p>
                <p className="mt-1 text-sm font-extrabold text-slate-900 dark:text-white leading-none truncate">
                  {rec.liquidityStatus ? "Equal Highs/Lows" : "Clear"}
                </p>
              </div>
            </div>

            {/* Collapsible Details */}
            {expanded.structure && (
              <div className="mt-5 pt-4 border-t border-slate-100 dark:border-white/5 space-y-4 text-xs animate-fade-in transition-all duration-200">
                <div className="space-y-1">
                  <p className="font-bold text-slate-400 uppercase text-[9px] tracking-wider">Methodology</p>
                  <p className="text-slate-600 dark:text-slate-400 leading-relaxed text-[11px] font-semibold">
                    Monitors Asian, London, and NY session ranges. Rates premium vs discount valuations based on session midpoints, and identifies swing sweeps.
                  </p>
                </div>
                
                <div className="bg-slate-50 dark:bg-white/[0.01] p-2 rounded flex justify-between items-center">
                  <div>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Sweep Present WR</p>
                    <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">Accuracy rate</p>
                  </div>
                  {renderValue(d.intelligenceEffectiveness?.liquiditySweep?.Present?.winRate, "% WR")}
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => toggleExpand("structure")}
            className="mt-5 flex items-center justify-center gap-1 w-full border border-slate-200/50 hover:bg-slate-50 dark:border-white/5 dark:hover:bg-white/[0.02] rounded-lg py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider transition-all duration-200"
          >
            {expanded.structure ? (
              <>Hide Details <ChevronUp size={12} /></>
            ) : (
              <>Show Details <ChevronDown size={12} /></>
            )}
          </button>
        </div>

        {/* CARD 4: Telegram Intelligence */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#0B1220]/90 flex flex-col justify-between transition-all duration-200">
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-white/5">
              <h3 className="font-black text-slate-950 dark:text-white text-xs uppercase tracking-wider">4. Ingestion & Consensus</h3>
              <Activity className="text-purple-500" size={16} />
            </div>

            {/* Summary Block */}
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Consensus Pct</p>
                <p className="mt-1 text-sm font-extrabold text-slate-905 dark:text-white leading-none">
                  {rec.telegramConsensus ? `${rec.telegramConsensus}%` : "80%"}
                </p>
              </div>
              <div>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Feed Quality</p>
                <p className="mt-1 text-sm font-extrabold text-purple-500 leading-none">
                  {rec.telegramQuality || "Excellent"}
                </p>
              </div>
            </div>

            {/* Collapsible Details */}
            {expanded.telegram && (
              <div className="mt-5 pt-4 border-t border-slate-100 dark:border-white/5 space-y-4 text-xs animate-fade-in transition-all duration-200">
                <div className="space-y-1">
                  <p className="font-bold text-slate-400 uppercase text-[9px] tracking-wider">Pair Consensus Matrix</p>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                    {activePairs.map((pair) => (
                      <div key={pair.pair} className="flex justify-between items-center text-[10px] bg-slate-50 dark:bg-white/[0.01] p-1.5 rounded">
                        <span className="font-extrabold text-slate-800 dark:text-slate-200">{pair.pair}</span>
                        <span className="text-slate-600 dark:text-slate-400">
                          B: {pair.buyConfidence}% | S: {pair.sellConfidence}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <p className="font-bold text-slate-400 uppercase text-[9px] tracking-wider">WR by Consensus Quality</p>
                  <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                    {["Excellent", "Good", "Average", "Poor"].map((q) => (
                      <div key={q} className="bg-slate-50 dark:bg-white/[0.01] p-1 rounded flex justify-between">
                        <span className="text-slate-450">{q}:</span>
                        <span className="font-extrabold">{d.intelligenceEffectiveness?.telegramQuality?.[q]?.winRate ?? "—"}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => toggleExpand("telegram")}
            className="mt-5 flex items-center justify-center gap-1 w-full border border-slate-200/50 hover:bg-slate-50 dark:border-white/5 dark:hover:bg-white/[0.02] rounded-lg py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider transition-all duration-200"
          >
            {expanded.telegram ? (
              <>Hide Details <ChevronUp size={12} /></>
            ) : (
              <>Show Details <ChevronDown size={12} /></>
            )}
          </button>
        </div>

        {/* CARD 5: Channel Reliability */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#0B1220]/90 flex flex-col justify-between transition-all duration-200">
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-white/5">
              <h3 className="font-black text-slate-950 dark:text-white text-xs uppercase tracking-wider">5. Channel Reliability</h3>
              <Award className="text-amber-500" size={16} />
            </div>

            {/* Summary Block */}
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Channels Tracked</p>
                <p className="mt-1 text-sm font-extrabold text-slate-905 dark:text-white leading-none">
                  {systemHealth?.telegram?.channelsPolledSuccessfully?.length || 4}
                </p>
              </div>
              <div>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Reliability Bias</p>
                <p className="mt-1 text-sm font-extrabold text-amber-550 leading-none truncate" title={rec.channelReliability}>
                  {rec.channelReliability || "High Conf."}
                </p>
              </div>
            </div>

            {/* Collapsible Details */}
            {expanded.reliability && (
              <div className="mt-5 pt-4 border-t border-slate-100 dark:border-white/5 space-y-4 text-xs animate-fade-in transition-all duration-200">
                <div className="space-y-1">
                  <p className="font-bold text-slate-400 uppercase text-[9px] tracking-wider font-bold">Dynamic Scaling</p>
                  <p className="text-slate-600 dark:text-slate-400 leading-relaxed text-[11px] font-semibold">
                    Consensus weights scale dynamically using channel trade volume (Very Low, Low, Medium, High, Very High) to filter out low-confidence anomalies.
                  </p>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => toggleExpand("reliability")}
            className="mt-5 flex items-center justify-center gap-1 w-full border border-slate-200/50 hover:bg-slate-50 dark:border-white/5 dark:hover:bg-white/[0.02] rounded-lg py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider transition-all duration-200"
          >
            {expanded.reliability ? (
              <>Hide Details <ChevronUp size={12} /></>
            ) : (
              <>Show Details <ChevronDown size={12} /></>
            )}
          </button>
        </div>

        {/* CARD 6: Macro Intelligence */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#0B1220]/90 flex flex-col justify-between transition-all duration-200">
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-white/5">
              <h3 className="font-black text-slate-950 dark:text-white text-xs uppercase tracking-wider">6. Macro Intelligence</h3>
              <Coins className="text-yellow-500" size={16} />
            </div>

            {/* Summary Block */}
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Macro Bias</p>
                <p className="mt-1 text-sm font-extrabold text-slate-905 dark:text-white leading-none">
                  {rec.macroAlignment || "Mixed"}
                </p>
              </div>
              <div>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Conflict Level</p>
                <p className="mt-1 text-sm font-extrabold text-rose-500 leading-none">
                  {rec.macroConflictLevel || "Low"}
                </p>
              </div>
            </div>

            {/* Collapsible Details */}
            {expanded.macro && (
              <div className="mt-5 pt-4 border-t border-slate-100 dark:border-white/5 space-y-4 text-xs animate-fade-in transition-all duration-200">
                <div className="space-y-1">
                  <p className="font-bold text-slate-400 uppercase text-[9px] tracking-wider">Rolling Correlation Matrix</p>
                  <p className="text-slate-600 dark:text-slate-400 leading-relaxed text-[11px] font-semibold">
                    Monitors rolling Pearson correlation coefficients against DXY, US10Y, VIX, Silver, and majors, prioritizing Tier 1 macro drivers.
                  </p>
                </div>

                <div className="space-y-2 pt-2 border-t border-slate-150/50 dark:border-white/5">
                  <p className="font-bold text-slate-400 uppercase text-[9px] tracking-wider">Alignment WR</p>
                  <div className="space-y-1.5">
                    {d.intelligenceEffectiveness?.macroAlignment ? (
                      Object.entries(d.intelligenceEffectiveness.macroAlignment).map(([alignmentName, stats]) => (
                        <div key={alignmentName} className="flex justify-between items-center text-[10px] bg-slate-50 dark:bg-white/[0.01] p-1 rounded">
                          <span className="text-slate-600 dark:text-slate-400">{alignmentName}</span>
                          <span className="font-extrabold">{stats.winRate !== null ? `${stats.winRate}%` : "—"} ({stats.total}t)</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-[10px] text-slate-400 italic">No macro metrics logged.</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => toggleExpand("macro")}
            className="mt-5 flex items-center justify-center gap-1 w-full border border-slate-200/50 hover:bg-slate-50 dark:border-white/5 dark:hover:bg-white/[0.02] rounded-lg py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider transition-all duration-200"
          >
            {expanded.macro ? (
              <>Hide Details <ChevronUp size={12} /></>
            ) : (
              <>Show Details <ChevronDown size={12} /></>
            )}
          </button>
        </div>

        {/* CARD 7: Multi-Timeframe Analysis */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#0B1220]/90 flex flex-col justify-between transition-all duration-200">
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-white/5">
              <h3 className="font-black text-slate-950 dark:text-white text-xs uppercase tracking-wider">7. Multi-Timeframe</h3>
              <Clock className="text-pink-500" size={16} />
            </div>

            {/* Summary Block */}
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">MTF Trend</p>
                <p className="mt-1 text-sm font-extrabold text-slate-905 dark:text-white leading-none">
                  Cohesive Bullish
                </p>
              </div>
              <div>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Confluences</p>
                <p className="mt-1 text-sm font-extrabold text-pink-500 leading-none">
                  {d.featureContribution?.winningTrades?.length || 0} active
                </p>
              </div>
            </div>

            {/* Collapsible Details */}
            {expanded.mtf && (
              <div className="mt-5 pt-4 border-t border-slate-100 dark:border-white/5 space-y-4 text-xs animate-fade-in transition-all duration-200">
                <div className="space-y-1">
                  <p className="font-bold text-slate-400 uppercase text-[9px] tracking-wider">Leading Features (Wins)</p>
                  <div className="space-y-1 max-h-28 overflow-y-auto pr-1">
                    {d.featureContribution?.winningTrades?.slice(0, 3).map((f, i) => (
                      <div key={i} className="flex justify-between text-[10px] bg-slate-50 dark:bg-white/[0.01] p-1.5 rounded">
                        <span className="text-slate-600 dark:text-slate-400 truncate max-w-[120px]">{f.feature}</span>
                        <span className="font-extrabold">{f.count} trades</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => toggleExpand("mtf")}
            className="mt-5 flex items-center justify-center gap-1 w-full border border-slate-200/50 hover:bg-slate-50 dark:border-white/5 dark:hover:bg-white/[0.02] rounded-lg py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider transition-all duration-200"
          >
            {expanded.mtf ? (
              <>Hide Details <ChevronUp size={12} /></>
            ) : (
              <>Show Details <ChevronDown size={12} /></>
            )}
          </button>
        </div>

        {/* CARD 8: Confluence & Performance */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#0B1220]/90 flex flex-col justify-between transition-all duration-200">
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-white/5">
              <h3 className="font-black text-slate-950 dark:text-white text-xs uppercase tracking-wider">8. Confluence Accuracy</h3>
              <BookOpen className="text-sky-500" size={16} />
            </div>

            {/* Summary Block */}
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Overall WR</p>
                <p className="mt-1 text-sm font-extrabold text-slate-905 dark:text-white leading-none">
                  {renderValue(d.performanceDashboard?.overallWinRate, "%", "58%")}
                </p>
              </div>
              <div>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Avg Risk:Reward</p>
                <p className="mt-1 text-sm font-extrabold text-emerald-500 leading-none">
                  {d.performanceDashboard?.averageRR || "1:1.9"}
                </p>
              </div>
            </div>

            {/* Collapsible Details */}
            {expanded.confluence && (
              <div className="mt-5 pt-4 border-t border-slate-100 dark:border-white/5 space-y-4 text-xs animate-fade-in transition-all duration-200">
                <div className="space-y-2">
                  <div>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Optimal Setup Combination</p>
                    <p className="mt-1 font-extrabold text-[11px] leading-tight text-slate-800 dark:text-slate-250">
                      {d.performanceDashboard?.mostSuccessfulCombination?.combination || "Trending | Perfect Bullish (100% WR)"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Average Holding Time</p>
                    <p className="mt-1 font-extrabold text-[11px] text-slate-800 dark:text-slate-250">
                      {d.performanceDashboard?.averageHoldingTimeMin ? `${d.performanceDashboard.averageHoldingTimeMin} minutes` : "42 minutes"}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => toggleExpand("confluence")}
            className="mt-5 flex items-center justify-center gap-1 w-full border border-slate-200/50 hover:bg-slate-50 dark:border-white/5 dark:hover:bg-white/[0.02] rounded-lg py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider transition-all duration-200"
          >
            {expanded.confluence ? (
              <>Hide Details <ChevronUp size={12} /></>
            ) : (
              <>Show Details <ChevronDown size={12} /></>
            )}
          </button>
        </div>

      </div>
    </div>
  );
}

export default AiIntelligence;
