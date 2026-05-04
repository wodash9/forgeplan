#!/usr/bin/env node
import { createForgePlanServer } from '../dist/src/index.js';

const port = Number(process.env.FORGEPLAN_PORT ?? process.env.PORT ?? 8787);
const host = process.env.FORGEPLAN_HOST ?? '127.0.0.1';
const dbPath = process.env.FORGEPLAN_DB ?? './forgeplan.db';

const staticDir = process.env.FORGEPLAN_STATIC_DIR ?? './dist-web';

const { server } = createForgePlanServer({ dbPath, port, host, staticDir });

server.listen(port, host, () => {
  console.log(`ForgePlan server listening on http://${host}:${port}`);
  console.log(`API: http://${host}:${port}/api`);
  console.log(`Static assets: ${staticDir}`);
  console.log(`SQLite database: ${dbPath}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
