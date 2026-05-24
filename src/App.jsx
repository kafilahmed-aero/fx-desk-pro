import PairCard from "./components/PairCard";

function App() {
  const pairs = [
    { name: "GOLD", signal: "82% BUY", color: "green", percentage: 82 },
    { name: "EURUSD", signal: "61% SELL", color: "red", percentage: 61 },
    { name: "GBPUSD", signal: "55% BUY", color: "green", percentage: 55 },
    { name: "USDJPY", signal: "73% SELL", color: "red", percentage: 73 },
  ];

  return (
    <div className="min-h-screen bg-[#0B1120] text-white p-8">
      
      <h1 className="text-4xl font-bold text-center text-blue-400 mb-10">
        Forex Consensus Dashboard
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {pairs.map((pair, index) => (
          <PairCard
            key={index}
            name={pair.name}
            signal={pair.signal}
            color={pair.color}
            percentage={pair.percentage}
          />
        ))}
      </div>
    </div>
  );
}

export default App;
