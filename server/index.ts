import { createAnalyticsApp } from './analyticsApp.js';
import { closeAnalyticsStore, getAnalyticsStore, resolveAnalyticsRuntimeConfig } from './analyticsRuntime.js';

const port = Number(process.env.BROWSERBUD_LOCAL_API_PORT || 3011);

async function main() {
  const runtimeConfig = resolveAnalyticsRuntimeConfig();
  const store = await getAnalyticsStore();
  const app = createAnalyticsApp({ store });

  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`Browserbud analytics API listening on http://127.0.0.1:${port}`);
    if (runtimeConfig.kind === 'postgres') {
      console.log('Analytics backend: Postgres');
      return;
    }
    if (runtimeConfig.kind === 'sqlite') {
      console.log(`SQLite database: ${runtimeConfig.dbPath}`);
      return;
    }
    console.log(runtimeConfig.message);
  });

  async function shutdown() {
    server.close(async () => {
      await closeAnalyticsStore();
      process.exit(0);
    });
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main().catch((error) => {
  console.error('Failed to start Browserbud analytics API', error);
  process.exit(1);
});
