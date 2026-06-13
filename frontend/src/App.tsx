import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';

const Verify = lazy(() => import('./pages/Verify').then((mod) => ({ default: mod.Verify })));
const Report = lazy(() => import('./pages/Report').then((mod) => ({ default: mod.Report })));

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
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
