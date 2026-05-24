function App() {
  const pairs = [
    { name: "GOLD", signal: "82% BUY", color: "green" },
    { name: "EURUSD", signal: "61% SELL", color: "red" },
    { name: "GBPUSD", signal: "55% BUY", color: "green" },
    { name: "USDJPY", signal: "73% SELL", color: "red" },
  ];

  return (
    <div className="min-h-screen bg-[#0B1120] text-white p-8">
      
      <h1 className="text-4xl font-bold text-center text-green-400 mb-10">
        Forex Consensus Dashboard
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {pairs.map((pair, index) => (
          <div
            key={index}
            className="bg-[#111827] rounded-2xl p-6 shadow-xl border border-white/10 hover:scale-105 transition duration-300"
          >
            <h2 className="text-2xl font-semibold mb-4">
              {pair.name}
            </h2>

            <p
              className={`text-3xl font-bold ${
                pair.color === "green"
                  ? "text-green-400"
                  : "text-red-400"
              }`}
            >
              {pair.signal}
            </p>

            <div className="mt-4 w-full bg-gray-700 rounded-full h-3">
              <div
                className={`h-3 rounded-full ${
                  pair.color === "green"
                    ? "bg-green-400"
                    : "bg-red-400"
                }`}
                style={{
                  width:
                    pair.signal.includes("82")
                      ? "82%"
                      : pair.signal.includes("61")
                      ? "61%"
                      : pair.signal.includes("55")
                      ? "55%"
                      : "73%",
                }}
              ></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;