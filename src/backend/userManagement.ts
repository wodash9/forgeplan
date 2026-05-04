export interface ForgePlanAdminIdentity {
  id: string;
  username: string;
  roles: string[];
}

export interface ForgePlanUserSummary {
  id: string;
  username?: string | undefined;
  email?: string | undefined;
  firstName?: string | undefined;
  lastName?: string | undefined;
  enabled: boolean;
}

export interface CreateForgePlanUserInput {
  username?: unknown;
  email?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  enabled?: unknown;
  password?: unknown;
  temporaryPassword?: unknown;
}

export interface UpdateForgePlanUserInput {
  username?: unknown;
  email?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  enabled?: unknown;
  password?: unknown;
  temporaryPassword?: unknown;
}

export interface UserManagementAdapter {
  isConfigured(): boolean;
  configurationMessage?: string | undefined;
  requireUser(request: Request): Promise<ForgePlanAdminIdentity>;
  requireAdmin(request: Request): Promise<ForgePlanAdminIdentity>;
  listUsers(params: { search?: string | undefined }, admin: ForgePlanAdminIdentity): Promise<ForgePlanUserSummary[]>;
  createUser(input: unknown, admin: ForgePlanAdminIdentity): Promise<ForgePlanUserSummary>;
  updateUser(id: string, input: unknown, admin: ForgePlanAdminIdentity): Promise<ForgePlanUserSummary>;
  deleteUser(id: string, admin: ForgePlanAdminIdentity): Promise<void>;
}

type FetchLike = typeof fetch;

type KeycloakAdminConfig = {
  baseUrl: string;
  realm: string;
  adminClientId: string;
  adminClientSecret: string;
  roleClientId: string;
  allowedAdminRoles: string[];
};

type KeycloakTokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type KeycloakUserRepresentation = {
  id?: string;
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled?: boolean;
};

type IntrospectionResponse = {
  active?: boolean;
  sub?: string;
  username?: string;
  preferred_username?: string;
  email?: string;
  scope?: string;
  realm_access?: { roles?: string[] };
  resource_access?: Record<string, { roles?: string[] }>;
  roles?: string[];
  error?: string;
  error_description?: string;
};

export class UserManagementError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly details?: unknown) {
    super(message);
  }
}

export function createUnavailableUserManagementAdapter(message = 'Keycloak user management is not configured on this ForgePlan server.'): UserManagementAdapter {
  return {
    configurationMessage: message,
    isConfigured: () => false,
    async requireUser() {
      throw new UserManagementError(503, 'user_management_unavailable', message);
    },
    async requireAdmin() {
      throw new UserManagementError(503, 'user_management_unavailable', message);
    },
    async listUsers() {
      throw new UserManagementError(503, 'user_management_unavailable', message);
    },
    async createUser() {
      throw new UserManagementError(503, 'user_management_unavailable', message);
    },
    async updateUser() {
      throw new UserManagementError(503, 'user_management_unavailable', message);
    },
    async deleteUser() {
      throw new UserManagementError(503, 'user_management_unavailable', message);
    },
  };
}

export function createKeycloakUserManagementFromEnv(env: NodeJS.ProcessEnv = process.env, fetchImpl: FetchLike = fetch): UserManagementAdapter {
  const baseUrl = trimEnv(env.FORGEPLAN_KEYCLOAK_URL ?? env.KEYCLOAK_BASE_URL ?? env.KEYCLOAK_URL);
  const realm = trimEnv(env.FORGEPLAN_KEYCLOAK_REALM ?? env.KEYCLOAK_REALM);
  const adminClientId = trimEnv(env.FORGEPLAN_KEYCLOAK_ADMIN_CLIENT_ID ?? env.KEYCLOAK_ADMIN_CLIENT_ID);
  const adminClientSecret = trimEnv(env.FORGEPLAN_KEYCLOAK_ADMIN_CLIENT_SECRET ?? env.KEYCLOAK_ADMIN_CLIENT_SECRET);
  const roleClientId = trimEnv(env.FORGEPLAN_KEYCLOAK_ROLE_CLIENT_ID ?? env.FORGEPLAN_KEYCLOAK_CLIENT_ID ?? env.VITE_KEYCLOAK_CLIENT_ID) ?? adminClientId;
  const allowedAdminRoles = (env.FORGEPLAN_ADMIN_ROLES ?? 'forgeplan-admin')
    .split(',')
    .map((role) => role.trim())
    .filter(Boolean);

  const missing = [
    ['FORGEPLAN_KEYCLOAK_URL/KEYCLOAK_BASE_URL', baseUrl],
    ['FORGEPLAN_KEYCLOAK_REALM/KEYCLOAK_REALM', realm],
    ['FORGEPLAN_KEYCLOAK_ADMIN_CLIENT_ID/KEYCLOAK_ADMIN_CLIENT_ID', adminClientId],
    ['FORGEPLAN_KEYCLOAK_ADMIN_CLIENT_SECRET/KEYCLOAK_ADMIN_CLIENT_SECRET', adminClientSecret],
  ].filter(([, value]) => !value).map(([name]) => name);

  if (missing.length > 0) {
    return createUnavailableUserManagementAdapter(`Keycloak user management is disabled. Missing server env: ${missing.join(', ')}.`);
  }

  return new KeycloakUserManagementAdapter({
    baseUrl: baseUrl!.replace(/\/+$/, ''),
    realm: realm!,
    adminClientId: adminClientId!,
    adminClientSecret: adminClientSecret!,
    roleClientId: roleClientId!,
    allowedAdminRoles,
  }, fetchImpl);
}

class KeycloakUserManagementAdapter implements UserManagementAdapter {
  private adminToken: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: KeycloakAdminConfig, private readonly fetchImpl: FetchLike) {}

  isConfigured(): boolean {
    return true;
  }

  async requireUser(request: Request): Promise<ForgePlanAdminIdentity> {
    const body = await this.introspectBearer(request);
    const roles = extractRoles(body, this.config.roleClientId);
    return {
      id: body.sub ?? body.username ?? body.preferred_username ?? 'keycloak-user',
      username: body.preferred_username ?? body.username ?? body.email ?? 'keycloak-user',
      roles,
    };
  }

  async requireAdmin(request: Request): Promise<ForgePlanAdminIdentity> {
    const identity = await this.requireUser(request);
    const hasAllowedRole = identity.roles.some((role) => this.config.allowedAdminRoles.includes(role));
    if (!hasAllowedRole) {
      throw new UserManagementError(403, 'forbidden_user_management', `User management requires one of these Keycloak roles: ${this.config.allowedAdminRoles.join(', ')}.`);
    }
    return identity;
  }

  private async introspectBearer(request: Request): Promise<IntrospectionResponse> {
    const bearer = parseBearerToken(request.headers.get('authorization'));
    if (!bearer) throw new UserManagementError(401, 'missing_bearer_token', 'ForgePlan API access requires a Keycloak bearer token.');

    const form = new URLSearchParams({
      client_id: this.config.adminClientId,
      client_secret: this.config.adminClientSecret,
      token: bearer,
    });
    const response = await this.fetchImpl(this.realmUrl('/protocol/openid-connect/token/introspect'), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    const body = await safeJson<IntrospectionResponse>(response);
    if (!response.ok) {
      throw new UserManagementError(502, 'keycloak_introspection_failed', keycloakErrorMessage(body, 'Keycloak token introspection failed.'), body);
    }
    if (!body.active) throw new UserManagementError(401, 'inactive_bearer_token', 'The ForgePlan bearer token is not active.');
    return body;
  }

  async listUsers(params: { search?: string | undefined }): Promise<ForgePlanUserSummary[]> {
    const query = new URLSearchParams({ max: '100' });
    if (params.search?.trim()) query.set('search', params.search.trim());
    const response = await this.fetchImpl(`${this.adminUrl('/users')}?${query.toString()}`, {
      headers: await this.adminHeaders(),
    });
    const body = await safeJson<KeycloakUserRepresentation[]>(response);
    if (!response.ok) throw this.keycloakAdminError(response.status, body, 'Could not list Keycloak users.');
    return Array.isArray(body) ? body.map(toUserSummary).filter(hasUserId) : [];
  }

  async createUser(input: unknown): Promise<ForgePlanUserSummary> {
    const parsed = parseCreateUserInput(input);
    const response = await this.fetchImpl(this.adminUrl('/users'), {
      method: 'POST',
      headers: await this.adminHeaders(),
      body: JSON.stringify(toKeycloakCreateUser(parsed)),
    });
    const body = await safeJson<unknown>(response);
    if (!response.ok) throw this.keycloakAdminError(response.status, body, 'Could not create Keycloak user.');

    const createdId = keycloakUserIdFromLocation(response.headers.get('location'))
      ?? await this.findUserIdByUsername(parsed.username);
    if (!createdId) throw new UserManagementError(502, 'keycloak_user_missing', 'Keycloak created the user but did not return a user id.');

    if (parsed.password) await this.resetPassword(createdId, parsed.password, parsed.temporaryPassword);
    return await this.getUser(createdId);
  }

  async updateUser(id: string, input: unknown): Promise<ForgePlanUserSummary> {
    const safeId = requireUserId(id);
    const parsed = parseUpdateUserInput(input);
    const response = await this.fetchImpl(this.adminUrl(`/users/${encodeURIComponent(safeId)}`), {
      method: 'PUT',
      headers: await this.adminHeaders(),
      body: JSON.stringify(toKeycloakUpdateUser(parsed)),
    });
    const body = await safeJson<unknown>(response);
    if (!response.ok) throw this.keycloakAdminError(response.status, body, 'Could not update Keycloak user.');
    if (parsed.password) await this.resetPassword(safeId, parsed.password, parsed.temporaryPassword);
    return await this.getUser(safeId);
  }

  async deleteUser(id: string): Promise<void> {
    const safeId = requireUserId(id);
    const response = await this.fetchImpl(this.adminUrl(`/users/${encodeURIComponent(safeId)}`), {
      method: 'DELETE',
      headers: await this.adminHeaders(),
    });
    if (response.status === 404) throw new UserManagementError(404, 'keycloak_user_not_found', `Keycloak user ${safeId} does not exist.`);
    if (!response.ok) throw this.keycloakAdminError(response.status, await safeJson<unknown>(response), 'Could not delete Keycloak user.');
  }

  private async getUser(id: string): Promise<ForgePlanUserSummary> {
    const response = await this.fetchImpl(this.adminUrl(`/users/${encodeURIComponent(id)}`), {
      headers: await this.adminHeaders(),
    });
    const body = await safeJson<KeycloakUserRepresentation>(response);
    if (!response.ok) throw this.keycloakAdminError(response.status, body, 'Could not read Keycloak user.');
    return toUserSummary(body);
  }

  private async resetPassword(id: string, password: string, temporaryPassword: boolean): Promise<void> {
    const response = await this.fetchImpl(this.adminUrl(`/users/${encodeURIComponent(id)}/reset-password`), {
      method: 'PUT',
      headers: await this.adminHeaders(),
      body: JSON.stringify({ type: 'password', value: password, temporary: temporaryPassword }),
    });
    if (!response.ok) throw this.keycloakAdminError(response.status, await safeJson<unknown>(response), 'Could not set Keycloak user password.');
  }

  private async findUserIdByUsername(username: string): Promise<string | undefined> {
    const query = new URLSearchParams({ username, exact: 'true', max: '1' });
    const response = await this.fetchImpl(`${this.adminUrl('/users')}?${query.toString()}`, {
      headers: await this.adminHeaders(),
    });
    const body = await safeJson<KeycloakUserRepresentation[]>(response);
    if (!response.ok || !Array.isArray(body)) return undefined;
    return body[0]?.id;
  }

  private async adminHeaders(): Promise<HeadersInit> {
    return {
      authorization: `Bearer ${await this.getAdminToken()}`,
      'content-type': 'application/json',
    };
  }

  private async getAdminToken(): Promise<string> {
    const now = Date.now();
    if (this.adminToken && this.adminToken.expiresAt > now + 10_000) return this.adminToken.value;

    const form = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.adminClientId,
      client_secret: this.config.adminClientSecret,
    });
    const response = await this.fetchImpl(this.realmUrl('/protocol/openid-connect/token'), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    const body = await safeJson<KeycloakTokenResponse>(response);
    if (!response.ok || !body.access_token) {
      throw new UserManagementError(502, 'keycloak_admin_token_failed', keycloakErrorMessage(body, 'Could not obtain a Keycloak admin token.'), body);
    }
    this.adminToken = {
      value: body.access_token,
      expiresAt: now + Math.max(1, body.expires_in ?? 30) * 1000,
    };
    return this.adminToken.value;
  }

  private realmUrl(path: string): string {
    return `${this.config.baseUrl}/realms/${encodeURIComponent(this.config.realm)}${path}`;
  }

  private adminUrl(path: string): string {
    return `${this.config.baseUrl}/admin/realms/${encodeURIComponent(this.config.realm)}${path}`;
  }

  private keycloakAdminError(status: number, body: unknown, fallback: string): UserManagementError {
    const code = status === 404 ? 'keycloak_user_not_found' : 'keycloak_admin_error';
    return new UserManagementError(status === 404 ? 404 : 502, code, keycloakErrorMessage(body, fallback), body);
  }
}

function trimEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseBearerToken(header: string | null): string | undefined {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}

function extractRoles(body: IntrospectionResponse, roleClientId: string): string[] {
  const roles = new Set<string>();
  for (const role of body.realm_access?.roles ?? []) roles.add(role);
  for (const role of body.resource_access?.[roleClientId]?.roles ?? []) roles.add(role);
  return Array.from(roles).filter(Boolean);
}

async function safeJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text.trim()) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

function keycloakErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const description = record.error_description;
    const error = record.error;
    if (typeof description === 'string' && description.trim()) return description;
    if (typeof error === 'string' && error.trim()) return error;
  }
  if (typeof body === 'string' && body.trim()) return body.slice(0, 500);
  return fallback;
}

function parseCreateUserInput(input: unknown) {
  const record = requireObject(input);
  const username = requireNonEmptyString(record.username, 'username');
  const email = optionalNonEmptyString(record.email, 'email');
  const password = optionalNonEmptyString(record.password, 'password');
  if (password && password.length < 8) throw new UserManagementError(400, 'invalid_user_input', 'password must be at least 8 characters.');
  return {
    username,
    email,
    firstName: optionalNonEmptyString(record.firstName, 'firstName'),
    lastName: optionalNonEmptyString(record.lastName, 'lastName'),
    enabled: optionalBoolean(record.enabled, true, 'enabled'),
    password,
    temporaryPassword: optionalBoolean(record.temporaryPassword, true, 'temporaryPassword'),
  };
}

function parseUpdateUserInput(input: unknown) {
  const record = requireObject(input);
  const password = optionalNonEmptyString(record.password, 'password');
  if (password && password.length < 8) throw new UserManagementError(400, 'invalid_user_input', 'password must be at least 8 characters.');
  return {
    username: optionalNonEmptyString(record.username, 'username'),
    email: optionalNonEmptyString(record.email, 'email'),
    firstName: optionalNonEmptyString(record.firstName, 'firstName'),
    lastName: optionalNonEmptyString(record.lastName, 'lastName'),
    enabled: optionalBoolean(record.enabled, undefined, 'enabled'),
    password,
    temporaryPassword: optionalBoolean(record.temporaryPassword, true, 'temporaryPassword'),
  };
}

function requireObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new UserManagementError(400, 'invalid_user_input', 'Expected a JSON object.');
  }
  return input as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new UserManagementError(400, 'invalid_user_input', `${field} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalNonEmptyString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return requireNonEmptyString(value, field);
}

function optionalBoolean(value: unknown, fallback: boolean, field: string): boolean;
function optionalBoolean(value: unknown, fallback: undefined, field: string): boolean | undefined;
function optionalBoolean(value: unknown, fallback: boolean | undefined, field: string): boolean | undefined {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw new UserManagementError(400, 'invalid_user_input', `${field} must be a boolean.`);
  return value;
}

function requireUserId(id: string): string {
  let safeId: string;
  try {
    safeId = decodeURIComponent(id).trim();
  } catch {
    throw new UserManagementError(400, 'invalid_user_input', 'User id is not valid URL encoding.');
  }
  if (!safeId) throw new UserManagementError(400, 'invalid_user_input', 'User id is required.');
  if (safeId === '.' || safeId === '..' || safeId.includes('/') || safeId.includes('\\') || safeId.includes('%') || /[\u0000-\u001f\u007f]/.test(safeId)) {
    throw new UserManagementError(400, 'invalid_user_input', 'User id contains unsafe path characters.');
  }
  return safeId;
}

function toKeycloakCreateUser(input: ReturnType<typeof parseCreateUserInput>): KeycloakUserRepresentation {
  const user: KeycloakUserRepresentation = { username: input.username, enabled: input.enabled };
  if (input.email) user.email = input.email;
  if (input.firstName) user.firstName = input.firstName;
  if (input.lastName) user.lastName = input.lastName;
  return user;
}

function toKeycloakUpdateUser(input: ReturnType<typeof parseUpdateUserInput>): KeycloakUserRepresentation {
  const user: KeycloakUserRepresentation = {};
  if (input.username) user.username = input.username;
  if (input.email) user.email = input.email;
  if (input.firstName) user.firstName = input.firstName;
  if (input.lastName) user.lastName = input.lastName;
  if (input.enabled !== undefined) user.enabled = input.enabled;
  return user;
}

function keycloakUserIdFromLocation(location: string | null): string | undefined {
  if (!location) return undefined;
  return location.split('/').filter(Boolean).pop();
}

function toUserSummary(user: KeycloakUserRepresentation): ForgePlanUserSummary {
  return {
    id: user.id ?? '',
    username: user.username,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    enabled: user.enabled ?? false,
  };
}

function hasUserId(user: ForgePlanUserSummary): boolean {
  return user.id.length > 0;
}
