import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useCase } from './store/caseStore';

const Workspace = lazy(() => import('./pages/Workspace').then((mod) => ({ default: mod.Workspace })));
const History = lazy(() => import('./pages/History').then((mod) => ({ default: mod.History })));

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

export default function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Workspace />} />
            <Route path="/history" element={<History />} />
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
