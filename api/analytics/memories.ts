import { handleAnalyticsMemoriesRequest } from '../../server/analyticsWebHandlers';

export const runtime = 'nodejs';

export default function handler(request: Request) {
  return handleAnalyticsMemoriesRequest(request);
}
