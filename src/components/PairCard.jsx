function PairCard({ name, signal, color, percentage }) {
  return (
    <div className="bg-[#111827] rounded-2xl p-6 shadow-xl border border-white/10 hover:scale-105 transition duration-300">
      <h2 className="text-2xl font-semibold mb-4">
        {name}
      </h2>

      <p
        className={`text-3xl font-bold ${
          color === "green"
            ? "text-green-400"
            : "text-red-400"
        }`}
      >
        {signal}
      </p>

      <div className="mt-4 w-full bg-gray-700 rounded-full h-3">
        <div
          className={`h-3 rounded-full ${
            color === "green"
              ? "bg-green-400"
              : "bg-red-400"
          }`}
          style={{ width: `${percentage}%` }}
        ></div>
      </div>
    </div>
  );
}

export default PairCard;
