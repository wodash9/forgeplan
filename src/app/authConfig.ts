export type AuthMode = 'mock' | 'keycloak';

export type AuthEnv = Partial<{
  VITE_AUTH_MODE: string;
  VITE_KEYCLOAK_URL: string;
  VITE_KEYCLOAK_REALM: string;
  VITE_KEYCLOAK_CLIENT_ID: string;
  VITE_KEYCLOAK_ROLE_CLIENT_ID: string;
}>;

export type PublicUser = {
  id: string;
  email?: string | undefined;
  name: string;
  username?: string | undefined;
  roles: string[];
};

export type KeycloakPublicConfig = {
  mode: 'keycloak';
  url: string;
  realm: string;
  clientId: string;
  roleClientId: string;
};

export type MockConfig = { mode: 'mock' };
export type AuthConfig = KeycloakPublicConfig | MockConfig;

export function isMockAllowed(context: { mode: string; hostname: string }): boolean {
  return context.mode === 'development' || ['localhost', '127.0.0.1', '::1'].includes(context.hostname);
}

export function createAuthConfig(env: AuthEnv): AuthConfig {
  const mode = (env.VITE_AUTH_MODE || 'mock') as AuthMode;
  if (mode === 'mock') return { mode: 'mock' };
  if (mode !== 'keycloak') throw new Error(`Unsupported auth mode: ${mode}`);

  const missing = [
    ['VITE_KEYCLOAK_URL', env.VITE_KEYCLOAK_URL],
    ['VITE_KEYCLOAK_REALM', env.VITE_KEYCLOAK_REALM],
    ['VITE_KEYCLOAK_CLIENT_ID', env.VITE_KEYCLOAK_CLIENT_ID],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`Missing Keycloak public config: ${missing.join(', ')}`);

  return {
    mode: 'keycloak',
    url: env.VITE_KEYCLOAK_URL!,
    realm: env.VITE_KEYCLOAK_REALM!,
    clientId: env.VITE_KEYCLOAK_CLIENT_ID!,
    roleClientId: env.VITE_KEYCLOAK_ROLE_CLIENT_ID || env.VITE_KEYCLOAK_CLIENT_ID!,
  };
}

export function getMockUser(): PublicUser {
  return {
    id: 'local-dev-user',
    email: 'dev@localhost',
    name: 'Local Dev User',
    username: 'local-dev-user',
    roles: ['user', 'forgeplan-admin'],
  };
}

export function hasAdminRole(user: PublicUser | null, allowedRoles = ['forgeplan-admin']): boolean {
  return Boolean(user?.roles.some((role) => allowedRoles.includes(role)));
}
