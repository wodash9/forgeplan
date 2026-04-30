import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { createForgePlanApi } from './api.js';
import { ForgePlanLocalStore } from '../storage/localStore.js';

const MAX_REQUEST_BODY_BYTES = 1_000_000;
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export interface ForgePlanServerOptions {
  dbPath: string;
  port?: number | undefined;
  host?: string | undefined;
}

export function createForgePlanServer({ dbPath, port = 8787, host = '127.0.0.1' }: ForgePlanServerOptions) {
  validateSafeHost(host);
  const store = new ForgePlanLocalStore(dbPath);
  const api = createForgePlanApi({ store });
  const server = createServer(async (incoming, outgoing) => {
    try {
      const request = await toWebRequest(incoming, host, port);
      const response = await api.fetch(request);
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

class PayloadTooLargeError extends Error {}

async function writeWebResponse(outgoing: ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  outgoing.writeHead(response.status, headers);
  outgoing.end(Buffer.from(await response.arrayBuffer()));
}
