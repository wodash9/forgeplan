import App from './App.js';
import { useAuth } from './AuthProvider.js';
import { hasAdminRole } from './authConfig.js';
import { UserManagementPanel } from './UserManagementPanel.js';

export default function PlatformApp() {
  const auth = useAuth();

  if (auth.isLoading) {
    return <main className="platform-auth-shell"><p className="muted">Cargando sesión Keycloak...</p></main>;
  }

  if (!auth.isAuthenticated) {
    return (
      <main className="platform-auth-shell">
        <section className="platform-login-card">
          <p className="eyebrow"><span className="dot" /> Plataforma ForgePlan</p>
          <h1>Acceso con Keycloak</h1>
          <p className="muted">Entra para acceder a la plataforma y, si tienes rol <code>forgeplan-admin</code>, gestionar usuarios reales de Keycloak desde ForgePlan.</p>
          {auth.error && <p className="warning">{auth.error}</p>}
          <div className="platform-actions">
            <button className="primary-button" onClick={auth.login}>Entrar con Keycloak</button>
            {import.meta.env.MODE === 'development' && <button className="secondary-button" onClick={auth.continueLocally}>Continuar local</button>}
            <a className="secondary-button" href="/demo">Abrir demo pública</a>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main>
      <nav className="platform-userbar" aria-label="ForgePlan platform user">
        <a className="platform-brand" href="/">ForgePlan</a>
        <span>{auth.user?.name}</span>
        <button className="secondary-button" onClick={auth.logout}>Salir</button>
      </nav>
      <UserManagementPanel getAccessToken={auth.getAccessToken} isAdmin={hasAdminRole(auth.user)} />
      <App />
    </main>
  );
}
