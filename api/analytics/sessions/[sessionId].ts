import { handleAnalyticsSessionRequest } from '../../../server/analyticsWebHandlers.js';

export const runtime = 'nodejs';

export default function handler(request: Request) {
  return handleAnalyticsSessionRequest(request);
}
