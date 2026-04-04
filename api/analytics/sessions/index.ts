import { handleAnalyticsSessionsRequest } from '../../../server/analyticsWebHandlers';

export const runtime = 'nodejs';

export default function handler(request: Request) {
  return handleAnalyticsSessionsRequest(request);
}
