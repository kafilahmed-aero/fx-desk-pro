import PairCard from "./components/PairCard";

function App() {
  const pairs = [
    { name: "GOLD", signal: "82% BUY", color: "green", percentage: 82 },
    { name: "EURUSD", signal: "61% SELL", color: "red", percentage: 61 },
    { name: "GBPUSD", signal: "55% BUY", color: "green", percentage: 55 },
    { name: "USDJPY", signal: "73% SELL", color: "red", percentage: 73 },
  ];

  const navigationItems = ["Dashboard", "Signals", "Analytics", "Settings"];
  const totalSignals = pairs.length;
  const buySignals = pairs.filter((pair) => pair.color === "green").length;
  const sellSignals = pairs.filter((pair) => pair.color === "red").length;
  const strongestPair = pairs.reduce((strongest, pair) =>
    pair.percentage > strongest.percentage ? pair : strongest
  );

  const stats = [
    { label: "Total Signals", value: totalSignals, accent: "text-blue-400" },
    { label: "Buy Signals", value: buySignals, accent: "text-green-400" },
    { label: "Sell Signals", value: sellSignals, accent: "text-red-400" },
    {
      label: "Strongest Pair",
      value: strongestPair.name,
      accent: "text-cyan-300",
    },
  ];

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="border-b border-white/10 bg-[#080E1B] px-5 py-5 lg:w-64 lg:border-b-0 lg:border-r lg:px-6 lg:py-8">
          <div className="flex items-center justify-between gap-4 lg:block">
            <div>
              <p className="text-sm font-semibold uppercase tracking-widest text-blue-300">
                FX Desk
              </p>
              <h1 className="mt-2 text-2xl font-bold text-white lg:text-3xl">
                Forex Consensus
              </h1>
            </div>
            <div className="hidden rounded-lg border border-blue-400/30 bg-blue-400/10 px-3 py-2 text-sm font-semibold text-blue-200 sm:block lg:mt-8 lg:inline-block">
              Live
            </div>
          </div>

          <nav className="mt-6 flex gap-2 overflow-x-auto lg:mt-10 lg:flex-col lg:overflow-visible">
            {navigationItems.map((item) => (
              <button
                key={item}
                className={`whitespace-nowrap rounded-lg px-4 py-3 text-left text-sm font-semibold transition ${
                  item === "Dashboard"
                    ? "bg-blue-500 text-white shadow-lg shadow-blue-500/20"
                    : "text-slate-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                {item}
              </button>
            ))}
          </nav>
        </aside>

        <main className="flex-1 p-5 sm:p-8">
          <div className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-widest text-slate-400">
                Market Overview
              </p>
              <h2 className="mt-2 text-3xl font-bold text-blue-400 sm:text-4xl">
                Forex Consensus Dashboard
              </h2>
            </div>
            <p className="text-sm font-medium text-slate-400">
              {totalSignals} tracked pairs
            </p>
          </div>

          <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-lg border border-white/10 bg-[#111827] p-5 shadow-xl"
              >
                <p className="text-sm font-medium text-slate-400">
                  {stat.label}
                </p>
                <p className={`mt-3 text-3xl font-bold ${stat.accent}`}>
                  {stat.value}
                </p>
              </div>
            ))}
          </section>

          <section className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
            {pairs.map((pair, index) => (
              <PairCard
                key={index}
                name={pair.name}
                signal={pair.signal}
                color={pair.color}
                percentage={pair.percentage}
              />
            ))}
          </section>
        </main>
      </div>
    </div>
  );
}

export default App;
