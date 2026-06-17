import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useCase } from './store/caseStore';

const Verify = lazy(() => import('./pages/Verify').then((mod) => ({ default: mod.Verify })));
const Report = lazy(() => import('./pages/Report').then((mod) => ({ default: mod.Report })));

// /s/:id — load a previously shared report into the case store, then render the
// same dossier. Report handles its own loading/error/empty states.
function SharedReportRoute() {
  const { id } = useParams();
  const { loadShared } = useCase();
  useEffect(() => {
    if (id) void loadShared(id);
  }, [id, loadShared]);
  return <Report />;
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
            <Route path="/" element={<Verify />} />
            <Route path="/report" element={<Report />} />
            <Route path="/s/:id" element={<SharedReportRoute />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
