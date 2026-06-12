import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Verify } from './pages/Verify';
import { Report } from './pages/Report';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Verify />} />
        <Route path="/report" element={<Report />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
