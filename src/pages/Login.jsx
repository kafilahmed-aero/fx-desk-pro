import { useState } from "react";
import { Activity, Lock, Mail, Moon, ShieldCheck, Sun } from "lucide-react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";
import { login } from "../services/authService";

function Login({ isAuthenticated, onLogin }) {
  const { isDark, toggleTheme } = useTheme();
  const [email, setEmail] = useState("trader@example.com");
  const [password, setPassword] = useState("password");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const redirectTo = location.state?.from?.pathname || "/dashboard";

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const user = await login({ email, password });
      onLogin(user);
      navigate(redirectTo, { replace: true });
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.18),transparent_34%),linear-gradient(135deg,#f8fafc,#e2e8f0)] px-5 py-10 text-slate-950 transition-colors duration-300 dark:bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.22),transparent_36%),linear-gradient(135deg,#07101f,#0B1120_55%,#111827)] dark:text-white">
      <div className="animate-dashboard-in w-full max-w-md rounded-3xl border border-white/70 bg-white/80 p-6 shadow-2xl shadow-slate-200/70 backdrop-blur-2xl transition-colors duration-300 dark:border-white/10 dark:bg-white/[0.07] dark:shadow-blue-500/10 sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-400 text-white shadow-lg shadow-blue-500/25">
          <Activity size={24} />
        </div>
        <p className="text-sm font-semibold uppercase tracking-widest text-blue-500 dark:text-blue-300">
          FX Desk Pro
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950 dark:text-white">
          Sign in to Forex Consensus
        </h1>
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-blue-400/30 hover:bg-blue-500/10 hover:text-blue-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-blue-400/10 dark:hover:text-blue-300"
          >
            {isDark ? <Sun size={14} /> : <Moon size={14} />}
            {isDark ? "Light" : "Dark"}
          </button>
        </div>
        <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
          Use any email and password for this local demo authentication flow.
        </p>

        <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
          <div>
            <label
              className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300"
              htmlFor="email"
            >
              <Mail size={15} />
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 dark:border-white/10 dark:bg-[#080E1B] dark:text-white"
              placeholder="trader@example.com"
            />
          </div>

          <div>
            <label
              className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300"
              htmlFor="password"
            >
              <Lock size={15} />
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 dark:border-white/10 dark:bg-[#080E1B] dark:text-white"
              placeholder="Enter password"
            />
          </div>

          {error ? (
            <p className="rounded-lg border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm font-medium text-red-300">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isLoading}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-cyan-400 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-blue-500/25 transition hover:-translate-y-0.5 hover:shadow-blue-500/40 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isLoading ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"></span>
                Signing in
              </>
            ) : (
              <>
                <ShieldCheck size={17} />
                Sign in
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

export default Login;
