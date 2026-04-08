import {
  readDocumentTextChunk,
  searchDocumentText,
  splitDocumentTextIntoChunks,
  type BrowserContextPacket,
} from './browserContext';
import {
  requestBrowserBudPageResource,
  type BrowserBudPageResourceResponse,
} from './browserContextBridge';

export type CurrentPageDocument = {
  url: string;
  contentType: string | null;
  source: 'extension-context' | 'fetched-html' | 'fetched-text' | 'fetched-pdf';
  text: string;
  documentTextLength: number;
  chunkCount: number;
  truncated: boolean;
};

function normalizeDocumentText(value?: string | null): string {
  return (value || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function looksLikePdf(url: string, contentType?: string | null): boolean {
  return /application\/pdf/i.test(contentType || '') || /\.pdf(?:$|[?#])/i.test(url);
}

function extractHtmlDocumentText(html: string): string {
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, noscript').forEach((node) => node.remove());
    return normalizeDocumentText(doc.body?.innerText || doc.body?.textContent || '');
  }

  return normalizeDocumentText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  );
}

function decodeBase64ToUint8Array(dataBase64: string): Uint8Array {
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function extractPdfDocumentText(dataBase64: string): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const bytes = decodeBase64ToUint8Array(dataBase64);
  const loadingTask = pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    useWorkerFetch: false,
  });
  const pdfDocument = await loadingTask.promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    const page = await pdfDocument.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const rawText = textContent.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ');
    const normalizedPageText = normalizeDocumentText(rawText);
    if (normalizedPageText) {
      pages.push(`Page ${pageNumber}\n${normalizedPageText}`);
    }
  }

  return normalizeDocumentText(pages.join('\n\n'));
}

function buildDocumentFromText(
  packet: BrowserContextPacket,
  text: string,
  source: CurrentPageDocument['source'],
  contentType: string | null,
  truncated = false,
): CurrentPageDocument | null {
  const normalizedText = normalizeDocumentText(text);
  if (!normalizedText) {
    return null;
  }

  return {
    url: packet.url,
    contentType,
    source,
    documentTextLength: normalizedText.length,
    text: normalizedText,
    chunkCount: splitDocumentTextIntoChunks(normalizedText).length,
    truncated,
  };
}

export async function resolveCurrentPageDocument(
  packet: BrowserContextPacket,
  requestPageResource: (url: string) => Promise<BrowserBudPageResourceResponse | null> = requestBrowserBudPageResource,
): Promise<CurrentPageDocument | null> {
  if (packet.page.documentText && !packet.page.documentTextTruncated) {
    return buildDocumentFromText(
      packet,
      packet.page.documentText,
      'extension-context',
      'text/plain',
      false,
    );
  }

  const resource = await requestPageResource(packet.url);
  if (!resource?.ok) {
    if (packet.page.documentText) {
      return buildDocumentFromText(
        packet,
        packet.page.documentText,
        'extension-context',
        'text/plain',
        true,
      );
    }
    return null;
  }

  if (looksLikePdf(packet.url, resource.contentType)) {
    if (!resource.dataBase64) {
      return null;
    }

    const pdfText = await extractPdfDocumentText(resource.dataBase64);
    return buildDocumentFromText(packet, pdfText, 'fetched-pdf', resource.contentType || 'application/pdf');
  }

  if (typeof resource.text === 'string' && resource.text.trim()) {
    const source = /html/i.test(resource.contentType || '') ? 'fetched-html' : 'fetched-text';
    const extractedText = source === 'fetched-html'
      ? extractHtmlDocumentText(resource.text)
      : normalizeDocumentText(resource.text);
    return buildDocumentFromText(packet, extractedText, source, resource.contentType, Boolean(resource.truncated));
  }

  if (packet.page.documentText) {
    return buildDocumentFromText(
      packet,
      packet.page.documentText,
      'extension-context',
      'text/plain',
      true,
    );
  }

  return null;
}

export function buildCurrentPageToolResult(document: CurrentPageDocument) {
  const previewChunk = readDocumentTextChunk(document.text, 1);
  return {
    source: document.source,
    contentType: document.contentType,
    documentTextLength: document.documentTextLength,
    chunkCount: document.chunkCount,
    truncated: document.truncated,
    documentExcerpt: previewChunk?.text.slice(0, 1200) || document.text.slice(0, 1200),
  };
}

export function searchCurrentPageDocument(document: CurrentPageDocument, query: string, maxResults = 4): string[] {
  return searchDocumentText(document.text, query, maxResults);
}

export function readCurrentPageDocumentChunk(document: CurrentPageDocument, chunkNumber: number) {
  return readDocumentTextChunk(document.text, chunkNumber);
}
