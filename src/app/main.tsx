import React from 'react';
import { createRoot } from 'react-dom/client';

import App from './App.js';
import LandingPage from './LandingPage.js';

function Root() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  return path === '/demo' || path === '/app' ? <App /> : <LandingPage />;
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
