import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Landing } from './pages/Landing';
import { NewCase } from './pages/NewCase';
import { Report } from './pages/Report';
import { IntelligenceNetwork } from './pages/IntelligenceNetwork';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Landing />} />
        <Route path="/how-it-works" element={<Landing />} />
        <Route path="/new" element={<NewCase />} />
        <Route path="/report" element={<Report />} />
        <Route path="/network" element={<IntelligenceNetwork />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
