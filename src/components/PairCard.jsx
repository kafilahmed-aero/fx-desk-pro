import { ArrowDownRight, ArrowUpRight, ShieldCheck } from "lucide-react";

function PairCard({ name, signal, color, percentage }) {
  const isStrongSignal = percentage >= 70;

  return (
    <div
      className={`group relative min-w-0 overflow-hidden rounded-2xl border bg-white/80 p-6 shadow-xl shadow-slate-200/70 backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:scale-[1.02] dark:bg-white/[0.06] dark:shadow-black/10 ${
        isStrongSignal
          ? color === "green"
            ? "border-green-400/30 shadow-green-400/10 hover:border-green-300/60 hover:shadow-green-400/25"
            : "border-red-400/30 shadow-red-400/10 hover:border-red-300/60 hover:shadow-red-400/25"
          : "border-slate-200 hover:border-blue-400/30 hover:shadow-blue-500/10 dark:border-white/10"
      }`}
    >
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 h-1 ${
          color === "green"
            ? "bg-gradient-to-r from-green-400 via-emerald-300 to-cyan-300"
            : "bg-gradient-to-r from-red-400 via-rose-300 to-orange-300"
        }`}
      ></div>

      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
            Instrument
          </p>
          <h2 className="mt-2 break-words text-2xl font-semibold text-slate-950 dark:text-white">
            {name}
          </h2>
        </div>
        <div
          className={`flex h-11 w-11 items-center justify-center rounded-2xl ${
            color === "green"
              ? "bg-green-400/10 text-green-400"
              : "bg-red-400/10 text-red-400"
          }`}
        >
          {color === "green" ? <ArrowUpRight size={22} /> : <ArrowDownRight size={22} />}
        </div>
      </div>

      <p
        className={`inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r px-3 py-2 text-3xl font-bold transition duration-300 ${
          color === "green"
            ? "from-green-400/15 to-cyan-400/10 text-green-400 group-hover:drop-shadow-[0_0_12px_rgba(74,222,128,0.45)]"
            : "from-red-400/15 to-orange-400/10 text-red-400 group-hover:drop-shadow-[0_0_12px_rgba(248,113,113,0.45)]"
        }`}
      >
        {isStrongSignal ? <ShieldCheck size={22} /> : null}
        {signal}
      </p>

      <div className="mt-4 w-full bg-slate-200 dark:bg-gray-700 rounded-full h-3">
        <div
          className={`h-3 rounded-full transition-all duration-700 ${
            color === "green"
              ? "bg-green-400 shadow-[0_0_14px_rgba(74,222,128,0.35)]"
              : "bg-red-400 shadow-[0_0_14px_rgba(248,113,113,0.35)]"
          }`}
          style={{ width: `${percentage}%` }}
        ></div>
      </div>
    </div>
  );
}

export default PairCard;
