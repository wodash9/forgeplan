import React from 'react';
import { createRoot } from 'react-dom/client';

import { AuthProvider } from './AuthProvider.js';
import App from './App.js';
import LandingPage from './LandingPage.js';
import PlatformApp from './PlatformApp.js';

function Root() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/demo') return <App />;
  if (path === '/app') {
    return (
      <AuthProvider>
        <PlatformApp />
      </AuthProvider>
    );
  }
  return <LandingPage />;
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
