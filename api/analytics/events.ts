import { handleAnalyticsEventsRequest } from '../../server/analyticsWebHandlers';

export const runtime = 'nodejs';

export default function handler(request: Request) {
  return handleAnalyticsEventsRequest(request);
}
