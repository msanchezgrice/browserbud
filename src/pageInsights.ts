import type { CurrentPageDocument } from './currentPageDocument';

export const PAGE_INSIGHTS_STORAGE_KEY = 'browserbud.pageInsights.v1';
const MAX_STORED_PAGE_INSIGHTS = 30;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type PageInsight = {
  url: string;
  title: string;
  generatedAt: string;
  documentFingerprint: string;
  documentTextLength: number;
  contentType: string | null;
  source: CurrentPageDocument['source'];
  pageKind: string | null;
  summary: string;
  keyPoints: string[];
  likelyUserGoals: string[];
  navigationTips: string[];
};

function normalizeText(value?: string | null): string {
  return (value || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function djb2Hash(input: string): string {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) + hash) + input.charCodeAt(index);
    hash |= 0;
  }
  return `p${Math.abs(hash).toString(36)}`;
}

function safeJsonParse(raw: string | null | undefined): unknown {
  if (!raw) {
    return [];
  }

  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function hasPageInsightShape(value: unknown): value is PageInsight {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const insight = value as Partial<PageInsight>;
  return typeof insight.url === 'string'
    && typeof insight.title === 'string'
    && typeof insight.generatedAt === 'string'
    && typeof insight.documentFingerprint === 'string'
    && typeof insight.documentTextLength === 'number'
    && typeof insight.summary === 'string'
    && Array.isArray(insight.keyPoints)
    && Array.isArray(insight.likelyUserGoals)
    && Array.isArray(insight.navigationTips);
}

function sortInsightsNewestFirst(left: PageInsight, right: PageInsight) {
  return right.generatedAt.localeCompare(left.generatedAt);
}

export function buildPageInsightFingerprint(document: CurrentPageDocument): string {
  const fingerprintSource = [
    document.url,
    document.contentType || '',
    String(document.documentTextLength),
    document.text.slice(0, 1600),
    document.text.slice(-1600),
  ].join('\n');

  return djb2Hash(fingerprintSource);
}

export function readStoredPageInsights(storage: StorageLike | null | undefined): PageInsight[] {
  if (!storage) {
    return [];
  }

  const parsed = safeJsonParse(storage.getItem(PAGE_INSIGHTS_STORAGE_KEY));
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter(hasPageInsightShape).sort(sortInsightsNewestFirst);
}

export function writeStoredPageInsights(
  storage: StorageLike | null | undefined,
  insights: PageInsight[],
) {
  if (!storage) {
    return;
  }

  if (insights.length === 0) {
    storage.removeItem(PAGE_INSIGHTS_STORAGE_KEY);
    return;
  }

  storage.setItem(
    PAGE_INSIGHTS_STORAGE_KEY,
    JSON.stringify([...insights].sort(sortInsightsNewestFirst).slice(0, MAX_STORED_PAGE_INSIGHTS)),
  );
}

export function getStoredPageInsight(
  storage: StorageLike | null | undefined,
  url: string,
  documentFingerprint: string,
): PageInsight | null {
  return readStoredPageInsights(storage).find((insight) => (
    insight.url === url && insight.documentFingerprint === documentFingerprint
  )) || null;
}

export function upsertStoredPageInsight(
  storage: StorageLike | null | undefined,
  insight: PageInsight,
) {
  const existing = readStoredPageInsights(storage).filter((entry) => !(
    entry.url === insight.url && entry.documentFingerprint === insight.documentFingerprint
  ));
  writeStoredPageInsights(storage, [insight, ...existing]);
}

export function buildPageInsightContextPrompt(insight: PageInsight): string {
  const lines = [
    'Background page analysis update only. Do not respond aloud to this message.',
    `Prepared page summary for: ${insight.title}`,
    `Summary: ${normalizeText(insight.summary)}`,
  ];

  if (insight.keyPoints.length > 0) {
    lines.push(`Key points: ${insight.keyPoints.slice(0, 4).join(' | ')}`);
  }

  if (insight.likelyUserGoals.length > 0) {
    lines.push(`Likely user goals: ${insight.likelyUserGoals.slice(0, 3).join(' | ')}`);
  }

  if (insight.navigationTips.length > 0) {
    lines.push(`Navigation help: ${insight.navigationTips.slice(0, 3).join(' | ')}`);
  }

  lines.push('Use this prepared analysis when the user asks for help with this page or document.');
  return lines.join('\n');
}

export function buildPageInsightMarkdown(insight: PageInsight): string {
  const lines = [
    `### Prepared Page Analysis`,
    '',
    insight.summary,
  ];

  if (insight.keyPoints.length > 0) {
    lines.push('', '#### Key points', '');
    for (const point of insight.keyPoints.slice(0, 5)) {
      lines.push(`- ${point}`);
    }
  }

  if (insight.navigationTips.length > 0) {
    lines.push('', '#### Navigation help', '');
    for (const tip of insight.navigationTips.slice(0, 4)) {
      lines.push(`- ${tip}`);
    }
  }

  return lines.join('\n');
}
