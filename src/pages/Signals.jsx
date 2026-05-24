import { Inbox, RadioTower } from "lucide-react";

function Signals() {
  return (
    <div className="animate-dashboard-in">
      <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
        <RadioTower size={16} />
        Signal Center
      </p>
      <h2 className="mt-2 text-3xl font-bold text-blue-500 dark:text-blue-400 sm:text-4xl">
        Signals
      </h2>

      <div className="mt-8 rounded-2xl border border-white/70 bg-white/75 p-6 shadow-xl shadow-slate-200/70 backdrop-blur-xl transition-colors duration-300 dark:border-white/10 dark:bg-white/[0.06] dark:shadow-black/10">
        <h3 className="inline-flex items-center gap-2 text-lg font-semibold text-slate-950 dark:text-white">
          <Inbox className="text-blue-500 dark:text-blue-300" size={19} />
          Signal Inbox
        </h3>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">
          Telegram-derived signals, filters, and review workflows will live
          here when the integration is connected.
        </p>
      </div>
    </div>
  );
}

export default Signals;
