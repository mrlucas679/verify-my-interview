import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { CaseProvider } from './store/caseStore';
import { AuthProvider } from './lib/auth';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <AuthProvider>
        <CaseProvider>
          <App />
        </CaseProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
