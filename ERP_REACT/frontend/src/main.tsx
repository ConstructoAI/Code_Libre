/**
 * ERP React Frontend - Entry Point
 */

// Capture OAuth callback params BEFORE React boots (prevents loss on redirect)
(() => {
  const url = new URL(window.location.href);
  if (url.searchParams.get('callback') === 'quickbooks' && url.searchParams.get('code')) {
    sessionStorage.setItem('qb_oauth_callback', JSON.stringify({
      code: url.searchParams.get('code'),
      realmId: url.searchParams.get('realmId') || '',
      state: url.searchParams.get('state') || '',
    }));
  }
})();

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
