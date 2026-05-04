import { useEffect, useMemo, useState, type FormEvent } from 'react';

type ForgePlanUser = {
  id: string;
  username?: string | undefined;
  email?: string | undefined;
  firstName?: string | undefined;
  lastName?: string | undefined;
  enabled: boolean;
};

type Props = {
  getAccessToken: () => Promise<string | null>;
  apiBaseUrl?: string | undefined;
  isAdmin: boolean;
};

const configuredUserAdminApiBaseUrl = import.meta.env.VITE_FORGEPLAN_USER_ADMIN_API_BASE_URL?.trim() ?? '';

function normalizeBaseUrl(value: string | undefined): string {
  return value?.trim().replace(/\/+$/, '') ?? '';
}

export function UserManagementPanel({ getAccessToken, apiBaseUrl = configuredUserAdminApiBaseUrl, isAdmin }: Props) {
  const [users, setUsers] = useState<ForgePlanUser[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState({ username: '', email: '', firstName: '', lastName: '', password: '' });
  const baseUrl = useMemo(() => normalizeBaseUrl(apiBaseUrl), [apiBaseUrl]);

  async function request(path: string, init: RequestInit = {}) {
    const token = await getAccessToken();
    if (!token) throw new Error('No hay token Keycloak activo. Vuelve a iniciar sesión.');
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${token}`);
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
    return body;
  }

  async function refreshUsers() {
    if (!isAdmin) return;
    setStatus('Cargando usuarios Keycloak...');
    setError('');
    try {
      const body = await request('/api/admin/users');
      setUsers(Array.isArray(body.users) ? body.users : []);
      setStatus('Usuarios sincronizados desde Keycloak.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('');
    }
  }

  useEffect(() => {
    refreshUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, baseUrl]);

  async function submitUser(event: FormEvent) {
    event.preventDefault();
    if (!form.username.trim()) return;
    setStatus('Creando usuario en Keycloak...');
    setError('');
    try {
      await request('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          username: form.username.trim(),
          email: form.email.trim() || undefined,
          firstName: form.firstName.trim() || undefined,
          lastName: form.lastName.trim() || undefined,
          password: form.password || undefined,
          temporaryPassword: true,
          enabled: true,
        }),
      });
      setForm({ username: '', email: '', firstName: '', lastName: '', password: '' });
      await refreshUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('');
    }
  }

  async function toggleUser(user: ForgePlanUser) {
    setStatus(`${user.enabled ? 'Desactivando' : 'Activando'} ${user.username ?? user.id} en Keycloak...`);
    setError('');
    try {
      await request(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !user.enabled }),
      });
      await refreshUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('');
    }
  }

  async function deleteUser(user: ForgePlanUser) {
    setStatus(`Borrando ${user.username ?? user.id} en Keycloak...`);
    setError('');
    try {
      await request(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: 'DELETE' });
      await refreshUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('');
    }
  }

  if (!isAdmin) {
    return (
      <section className="user-management-card" aria-label="Gestión de usuarios">
        <div className="panel-title">Gestión de usuarios</div>
        <p className="warning">Necesitas rol forgeplan-admin en Keycloak para crear, editar o borrar usuarios.</p>
      </section>
    );
  }

  return (
    <section className="user-management-card" aria-label="Gestión de usuarios">
      <div className="section-heading compact">
        <div>
          <p className="eyebrow"><span className="dot" /> Keycloak access control</p>
          <h2>Gestión de usuarios</h2>
          <p className="muted">Los usuarios se crean, editan y borran realmente en Keycloak. ForgePlan solo actúa como consola delegada.</p>
        </div>
        <button className="secondary-button" onClick={refreshUsers}>Sincronizar</button>
      </div>

      {error && <p className="warning">{error}</p>}
      {status && <p className="muted">{status}</p>}

      <form className="user-management-form" aria-label="Crear usuario Keycloak" onSubmit={submitUser}>
        <label>
          Nombre de usuario Keycloak
          <input value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} />
        </label>
        <label>
          Email
          <input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
        </label>
        <label>
          Nombre
          <input value={form.firstName} onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))} />
        </label>
        <label>
          Apellidos
          <input value={form.lastName} onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value }))} />
        </label>
        <label>
          Contraseña temporal
          <input type="password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} />
        </label>
        <button className="primary-button" type="submit">Crear usuario</button>
      </form>

      <div className="user-table" role="region" aria-label="Usuarios Keycloak">
        {users.map((user) => (
          <article className="user-row" key={user.id}>
            <div>
              <strong>{user.username ?? user.id}</strong>
              <span>{user.email ?? 'sin email'} · {user.enabled ? 'activo' : 'desactivado'}</span>
            </div>
            <div className="user-actions">
              <button className="secondary-button" onClick={() => toggleUser(user)}>{user.enabled ? `Desactivar ${user.username ?? user.id}` : `Activar ${user.username ?? user.id}`}</button>
              <button className="danger-button" onClick={() => deleteUser(user)}>Borrar {user.username ?? user.id}</button>
            </div>
          </article>
        ))}
        {users.length === 0 && <p className="muted">No hay usuarios Keycloak visibles para ForgePlan.</p>}
      </div>
    </section>
  );
}
