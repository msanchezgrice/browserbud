import type { IncomingMessage, ServerResponse } from 'node:http';

type NodeLikeRequest = IncomingMessage & {
  body?: unknown;
};

function readExistingBody(body: unknown): BodyInit | undefined {
  if (body == null) {
    return undefined;
  }

  if (typeof body === 'string' || body instanceof Uint8Array || body instanceof ArrayBuffer || body instanceof Blob || body instanceof URLSearchParams) {
    return body;
  }

  return JSON.stringify(body);
}

async function readStreamBody(request: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return undefined;
  }

  return Buffer.concat(chunks);
}

export async function buildWebRequest(request: NodeLikeRequest): Promise<Request> {
  const protocolHeader = request.headers['x-forwarded-proto'];
  const forwardedProtocol = Array.isArray(protocolHeader) ? protocolHeader[0] : protocolHeader;
  const hostHeader = request.headers['x-forwarded-host'] || request.headers.host || 'localhost';
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
  const origin = `${forwardedProtocol || 'https'}://${host}`;
  const url = new URL(request.url || '/', origin);

  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      headers.set(key, value.join(', '));
      continue;
    }
    if (typeof value === 'string') {
      headers.set(key, value);
    }
  }

  const method = request.method || 'GET';
  const body = method === 'GET' || method === 'HEAD'
    ? undefined
    : readExistingBody(request.body) || await readStreamBody(request);

  return new Request(url, {
    method,
    headers,
    body,
  });
}

export async function sendWebResponse(response: Response, res: ServerResponse): Promise<void> {
  res.statusCode = response.status;

  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  if (!response.body) {
    res.end();
    return;
  }

  const body = Buffer.from(await response.arrayBuffer());
  res.end(body);
}

export async function runNodeRequestHandler(
  request: NodeLikeRequest,
  response: ServerResponse,
  handler: (request: Request) => Promise<Response>,
): Promise<void> {
  const webRequest = await buildWebRequest(request);
  const webResponse = await handler(webRequest);
  await sendWebResponse(webResponse, response);
}
