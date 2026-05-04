import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserManagementPanel } from '../src/app/UserManagementPanel.js';

describe('ForgePlan Keycloak user management panel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('lists, creates, disables, and deletes users through the ForgePlan admin API using the Keycloak access token', async () => {
    const user = userEvent.setup();
    const requests: Array<{ url: string; method: string; auth: string | null; body?: unknown }> = [];
    let users: Array<{ id: string; username: string; email?: string; firstName?: string; lastName?: string; enabled: boolean }> = [
      { id: 'user-1', username: 'planner', email: 'planner@example.com', firstName: 'Plan', lastName: 'Ner', enabled: true },
    ];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      const method = init?.method ?? 'GET';
      const auth = init?.headers instanceof Headers
        ? init.headers.get('authorization')
        : Array.isArray(init?.headers)
          ? new Headers(init.headers).get('authorization')
          : new Headers(init?.headers).get('authorization');
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      requests.push({ url: href, method, auth, body });

      if (method === 'GET') return Response.json({ users });
      if (method === 'POST') {
        users = [...users, { id: 'user-2', username: body.username, email: body.email, enabled: true }];
        return Response.json({ user: users.at(-1) }, { status: 201 });
      }
      if (method === 'PATCH') {
        users = users.map((item) => item.id === 'user-1' ? { ...item, enabled: body.enabled } : item);
        return Response.json({ user: users.find((item) => item.id === 'user-1') });
      }
      if (method === 'DELETE') {
        users = users.filter((item) => item.id !== 'user-1');
        return Response.json({ deleted: true, id: 'user-1' });
      }
      return Response.json({ error: { message: 'unexpected' } }, { status: 500 });
    }));

    render(<UserManagementPanel getAccessToken={async () => 'keycloak-access-token'} apiBaseUrl="" isAdmin />);

    expect(await screen.findByText('planner')).toBeInTheDocument();
    expect(screen.getByText(/planner@example\.com/)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Nombre de usuario Keycloak'), 'operator');
    await user.type(screen.getByLabelText('Email'), 'operator@example.com');
    await user.type(screen.getByLabelText('Contraseña temporal'), 'TempPass123!');
    await user.click(screen.getByRole('button', { name: 'Crear usuario' }));

    expect(await screen.findByText('operator')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Desactivar planner' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Activar planner' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Borrar planner' }));
    await waitFor(() => expect(screen.queryByText('planner@example.com')).not.toBeInTheDocument());

    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      'GET /api/admin/users',
      'POST /api/admin/users',
      'GET /api/admin/users',
      'PATCH /api/admin/users/user-1',
      'GET /api/admin/users',
      'DELETE /api/admin/users/user-1',
      'GET /api/admin/users',
    ]);
    expect(requests.every((request) => request.auth === 'Bearer keycloak-access-token')).toBe(true);
  });

  it('hides the user administration controls for non-admin users', () => {
    render(<UserManagementPanel getAccessToken={async () => 'token'} apiBaseUrl="" isAdmin={false} />);

    expect(screen.getByText(/Necesitas rol forgeplan-admin/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Crear usuario' })).not.toBeInTheDocument();
  });
});
