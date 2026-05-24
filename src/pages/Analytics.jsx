import { BarChart3, PieChart, TrendingUp } from "lucide-react";

function Analytics() {
  return (
    <div className="animate-dashboard-in">
      <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
        <BarChart3 size={16} />
        Performance Lab
      </p>
      <h2 className="mt-2 text-3xl font-bold text-blue-500 dark:text-blue-400 sm:text-4xl">
        Analytics
      </h2>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/70 bg-white/75 p-6 shadow-xl shadow-slate-200/70 backdrop-blur-xl transition-colors duration-300 dark:border-white/10 dark:bg-white/[0.06] dark:shadow-black/10">
          <h3 className="inline-flex items-center gap-2 text-lg font-semibold text-slate-950 dark:text-white">
            <TrendingUp className="text-green-500 dark:text-green-300" size={19} />
            Win Rate
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
            Historical accuracy, pair performance, and strategy breakdowns will
            appear here.
          </p>
        </div>
        <div className="rounded-2xl border border-white/70 bg-white/75 p-6 shadow-xl shadow-slate-200/70 backdrop-blur-xl transition-colors duration-300 dark:border-white/10 dark:bg-white/[0.06] dark:shadow-black/10">
          <h3 className="inline-flex items-center gap-2 text-lg font-semibold text-slate-950 dark:text-white">
            <PieChart className="text-blue-500 dark:text-blue-300" size={19} />
            Market Bias
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
            Future analytics can compare buy/sell pressure, confidence trends,
            and session behavior.
          </p>
        </div>
      </div>
    </div>
  );
}

export default Analytics;
