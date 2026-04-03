import path from 'node:path';

import { AnalyticsStore } from './analyticsStore';
import { createAnalyticsApp } from './analyticsApp';

const port = Number(process.env.BROWSERBUD_LOCAL_API_PORT || 3011);
const dbPath = process.env.BROWSERBUD_LOCAL_DB_PATH || path.resolve(process.cwd(), 'data/browserbud.sqlite');

const store = new AnalyticsStore({ dbPath });
store.initialize();

const app = createAnalyticsApp({ store });

const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Browserbud analytics API listening on http://127.0.0.1:${port}`);
  console.log(`SQLite database: ${dbPath}`);
});

function shutdown() {
  server.close(() => {
    store.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
