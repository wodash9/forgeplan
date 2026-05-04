import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

import { createForgePlanApi } from './api.js';
import { ForgePlanLocalStore } from '../storage/localStore.js';

const MAX_REQUEST_BODY_BYTES = 1_000_000;
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export interface ForgePlanServerOptions {
  dbPath: string;
  port?: number | undefined;
  host?: string | undefined;
  staticDir?: string | undefined;
}

export function createForgePlanServer({ dbPath, port = 8787, host = '127.0.0.1', staticDir }: ForgePlanServerOptions) {
  validateSafeHost(host);
  const store = new ForgePlanLocalStore(dbPath);
  const api = createForgePlanApi({ store });
  const resolvedStaticDir = staticDir ? resolve(staticDir) : undefined;
  const server = createServer(async (incoming, outgoing) => {
    try {
      const request = await toWebRequest(incoming, host, port);
      const url = new URL(request.url);
      const response = url.pathname.startsWith('/api/') || url.pathname === '/api'
        ? await api.fetch(request)
        : await serveStaticAsset(resolvedStaticDir, url.pathname);
      await writeWebResponse(outgoing, response);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        outgoing.writeHead(413, { 'content-type': 'application/json; charset=utf-8' });
        outgoing.end(JSON.stringify({ error: { code: 'payload_too_large', message: error.message } }));
        return;
      }
      outgoing.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      outgoing.end(JSON.stringify({ error: { code: 'internal_error', message: error instanceof Error ? error.message : 'Unexpected server error.' } }));
    }
  });

  server.on('close', () => store.close());
  return { server, store, host, port };
}

async function toWebRequest(incoming: IncomingMessage, host: string, port: number): Promise<Request> {
  const declaredLength = Number(incoming.headers['content-length'] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) {
    throw new PayloadTooLargeError(`Request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes.`);
  }

  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  for await (const chunk of incoming) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.byteLength;
    if (receivedBytes > MAX_REQUEST_BODY_BYTES) {
      throw new PayloadTooLargeError(`Request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes.`);
    }
    chunks.push(buffer);
  }
  const url = new URL(incoming.url ?? '/', `http://${incoming.headers.host ?? `${host}:${port}`}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) headers.set(key, value.join(', '));
    else if (typeof value === 'string') headers.set(key, value);
  }

  const method = incoming.method ?? 'GET';
  const init: RequestInit = { method, headers };
  if (method !== 'GET' && method !== 'HEAD') init.body = Buffer.concat(chunks);
  return new Request(url, init);
}

function validateSafeHost(host: string): void {
  if (LOCAL_HOSTS.has(host)) return;
  if (process.env.FORGEPLAN_UNSAFE_BIND_ALL === '1') return;
  throw new Error(`Unsafe ForgePlan host ${host}. Bind to 127.0.0.1/localhost, or set FORGEPLAN_UNSAFE_BIND_ALL=1 intentionally.`);
}

async function serveStaticAsset(staticDir: string | undefined, pathname: string): Promise<Response> {
  if (!staticDir) return jsonResponse(404, { error: { code: 'not_found', message: `Route ${pathname} does not exist.` } });
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return jsonResponse(400, { error: { code: 'invalid_path', message: 'Static asset path is not valid URL encoding.' } });
  }
  const normalizedPath = normalize(decodedPath).replace(/^(\.\.([/\\]|$))+/, '');
  const relativePath = normalizedPath === sep || normalizedPath === '.' ? 'index.html' : normalizedPath.replace(/^[/\\]+/, '');
  const candidatePath = resolve(join(staticDir, relativePath));
  if (!candidatePath.startsWith(`${staticDir}${sep}`) && candidatePath !== staticDir) {
    return jsonResponse(403, { error: { code: 'forbidden', message: 'Static asset path is outside the configured directory.' } });
  }

  const assetResponse = await tryReadStaticFile(candidatePath);
  if (assetResponse) return assetResponse;
  if (!extname(relativePath)) {
    const fallbackResponse = await tryReadStaticFile(join(staticDir, 'index.html'));
    if (fallbackResponse) return fallbackResponse;
  }
  return jsonResponse(404, { error: { code: 'not_found', message: `Static asset ${pathname} does not exist.` } });
}

async function tryReadStaticFile(path: string): Promise<Response | undefined> {
  try {
    const body = await readFile(path);
    return new Response(body, { headers: staticHeaders(contentTypeFor(path)) });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT') return undefined;
    throw error;
  }
}

function staticHeaders(contentType: string): HeadersInit {
  return {
    'content-type': contentType,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'geolocation=(), microphone=(), camera=()',
  };
}

function contentTypeFor(path: string): string {
  switch (extname(path)) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'text/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.txt': return 'text/plain; charset=utf-8';
    default: return 'application/octet-stream';
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

class PayloadTooLargeError extends Error {}

async function writeWebResponse(outgoing: ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  outgoing.writeHead(response.status, headers);
  outgoing.end(Buffer.from(await response.arrayBuffer()));
}
