import type { IncomingMessage, ServerResponse } from 'node:http';

import { handleAnalyticsMemoriesRequest } from '../../server/analyticsWebHandlers.js';
import { runNodeRequestHandler } from '../../server/vercelNodeBridge.js';

export const runtime = 'nodejs';

export default async function handler(request: IncomingMessage & { body?: unknown }, response: ServerResponse) {
  await runNodeRequestHandler(request, response, handleAnalyticsMemoriesRequest);
}
