#!/usr/bin/env node
import { createForgePlanServer } from '../dist/src/index.js';

const port = Number(process.env.FORGEPLAN_PORT ?? process.env.PORT ?? 8787);
const host = process.env.FORGEPLAN_HOST ?? '127.0.0.1';
const dbPath = process.env.FORGEPLAN_DB ?? './forgeplan.db';

const { server } = createForgePlanServer({ dbPath, port, host });

server.listen(port, host, () => {
  console.log(`ForgePlan backend listening on http://${host}:${port}/api`);
  console.log(`SQLite database: ${dbPath}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
