import { lazy, Suspense, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Check, Copy, Loader2, LogIn } from 'lucide-react';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useCase } from './store/caseStore';
import { readAuthDiagnosticText, useAuth } from './lib/auth';

const Workspace = lazy(() => import('./pages/Workspace').then((mod) => ({ default: mod.Workspace })));
const History = lazy(() => import('./pages/History').then((mod) => ({ default: mod.History })));
const AdminReports = lazy(() => import('./pages/AdminReports').then((mod) => ({ default: mod.AdminReports })));
const PrivacyNotice = lazy(() => import('./pages/Legal').then((mod) => ({ default: mod.PrivacyNotice })));
const TermsNotice = lazy(() => import('./pages/Legal').then((mod) => ({ default: mod.TermsNotice })));

// /s/:id loads a shared dossier into the same investigation workspace.
function SharedReportRoute() {
  const { id } = useParams();
  const { loadShared } = useCase();
  useEffect(() => {
    if (id) void loadShared(id);
  }, [id, loadShared]);
  return <Workspace />;
}

function RouteFallback() {
  return (
    <div className="grid min-h-screen place-items-center bg-ink-950 px-6">
      <div className="surface px-5 py-4 font-mono text-sm text-muted" role="status">
        Opening your check workspace...
      </div>
    </div>
  );
}

function AuthCallbackRoute() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (auth.authenticated) navigate('/', { replace: true });
  }, [auth.authenticated, navigate]);

  const retry = () => {
    auth.clearError();
    void auth.signIn();
  };

  const copyDiagnostic = async () => {
    const text = readAuthDiagnosticText();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-2xl place-items-center px-4 py-8 text-center sm:px-6">
      <div className="w-full rounded-xl border border-line bg-ink-850 p-5 shadow-card">
        {!auth.error ? (
          <>
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-accent" strokeWidth={1.75} />
            <h1 className="mt-4 font-display text-xl font-semibold text-white">Completing sign-in</h1>
            <p className="mt-2 text-sm text-muted">Checking the Microsoft response...</p>
          </>
        ) : (
          <>
            <h1 className="font-display text-xl font-semibold text-white">Sign-in was not completed</h1>
            <p className="mt-2 text-sm text-risk-needs" role="alert">{auth.error}</p>
            <button
              type="button"
              onClick={retry}
              disabled={auth.loading || auth.redirecting}
              className="btn-primary mt-5 disabled:opacity-60"
            >
              {auth.redirecting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
              ) : (
                <LogIn className="h-3.5 w-3.5" strokeWidth={1.75} />
              )}
              {auth.redirecting ? 'Opening Microsoft' : 'Try again'}
            </button>
            <button
              type="button"
              onClick={() => void copyDiagnostic()}
              className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-md border border-line bg-ink-800 px-3 py-2 text-xs text-muted transition hover:border-accent/50 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-risk-low" strokeWidth={1.75} /> : <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />}
              {copied ? 'Copied' : 'Copy diagnostic'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Workspace />} />
            <Route path="/history" element={<History />} />
            <Route path="/auth/callback" element={<AuthCallbackRoute />} />
            <Route path="/admin/reports" element={<AdminReports />} />
            <Route path="/privacy" element={<PrivacyNotice />} />
            <Route path="/terms" element={<TermsNotice />} />
            <Route path="/network" element={<Navigate to="/history" replace />} />
            <Route path="/report" element={<Navigate to="/" replace />} />
            <Route path="/s/:id" element={<SharedReportRoute />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
