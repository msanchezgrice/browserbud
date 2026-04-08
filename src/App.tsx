import React, { useState, useEffect, useRef } from 'react';
import { FunctionCallingConfigMode, GoogleGenAI, Modality, Type } from '@google/genai';
import { Play, Square, Mic, MicOff, User, Clock, MessageSquare, Monitor, MonitorOff, Info, Plus, Trash2, RotateCcw, Settings, Search, FileText, BookOpen, List, Bookmark, Globe } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { DEFAULT_AUTO_SAVE_INTERVAL_MS, buildAutoSavePrompt } from './autoSave';
import { completeAnalyticsSession, createAnalyticsSession, fetchAnalyticsSessionTimeline, fetchAnalyticsSessions, fetchLatestAnalyticsSessionTimeline, generateAnalyticsSessionRecap, recordAnalyticsEvent, recordAnalyticsMemory, recordAnalyticsTurn } from './analyticsApi';
import type { AnalyticsMemoryInput, AnalyticsRawEventInput, AnalyticsSessionListItem, AnalyticsSessionTimeline } from './analyticsTypes';
import { buildAppTabPath, resolveAppTabRoute, type AppTabRoute } from './appSurface';
import {
  buildBrowserContextPrompt,
  buildCurrentPageToolSnapshot,
  getCaptureModeRequirements,
  isSignificantBrowserContextUpdate,
  readDocumentTextChunk,
  searchBrowserContextDocument,
  splitDocumentTextIntoChunks,
  type BrowserContextPacket,
  type CaptureMode,
} from './browserContext';
import { postBrowserBudBridgeRequest, subscribeToBrowserBudBridge } from './browserContextBridge';
import { createStoredApiKeyController } from './clientConfig';
import {
  buildCurrentPageToolResult,
  readCurrentPageDocumentChunk,
  resolveCurrentPageDocument,
  searchCurrentPageDocument,
  type CurrentPageDocument,
} from './currentPageDocument';
import { buildRehydratedSessionState, buildTranscriptFeed, formatActivityLogEntry, formatLatency, mergeIncrementalTranscript, parseStoredLogEntries, serializeLogEntries, shouldCommitUserTranscript, shouldRunTimedBackgroundSave, truncateSessionHandle } from './liveUtils';
import { buildLocalSessionRecapSummary, getLatestStoredAnalyticsSessionTimeline, getStoredAnalyticsSessionTimeline, listStoredAnalyticsSessions, upsertStoredAnalyticsTimeline } from './localAnalyticsHistory';
import {
  buildPageInsightContextPrompt,
  buildPageInsightFingerprint,
  getStoredPageInsight,
  upsertStoredPageInsight,
  type PageInsight,
} from './pageInsights';
import { getRuntimeSupport } from './runtimeSupport';

const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-3.1-flash-live-preview';
const DEV_DEFAULT_API_KEY = process.env.BROWSERBUD_DEV_DEFAULT_API_KEY || '';
const TIMED_HELPFUL_INFO_MODEL = 'gemini-2.5-flash';
const PAGE_INSIGHT_MODEL = 'gemini-2.5-flash';
const PAGE_INSIGHT_CHUNK_SIZE = 12000;

const STORAGE_KEYS = {
  customPersonas: 'browserbud.customPersonas',
  helpfulInfo: 'browserbud.helpfulInfo',
  activityLog: 'browserbud.activityLog',
  savedNotes: 'browserbud.savedNotes',
  transcriptLogs: 'browserbud.transcriptLogs',
  modelInputPreview: 'browserbud.modelInputPreview',
};

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

const MAX_RECONNECT_ATTEMPTS = 6;
const AUTO_COMMENTARY_USER_COOLDOWN_MS = 15000;
const TIMED_COMMENTARY_PROMPT = 'Provide a brief spoken commentary on what is happening on the screen right now. Keep it under two sentences unless the user asked for more detail.';

const readStoredText = (key: string) => {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
};

const readStoredModelInputPreview = (): ModelInputPreview => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.modelInputPreview);
    if (!raw) {
      return {
        lastScreenFrameAt: null,
        lastBrowserContextPrompt: '',
        lastBrowserContextCapturedAt: null,
        lastPageInsightPrompt: '',
        lastPageInsightGeneratedAt: null,
      };
    }

    const parsed = JSON.parse(raw) as Partial<ModelInputPreview>;
    return {
      lastScreenFrameAt: typeof parsed.lastScreenFrameAt === 'string' ? parsed.lastScreenFrameAt : null,
      lastBrowserContextPrompt: typeof parsed.lastBrowserContextPrompt === 'string' ? parsed.lastBrowserContextPrompt : '',
      lastBrowserContextCapturedAt: typeof parsed.lastBrowserContextCapturedAt === 'string' ? parsed.lastBrowserContextCapturedAt : null,
      lastPageInsightPrompt: typeof parsed.lastPageInsightPrompt === 'string' ? parsed.lastPageInsightPrompt : '',
      lastPageInsightGeneratedAt: typeof parsed.lastPageInsightGeneratedAt === 'string' ? parsed.lastPageInsightGeneratedAt : null,
    };
  } catch {
    return {
      lastScreenFrameAt: null,
      lastBrowserContextPrompt: '',
      lastBrowserContextCapturedAt: null,
      lastPageInsightPrompt: '',
      lastPageInsightGeneratedAt: null,
    };
  }
};

const getSafeLocalStorage = (): Storage | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const readInitialApiKey = (): string => {
  const controller = createStoredApiKeyController(getSafeLocalStorage());
  const storedApiKey = controller.get();
  if (storedApiKey) {
    return storedApiKey;
  }

  const fallbackApiKey = DEV_DEFAULT_API_KEY.trim();
  if (fallbackApiKey) {
    controller.set(fallbackApiKey);
    return fallbackApiKey;
  }

  return '';
};

type Personality = {
  id: string;
  name: string;
  prompt: string;
  voiceName: string;
  isCustom?: boolean;
  useSearch?: boolean;
};

const DEFAULT_PERSONALITIES: Personality[] = [
  { id: 'sarcastic', name: 'Sarcastic Critic', prompt: 'You are a highly sarcastic and cynical web critic. You judge everything the user looks at on their screen.', voiceName: 'Charon', useSearch: true },
  { id: 'hype', name: 'Hype Man', prompt: 'You are an overly enthusiastic hype man. Everything the user browses on their screen is the most amazing thing ever.', voiceName: 'Zephyr', useSearch: true },
  { id: 'academic', name: 'Academic Scholar', prompt: 'You are a pretentious academic. You analyze the user\'s screen through a sociological and philosophical lens.', voiceName: 'Fenrir', useSearch: true },
  { id: 'paranoid', name: 'Paranoid Hacker', prompt: 'You are a paranoid hacker. You constantly warn the user about tracking, cookies, and government surveillance based on what they are looking at.', voiceName: 'Puck', useSearch: true },
  { id: 'grandma', name: 'Confused Grandma', prompt: 'You are a confused but sweet grandmother who doesn\'t really understand the internet or what is on the screen, but tries to be supportive.', voiceName: 'Kore', useSearch: true },
];

const AVAILABLE_VOICES = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'];

const FREQUENCIES = [
  { id: 0, name: 'Off' },
  { id: 10000, name: 'Every 10 seconds' },
  { id: 30000, name: 'Every 30 seconds' },
  { id: 60000, name: 'Every 1 minute' },
];

const CAPTURE_MODES: Array<{
  id: CaptureMode;
  label: string;
  description: string;
}> = [
  {
    id: 'multimodal',
    label: 'Multimodal',
    description: 'Use the Chrome extension and screen-share together.',
  },
  {
    id: 'screen-share',
    label: 'Screen Only',
    description: 'Keep the current visual-only capture flow.',
  },
  {
    id: 'browser-extension',
    label: 'Extension Only',
    description: 'Use browser-native context without screen-share.',
  },
];

type AppTab = AppTabRoute;
type PageInsightStatus = 'idle' | 'warming' | 'ready' | 'error';
type ModelInputPreview = {
  lastScreenFrameAt: string | null;
  lastBrowserContextPrompt: string;
  lastBrowserContextCapturedAt: string | null;
  lastPageInsightPrompt: string;
  lastPageInsightGeneratedAt: string | null;
};

type LogEntry = {
  id: string;
  timestamp: Date;
  text: string;
  role: 'user' | 'model' | 'system';
  isDraft?: boolean;
};

const readStoredLogs = (): LogEntry[] => {
  return parseStoredLogEntries(readStoredText(STORAGE_KEYS.transcriptLogs)).flatMap((entry) => {
    const timestamp = new Date(entry.timestamp);
    if (Number.isNaN(timestamp.getTime())) {
      return [];
    }
    return [{ ...entry, timestamp }];
  });
};

type DebugState = {
  currentSessionHandle: string | null;
  firstAudioLatencyMs: number | null;
  reconnectAttempts: number;
  lastReconnectReason: string | null;
  lastReconnectAt: string | null;
  lastAutoSaveAt: string | null;
  lastCommentaryAt: string | null;
};

type HelpfulInfoInsertInput = {
  title?: string | null;
  content?: string | null;
  source: 'live-tool' | 'timed-auto-save';
  logToTranscript?: boolean;
};

type LocalHistoryCapture = {
  sessionId: string;
  startedAt: string;
  sourceSurface: string | null;
  personaId: string | null;
  liveModel: string | null;
  searchEnabled: boolean;
  captureMode: string;
  existingLogIds: Set<string>;
  helpfulInfoBaseline: string;
  activityLogBaseline: string;
  savedNotesBaseline: string;
};

function mergeHistorySessionItems(
  primary: AnalyticsSessionListItem[],
  secondary: AnalyticsSessionListItem[],
): AnalyticsSessionListItem[] {
  const merged = new Map<string, AnalyticsSessionListItem>();

  for (const item of [...primary, ...secondary]) {
    if (!merged.has(item.session.id)) {
      merged.set(item.session.id, item);
    }
  }

  return [...merged.values()].sort((left, right) => right.session.startedAt.localeCompare(left.session.startedAt));
}

function getPrependedDelta(currentValue: string, baselineValue: string): string {
  if (!baselineValue) {
    return currentValue.trim();
  }

  if (!currentValue || currentValue === baselineValue) {
    return '';
  }

  if (currentValue.endsWith(baselineValue)) {
    return currentValue.slice(0, currentValue.length - baselineValue.length).trim();
  }

  return currentValue.trim();
}

function getHistoryUnavailableMessage(hasStoredFallback: boolean): string {
  const hostname = typeof window === 'undefined' ? '' : window.location.hostname;
  if (hasStoredFallback) {
    return 'Showing browser-only session history from this device because the analytics backend is unavailable.';
  }

  if (LOCAL_HOSTNAMES.has(hostname)) {
    return 'History backend unavailable. Start `npm run dev:api` for shared session history. Finished sessions will still save in this browser.';
  }

  return 'Shared history is not enabled on this deploy yet. Finished sessions will still save in this browser.';
}

const TAB_METADATA: Record<AppTab, { label: string; toolName: string; description: string; emptyState: string; }> = {
  transcript: {
    label: 'Live Transcript',
    toolName: 'Automatic transcript',
    description: 'Full user and companion turns are assembled from streaming transcription events.',
    emptyState: 'No transcript yet. Share your screen and click Start Companion to begin.',
  },
  info: {
    label: 'Helpful Info',
    toolName: 'Tool: appendHelpfulInfo',
    description: 'Reusable advice, links, and takeaways saved for later.',
    emptyState: 'No helpful info yet. Ask the companion to save something useful to the Helpful Info tab.',
  },
  activity: {
    label: 'Activity Log',
    toolName: 'Tool: logActivity',
    description: 'Structured records with timestamp, app, page, URL, and summary land here.',
    emptyState: 'No activity logged yet. Ask the companion to log what you are doing or save the current page context.',
  },
  notes: {
    label: 'Saved Notes',
    toolName: 'Tool: saveNote',
    description: 'Direct reminders, todos, and remember-this requests land here.',
    emptyState: 'No notes saved yet. Say add a note or remember this to trigger saveNote.',
  },
  history: {
    label: 'Session History',
    toolName: 'Session timeline',
    description: 'Browse finished sessions, raw events, saved context, and recent turns.',
    emptyState: 'No session history yet. Finish a session to populate this view.',
  },
  memory: {
    label: 'Browser Memory',
    toolName: 'Reusable record',
    description: 'Readable recap markdown plus the most useful saved context from your finished sessions.',
    emptyState: 'No browser memory yet. Finish a session to generate a recap and saved context.',
  },
};

const TAB_BUTTONS: Array<{
  id: AppTab;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'transcript', label: 'Transcript', Icon: MessageSquare },
  { id: 'info', label: 'Helpful Info', Icon: BookOpen },
  { id: 'activity', label: 'Activity', Icon: List },
  { id: 'notes', label: 'Notes', Icon: Bookmark },
  { id: 'history', label: 'History', Icon: Clock },
  { id: 'memory', label: 'Memory', Icon: FileText },
];

const MARKDOWN_PROSE_CLASS =
  'prose prose-stone prose-headings:text-stone-900 prose-p:text-stone-700 prose-strong:text-stone-900 prose-a:text-teal-600 prose-code:text-teal-700 prose-pre:bg-stone-950 prose-pre:text-stone-100 max-w-none';

const COMPACT_MARKDOWN_PROSE_CLASS =
  `${MARKDOWN_PROSE_CLASS} prose-sm prose-headings:mb-2 prose-headings:mt-4 prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-hr:my-4`;

function stripSessionRecapHeading(markdown: string | null | undefined): string {
  return (markdown || '').replace(/^# Session Recap\s*/i, '').trim();
}

function ListeningIndicator() {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-white/95 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-teal-600 shadow-sm shadow-teal-100/60">
      <span className="relative flex h-5 w-5 items-center justify-center rounded-full bg-teal-50 text-teal-600">
        <span className="absolute inline-flex h-5 w-5 rounded-full bg-teal-200/70 animate-ping" />
        <Mic className="relative h-3 w-3" />
      </span>
      <span>Listening</span>
      <span className="flex items-end gap-0.5" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="w-0.5 rounded-full bg-teal-500 animate-pulse"
            style={{
              height: `${8 + index * 3}px`,
              animationDelay: `${index * 160}ms`,
              animationDuration: '900ms',
            }}
          />
        ))}
      </span>
    </div>
  );
}

export default function App() {
  const [personas, setPersonas] = useState<Personality[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.customPersonas);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {}
    }
    return DEFAULT_PERSONALITIES;
  });

  const [personality, setPersonality] = useState(personas[0].id);
  const [userApiKey, setUserApiKey] = useState(() => readInitialApiKey());
  const [captureMode, setCaptureMode] = useState<CaptureMode>('multimodal');
  const [commentaryFrequency, setCommentaryFrequency] = useState(0);
  const [frequency, setFrequency] = useState(DEFAULT_AUTO_SAVE_INTERVAL_MS);
  const [isSharing, setIsSharing] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>(() => readStoredLogs());
  const [liveDraftTranscript, setLiveDraftTranscript] = useState<LogEntry | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Notepad State
  const [activeTab, setActiveTab] = useState<AppTab>(() => (
    typeof window === 'undefined' ? 'transcript' : resolveAppTabRoute(window.location.pathname)
  ));
  const [helpfulInfo, setHelpfulInfo] = useState<string>(() => readStoredText(STORAGE_KEYS.helpfulInfo));
  const [activityLog, setActivityLog] = useState<string>(() => readStoredText(STORAGE_KEYS.activityLog));
  const [savedNotes, setSavedNotes] = useState<string>(() => readStoredText(STORAGE_KEYS.savedNotes));
  const [historySessions, setHistorySessions] = useState<AnalyticsSessionListItem[]>([]);
  const [selectedHistorySessionId, setSelectedHistorySessionId] = useState<string | null>(null);
  const [selectedHistoryTimeline, setSelectedHistoryTimeline] = useState<AnalyticsSessionTimeline | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  
  // Custom Persona State
  const [showAddPersona, setShowAddPersona] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [extensionBridgeReady, setExtensionBridgeReady] = useState(false);
  const [extensionBridgeChecked, setExtensionBridgeChecked] = useState(false);
  const [extensionVersion, setExtensionVersion] = useState<string | null>(null);
  const [browserContextPacket, setBrowserContextPacket] = useState<BrowserContextPacket | null>(null);
  const [pageInsight, setPageInsight] = useState<PageInsight | null>(null);
  const [pageInsightStatus, setPageInsightStatus] = useState<PageInsightStatus>('idle');
  const [pageInsightError, setPageInsightError] = useState<string | null>(null);
  const [modelInputPreview, setModelInputPreview] = useState<ModelInputPreview>(() => readStoredModelInputPreview());
  const [lastScreenFramePreview, setLastScreenFramePreview] = useState<string | null>(null);
  const [newPersonaName, setNewPersonaName] = useState('');
  const [newPersonaPrompt, setNewPersonaPrompt] = useState('');
  const [newPersonaVoice, setNewPersonaVoice] = useState(AVAILABLE_VOICES[0]);
  const [newPersonaSearch, setNewPersonaSearch] = useState(false);
  const [sessionSearchEnabled, setSessionSearchEnabled] = useState(Boolean(personas[0]?.useSearch));
  const [debugState, setDebugState] = useState<DebugState>({
    currentSessionHandle: null,
    firstAudioLatencyMs: null,
    reconnectAttempts: 0,
    lastReconnectReason: null,
    lastReconnectAt: null,
    lastAutoSaveAt: null,
    lastCommentaryAt: null,
  });
  const [runtimeSupport, setRuntimeSupport] = useState(() => getRuntimeSupport());

  const selectedPersonality = personas.find((option) => option.id === personality) || personas[0];
  const configuredApiKey = userApiKey.trim();
  const historySurfaceOpen = activeTab === 'history' || activeTab === 'memory';
  const captureRequirements = getCaptureModeRequirements(captureMode);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tabContentScrollRef = useRef<HTMLDivElement>(null);
  const settingsPanelRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  
  // Live API & Audio Refs
  const sessionRef = useRef<Promise<any> | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micSinkRef = useRef<GainNode | null>(null);
  const processorRef = useRef<AudioWorkletNode | null>(null);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextPlayTimeRef = useRef<number>(0);
  const isMicMutedRef = useRef(isMicMuted);
  const isModelSpeakingRef = useRef(false);
  const currentInputTranscriptRef = useRef('');
  const currentOutputTranscriptRef = useRef('');
  const sessionHandleRef = useRef<string | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const shouldStayConnectedRef = useRef(false);
  const isStartingRef = useRef(false);
  const isStoppingRef = useRef(false);
  const isUnmountingRef = useRef(false);
  const pendingTurnRef = useRef(false);
  const pendingToolCallRef = useRef(false);
  const lastUserActivityAtRef = useRef(0);
  const lastPromptAtRef = useRef(0);
  const sessionStartTimeRef = useRef<number | null>(null);
  const firstAudioChunkSeenRef = useRef(false);
  const suppressModelOutputRef = useRef(false);
  const analyticsSessionIdRef = useRef<string | null>(null);
  const analyticsEventSeqRef = useRef(0);
  const localHistoryCaptureRef = useRef<LocalHistoryCapture | null>(null);
  const timedHelpfulInfoSaveInFlightRef = useRef(false);
  const latestBrowserContextRef = useRef<BrowserContextPacket | null>(null);
  const previousBrowserContextRef = useRef<BrowserContextPacket | null>(null);
  const lastInjectedBrowserContextPromptRef = useRef<string | null>(null);
  const currentPageDocumentCacheRef = useRef<Map<string, CurrentPageDocument>>(new Map());
  const latestPageInsightRef = useRef<PageInsight | null>(null);
  const lastInjectedPageInsightFingerprintRef = useRef<string | null>(null);
  const pageInsightWarmFingerprintRef = useRef<string | null>(null);
  
  // Interval Refs
  const videoIntervalRef = useRef<number | null>(null);
  const commentaryIntervalRef = useRef<number | null>(null);
  const backgroundSaveIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    isMicMutedRef.current = isMicMuted;
  }, [isMicMuted]);

  useEffect(() => {
    const syncRuntimeSupport = () => {
      setRuntimeSupport(getRuntimeSupport());
    };

    syncRuntimeSupport();
    window.addEventListener('resize', syncRuntimeSupport);

    return () => {
      window.removeEventListener('resize', syncRuntimeSupport);
    };
  }, []);

  useEffect(() => {
    if (!isRunning) {
      setSessionSearchEnabled(Boolean(selectedPersonality?.useSearch));
    }
  }, [isRunning, selectedPersonality]);

  useEffect(() => {
    createStoredApiKeyController(getSafeLocalStorage()).set(userApiKey);
  }, [userApiKey]);

  useEffect(() => {
    latestBrowserContextRef.current = browserContextPacket;
  }, [browserContextPacket]);

  useEffect(() => {
    latestPageInsightRef.current = pageInsight;
  }, [pageInsight]);

  useEffect(() => {
    const markCheckedTimer = window.setTimeout(() => {
      setExtensionBridgeChecked(true);
    }, 1200);

    const unsubscribe = subscribeToBrowserBudBridge((event) => {
      setExtensionBridgeChecked(true);
      if (event.kind === 'ready') {
        setExtensionBridgeReady(true);
        setExtensionVersion(event.version);
        return;
      }

      if (event.kind === 'resource') {
        return;
      }

      setBrowserContextPacket(event.packet);
    });

    postBrowserBudBridgeRequest('REQUEST_EXTENSION_STATUS');
    postBrowserBudBridgeRequest('REQUEST_ACTIVE_CONTEXT');

    const statusPoll = window.setInterval(() => {
      postBrowserBudBridgeRequest('REQUEST_EXTENSION_STATUS');
    }, 8000);
    const contextPoll = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        postBrowserBudBridgeRequest('REQUEST_ACTIVE_CONTEXT');
      }
    }, 5000);

    return () => {
      window.clearTimeout(markCheckedTimer);
      window.clearInterval(statusPoll);
      window.clearInterval(contextPoll);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!browserContextPacket) {
      return;
    }

    const previousPacket = previousBrowserContextRef.current;
    const isSignificantUpdate = isSignificantBrowserContextUpdate(previousPacket, browserContextPacket);
    previousBrowserContextRef.current = browserContextPacket;
    if (!isSignificantUpdate) {
      return;
    }

    recordAnalyticsEventSafe({
      source: 'browser-extension',
      eventType: `browser.${browserContextPacket.navEvent}`,
      appName: 'Chrome',
      pageTitle: browserContextPacket.title,
      url: browserContextPacket.url,
      domain: browserContextPacket.domain,
      tabId: String(browserContextPacket.tabId),
      payload: {
        packetVersion: browserContextPacket.packetVersion,
        activeSection: browserContextPacket.location.activeSection || null,
        primaryNavCount: browserContextPacket.navMap.primaryLinks.length,
        localNavCount: browserContextPacket.navMap.localLinks.length,
        headingCount: browserContextPacket.contentMap.headings.length,
        anchorCount: browserContextPacket.anchors.length,
      },
    });

    if (!isRunning) {
      return;
    }

    const contextPrompt = buildBrowserContextPrompt(browserContextPacket);
    if (lastInjectedBrowserContextPromptRef.current === contextPrompt) {
      return;
    }

    lastInjectedBrowserContextPromptRef.current = contextPrompt;
    setModelInputPreview((prev) => ({
      ...prev,
      lastBrowserContextPrompt: contextPrompt,
      lastBrowserContextCapturedAt: browserContextPacket.capturedAt,
    }));
    sendSessionPrompt(contextPrompt, { suppressOutput: true });
  }, [browserContextPacket, isRunning]);

  useEffect(() => {
    if (!browserContextPacket) {
      setPageInsight(null);
      setPageInsightStatus('idle');
      setPageInsightError(null);
      return;
    }

    let cancelled = false;

    const warmInsight = async () => {
      const packet = browserContextPacket;
      const document = await getCurrentPageDocument();
      if (cancelled || !document) {
        if (!cancelled) {
          setPageInsight(null);
          setPageInsightStatus('idle');
          setPageInsightError(null);
        }
        return;
      }

      const fingerprint = buildPageInsightFingerprint(document);
      const cached = getStoredPageInsight(getSafeLocalStorage(), packet.url, fingerprint);
      if (cached) {
        if (!cancelled) {
          setPageInsight(cached);
          setPageInsightStatus('ready');
          setPageInsightError(null);
        }
        return;
      }

      if (!configuredApiKey) {
        if (!cancelled) {
          setPageInsight(null);
          setPageInsightStatus('idle');
          setPageInsightError(null);
        }
        return;
      }

      if (pageInsightWarmFingerprintRef.current === fingerprint) {
        if (!cancelled) {
          setPageInsightStatus('warming');
        }
        return;
      }

      pageInsightWarmFingerprintRef.current = fingerprint;
      if (!cancelled) {
        setPageInsight(null);
        setPageInsightStatus('warming');
        setPageInsightError(null);
      }

      try {
        const insight = await generatePageInsight(packet, document);
        if (cancelled) {
          return;
        }

        upsertStoredPageInsight(getSafeLocalStorage(), insight);
        setPageInsight(insight);
        setPageInsightStatus('ready');
        setPageInsightError(null);
      } catch (error) {
        console.error('Background page analysis failed', error);
        if (!cancelled) {
          setPageInsight(null);
          setPageInsightStatus('error');
          setPageInsightError(error instanceof Error ? error.message : 'Background page analysis failed.');
        }
      } finally {
        if (pageInsightWarmFingerprintRef.current === fingerprint) {
          pageInsightWarmFingerprintRef.current = null;
        }
      }
    };

    void warmInsight();

    return () => {
      cancelled = true;
    };
  }, [
    browserContextPacket?.url,
    browserContextPacket?.page.hash,
    browserContextPacket?.page.documentTextLength,
    configuredApiKey,
  ]);

  useEffect(() => {
    if (!isRunning || !pageInsight) {
      return;
    }

    if (lastInjectedPageInsightFingerprintRef.current === pageInsight.documentFingerprint) {
      return;
    }

    lastInjectedPageInsightFingerprintRef.current = pageInsight.documentFingerprint;
    const insightPrompt = buildPageInsightContextPrompt(pageInsight);
    setModelInputPreview((prev) => ({
      ...prev,
      lastPageInsightPrompt: insightPrompt,
      lastPageInsightGeneratedAt: pageInsight.generatedAt,
    }));
    sendSessionPrompt(insightPrompt, { suppressOutput: true });
  }, [isRunning, pageInsight]);

  useEffect(() => {
    if (!showSettingsPanel) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }

      if (settingsPanelRef.current?.contains(target) || settingsButtonRef.current?.contains(target)) {
        return;
      }

      setShowSettingsPanel(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowSettingsPanel(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showSettingsPanel]);

  useEffect(() => {
    const syncTabFromLocation = () => {
      setActiveTab(resolveAppTabRoute(window.location.pathname));
    };

    window.addEventListener('popstate', syncTabFromLocation);
    return () => {
      window.removeEventListener('popstate', syncTabFromLocation);
    };
  }, []);

  useEffect(() => {
    const targetPath = buildAppTabPath(activeTab);
    if (window.location.pathname !== targetPath) {
      window.history.replaceState(window.history.state, '', targetPath);
    }
  }, [activeTab]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.helpfulInfo, helpfulInfo);
  }, [helpfulInfo]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.activityLog, activityLog);
  }, [activityLog]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.savedNotes, savedNotes);
  }, [savedNotes]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.transcriptLogs, serializeLogEntries(logs.map((log) => ({
      id: log.id,
      timestamp: log.timestamp.toISOString(),
      text: log.text,
      role: log.role,
    }))));
  }, [logs]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.modelInputPreview, JSON.stringify(modelInputPreview));
  }, [modelInputPreview]);

  useEffect(() => {
    let cancelled = false;

    void fetchLatestAnalyticsSessionTimeline().then((timeline) => {
      const resolvedTimeline = timeline || readLatestLocalHistoryTimeline();
      if (!resolvedTimeline || cancelled) {
        return;
      }

      const rehydrated = buildRehydratedSessionState(resolvedTimeline);
      const rehydratedLogs = rehydrated.logs.flatMap((entry) => {
        const timestamp = new Date(entry.timestamp);
        if (Number.isNaN(timestamp.getTime())) {
          return [];
        }
        return [{ ...entry, timestamp }];
      });

      setLogs((prev) => (prev.length > 0 ? prev : rehydratedLogs));
      setHelpfulInfo((prev) => (prev.trim() ? prev : rehydrated.helpfulInfo));
      setActivityLog((prev) => (prev.trim() ? prev : rehydrated.activityLog));
      setSavedNotes((prev) => (prev.trim() ? prev : rehydrated.savedNotes));
      setSelectedHistoryTimeline((prev) => prev || resolvedTimeline);
      setSelectedHistorySessionId((prev) => prev || resolvedTimeline.session.id);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void refreshHistorySessions();
  }, []);

  useEffect(() => {
    if (!historySurfaceOpen) {
      return;
    }

    void refreshHistorySessions();
  }, [historySurfaceOpen]);

  useEffect(() => {
    if (!historySurfaceOpen || !selectedHistorySessionId) {
      return;
    }

    void refreshSelectedHistoryTimeline(selectedHistorySessionId);
  }, [historySurfaceOpen, selectedHistorySessionId]);

  const savePersonas = (newPersonas: Personality[]) => {
    setPersonas(newPersonas);
    localStorage.setItem(STORAGE_KEYS.customPersonas, JSON.stringify(newPersonas));
  };

  const addPersona = () => {
    if (!newPersonaName.trim() || !newPersonaPrompt.trim()) return;
    const newPersona: Personality = {
      id: 'custom_' + Date.now(),
      name: newPersonaName,
      prompt: newPersonaPrompt,
      voiceName: newPersonaVoice,
      useSearch: newPersonaSearch,
      isCustom: true
    };
    savePersonas([...personas, newPersona]);
    setPersonality(newPersona.id);
    setNewPersonaName('');
    setNewPersonaPrompt('');
    setNewPersonaSearch(false);
    setShowAddPersona(false);
  };

  const deletePersona = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newPersonas = personas.filter(p => p.id !== id);
    savePersonas(newPersonas);
    if (personality === id) {
      setPersonality(newPersonas[0].id);
    }
  };

  const resetPersonas = () => {
    if (window.confirm("Are you sure you want to reset to default personalities? All custom ones will be lost.")) {
      savePersonas(DEFAULT_PERSONALITIES);
      setPersonality(DEFAULT_PERSONALITIES[0].id);
    }
  };

  const toggleSharing = async () => {
    setErrorMsg(null);
    if (isSharing) {
      const stream = videoRef.current?.srcObject as MediaStream;
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      if (videoRef.current) videoRef.current.srcObject = null;
      setIsSharing(false);
      if (isRunning) stopLive();
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ 
          video: { displaySurface: 'browser' } 
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setIsSharing(true);
        
        stream.getVideoTracks()[0].onended = () => {
          setIsSharing(false);
          if (isRunning) stopLive();
        };
      } catch (err: any) {
        console.error("Error sharing screen:", err);
        if (err.message && err.message.includes("display-capture")) {
          setErrorMsg("Screen sharing is not allowed in this embedded view. Please click the 'Open in New Tab' button (usually an arrow icon at the top right of the preview) to use this feature.");
        } else {
          setErrorMsg("Failed to share screen: " + err.message);
        }
      }
    }
  };

  const captureFrame = (): string | null => {
    if (!videoRef.current || !canvasRef.current || !isSharing) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.5);
    return dataUrl.split(',')[1];
  };

  const recordSentScreenFrame = (base64Image: string) => {
    const timestamp = new Date().toISOString();
    setModelInputPreview((prev) => ({
      ...prev,
      lastScreenFrameAt: timestamp,
    }));
    setLastScreenFramePreview(`data:image/jpeg;base64,${base64Image}`);
  };

  const playAudioChunk = (base64Audio: string) => {
    const playCtx = playCtxRef.current;
    if (!playCtx) return;

    if (playCtx.state === 'suspended') {
      playCtx.resume();
    }

    const binaryString = atob(base64Audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const buffer = playCtx.createBuffer(1, bytes.length / 2, 24000);
    const channelData = buffer.getChannelData(0);
    const dataView = new DataView(bytes.buffer);
    for (let i = 0; i < channelData.length; i++) {
      channelData[i] = dataView.getInt16(i * 2, true) / 32768.0;
    }

    const source = playCtx.createBufferSource();
    source.buffer = buffer;
    
    // SPEED UP THE VOICE! (1.15x speed)
    source.playbackRate.value = 1.15; 
    
    source.connect(playCtx.destination);

    if (nextPlayTimeRef.current < playCtx.currentTime) {
      nextPlayTimeRef.current = playCtx.currentTime;
    }

    source.start(nextPlayTimeRef.current);
    activeSourcesRef.current.push(source);

    source.onended = () => {
      activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== source);
    };

    nextPlayTimeRef.current += buffer.duration / source.playbackRate.value;
  };

  const clearRuntimeTimers = () => {
    if (videoIntervalRef.current) {
      clearInterval(videoIntervalRef.current);
      videoIntervalRef.current = null;
    }

    if (commentaryIntervalRef.current) {
      clearInterval(commentaryIntervalRef.current);
      commentaryIntervalRef.current = null;
    }

    if (backgroundSaveIntervalRef.current) {
      clearInterval(backgroundSaveIntervalRef.current);
      backgroundSaveIntervalRef.current = null;
    }
  };

  const clearReconnectTimer = () => {
    if (reconnectTimeoutRef.current) {
      window.clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  };

  const nextAnalyticsSeq = () => {
    analyticsEventSeqRef.current += 1;
    return analyticsEventSeqRef.current;
  };

  const recordAnalyticsEventSafe = (
    input: Omit<AnalyticsRawEventInput, 'sessionId' | 'seq' | 'occurredAt'> & { occurredAt?: string },
    sessionIdOverride?: string | null,
  ) => {
    const sessionId = sessionIdOverride || analyticsSessionIdRef.current;
    if (!sessionId) {
      return;
    }

    void recordAnalyticsEvent({
      ...input,
      sessionId,
      seq: nextAnalyticsSeq(),
      occurredAt: input.occurredAt || new Date().toISOString(),
    });
  };

  const recordAnalyticsMemorySafe = (input: Omit<AnalyticsMemoryInput, 'sessionId'>, sessionIdOverride?: string | null) => {
    const sessionId = sessionIdOverride || analyticsSessionIdRef.current;
    if (!sessionId) {
      return;
    }

    void recordAnalyticsMemory({
      ...input,
      sessionId,
    });
  };

  const recordAnalyticsTurnSafe = (
    input: Omit<Parameters<typeof recordAnalyticsTurn>[0], 'sessionId'>,
    sessionIdOverride?: string | null,
  ) => {
    const sessionId = sessionIdOverride || analyticsSessionIdRef.current;
    if (!sessionId) {
      return;
    }

    void recordAnalyticsTurn({
      ...input,
      sessionId,
    });
  };

  const appendHelpfulInfoEntry = ({
    title,
    content,
    source,
    logToTranscript = true,
  }: HelpfulInfoInsertInput): boolean => {
    const normalizedContent = typeof content === 'string' ? content.trim() : '';
    if (!normalizedContent) {
      return false;
    }

    const timestampLabel = new Date().toLocaleTimeString();
    const normalizedTitle = typeof title === 'string' ? title.trim() : '';
    const heading = normalizedTitle ? `### [${timestampLabel}] ${normalizedTitle}` : `### [${timestampLabel}] Helpful Info`;
    const infoEntry = `${heading}\n\n${normalizedContent}\n\n---\n\n`;
    const eventId = crypto.randomUUID();

    setHelpfulInfo((prev) => infoEntry + prev);
    if (logToTranscript) {
      setLogs((prev) => [{
        id: Math.random().toString(36).substring(7),
        timestamp: new Date(),
        text: source === 'timed-auto-save'
          ? '[Action]: Auto-saved helpful info from the current screen.'
          : '[Action]: Added helpful info to the Helpful Info tab.',
        role: 'system',
      }, ...prev]);
    }

    recordAnalyticsEventSafe({
      id: eventId,
      source: 'browserbud-ui',
      eventType: source === 'timed-auto-save' ? 'tool.helpful_info_auto_saved' : 'tool.helpful_info_saved',
      payload: {
        title: normalizedTitle || 'Helpful Info',
        content: normalizedContent,
        source,
      },
    });
    recordAnalyticsMemorySafe({
      memoryType: 'helpful_info',
      title: normalizedTitle || 'Helpful Info',
      bodyMd: normalizedContent,
      sourceEventIds: [eventId],
    });

    return true;
  };

  const readLocalHistorySessions = (limit = 20) => {
    return listStoredAnalyticsSessions(getSafeLocalStorage(), limit);
  };

  const readLocalHistoryTimeline = (sessionId: string) => {
    return getStoredAnalyticsSessionTimeline(getSafeLocalStorage(), sessionId);
  };

  const readLatestLocalHistoryTimeline = () => {
    return getLatestStoredAnalyticsSessionTimeline(getSafeLocalStorage());
  };

  const persistLocalHistoryTimeline = (timeline: AnalyticsSessionTimeline) => {
    upsertStoredAnalyticsTimeline(getSafeLocalStorage(), timeline);
  };

  const refreshHistorySessions = async () => {
    setHistoryLoading(true);
    setHistoryError(null);

    const response = await fetchAnalyticsSessions(20);
    const localSessions = readLocalHistorySessions(20);
    if (!response) {
      setHistorySessions(localSessions);
      setHistoryError(getHistoryUnavailableMessage(localSessions.length > 0));
      setHistoryLoading(false);
      return;
    }

    setHistorySessions(mergeHistorySessionItems(response.sessions, localSessions));
    setSelectedHistorySessionId((current) => {
      const mergedSessions = mergeHistorySessionItems(response.sessions, localSessions);
      if (current && mergedSessions.some((item) => item.session.id === current)) {
        return current;
      }
      return mergedSessions[0]?.session.id ?? null;
    });
    setHistoryLoading(false);
  };

  const refreshSelectedHistoryTimeline = async (sessionId: string) => {
    setHistoryLoading(true);
    setHistoryError(null);

    const timeline = await fetchAnalyticsSessionTimeline(sessionId);
    if (!timeline) {
      const localTimeline = readLocalHistoryTimeline(sessionId);
      setSelectedHistoryTimeline(localTimeline);
      setHistoryError(localTimeline ? null : 'Unable to load the selected session timeline right now.');
      setHistoryLoading(false);
      return;
    }

    setSelectedHistoryTimeline(timeline);
    setHistoryLoading(false);
  };

  const beginAnalyticsSession = (isReconnect: boolean) => {
    if (analyticsSessionIdRef.current) {
      recordAnalyticsEventSafe({
        source: 'browserbud-ui',
        eventType: 'session.reconnected',
        payload: {
          reconnectAttempt: reconnectAttemptsRef.current,
        },
      });
      return;
    }

    const sessionId = crypto.randomUUID();
    analyticsSessionIdRef.current = sessionId;
    analyticsEventSeqRef.current = 0;

    const sharedStream = videoRef.current?.srcObject as MediaStream | null;
    const sharedTrack = sharedStream?.getVideoTracks?.()[0] || null;
    const sourceSurface = captureRequirements.requiresScreenShare
      ? (sharedTrack?.getSettings?.().displaySurface || sharedTrack?.label || 'unknown')
      : (browserContextPacket?.domain ? `tab:${browserContextPacket.domain}` : 'browser-extension');
    const startedAt = new Date().toISOString();

    void createAnalyticsSession({
      id: sessionId,
      startedAt,
      sourceSurface,
      personaId: selectedPersonality.id,
      liveModel: LIVE_MODEL,
      searchEnabled: sessionSearchEnabled,
      captureMode,
    });

    recordAnalyticsEventSafe({
      source: 'browserbud-ui',
      eventType: isReconnect ? 'session.reconnected' : 'session.started',
      appName: 'BrowserBud',
      pageTitle: selectedPersonality.name,
      payload: {
        voiceName: selectedPersonality.voiceName,
        commentaryFrequencyMs: commentaryFrequency,
        helpfulInfoAutoSaveFrequencyMs: frequency,
        searchEnabled: sessionSearchEnabled,
        captureMode,
        extensionBridgeReady,
      },
    }, sessionId);

    localHistoryCaptureRef.current = {
      sessionId,
      startedAt,
      sourceSurface,
      personaId: selectedPersonality.id,
      liveModel: LIVE_MODEL,
      searchEnabled: sessionSearchEnabled,
      captureMode,
      existingLogIds: new Set(logs.map((entry) => entry.id)),
      helpfulInfoBaseline: helpfulInfo,
      activityLogBaseline: activityLog,
      savedNotesBaseline: savedNotes,
    };

    if (historySurfaceOpen) {
      void refreshHistorySessions();
    }
  };

  const finalizeAnalyticsSession = async (reason: string, { skipRecap = false }: { skipRecap?: boolean } = {}) => {
    const sessionId = analyticsSessionIdRef.current;
    const localHistoryCapture = localHistoryCaptureRef.current;
    if (!sessionId) {
      return;
    }

    const endedAt = new Date().toISOString();
    recordAnalyticsEventSafe({
      source: 'browserbud-ui',
      eventType: 'session.stopped',
      payload: { reason },
      occurredAt: endedAt,
    }, sessionId);

    analyticsSessionIdRef.current = null;
    analyticsEventSeqRef.current = 0;
    localHistoryCaptureRef.current = null;

    const localTurns = localHistoryCapture
      ? logs
        .filter((entry) => !localHistoryCapture.existingLogIds.has(entry.id) && (entry.role === 'user' || entry.role === 'model'))
        .slice()
        .reverse()
        .map((entry) => ({
          id: entry.id,
          sessionId,
          role: entry.role,
          startedAt: entry.timestamp.toISOString(),
          endedAt: entry.timestamp.toISOString(),
          transcript: entry.text,
          promptKind: entry.role === 'user' ? 'user-voice' : 'live-response',
          modelName: entry.role === 'model' ? LIVE_MODEL : null,
          relatedEventId: null,
        }))
      : [];

    const localMemories = localHistoryCapture
      ? [
        getPrependedDelta(helpfulInfo, localHistoryCapture.helpfulInfoBaseline)
          ? {
            id: `${sessionId}-helpful-info`,
            sessionId,
            memoryType: 'helpful_info',
            title: 'Helpful Info',
            bodyMd: getPrependedDelta(helpfulInfo, localHistoryCapture.helpfulInfoBaseline),
            sourceUrl: null,
            sourceEventIds: [],
            sourceTurnIds: [],
            embeddingModel: null,
            embeddingJson: null,
            createdAt: endedAt,
          }
          : null,
        getPrependedDelta(activityLog, localHistoryCapture.activityLogBaseline)
          ? {
            id: `${sessionId}-activity-log`,
            sessionId,
            memoryType: 'activity_log',
            title: 'Activity Log',
            bodyMd: getPrependedDelta(activityLog, localHistoryCapture.activityLogBaseline),
            sourceUrl: null,
            sourceEventIds: [],
            sourceTurnIds: [],
            embeddingModel: null,
            embeddingJson: null,
            createdAt: endedAt,
          }
          : null,
        getPrependedDelta(savedNotes, localHistoryCapture.savedNotesBaseline)
          ? {
            id: `${sessionId}-saved-notes`,
            sessionId,
            memoryType: 'saved_note',
            title: 'Saved Notes',
            bodyMd: getPrependedDelta(savedNotes, localHistoryCapture.savedNotesBaseline),
            sourceUrl: null,
            sourceEventIds: [],
            sourceTurnIds: [],
            embeddingModel: null,
            embeddingJson: null,
            createdAt: endedAt,
          }
          : null,
      ].filter(Boolean)
      : [];

    const persistLocalSession = (summary: AnalyticsSessionTimeline['summaries'][number] | null) => {
      if (!localHistoryCapture) {
        return;
      }

      persistLocalHistoryTimeline({
        session: {
          id: sessionId,
          startedAt: localHistoryCapture.startedAt,
          endedAt,
          sourceSurface: localHistoryCapture.sourceSurface,
          personaId: localHistoryCapture.personaId,
          liveModel: localHistoryCapture.liveModel,
          searchEnabled: localHistoryCapture.searchEnabled,
          captureMode: localHistoryCapture.captureMode,
          createdAt: localHistoryCapture.startedAt,
        },
        events: [
          {
            id: `${sessionId}-started`,
            sessionId,
            seq: 0,
            source: 'browserbud-ui',
            eventType: 'session.started',
            occurredAt: localHistoryCapture.startedAt,
            endedAt: null,
            appName: 'BrowserBud',
            windowTitle: null,
            tabId: null,
            url: null,
            domain: null,
            pageTitle: localHistoryCapture.personaId,
            payload: {
              searchEnabled: localHistoryCapture.searchEnabled,
              localFallback: true,
            },
            privacyTier: 'standard',
          },
          {
            id: `${sessionId}-stopped`,
            sessionId,
            seq: 1,
            source: 'browserbud-ui',
            eventType: 'session.stopped',
            occurredAt: endedAt,
            endedAt,
            appName: 'BrowserBud',
            windowTitle: null,
            tabId: null,
            url: null,
            domain: null,
            pageTitle: localHistoryCapture.personaId,
            payload: {
              reason,
              localFallback: true,
            },
            privacyTier: 'standard',
          },
        ],
        turns: localTurns,
        memories: localMemories,
        summaries: summary ? [summary] : [],
      });
    };

    if (skipRecap) {
      void completeAnalyticsSession(sessionId, endedAt);
      persistLocalSession(null);
      if (historySurfaceOpen) {
        void refreshHistorySessions();
      }
      return;
    }

    const recapResponse = await generateAnalyticsSessionRecap(sessionId, endedAt);
    const summary = recapResponse?.summary || (localHistoryCapture
      ? buildLocalSessionRecapSummary({
        session: {
          id: sessionId,
          startedAt: localHistoryCapture.startedAt,
          endedAt,
          sourceSurface: localHistoryCapture.sourceSurface,
          personaId: localHistoryCapture.personaId,
          liveModel: localHistoryCapture.liveModel,
          searchEnabled: localHistoryCapture.searchEnabled,
          captureMode: localHistoryCapture.captureMode,
          createdAt: localHistoryCapture.startedAt,
        },
        turns: localTurns,
        memories: localMemories,
        createdAt: endedAt,
      })
      : null);

    if (!recapResponse?.summary) {
      void completeAnalyticsSession(sessionId, endedAt);
    }

    persistLocalSession(summary);

    if (summary) {
      const timestamp = new Date();
      const recapBody = summary.markdown.replace(/^# Session Recap\s*/i, '').trim();
      const recapEntry = `### [${timestamp.toLocaleTimeString()}] Session Recap\n\n${recapBody}\n\n---\n\n`;
      setHelpfulInfo((prev) => recapEntry + prev);
      setLogs((prev) => [{
        id: Math.random().toString(36).slice(2),
        timestamp,
        text: '[Action]: Saved a session recap to the Helpful Info tab.',
        role: 'system',
      }, ...prev]);
    }

    if (historySurfaceOpen) {
      void refreshHistorySessions();
    }
  };

  const sendSessionPrompt = (
    text: string,
    {
      kind = 'manual',
      suppressOutput = false,
    }: {
      kind?: 'manual' | 'auto-save' | 'commentary';
      suppressOutput?: boolean;
    } = {},
  ) => {
    const pendingSession = sessionRef.current;
    if (!pendingSession) {
      return;
    }

    pendingTurnRef.current = true;
    lastPromptAtRef.current = Date.now();

    if (kind === 'auto-save') {
      setDebugState((prev) => ({
        ...prev,
        lastAutoSaveAt: new Date().toLocaleTimeString(),
      }));
    }

    if (kind === 'commentary') {
      setDebugState((prev) => ({
        ...prev,
        lastCommentaryAt: new Date().toLocaleTimeString(),
      }));
    }

    suppressModelOutputRef.current = suppressOutput;

    void pendingSession.then((session) => {
      session.sendRealtimeInput({ text });
    }).catch(() => {
      suppressModelOutputRef.current = false;
    });
  };

  const getCurrentPageDocument = async (): Promise<CurrentPageDocument | null> => {
    const packet = latestBrowserContextRef.current;
    if (!packet) {
      return null;
    }

    const cached = currentPageDocumentCacheRef.current.get(packet.url);
    const packetDocumentLength = packet.page.documentTextLength ?? packet.page.documentText?.length ?? 0;
    if (
      cached
      && (
        cached.source !== 'extension-context'
        || (!packet.page.documentTextTruncated && cached.documentTextLength === packetDocumentLength)
      )
    ) {
      return cached;
    }

    const resolved = await resolveCurrentPageDocument(packet);
    if (!resolved) {
      return null;
    }

    currentPageDocumentCacheRef.current.set(packet.url, resolved);
    if (currentPageDocumentCacheRef.current.size > 4) {
      const oldestKey = currentPageDocumentCacheRef.current.keys().next().value;
      if (oldestKey) {
        currentPageDocumentCacheRef.current.delete(oldestKey);
      }
    }

    return resolved;
  };

  const generatePageInsight = async (
    packet: BrowserContextPacket,
    document: CurrentPageDocument,
  ): Promise<PageInsight> => {
    const aiClient = new GoogleGenAI({ apiKey: configuredApiKey });
    const chunkTexts = splitDocumentTextIntoChunks(document.text, PAGE_INSIGHT_CHUNK_SIZE);
    const cappedChunkTexts = chunkTexts.slice(0, 24);
    const chunkSummaries: string[] = [];

    for (let index = 0; index < cappedChunkTexts.length; index += 1) {
      const response = await aiClient.models.generateContent({
        model: PAGE_INSIGHT_MODEL,
        contents: [{
          role: 'user',
          parts: [{
            text: [
              'You are preparing background browsing intelligence for BrowserBud.',
              `Current URL: ${packet.url}`,
              `Page title: ${packet.title}`,
              `Chunk ${index + 1} of ${cappedChunkTexts.length}.`,
              'Summarize the most important information from this chunk for later user assistance.',
              'Focus on what the page/document is about, notable facts, navigation cues, and anything likely to matter if the user asks a question later.',
              'Return JSON with: summary (string), keyPoints (array of short strings).',
              '',
              cappedChunkTexts[index],
            ].join('\n'),
          }],
        }],
        config: {
          temperature: 0.2,
          maxOutputTokens: 260,
          responseMimeType: 'application/json',
          responseJsonSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              summary: { type: 'string' },
              keyPoints: {
                type: 'array',
                items: { type: 'string' },
              },
            },
            required: ['summary'],
          },
        },
      });

      let parsed: { summary?: string; keyPoints?: string[] } | null = null;
      try {
        parsed = response.text ? JSON.parse(response.text) as { summary?: string; keyPoints?: string[] } : null;
      } catch {
        parsed = null;
      }

      const summary = typeof parsed?.summary === 'string' && parsed.summary.trim()
        ? parsed.summary.trim()
        : response.text?.trim();
      const keyPoints = Array.isArray(parsed?.keyPoints)
        ? parsed!.keyPoints.filter((point): point is string => typeof point === 'string' && point.trim().length > 0)
        : [];

      if (summary) {
        chunkSummaries.push([
          `Chunk ${index + 1}: ${summary}`,
          ...keyPoints.slice(0, 4).map((point) => `- ${point}`),
        ].join('\n'));
      }
    }

    const headings = packet.contentMap.headings.slice(0, 8).map((heading) => heading.text).join(' | ');
    const anchors = packet.anchors.slice(0, 8).map((anchor) => anchor.name).join(' | ');
    const finalResponse = await aiClient.models.generateContent({
      model: PAGE_INSIGHT_MODEL,
      contents: [{
        role: 'user',
        parts: [{
          text: [
            'You are preparing cached page intelligence for BrowserBud.',
            `Current URL: ${packet.url}`,
            `Page title: ${packet.title}`,
            `Content type: ${document.contentType || 'unknown'}`,
            `Document length: ${document.documentTextLength} characters`,
            headings ? `Top headings: ${headings}` : '',
            anchors ? `Action anchors: ${anchors}` : '',
            document.chunkCount > cappedChunkTexts.length
              ? `This summary was prepared from ${cappedChunkTexts.length} large chunks out of ${document.chunkCount} total chunks.`
              : `This summary was prepared from ${cappedChunkTexts.length} chunks.`,
            'Create JSON with: summary (string), pageKind (string), keyPoints (array of short strings), likelyUserGoals (array of short strings), navigationTips (array of short strings).',
            'Optimize for helping the user navigate, understand, and answer questions about this page later.',
            '',
            chunkSummaries.join('\n\n'),
          ].filter(Boolean).join('\n'),
        }],
      }],
      config: {
        temperature: 0.2,
        maxOutputTokens: 420,
        responseMimeType: 'application/json',
        responseJsonSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            summary: { type: 'string' },
            pageKind: { type: 'string' },
            keyPoints: {
              type: 'array',
              items: { type: 'string' },
            },
            likelyUserGoals: {
              type: 'array',
              items: { type: 'string' },
            },
            navigationTips: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          required: ['summary'],
        },
      },
    });

    let parsed: {
      summary?: string;
      pageKind?: string;
      keyPoints?: string[];
      likelyUserGoals?: string[];
      navigationTips?: string[];
    } | null = null;
    try {
      parsed = finalResponse.text ? JSON.parse(finalResponse.text) as {
        summary?: string;
        pageKind?: string;
        keyPoints?: string[];
        likelyUserGoals?: string[];
        navigationTips?: string[];
      } : null;
    } catch {
      parsed = null;
    }

    const cleanList = (values?: string[]) => (
      Array.isArray(values)
        ? values
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter(Boolean)
          .slice(0, 5)
        : []
    );

    return {
      url: packet.url,
      title: packet.title,
      generatedAt: new Date().toISOString(),
      documentFingerprint: buildPageInsightFingerprint(document),
      documentTextLength: document.documentTextLength,
      contentType: document.contentType,
      source: document.source,
      pageKind: typeof parsed?.pageKind === 'string' && parsed.pageKind.trim() ? parsed.pageKind.trim() : null,
      summary: typeof parsed?.summary === 'string' && parsed.summary.trim()
        ? parsed.summary.trim()
        : (finalResponse.text?.trim() || chunkSummaries[0] || 'Prepared page analysis is available.'),
      keyPoints: cleanList(parsed?.keyPoints),
      likelyUserGoals: cleanList(parsed?.likelyUserGoals),
      navigationTips: cleanList(parsed?.navigationTips),
    };
  };

  const maybeTriggerTimedHelpfulInfoSave = async () => {
    if (!shouldRunTimedBackgroundSave({
      frequencyMs: frequency,
      nowMs: Date.now(),
      isModelSpeaking: isModelSpeakingRef.current,
      hasPendingTurn: pendingTurnRef.current,
      hasPendingToolCall: pendingToolCallRef.current,
      hasReconnectTimer: Boolean(reconnectTimeoutRef.current),
      lastUserActivityAtMs: lastUserActivityAtRef.current,
      lastPromptAtMs: lastPromptAtRef.current,
      cooldownMs: AUTO_COMMENTARY_USER_COOLDOWN_MS,
    })) {
      return;
    }

    const frameBase64 = captureFrame();
    const browserContext = latestBrowserContextRef.current;
    const preparedInsight = latestPageInsightRef.current;
    if ((!frameBase64 && !browserContext) || !configuredApiKey || timedHelpfulInfoSaveInFlightRef.current) {
      return;
    }

    timedHelpfulInfoSaveInFlightRef.current = true;
    pendingToolCallRef.current = true;
    lastPromptAtRef.current = Date.now();
    setDebugState((prev) => ({
      ...prev,
      lastAutoSaveAt: new Date().toLocaleTimeString(),
    }));

    try {
      const aiClient = new GoogleGenAI({ apiKey: configuredApiKey });
      const parts: Array<Record<string, unknown>> = [];
      if (frameBase64) {
        parts.push({
          inlineData: {
            data: frameBase64,
            mimeType: 'image/jpeg',
          },
        });
      }
      if (browserContext) {
        parts.push({
          text: `Browser context snapshot:\n${buildBrowserContextPrompt(browserContext)}`,
        });
      }
      if (preparedInsight) {
        parts.push({
          text: `Prepared page analysis:\n${buildPageInsightContextPrompt(preparedInsight)}`,
        });
      }
      parts.push({
        text: [
          buildAutoSavePrompt(),
          frameBase64
            ? 'Use the attached screenshot as visual truth for what is visible right now.'
            : 'No screenshot is attached for this save. Use the browser-native context snapshot only.',
          browserContext
            ? 'Prefer specific observations about the current URL, page structure, visible actions, likely user intent, and anything worth remembering.'
            : 'Look only at the attached screenshot from the current browsing session.',
          'Return concise markdown that would still be useful when reopened later.',
        ].join(' '),
      });
      const response = await aiClient.models.generateContent({
        model: TIMED_HELPFUL_INFO_MODEL,
        contents: [{
          role: 'user',
          parts,
        }],
        config: {
          temperature: 0.2,
          maxOutputTokens: 220,
          responseMimeType: 'application/json',
          responseJsonSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              title: {
                type: 'string',
                description: 'Short title for the saved helpful info entry.',
              },
              content: {
                type: 'string',
                description: 'Concise markdown content about what matters on the current screen.',
              },
            },
            required: ['content'],
          },
        },
      });

      let parsed: { title?: string; content?: string } | null = null;
      try {
        parsed = response.text ? JSON.parse(response.text) as { title?: string; content?: string } : null;
      } catch {
        parsed = null;
      }

      const inserted = appendHelpfulInfoEntry({
        title: parsed?.title,
        content: parsed?.content || response.text,
        source: 'timed-auto-save',
        logToTranscript: false,
      });

      if (!inserted && response.text?.trim()) {
        appendHelpfulInfoEntry({
          title: 'Helpful Info',
          content: response.text,
          source: 'timed-auto-save',
          logToTranscript: false,
        });
      }
    } catch (error) {
      console.error('Timed helpful info save failed', error);
    } finally {
      pendingToolCallRef.current = false;
      timedHelpfulInfoSaveInFlightRef.current = false;
    }
  };

  const maybeTriggerTimedCommentary = () => {
    if (!shouldRunTimedBackgroundSave({
      frequencyMs: commentaryFrequency,
      nowMs: Date.now(),
      isModelSpeaking: isModelSpeakingRef.current,
      hasPendingTurn: pendingTurnRef.current,
      hasPendingToolCall: pendingToolCallRef.current,
      hasReconnectTimer: Boolean(reconnectTimeoutRef.current),
      lastUserActivityAtMs: lastUserActivityAtRef.current,
      lastPromptAtMs: lastPromptAtRef.current,
      cooldownMs: AUTO_COMMENTARY_USER_COOLDOWN_MS,
    })) {
      return;
    }

    sendSessionPrompt(TIMED_COMMENTARY_PROMPT, { kind: 'commentary' });
  };

  const cleanupLiveSession = ({ closeSession = false, stopMic = true }: { closeSession?: boolean; stopMic?: boolean } = {}) => {
    clearRuntimeTimers();

    activeSourcesRef.current.forEach((source) => {
      try {
        source.stop();
      } catch {}
    });
    activeSourcesRef.current = [];
    isModelSpeakingRef.current = false;
    pendingTurnRef.current = false;
    pendingToolCallRef.current = false;
    currentInputTranscriptRef.current = '';
    currentOutputTranscriptRef.current = '';
    setLiveDraftTranscript(null);
    suppressModelOutputRef.current = false;
    timedHelpfulInfoSaveInFlightRef.current = false;
    lastPromptAtRef.current = 0;
    firstAudioChunkSeenRef.current = false;
    sessionStartTimeRef.current = null;

    if (processorRef.current) {
      processorRef.current.port.onmessage = null;
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (micSourceRef.current) {
      micSourceRef.current.disconnect();
      micSourceRef.current = null;
    }

    if (micSinkRef.current) {
      micSinkRef.current.disconnect();
      micSinkRef.current = null;
    }

    if (stopMic && micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }

    if (micCtxRef.current) {
      void micCtxRef.current.close().catch(() => {});
      micCtxRef.current = null;
    }

    if (playCtxRef.current) {
      void playCtxRef.current.close().catch(() => {});
      playCtxRef.current = null;
    }

    const pendingSession = sessionRef.current;
    sessionRef.current = null;

    if (closeSession && pendingSession) {
      void pendingSession.then((session: any) => session.close()).catch(() => {});
    }
  };

  const scheduleReconnect = (reason: string) => {
    if (reconnectTimeoutRef.current || !shouldStayConnectedRef.current || isUnmountingRef.current) {
      return;
    }

    if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      shouldStayConnectedRef.current = false;
      setErrorMsg('Live connection could not be restored. Share your tab again if needed, then restart the companion.');
      setLogs((prev) => [{
        id: Math.random().toString(36).slice(2),
        timestamp: new Date(),
        text: 'Live connection could not be restored after several attempts.',
        role: 'system'
      }, ...prev]);
      setDebugState((prev) => ({
        ...prev,
        reconnectAttempts: reconnectAttemptsRef.current,
        lastReconnectReason: reason,
        lastReconnectAt: new Date().toLocaleTimeString(),
      }));
      return;
    }

    reconnectAttemptsRef.current += 1;
    const delayMs = Math.min(1000 * 2 ** (reconnectAttemptsRef.current - 1), 8000);
    setErrorMsg(`Live connection dropped. Reconnecting in ${Math.round(delayMs / 1000)}s...`);
    setLogs((prev) => [{
      id: Math.random().toString(36).slice(2),
      timestamp: new Date(),
      text: `Live connection dropped (${reason}). Reconnecting in ${Math.round(delayMs / 1000)}s...`,
      role: 'system'
    }, ...prev]);
    setDebugState((prev) => ({
      ...prev,
      reconnectAttempts: reconnectAttemptsRef.current,
      lastReconnectReason: reason,
      lastReconnectAt: new Date().toLocaleTimeString(),
    }));

    reconnectTimeoutRef.current = window.setTimeout(() => {
      reconnectTimeoutRef.current = null;
      void startLive({ isReconnect: true });
    }, delayMs);
  };

  const startLive = async ({ isReconnect = false }: { isReconnect?: boolean } = {}) => {
    if (isStartingRef.current || isUnmountingRef.current) {
      return;
    }

    if (captureRequirements.requiresScreenShare && !isSharing) {
      alert(captureMode === 'multimodal'
        ? 'Multimodal mode needs screen sharing and the Chrome extension. Share a tab or screen first.'
        : 'Please share a tab or screen first!');
      return;
    }

    if (captureRequirements.requiresExtension && !extensionBridgeReady) {
      alert(captureMode === 'multimodal'
        ? 'Multimodal mode needs the BrowserBud Chrome extension. Install it, reload BrowserBud, and try again.'
        : 'Browser extension mode needs the BrowserBud Chrome extension. Install it, reload BrowserBud, and try again.');
      return;
    }

    if (!configuredApiKey) {
      alert('Add your Gemini API key in the BYO key field before starting BrowserBud.');
      return;
    }

    console.debug('Start live requested', {
      isSharing,
      hasApiKey: Boolean(configuredApiKey),
      isReconnect,
      captureMode,
      extensionBridgeReady,
    });
    isStartingRef.current = true;
    isStoppingRef.current = false;
    setErrorMsg(null);
    clearReconnectTimer();
    lastInjectedBrowserContextPromptRef.current = null;

    if (!isReconnect) {
      shouldStayConnectedRef.current = true;
      reconnectAttemptsRef.current = 0;
    }

    cleanupLiveSession({ closeSession: false, stopMic: true });
    sessionStartTimeRef.current = performance.now();
    firstAudioChunkSeenRef.current = false;
    setDebugState((prev) => ({
      ...prev,
      firstAudioLatencyMs: null,
      reconnectAttempts: reconnectAttemptsRef.current,
    }));

    try {
      const aiClient = new GoogleGenAI({ apiKey: configuredApiKey });
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 } });
      console.debug('Microphone stream acquired', { tracks: micStream.getTracks().length });
      micStreamRef.current = micStream;

      playCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      micCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });

      void playCtxRef.current.resume().catch(() => {});
      void micCtxRef.current.resume().catch(() => {});
      await micCtxRef.current.audioWorklet.addModule('/pcm-recorder-worklet.js');

      nextPlayTimeRef.current = playCtxRef.current.currentTime;
      console.debug('Starting live session', {
        model: LIVE_MODEL,
        isReconnect,
        searchEnabled: sessionSearchEnabled,
        captureMode,
      });

      let currentTurnText = '';
      const commitUserTurn = () => {
        const text = currentInputTranscriptRef.current.trim();
        if (!text) {
          setLiveDraftTranscript(null);
          return;
        }

        const completedAt = new Date();
        setLiveDraftTranscript(null);
        setLogs((prev) => [{ id: Math.random().toString(36).substring(7), timestamp: completedAt, text, role: 'user' }, ...prev]);
        recordAnalyticsTurnSafe({
          id: crypto.randomUUID(),
          role: 'user',
          startedAt: completedAt.toISOString(),
          endedAt: completedAt.toISOString(),
          transcript: text,
          promptKind: 'user-voice',
        });
        recordAnalyticsEventSafe({
          source: 'browserbud-ui',
          eventType: 'live.user_turn_completed',
          occurredAt: completedAt.toISOString(),
          payload: {
            transcript: text,
          },
        });
        currentInputTranscriptRef.current = '';
      };

      const commitModelTurn = (suffix = '') => {
        const transcriptText = currentOutputTranscriptRef.current.trim();
        const fallbackText = currentTurnText.trim();
        const finalText = transcriptText || fallbackText;
        if (finalText) {
          const completedAt = new Date();
          const transcript = `${finalText}${suffix}`.trim();
          setLogs((prev) => [{
            id: Math.random().toString(36).substring(7),
            timestamp: completedAt,
            text: transcript,
            role: 'model'
          }, ...prev]);
          recordAnalyticsTurnSafe({
            id: crypto.randomUUID(),
            role: 'model',
            startedAt: completedAt.toISOString(),
            endedAt: completedAt.toISOString(),
            transcript,
            promptKind: 'live-response',
            modelName: LIVE_MODEL,
          });
          recordAnalyticsEventSafe({
            source: 'browserbud-ui',
            eventType: 'live.model_turn_completed',
            occurredAt: completedAt.toISOString(),
            pageTitle: selectedPersonality.name,
            payload: {
              transcript,
              interrupted: suffix.includes('Interrupted'),
            },
          });
        }
        currentTurnText = '';
        currentOutputTranscriptRef.current = '';
        pendingTurnRef.current = false;
        pendingToolCallRef.current = false;
      };

      const browserContextEnabled = captureRequirements.requiresExtension;
      const screenContextEnabled = captureRequirements.requiresScreenShare;
      const config: any = {
        responseModalities: [Modality.AUDIO],
        outputAudioTranscription: {},
        inputAudioTranscription: {},
        thinkingConfig: { thinkingLevel: 'minimal' },
        contextWindowCompression: { slidingWindow: {} },
        sessionResumption: { handle: sessionHandleRef.current || undefined },
        systemInstruction: {
          parts: [{ text: `${selectedPersonality.prompt} You can hear the user's voice. Respond naturally and keep spoken replies brief.

Tool rules:
- The Helpful Info tab stores reusable recommendations, links, and takeaways. If the user asks you to save something useful for later, call appendHelpfulInfo in this turn.
- When you receive a background auto-save check, you must call appendHelpfulInfo exactly once with a concise but useful note, even if only a short progress update is available.
- The Activity Log tab stores structured records of meaningful task and page changes. When you call logActivity, include the app name, page title, visible URL if available, a one-line summary, and brief details. Call it when the user explicitly asks for logging or when there is a clear task/page change worth recording.
- The Saved Notes tab stores direct reminders, todos, and remember-this requests. If the user says add a note, save this, or remember this, you must call saveNote in this turn before you finish responding.
- Do not use tools on every turn.
- Prioritize clean, complete spoken responses over fragmented quick replies.
${screenContextEnabled ? '- You receive live screen imagery from the current shared screen or tab. Treat that imagery as the primary source of truth for what is visibly on screen right now.' : ''}
${browserContextEnabled ? '- You also receive browser-native page context updates including URL, title, page structure, navigation, visible action anchors, and a current-page document corpus.' : ''}
${browserContextEnabled ? '- Treat browser-native context and prepared page analysis as supplemental. They help with structure, navigation, URL awareness, and off-screen document understanding, but they should not override the latest visible screen state.' : ''}
${browserContextEnabled ? '- When the user asks about off-screen content, page content below the fold, long articles, docs, or PDFs, use inspectCurrentPage, readCurrentPageChunk, and searchCurrentPage before answering. Do not pretend you have the full document if you have not inspected it.' : ''}` }]
        },
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedPersonality.voiceName } }
        },
        tools: [{
          functionDeclarations: [
            {
              name: 'appendHelpfulInfo',
              description: 'Add reusable advice, links, facts, or recommendations to the Helpful Info tab.',
              parameters: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING, description: 'Short title for the saved helpful info.' },
                  content: { type: Type.STRING, description: 'Markdown formatted helpful content to append.' }
                },
                required: ['content']
              }
            },
            {
              name: 'logActivity',
              description: 'Add a structured entry to the Activity Log tab describing a meaningful task or page change.',
              parameters: {
                type: Type.OBJECT,
                properties: {
                  appName: { type: Type.STRING, description: 'The app or site in focus, such as Chrome, Figma, Linear, or Gmail.' },
                  pageTitle: { type: Type.STRING, description: 'The page, tab, or screen title if visible.' },
                  url: { type: Type.STRING, description: 'The current URL if it is visible on screen.' },
                  summary: { type: Type.STRING, description: 'One concise sentence summarizing what the user is doing.' },
                  details: { type: Type.STRING, description: 'Optional extra details worth remembering.' }
                },
                required: ['appName', 'summary']
              }
            },
            {
              name: 'saveNote',
              description: 'Add a short reminder, quote, or requested note to the Saved Notes tab.',
              parameters: {
                type: Type.OBJECT,
                properties: {
                  note: { type: Type.STRING, description: 'The note or reminder to save.' }
                },
                required: ['note']
              }
            },
            ...(browserContextEnabled
              ? [
                {
                  name: 'inspectCurrentPage',
                  description: 'Inspect the current page corpus, including off-screen content when available, before answering questions about long pages or documents.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {},
                  },
                },
                {
                  name: 'readCurrentPageChunk',
                  description: 'Read a specific chunk from the current page corpus. Use this to walk through long pages or PDFs in order.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      chunkNumber: { type: Type.NUMBER, description: 'The 1-based chunk number to read from the current page corpus.' },
                    },
                    required: ['chunkNumber'],
                  },
                },
                {
                  name: 'searchCurrentPage',
                  description: 'Search the current page corpus, including off-screen page text, for relevant passages.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      query: { type: Type.STRING, description: 'The term, phrase, or question to search for in the current page corpus.' },
                    },
                    required: ['query'],
                  },
                },
              ]
              : [])
          ]
        }],
        toolConfig: {
          functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO },
        }
      };

      if (sessionSearchEnabled) {
        config.tools.push({ googleSearch: {} });
        config.systemInstruction.parts[0].text += '\n- Google Search is enabled for this session. Use it only for factual or time-sensitive questions where grounding helps.';
        config.toolConfig.includeServerSideToolInvocations = true;
      } else {
        config.systemInstruction.parts[0].text += '\n- Google Search is disabled for this session. Answer from the visible context unless the user explicitly asks you to search later.';
      }

      const sessionPromise = aiClient.live.connect({
        model: LIVE_MODEL,
        config,
        callbacks: {
          onopen: () => {
            console.debug('Live session opened', { model: LIVE_MODEL, resumed: Boolean(sessionHandleRef.current), isReconnect });
            reconnectAttemptsRef.current = 0;
            setErrorMsg(null);
            setIsRunning(true);
            beginAnalyticsSession(isReconnect);
            setDebugState((prev) => ({
              ...prev,
              reconnectAttempts: 0,
              lastReconnectAt: isReconnect ? new Date().toLocaleTimeString() : prev.lastReconnectAt,
            }));

            const source = micCtxRef.current!.createMediaStreamSource(micStream);
            const processor = new AudioWorkletNode(micCtxRef.current!, 'pcm-recorder-processor', {
              numberOfInputs: 1,
              numberOfOutputs: 1,
              outputChannelCount: [1],
              channelCount: 1,
              processorOptions: { chunkSize: 2048 },
            });
            const sink = micCtxRef.current!.createGain();
            sink.gain.value = 0;

            micSourceRef.current = source;
            micSinkRef.current = sink;
            processorRef.current = processor;

            source.connect(processor);
            processor.connect(sink);
            sink.connect(micCtxRef.current!.destination);

            processor.port.onmessage = (event) => {
              if (isMicMutedRef.current) {
                return;
              }

              const inputData = event.data;
              if (!(inputData instanceof Float32Array)) {
                return;
              }

              const pcm16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                pcm16[i] = Math.max(-1, Math.min(1, inputData[i])) * 32767;
              }

              const uint8Array = new Uint8Array(pcm16.buffer);
              let binary = '';
              for (let i = 0; i < uint8Array.byteLength; i++) {
                binary += String.fromCharCode(uint8Array[i]);
              }
              const base64 = btoa(binary);

              sessionPromise.then((session) => {
                session.sendRealtimeInput({ audio: { data: base64, mimeType: 'audio/pcm;rate=16000' } });
              }).catch(() => {});
            };

                if (captureRequirements.requiresScreenShare) {
              videoIntervalRef.current = window.setInterval(() => {
                const base64Image = captureFrame();
                if (base64Image) {
                  recordSentScreenFrame(base64Image);
                  sessionPromise.then((session) => {
                    session.sendRealtimeInput({ video: { data: base64Image, mimeType: 'image/jpeg' } });
                  }).catch(() => {});
                }
              }, 2000);
            }

            if (commentaryFrequency > 0) {
              commentaryIntervalRef.current = window.setInterval(() => {
                maybeTriggerTimedCommentary();
              }, commentaryFrequency);
            }

            if (frequency > 0) {
              backgroundSaveIntervalRef.current = window.setInterval(() => {
                maybeTriggerTimedHelpfulInfoSave();
              }, frequency);
            }

            setLogs((prev) => [{
              id: Math.random().toString(36).slice(2),
              timestamp: new Date(),
              text: isReconnect ? 'Live audio reconnected. You can keep talking.' : 'Connected to Live Audio. You can talk now!',
              role: 'system'
            }, ...prev]);
          },
          onmessage: (message: any) => {
            const inputTranscription = message.serverContent?.inputTranscription;
            const outputTranscription = message.serverContent?.outputTranscription;
            const sessionResumptionUpdate = message.sessionResumptionUpdate;
            const suppressModelOutput = suppressModelOutputRef.current;

            if (sessionResumptionUpdate?.resumable && sessionResumptionUpdate?.newHandle && sessionResumptionUpdate.newHandle !== sessionHandleRef.current) {
              sessionHandleRef.current = sessionResumptionUpdate.newHandle;
              setDebugState((prev) => ({
                ...prev,
                currentSessionHandle: sessionResumptionUpdate.newHandle,
              }));
            }

            const shouldLogEvent =
              Boolean(message.toolCall) ||
              Boolean(message.serverContent?.turnComplete) ||
              Boolean(message.serverContent?.interrupted) ||
              Boolean(message.serverContent?.generationComplete) ||
              Boolean(message.serverContent?.waitingForInput) ||
              Boolean(inputTranscription?.finished) ||
              Boolean(outputTranscription?.finished) ||
              Boolean(message.goAway);

            if (shouldLogEvent) {
              console.debug('Live API event', {
                turnComplete: Boolean(message.serverContent?.turnComplete),
                interrupted: Boolean(message.serverContent?.interrupted),
                generationComplete: Boolean(message.serverContent?.generationComplete),
                waitingForInput: Boolean(message.serverContent?.waitingForInput),
                inputFinished: Boolean(inputTranscription?.finished),
                outputFinished: Boolean(outputTranscription?.finished),
                hasToolCall: Boolean(message.toolCall),
                hasModelTurn: Boolean(message.serverContent?.modelTurn?.parts?.length),
                goAwayTimeLeft: message.goAway?.timeLeft || null,
              });
            }

            if (message.goAway?.timeLeft) {
              console.info('Live API connection rotation incoming', message.goAway.timeLeft);
            }

            if (inputTranscription?.text !== undefined) {
              lastUserActivityAtRef.current = Date.now();
              pendingTurnRef.current = true;
              currentInputTranscriptRef.current = mergeIncrementalTranscript(currentInputTranscriptRef.current, inputTranscription.text);
              const draftText = currentInputTranscriptRef.current.trim();
              setLiveDraftTranscript(draftText ? {
                id: 'draft-user',
                timestamp: new Date(),
                text: draftText,
                role: 'user',
                isDraft: true,
              } : null);
            }

            const parts = message.serverContent?.modelTurn?.parts;
            if (shouldCommitUserTranscript({
              inputFinished: Boolean(inputTranscription?.finished),
              hasModelParts: Boolean(parts?.length),
              hasToolCall: Boolean(message.toolCall),
              turnComplete: Boolean(message.serverContent?.turnComplete),
              interrupted: Boolean(message.serverContent?.interrupted),
            })) {
              commitUserTurn();
            }

            if (parts?.length) {
              pendingTurnRef.current = true;
              isModelSpeakingRef.current = true;
              for (const part of parts) {
                if (!suppressModelOutput && part?.text) {
                  currentTurnText += part.text;
                }
                if (!suppressModelOutput && part?.inlineData?.data) {
                  if (!firstAudioChunkSeenRef.current && sessionStartTimeRef.current !== null) {
                    firstAudioChunkSeenRef.current = true;
                    setDebugState((prev) => ({
                      ...prev,
                      firstAudioLatencyMs: performance.now() - sessionStartTimeRef.current!,
                    }));
                  }
                  playAudioChunk(part.inlineData.data);
                }
              }
            }

            if (!suppressModelOutput && outputTranscription?.text !== undefined) {
              currentOutputTranscriptRef.current = mergeIncrementalTranscript(currentOutputTranscriptRef.current, outputTranscription.text);
            }

            if (message.serverContent?.turnComplete) {
              isModelSpeakingRef.current = false;
              if (suppressModelOutputRef.current) {
                suppressModelOutputRef.current = false;
                currentTurnText = '';
                currentOutputTranscriptRef.current = '';
                pendingTurnRef.current = false;
                pendingToolCallRef.current = false;
              } else {
                commitModelTurn();
              }
            }

            if (message.serverContent?.interrupted) {
              isModelSpeakingRef.current = false;
              activeSourcesRef.current.forEach((source) => source.stop());
              activeSourcesRef.current = [];
              if (playCtxRef.current) {
                nextPlayTimeRef.current = playCtxRef.current.currentTime;
              }
              if (suppressModelOutputRef.current) {
                suppressModelOutputRef.current = false;
                currentTurnText = '';
                currentOutputTranscriptRef.current = '';
                pendingTurnRef.current = false;
                pendingToolCallRef.current = false;
              } else {
                commitModelTurn(' [Interrupted]');
              }
            }

            if (message.toolCall) {
              pendingToolCallRef.current = true;
              pendingTurnRef.current = true;
              const functionCalls = message.toolCall.functionCalls;
              if (functionCalls) {
                void (async () => {
                  const functionResponses: any[] = [];

                  for (const call of functionCalls) {
                    const timestamp = new Date().toLocaleTimeString();

                    if (call.name === 'appendHelpfulInfo') {
                      const args = call.args as any;
                      appendHelpfulInfoEntry({
                        title: args.title,
                        content: args.content,
                        source: 'live-tool',
                      });
                      functionResponses.push({ id: call.id, name: call.name, response: { result: 'success' } });
                      continue;
                    }

                    if (call.name === 'logActivity') {
                      const args = call.args as any;
                      const logEntry = formatActivityLogEntry(args, timestamp);
                      const eventId = crypto.randomUUID();
                      const pageTitle = typeof args.pageTitle === 'string' ? args.pageTitle.trim() : '';
                      const summary = typeof args.summary === 'string' ? args.summary.trim() : '';
                      const urlValue = typeof args.url === 'string' ? args.url.trim() : '';
                      let sourceUrl: string | null = null;
                      let sourceDomain: string | null = null;
                      try {
                        if (urlValue) {
                          const parsed = new URL(urlValue);
                          sourceUrl = parsed.toString();
                          sourceDomain = parsed.hostname;
                        }
                      } catch {}
                      setActivityLog((prev) => logEntry + prev);
                      setLogs((prev) => [{ id: Math.random().toString(36).substring(7), timestamp: new Date(), text: '[Action]: Logged structured activity to the Activity Log tab.', role: 'system' }, ...prev]);
                      recordAnalyticsEventSafe({
                        id: eventId,
                        source: 'browserbud-ui',
                        eventType: 'tool.activity_logged',
                        appName: typeof args.appName === 'string' ? args.appName.trim() : null,
                        url: sourceUrl,
                        domain: sourceDomain,
                        pageTitle: pageTitle || null,
                        payload: {
                          appName: args.appName,
                          pageTitle: args.pageTitle,
                          url: args.url,
                          summary: args.summary,
                          details: args.details,
                        },
                      });
                      recordAnalyticsMemorySafe({
                        memoryType: 'activity_log',
                        title: summary || pageTitle || 'Activity logged',
                        bodyMd: logEntry,
                        sourceUrl,
                        sourceEventIds: [eventId],
                      });
                      functionResponses.push({ id: call.id, name: call.name, response: { result: 'success' } });
                      continue;
                    }

                    if (call.name === 'saveNote') {
                      const args = call.args as any;
                      const noteEntry = `- **[${timestamp}]** ${args.note}\n`;
                      const eventId = crypto.randomUUID();
                      setSavedNotes((prev) => noteEntry + prev);
                      setLogs((prev) => [{ id: Math.random().toString(36).substring(7), timestamp: new Date(), text: '[Action]: Saved note to the Saved Notes tab.', role: 'system' }, ...prev]);
                      recordAnalyticsEventSafe({
                        id: eventId,
                        source: 'browserbud-ui',
                        eventType: 'tool.note_saved',
                        payload: {
                          note: args.note,
                        },
                      });
                      recordAnalyticsMemorySafe({
                        memoryType: 'saved_note',
                        title: typeof args.note === 'string' && args.note.trim() ? args.note.trim().slice(0, 80) : 'Saved Note',
                        bodyMd: typeof args.note === 'string' ? args.note : '',
                        sourceEventIds: [eventId],
                      });
                      functionResponses.push({ id: call.id, name: call.name, response: { result: 'success' } });
                      continue;
                    }

                    if (call.name === 'inspectCurrentPage') {
                      const packet = latestBrowserContextRef.current;
                      if (!packet) {
                        functionResponses.push({ id: call.id, name: call.name, response: { error: 'No active browser context is available yet.' } });
                        continue;
                      }

                      const document = await getCurrentPageDocument();
                      const snapshot = buildCurrentPageToolSnapshot(packet);
                      functionResponses.push({
                        id: call.id,
                        name: call.name,
                        response: {
                          ...snapshot,
                          fullDocumentAvailable: Boolean(document),
                          preparedInsight: latestPageInsightRef.current
                            ? {
                              summary: latestPageInsightRef.current.summary,
                              keyPoints: latestPageInsightRef.current.keyPoints,
                              likelyUserGoals: latestPageInsightRef.current.likelyUserGoals,
                              navigationTips: latestPageInsightRef.current.navigationTips,
                            }
                            : null,
                          ...(document ? buildCurrentPageToolResult(document) : {}),
                        },
                      });
                      continue;
                    }

                    if (call.name === 'readCurrentPageChunk') {
                      const packet = latestBrowserContextRef.current;
                      const args = call.args as any;
                      if (!packet) {
                        functionResponses.push({ id: call.id, name: call.name, response: { error: 'No active browser context is available yet.' } });
                        continue;
                      }

                      const chunkNumber = Number(args?.chunkNumber) || 1;
                      const document = await getCurrentPageDocument();
                      const chunk = document
                        ? readCurrentPageDocumentChunk(document, chunkNumber)
                        : readDocumentTextChunk(packet.page.documentText || packet.page.mainTextExcerpt || '', chunkNumber);

                      if (!chunk) {
                        functionResponses.push({
                          id: call.id,
                          name: call.name,
                          response: {
                            error: 'No readable page corpus is available for the current page.',
                            url: packet.url,
                          },
                        });
                        continue;
                      }

                      functionResponses.push({
                        id: call.id,
                        name: call.name,
                        response: {
                          url: packet.url,
                          title: packet.title,
                          source: document?.source || 'extension-context',
                          chunkNumber: chunk.chunkNumber,
                          totalChunks: chunk.totalChunks,
                          text: chunk.text,
                        },
                      });
                      continue;
                    }

                    if (call.name === 'searchCurrentPage') {
                      const packet = latestBrowserContextRef.current;
                      const args = call.args as any;
                      const query = typeof args?.query === 'string' ? args.query : '';
                      if (!packet) {
                        functionResponses.push({ id: call.id, name: call.name, response: { error: 'No active browser context is available yet.' } });
                        continue;
                      }

                      const document = await getCurrentPageDocument();
                      const results = document
                        ? searchCurrentPageDocument(document, query, 4)
                        : searchBrowserContextDocument(packet, query, 4);
                      functionResponses.push({
                        id: call.id,
                        name: call.name,
                        response: {
                          url: packet.url,
                          title: packet.title,
                          query,
                          resultCount: results.length,
                          results,
                          source: document?.source || 'extension-context',
                        },
                      });
                    }
                  }

                  if (functionResponses.length) {
                    sessionPromise.then((session) => {
                      session.sendToolResponse({ functionResponses });
                      pendingToolCallRef.current = false;
                    }).catch(() => {
                      pendingToolCallRef.current = false;
                    });
                  } else {
                    pendingToolCallRef.current = false;
                  }
                })().catch(() => {
                  pendingToolCallRef.current = false;
                });
              }
            }
          },
          onclose: () => {
            console.debug('Live session closed', { shouldReconnect: shouldStayConnectedRef.current && !isStoppingRef.current });
            cleanupLiveSession({ closeSession: false, stopMic: true });
            setIsRunning(false);

            if (isUnmountingRef.current || isStoppingRef.current || !shouldStayConnectedRef.current) {
              return;
            }

            scheduleReconnect('connection closed');
          },
          onerror: (err) => {
            console.error(`Live API error (model: ${LIVE_MODEL})`, err);
            cleanupLiveSession({ closeSession: false, stopMic: true });
            setIsRunning(false);

            if (isUnmountingRef.current || isStoppingRef.current || !shouldStayConnectedRef.current) {
              return;
            }

            scheduleReconnect(err?.message || 'runtime error');
          }
        }
      });

      sessionRef.current = sessionPromise;
    } catch (err: any) {
      cleanupLiveSession({ closeSession: false, stopMic: true });
      const message = `Failed to start Live API: ${err.message || err}. Did you grant microphone permissions?`;
      console.error(message, err);
      setErrorMsg(message);

      if (isReconnect) {
        scheduleReconnect(err?.message || 'startup failure');
      } else {
        shouldStayConnectedRef.current = false;
        alert(message);
      }
    } finally {
      isStartingRef.current = false;
    }
  };


  const stopLive = () => {
    void finalizeAnalyticsSession('user_stopped_session');
    shouldStayConnectedRef.current = false;
    isStoppingRef.current = true;
    lastInjectedBrowserContextPromptRef.current = null;
    clearReconnectTimer();
    cleanupLiveSession({ closeSession: true, stopMic: true });
    setIsRunning(false);
    setErrorMsg(null);
    setLogs((prev) => [{ id: Math.random().toString(), timestamp: new Date(), text: 'Disconnected.', role: 'system' }, ...prev]);
  };

  const toggleRunning = () => {
    console.debug('Toggle running clicked', { isSharing, isRunning, hasApiKey: Boolean(configuredApiKey) });
    if (!isRunning) {
      void startLive();
    } else {
      stopLive();
    }
  };

  useEffect(() => {
    isUnmountingRef.current = false;

    return () => {
      isUnmountingRef.current = true;
      shouldStayConnectedRef.current = false;
      clearReconnectTimer();
      void finalizeAnalyticsSession('app_unmounted', { skipRecap: true });
      cleanupLiveSession({ closeSession: true, stopMic: true });
    };
  }, []);

  const selectedHistorySession = historySessions.find((item) => item.session.id === selectedHistorySessionId) || null;
  const historyTurns = selectedHistoryTimeline ? [...selectedHistoryTimeline.turns].reverse().slice(0, 6) : [];
  const historyEvents = selectedHistoryTimeline ? [...selectedHistoryTimeline.events].reverse().slice(0, 8) : [];
  const historyMemories = selectedHistoryTimeline ? selectedHistoryTimeline.memories.slice(0, 8) : [];
  const transcriptFeed = buildTranscriptFeed(
    logs.map((log) => ({
      id: log.id,
      timestamp: log.timestamp.toISOString(),
      text: log.text,
      role: log.role,
    })),
    liveDraftTranscript ? {
      timestamp: liveDraftTranscript.timestamp.toISOString(),
      text: liveDraftTranscript.text,
      role: liveDraftTranscript.role,
    } : null,
  ).flatMap((entry) => {
    const timestamp = new Date(entry.timestamp);
    if (Number.isNaN(timestamp.getTime())) {
      return [];
    }

    return [{
      ...entry,
      timestamp,
    }];
  });
  const orderedTranscriptFeed = [...transcriptFeed].reverse();
  const latestHistorySession = historySessions[0] || null;
  const selectedHistorySummary = selectedHistorySession?.latestSummary
    || selectedHistoryTimeline?.summaries.find((summary) => summary.summaryKind === 'session_recap')
    || null;
  const latestHistorySummary = latestHistorySession?.latestSummary
    || selectedHistoryTimeline?.summaries.find((summary) => summary.summaryKind === 'session_recap')
    || null;
  const featuredMemorySession = selectedHistorySession || latestHistorySession;
  const featuredMemorySummary = selectedHistorySummary || latestHistorySummary;
  const featuredMemoryMarkdown = stripSessionRecapHeading(featuredMemorySummary?.markdown);
  const extensionStatus = !extensionBridgeChecked
    ? 'Checking'
    : extensionBridgeReady
      ? 'Connected'
      : 'Not detected';
  const pageInsightStatusLabel = pageInsightStatus === 'warming'
    ? 'Preparing'
    : pageInsightStatus === 'ready'
      ? 'Ready'
      : pageInsightStatus === 'error'
        ? 'Retry Needed'
        : 'Idle';
  const canStartCompanion = (!captureRequirements.requiresScreenShare || isSharing)
    && (!captureRequirements.requiresExtension || extensionBridgeReady);
  const startButtonLabel = (() => {
    if (isRunning) {
      return 'Stop Companion';
    }
    if (!configuredApiKey) {
      return 'Open Settings for Key';
    }
    if (captureRequirements.requiresExtension && !extensionBridgeReady) {
      return extensionBridgeChecked ? 'Reload With Extension' : 'Checking Extension';
    }
    if (captureRequirements.requiresScreenShare && !isSharing) {
      return captureMode === 'multimodal' ? 'Share Screen to Start' : 'Share Tab/Screen';
    }
    return 'Start Companion';
  })();

  useEffect(() => {
    if (activeTab !== 'transcript') {
      return;
    }

    const scrollContainer = tabContentScrollRef.current;
    if (!scrollContainer) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [activeTab, orderedTranscriptFeed.length, liveDraftTranscript?.text]);

  if (!runtimeSupport.supported) {
    return (
      <div className="min-h-screen bg-[#FAFAF8] px-6 py-10 text-stone-900 selection:bg-teal-500/20 sm:px-8">
        <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-3xl items-center">
          <div className="w-full rounded-[32px] border border-stone-200 bg-white p-8 shadow-sm sm:p-10">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
              <MonitorOff className="h-4 w-4" />
              {runtimeSupport.desktopOnly ? 'Desktop only' : 'Browser unsupported'}
            </div>

            <h1 className="mt-6 text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">
              {runtimeSupport.desktopOnly ? 'BrowserBud needs a desktop browser' : 'This browser cannot run BrowserBud'}
            </h1>

            <p className="mt-4 text-base leading-7 text-stone-600 sm:text-lg">
              {runtimeSupport.desktopOnly
                ? 'The live companion relies on tab or screen capture, microphone capture, and realtime audio APIs that are not reliable on mobile browsers today.'
                : 'BrowserBud could not find the browser APIs it needs for screen sharing, microphone access, and realtime audio.'}
            </p>

            <div className="mt-6 rounded-2xl border border-stone-200 bg-stone-50 p-5">
              <div className="text-sm font-medium text-stone-800">What to do instead</div>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-stone-600">
                <li>Open BrowserBud on a desktop or laptop browser.</li>
                <li>Use a current version of Chrome, Edge, Firefox, or Safari on macOS.</li>
                <li>If you are opening from an embedded preview, move it into a normal browser tab first.</li>
              </ul>
            </div>

            <div className="mt-6 rounded-2xl border border-stone-200 bg-white p-5">
              <div className="text-sm font-medium text-stone-800">Detected blockers</div>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-stone-600">
                {runtimeSupport.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <a
                href="/"
                className="inline-flex items-center justify-center rounded-full bg-teal-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
              >
                Back to home
              </a>
              <p className="text-sm text-stone-500">
                Reopen this URL on a desktop browser to use the live companion.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFAF8] text-stone-900 font-sans selection:bg-teal-500/20">
      <canvas ref={canvasRef} className="hidden" />

      <div className="max-w-6xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-8 h-screen max-h-screen min-h-0 overflow-hidden">

        {/* Left Panel: Configuration */}
        <div className="lg:col-span-4 flex flex-col gap-6 h-full overflow-y-auto pr-2 pb-8 custom-scrollbar">
	          <div className="space-y-3">
	            <div className="space-y-2">
	              <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2.5">
                <Monitor className="w-6 h-6 text-teal-600" />
                BrowserBud
              </h1>
              <p className="text-sm text-stone-500">
                BYO Gemini key alpha for turning live browsing into recaps, saved context, and session history.
	              </p>
	            </div>
	            {errorMsg && (
	              <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700 shadow-sm">
	                {errorMsg}
	              </div>
	            )}
	            <div className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-600 shadow-sm">
	              {configuredApiKey
	                ? 'Gemini key is stored locally on this device. Use the settings button in the top-right to review or clear it.'
	                : 'Add your Gemini key from the settings button in the top-right before starting the companion.'}
	            </div>
	          </div>

		          <div className="bg-white border border-[#E8E5E0] rounded-xl p-5 space-y-6 shadow-sm">

		            <div className="space-y-3">
		              <label className="text-sm font-medium text-stone-700 flex items-center gap-2">
		                <Globe className="w-4 h-4 text-stone-400" />
		                Capture Mode
		              </label>
		              <div className="grid grid-cols-1 gap-2">
		                {CAPTURE_MODES.map((mode) => (
		                  <button
		                    key={mode.id}
		                    type="button"
		                    onClick={() => setCaptureMode(mode.id)}
		                    disabled={isRunning}
		                    className={`rounded-xl border px-4 py-3 text-left transition-colors ${
		                      captureMode === mode.id
		                        ? 'border-teal-300 bg-teal-50'
		                        : 'border-stone-200 bg-white hover:bg-stone-50'
		                    } ${isRunning ? 'cursor-not-allowed opacity-60' : ''}`}
		                  >
		                    <div className="flex items-center justify-between gap-3">
		                      <div className="text-sm font-medium text-stone-900">{mode.label}</div>
		                      <div className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${
		                        captureMode === mode.id ? 'text-teal-700' : 'text-stone-400'
		                      }`}>
		                        {captureMode === mode.id ? 'Selected' : 'Available'}
		                      </div>
		                    </div>
		                    <p className="mt-1 text-xs leading-5 text-stone-500">{mode.description}</p>
		                  </button>
		                ))}
		              </div>
		            </div>

		            <div className="space-y-3 rounded-xl border border-stone-200 bg-stone-50 p-4">
		              <div className="flex items-center justify-between gap-3">
		                <div>
		                  <div className="text-sm font-medium text-stone-800">Chrome Extension Context</div>
		                  <p className="mt-1 text-xs leading-5 text-stone-500">
		                    Browser-native URL, nav, headings, forms, and action anchors for multimodal guidance.
		                  </p>
		                </div>
		                <button
		                  type="button"
		                  onClick={() => {
		                    postBrowserBudBridgeRequest('REQUEST_EXTENSION_STATUS');
		                    postBrowserBudBridgeRequest('REQUEST_ACTIVE_CONTEXT');
		                  }}
		                  className="rounded-full border border-stone-200 bg-white px-3 py-1 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-100"
		                >
		                  Refresh
		                </button>
		              </div>
		              <div className="flex items-center gap-2">
		                <span className={`h-2.5 w-2.5 rounded-full ${
		                  extensionBridgeReady ? 'bg-emerald-500' : extensionBridgeChecked ? 'bg-amber-500' : 'bg-stone-300'
		                }`} />
		                <span className="text-xs font-medium uppercase tracking-[0.14em] text-stone-500">
		                  {extensionStatus}
		                </span>
		                {extensionVersion && (
		                  <span className="text-xs text-stone-400">v{extensionVersion}</span>
		                )}
		              </div>
		              {browserContextPacket ? (
		                <div className="rounded-xl border border-stone-200 bg-white px-4 py-3">
		                  <div className="text-sm font-medium text-stone-900">{browserContextPacket.title}</div>
		                  <div className="mt-1 break-all text-xs text-teal-700">{browserContextPacket.url}</div>
		                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-stone-500">
		                    <div className="rounded-lg border border-stone-200 bg-stone-50 px-2 py-2">
		                      <div className="uppercase tracking-[0.12em] text-stone-400">Section</div>
		                      <div className="mt-1 font-medium text-stone-700">
		                        {browserContextPacket.location.activeSection || 'Unknown'}
		                      </div>
		                    </div>
		                    <div className="rounded-lg border border-stone-200 bg-stone-50 px-2 py-2">
		                      <div className="uppercase tracking-[0.12em] text-stone-400">Headings</div>
		                      <div className="mt-1 font-medium text-stone-700">{browserContextPacket.contentMap.headings.length}</div>
		                    </div>
		                    <div className="rounded-lg border border-stone-200 bg-stone-50 px-2 py-2">
		                      <div className="uppercase tracking-[0.12em] text-stone-400">Anchors</div>
		                      <div className="mt-1 font-medium text-stone-700">{browserContextPacket.anchors.length}</div>
		                    </div>
		                  </div>
		                </div>
		              ) : (
		                <div className="rounded-xl border border-dashed border-stone-300 bg-white px-4 py-3 text-xs leading-5 text-stone-500">
		                  {extensionBridgeReady
		                    ? 'Extension bridge is connected, but no active browser page snapshot has arrived yet.'
		                    : extensionBridgeChecked
		                      ? 'Extension not detected in this tab yet. Install it and reload BrowserBud to enable multimodal context.'
		                      : 'Checking whether the BrowserBud Chrome extension is available in this tab.'}
		                </div>
		              )}
		              <div className="rounded-xl border border-stone-200 bg-white px-4 py-3">
		                <div className="flex items-center justify-between gap-3">
		                  <div>
		                    <div className="text-sm font-medium text-stone-900">Prepared Page Analysis</div>
		                    <p className="mt-1 text-xs leading-5 text-stone-500">
		                      BrowserBud warms a deeper page summary and navigation hints in the background for the current page or PDF.
		                    </p>
		                  </div>
		                  <div className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${
		                    pageInsightStatus === 'ready'
		                      ? 'bg-emerald-50 text-emerald-700'
		                      : pageInsightStatus === 'warming'
		                        ? 'bg-amber-50 text-amber-700'
		                        : pageInsightStatus === 'error'
		                          ? 'bg-rose-50 text-rose-700'
		                          : 'bg-stone-100 text-stone-500'
		                  }`}>
		                    {pageInsightStatusLabel}
		                  </div>
		                </div>
		                {pageInsight ? (
		                  <div className="mt-3 space-y-3 text-xs text-stone-600">
		                    <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 leading-5 text-stone-700">
		                      {pageInsight.summary}
		                    </div>
		                    {pageInsight.navigationTips.length > 0 && (
		                      <div>
		                        <div className="uppercase tracking-[0.12em] text-stone-400">Navigation help</div>
		                        <div className="mt-1 leading-5 text-stone-600">
		                          {pageInsight.navigationTips.slice(0, 2).join(' | ')}
		                        </div>
		                      </div>
		                    )}
		                  </div>
		                ) : (
		                  <div className="mt-3 text-xs leading-5 text-stone-500">
		                    {pageInsightStatus === 'warming'
		                      ? 'BrowserBud is reading and preparing the current page in the background.'
		                      : pageInsightStatus === 'error'
		                        ? pageInsightError || 'Background page analysis failed for this page.'
		                        : configuredApiKey
		                          ? 'Open a page or PDF with extension context enabled to warm a reusable summary.'
		                          : 'Add your Gemini key to enable background page analysis.'}
		                  </div>
		                )}
		              </div>
		            </div>

		            {/* Screen Share Preview */}
	            <div className="space-y-3">
	              <div className="flex items-center justify-between">
	                <label className="text-sm font-medium text-stone-700 flex items-center gap-2">
	                  <Monitor className="w-4 h-4 text-stone-400" />
	                  {captureRequirements.requiresScreenShare ? 'Screen Source' : 'Screen Source (Optional)'}
	                </label>
	                <button
	                  onClick={toggleSharing}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                    isSharing
                      ? 'bg-rose-50 text-rose-600 hover:bg-rose-100'
                      : 'bg-teal-50 text-teal-600 hover:bg-teal-100'
                  }`}
                >
                  {isSharing ? 'Stop Sharing' : 'Share Tab/Screen'}
                </button>
              </div>

              <div className="relative aspect-video bg-stone-50 rounded-lg overflow-hidden border border-stone-200 shadow-inner flex items-center justify-center">
                {!isSharing && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-stone-400 gap-2">
                    <MonitorOff className="w-8 h-8 opacity-50" />
                    <span className="text-sm">No screen shared</span>
                  </div>
                )}
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-contain ${!isSharing ? 'opacity-0' : 'opacity-100'}`}
                />
              </div>

	              <div className="flex items-start gap-2 text-xs text-stone-500 bg-stone-50 p-3 rounded-xl border border-stone-200">
	                <Info className="w-4 h-4 shrink-0 text-teal-500" />
	                <p>
	                  {captureRequirements.requiresScreenShare
	                    ? 'To have the companion follow you across all tabs, choose "Entire Screen" when sharing.'
	                    : 'Screen-share stays available as a parallel visual signal, but this mode can run from the extension context alone.'}
	                </p>
	              </div>
	            </div>

            {/* Personality Select & Management */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-stone-700 flex items-center gap-2">
                  <User className="w-4 h-4 text-stone-400" />
                  Companion Personality
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={resetPersonas}
                    className="text-xs text-stone-400 hover:text-stone-600 transition-colors"
                    title="Reset to defaults"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setShowAddPersona(!showAddPersona)}
                    className="text-xs text-teal-600 hover:text-teal-500 transition-colors flex items-center gap-1"
                  >
                    <Plus className="w-4 h-4" /> Add
                  </button>
                </div>
              </div>

              {showAddPersona && (
                <div className="bg-stone-50 p-4 rounded-xl border border-stone-200 space-y-3">
                  <input
                    type="text"
                    placeholder="Persona Name (e.g. Pirate)"
                    value={newPersonaName}
                    onChange={e => setNewPersonaName(e.target.value)}
                    className="w-full bg-white border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500/20"
                  />
                  <textarea
                    placeholder="Prompt (e.g. You are a pirate looking at the screen...)"
                    value={newPersonaPrompt}
                    onChange={e => setNewPersonaPrompt(e.target.value)}
                    rows={3}
                    className="w-full bg-white border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500/20 resize-none"
                  />
                  <label className="flex items-center gap-2 text-sm text-stone-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newPersonaSearch}
                      onChange={e => setNewPersonaSearch(e.target.checked)}
                      className="rounded border-stone-300 bg-white text-teal-600 focus:ring-teal-500"
                    />
                    Enable Google Search (Grounded, slower)
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={newPersonaVoice}
                      onChange={e => setNewPersonaVoice(e.target.value)}
                      className="flex-1 bg-white border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500"
                    >
                      {AVAILABLE_VOICES.map(v => <option key={v} value={v}>{v} Voice</option>)}
                    </select>
                    <button
                      onClick={addPersona}
                      className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                {personas.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setPersonality(p.id)}
                    disabled={isRunning}
                    className={`text-left px-4 py-3 rounded-lg text-sm transition-all border flex items-center justify-between group ${
                      personality === p.id
                        ? 'bg-teal-50 border-l-2 border-teal-500 text-stone-900'
                        : 'bg-white border-stone-200 text-stone-600 hover:bg-stone-50'
                    } ${isRunning ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <div className="flex items-center gap-2">
                      <div className="font-medium">{p.name}</div>
                      {p.useSearch && <span title="Uses Google Search"><Search className="w-3 h-3 text-teal-500" /></span>}
                    </div>
                    {p.isCustom && !isRunning && (
                      <Trash2
                        className="w-4 h-4 text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity hover:text-rose-500"
                        onClick={(e) => deletePersona(p.id, e)}
                      />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Frequency Select */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-stone-700 flex items-center gap-2">
                <Clock className="w-4 h-4 text-stone-400" />
                Auto-Commentary Frequency
              </label>
              <select
                value={commentaryFrequency}
                onChange={(e) => setCommentaryFrequency(Number(e.target.value))}
                disabled={isRunning}
                className="w-full bg-white border border-stone-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 appearance-none disabled:opacity-50"
              >
                {FREQUENCIES.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
              <p className="text-xs text-stone-500">
                Spoken commentary during idle windows. BrowserBud waits until you stop talking before triggering these prompts.
              </p>
            </div>

            <div className="space-y-3">
              <label className="text-sm font-medium text-stone-700 flex items-center gap-2">
                <Clock className="w-4 h-4 text-stone-400" />
                Helpful Info Auto-Save
              </label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(Number(e.target.value))}
                disabled={isRunning}
                className="w-full bg-white border border-stone-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 appearance-none disabled:opacity-50"
              >
                {FREQUENCIES.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
              <p className="text-xs text-stone-500">
                Runs silent background saves into Helpful Info after a short idle cooldown. Nothing is spoken out loud during these timed saves.
              </p>
            </div>

            <div className="space-y-3">
              <label className="text-sm font-medium text-stone-700 flex items-center gap-2">
                <Search className="w-4 h-4 text-stone-400" />
                Google Search Grounding
              </label>
              <label className="flex items-center gap-3 rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sessionSearchEnabled}
                  onChange={(e) => setSessionSearchEnabled(e.target.checked)}
                  disabled={isRunning}
                  className="rounded border-stone-300 bg-white text-teal-600 focus:ring-teal-500"
                />
                <span className="flex-1">Enable search for this session</span>
                <span className={`text-xs font-medium ${sessionSearchEnabled ? 'text-teal-600' : 'text-stone-400'}`}>
                  {sessionSearchEnabled ? 'ON' : 'OFF'}
                </span>
              </label>
              <p className="text-xs text-stone-500">
                Grounding helps with factual lookups, but it adds latency. You can change this before starting the companion.
              </p>
            </div>

            {/* Controls */}
		            <div className="pt-4 border-t border-stone-200 flex gap-3">
		              <button
		                onClick={() => {
		                  if (!configuredApiKey) {
		                    setShowSettingsPanel(true);
		                    return;
		                  }
		                  toggleRunning();
		                }}
		                disabled={!isRunning && !configuredApiKey ? false : !isRunning && !canStartCompanion}
		                className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-lg font-medium transition-all ${
		                  !isRunning && !canStartCompanion
		                    ? 'bg-stone-100 text-stone-400 cursor-not-allowed'
		                    : !configuredApiKey
		                      ? 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200'
		                      : isRunning
		                        ? 'bg-rose-50 text-rose-600 hover:bg-rose-100 border border-rose-200'
		                        : 'bg-teal-600 text-white hover:bg-teal-700 shadow-md shadow-teal-600/15'
		                }`}
		              >
		                {isRunning ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
		                {startButtonLabel}
		              </button>

              <button
                onClick={() => setIsMicMuted(!isMicMuted)}
                disabled={!isRunning}
                className={`p-3 rounded-lg border transition-all ${
                  !isRunning
                    ? 'bg-stone-50 border-stone-200 text-stone-400 cursor-not-allowed'
                    : isMicMuted
                      ? 'bg-rose-50 border-rose-200 text-rose-500'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-600 hover:bg-emerald-100'
                }`}
                title={isMicMuted ? "Unmute Microphone" : "Mute Microphone"}
              >
                {isMicMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>

        {/* Right Panel: Feed & Notepad */}
        <div className="lg:col-span-8 flex min-h-0 flex-col h-full bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">

          {/* Tabs Header */}
	          <div className="px-4 pt-4 border-b border-stone-200 bg-white flex flex-col gap-4 z-10">
	            <div className="flex flex-col gap-3 px-2">
	              <div className="flex items-center justify-between gap-3">
	                <div className="flex items-center gap-4">
                  <div className={`flex items-center gap-2 text-xs font-medium px-2.5 py-1 rounded-full border ${
                    isRunning ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-stone-100 text-stone-500 border-stone-200'
                  }`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${isRunning ? 'bg-emerald-500 animate-pulse' : 'bg-stone-400'}`} />
                    {isRunning ? 'LIVE' : 'OFFLINE'}
                  </div>

	                  <button
	                    onClick={() => sendSessionPrompt(TIMED_COMMENTARY_PROMPT)}
	                    disabled={!isRunning}
	                    className="text-xs bg-stone-100 hover:bg-stone-200 text-stone-600 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
	                  >
	                    Force Comment
	                  </button>
	                </div>

	                <div className="relative">
	                  <button
	                    ref={settingsButtonRef}
	                    onClick={() => setShowSettingsPanel((current) => !current)}
	                    className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-50"
	                  >
	                    <Settings className="h-4 w-4" />
	                    <span>Settings</span>
	                    <span className={`h-2 w-2 rounded-full ${configuredApiKey ? 'bg-emerald-500' : 'bg-amber-400'}`} />
	                  </button>

	                  <AnimatePresence>
	                    {showSettingsPanel && (
	                      <motion.div
	                        ref={settingsPanelRef}
	                        initial={{ opacity: 0, y: -8, scale: 0.98 }}
	                        animate={{ opacity: 1, y: 0, scale: 1 }}
	                        exit={{ opacity: 0, y: -8, scale: 0.98 }}
	                        transition={{ duration: 0.18, ease: 'easeOut' }}
	                        className="absolute right-0 top-full z-20 mt-3 w-[min(28rem,calc(100vw-3rem))] rounded-[28px] border border-stone-200 bg-white p-5 shadow-xl shadow-stone-300/30"
	                      >
	                        <div className="flex items-start justify-between gap-4">
	                          <div>
	                            <div className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-teal-700">
	                              <Settings className="h-3.5 w-3.5" />
	                              Settings
	                            </div>
	                            <h3 className="mt-3 text-lg font-semibold text-stone-900">Bring Your Own Gemini Key</h3>
	                            <p className="mt-1 text-sm leading-6 text-stone-500">
	                              Stored locally in this browser for alpha use. Managed accounts and hosted billing can come later.
	                            </p>
	                          </div>
	                          <button
	                            onClick={() => setShowSettingsPanel(false)}
	                            className="text-xs font-medium text-stone-400 transition-colors hover:text-stone-600"
	                          >
	                            Close
	                          </button>
	                        </div>

	                        <div className="mt-5 rounded-2xl border border-stone-200 bg-stone-50 p-4">
	                          <div className="flex items-center justify-between gap-3">
	                            <div className="text-xs font-medium uppercase tracking-[0.14em] text-stone-400">
	                              Gemini API Key
	                            </div>
	                            <button
	                              onClick={() => setUserApiKey('')}
	                              className="text-xs text-stone-400 transition-colors hover:text-stone-600"
	                            >
	                              Clear
	                            </button>
	                          </div>

	                          <input
	                            type={showApiKey ? 'text' : 'password'}
	                            value={userApiKey}
	                            onChange={(event) => setUserApiKey(event.target.value)}
	                            placeholder="Paste your Gemini API key"
	                            autoCapitalize="off"
	                            autoCorrect="off"
	                            spellCheck={false}
	                            className="mt-3 w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-800 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500/20"
	                          />

	                          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500">
	                            <div>
	                              {configuredApiKey ? 'Stored locally on this device.' : 'Required before you can start the companion.'}
	                            </div>
	                            <button
	                              onClick={() => setShowApiKey((current) => !current)}
	                              className="rounded-full border border-stone-200 bg-white px-3 py-1 font-medium text-stone-600 transition-colors hover:bg-stone-100"
	                            >
	                              {showApiKey ? 'Hide key' : 'Show key'}
	                            </button>
	                          </div>
	                        </div>

	                        <div className="mt-4 rounded-2xl border border-stone-200 bg-stone-50 p-4">
	                          <div className="flex items-start justify-between gap-3">
	                            <div>
	                              <div className="text-xs font-medium uppercase tracking-[0.14em] text-stone-400">
	                                Model Input Preview
	                              </div>
	                              <p className="mt-1 text-sm leading-6 text-stone-500">
	                                Screen frames are primary for current visible state. Browser context and prepared page analysis are supplemental.
	                              </p>
	                            </div>
	                          </div>

	                          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
	                            <div className="rounded-xl border border-stone-200 bg-white px-3 py-2">
	                              <div className="text-[11px] uppercase tracking-[0.14em] text-stone-400">Last Screen Frame</div>
	                              <div className="mt-1 text-sm font-medium text-stone-700">
	                                {modelInputPreview.lastScreenFrameAt
	                                  ? new Date(modelInputPreview.lastScreenFrameAt).toLocaleTimeString()
	                                  : 'None yet'}
	                              </div>
	                            </div>
	                            <div className="rounded-xl border border-stone-200 bg-white px-3 py-2">
	                              <div className="text-[11px] uppercase tracking-[0.14em] text-stone-400">Browser Context</div>
	                              <div className="mt-1 text-sm font-medium text-stone-700">
	                                {modelInputPreview.lastBrowserContextCapturedAt
	                                  ? new Date(modelInputPreview.lastBrowserContextCapturedAt).toLocaleTimeString()
	                                  : 'None yet'}
	                              </div>
	                            </div>
	                            <div className="rounded-xl border border-stone-200 bg-white px-3 py-2">
	                              <div className="text-[11px] uppercase tracking-[0.14em] text-stone-400">Prepared Analysis</div>
	                              <div className="mt-1 text-sm font-medium text-stone-700">
	                                {modelInputPreview.lastPageInsightGeneratedAt
	                                  ? new Date(modelInputPreview.lastPageInsightGeneratedAt).toLocaleTimeString()
	                                  : 'None yet'}
	                              </div>
	                            </div>
	                          </div>

	                          {lastScreenFramePreview && (
	                            <div className="mt-4">
	                              <div className="text-[11px] uppercase tracking-[0.14em] text-stone-400">Latest Screen Frame</div>
	                              <img
	                                src={lastScreenFramePreview}
	                                alt="Latest screen frame sent to the live model"
	                                className="mt-2 h-28 w-full rounded-xl border border-stone-200 object-cover"
	                              />
	                            </div>
	                          )}

	                          <div className="mt-4 space-y-3">
	                            <div>
	                              <div className="text-[11px] uppercase tracking-[0.14em] text-stone-400">Latest Browser Context Prompt</div>
	                              <div className="mt-2 max-h-40 overflow-y-auto rounded-xl border border-stone-200 bg-white px-3 py-3 text-[11px] leading-5 text-stone-600 whitespace-pre-wrap">
	                                {modelInputPreview.lastBrowserContextPrompt || 'No browser-context prompt has been injected yet.'}
	                              </div>
	                            </div>
	                            <div>
	                              <div className="text-[11px] uppercase tracking-[0.14em] text-stone-400">Latest Prepared Analysis Prompt</div>
	                              <div className="mt-2 max-h-40 overflow-y-auto rounded-xl border border-stone-200 bg-white px-3 py-3 text-[11px] leading-5 text-stone-600 whitespace-pre-wrap">
	                                {modelInputPreview.lastPageInsightPrompt || 'No prepared page-analysis prompt has been injected yet.'}
	                              </div>
	                            </div>
	                          </div>
	                        </div>
	                      </motion.div>
	                    )}
	                  </AnimatePresence>
	                </div>
	              </div>

	              <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-stone-400">Session Handle</div>
                  <div className="mt-1 text-sm font-medium text-stone-700 font-mono">{truncateSessionHandle(debugState.currentSessionHandle)}</div>
                </div>
                <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-stone-400">First Audio</div>
                  <div className="mt-1 text-sm font-medium text-stone-700">{formatLatency(debugState.firstAudioLatencyMs)}</div>
                </div>
                <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-stone-400">Last Reconnect</div>
                  <div className="mt-1 text-sm font-medium text-stone-700">{debugState.lastReconnectAt || 'None'}</div>
                  <div className="text-xs text-stone-500">{debugState.lastReconnectReason || 'No reconnects yet'}</div>
                </div>
                <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-stone-400">Session Debug</div>
                  <div className="mt-1 text-sm font-medium text-stone-700">Search {sessionSearchEnabled ? 'ON' : 'OFF'}</div>
                  <div className="text-xs text-stone-500">
                    {debugState.lastAutoSaveAt ? `Helpful save ${debugState.lastAutoSaveAt}` : 'No helpful auto saves yet'}
                  </div>
	                  <div className="text-xs text-stone-500">
	                    {debugState.lastCommentaryAt ? `Commentary ${debugState.lastCommentaryAt}` : 'No timed commentary yet'}
	                  </div>
	                </div>
	              </div>
	            </div>
	            <div className="flex gap-1 overflow-x-auto custom-scrollbar pb-2">
	              {TAB_BUTTONS.map(({ id, label, Icon }) => (
	                <button
	                  key={id}
	                  onClick={() => setActiveTab(id)}
	                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors whitespace-nowrap ${
	                    activeTab === id
	                      ? id === 'transcript'
	                        ? 'bg-stone-100 text-stone-900 font-medium'
	                        : 'bg-teal-50 text-teal-700 font-medium'
	                      : 'text-stone-500 hover:text-stone-700 hover:bg-stone-50'
	                  }`}
	                >
	                  <Icon className="w-4 h-4" />
	                  {label}
	                </button>
	              ))}
	            </div>
	          </div>

          {/* Tab Content */}
          <div ref={tabContentScrollRef} className="flex-1 min-h-0 overflow-y-auto p-6 relative custom-scrollbar">
            <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-[0.16em] text-stone-400">{TAB_METADATA[activeTab].label}</div>
                <p className="mt-1 text-sm text-stone-500">{TAB_METADATA[activeTab].description}</p>
              </div>
              <div className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs font-medium text-stone-500">
                {TAB_METADATA[activeTab].toolName}
              </div>
            </div>

            {/* Transcript Tab */}
            {activeTab === 'transcript' && (
              <div className="min-h-full flex flex-col gap-4">
                <AnimatePresence initial={false}>
                  {orderedTranscriptFeed.map((log, i) => {
                    const isSystem = log.role === 'system';
                    const isUser = log.role === 'user';
                    const isDraft = Boolean(log.isDraft);
                    const isNewestCompanion = log.role === 'model' && i === orderedTranscriptFeed.length - 1;
                    const Icon = isSystem ? Settings : isUser ? User : Monitor;
                    const label = isSystem ? 'System' : isUser ? 'You' : 'Companion';
                    const cardClassName = isSystem
                      ? 'border-stone-200 bg-stone-50/90 text-center'
                      : isDraft
                        ? 'ml-10 border-teal-300 border-dashed bg-teal-50/80 shadow-sm shadow-teal-100/70 sm:ml-16'
                      : isUser
                        ? 'ml-10 border-teal-300 bg-teal-50 shadow-sm shadow-teal-100/60 sm:ml-16'
                        : isNewestCompanion
                          ? 'mr-10 border-stone-300 bg-white shadow-md shadow-stone-200/70 sm:mr-16'
                          : 'mr-10 border-stone-200 bg-stone-50 sm:mr-16';
                    const badgeClassName = isSystem
                      ? 'border-stone-200 bg-white text-stone-500'
                      : isDraft
                        ? 'border-teal-200 bg-white text-teal-700'
                      : isUser
                        ? 'border-teal-200 bg-white text-teal-700'
                        : 'border-stone-200 bg-white text-stone-600';
                    const bodyClassName = isSystem
                      ? 'text-sm text-stone-500'
                      : isDraft
                        ? 'text-[17px] font-medium text-teal-950'
                      : isUser
                        ? 'text-[17px] font-medium text-teal-950'
                        : isNewestCompanion
                          ? 'text-lg text-stone-900'
                          : 'text-lg text-stone-700';

                    return (
                      <motion.div
                        key={log.id}
                        initial={{ opacity: 0, y: -20, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ duration: 0.3, ease: "easeOut" }}
                        className={`rounded-2xl border p-5 ${cardClassName}`}
                      >
                        <div className={`mb-3 flex items-center ${isSystem ? 'justify-center' : 'justify-between'} gap-3`}>
                          <div className="flex items-center gap-2.5">
                            <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${badgeClassName}`}>
                              <Icon className="h-3.5 w-3.5" />
                              {label}
                            </div>
                            {isDraft && (
                              <ListeningIndicator />
                            )}
                            {!isSystem && (
                              <div className="flex items-center gap-1.5 text-xs text-stone-400">
                                <Clock className="h-3 w-3" />
                                {log.timestamp.toLocaleTimeString()}
                              </div>
                            )}
                          </div>

                          {isSystem && (
                            <div className="flex items-center gap-1.5 text-xs text-stone-400">
                              <Clock className="h-3 w-3" />
                              {log.timestamp.toLocaleTimeString()}
                            </div>
                          )}
                        </div>

                        <p className={`leading-relaxed ${bodyClassName}`}>
                          {log.text}
                        </p>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>

                {transcriptFeed.length === 0 && (
                  <div className="flex-1 flex flex-col items-center justify-center text-stone-400 gap-4 h-full">
                    <MessageSquare className="w-12 h-12 opacity-15" />
                    <p>{TAB_METADATA.transcript.emptyState}</p>
                  </div>
                )}
              </div>
            )}

            {/* Helpful Info Tab */}
	            {activeTab === 'info' && (
	              <div className="min-h-full">
	                {helpfulInfo ? (
	                  <div className={COMPACT_MARKDOWN_PROSE_CLASS}>
	                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{helpfulInfo}</ReactMarkdown>
	                  </div>
	                ) : (
                  <div className="flex flex-col items-center justify-center text-stone-400 gap-4 h-full">
                    <BookOpen className="w-12 h-12 opacity-15" />
                    <p>{TAB_METADATA.info.emptyState}</p>
                  </div>
                )}
              </div>
            )}

            {/* Activity Log Tab */}
	            {activeTab === 'activity' && (
	              <div className="min-h-full">
	                {activityLog ? (
	                  <div className={COMPACT_MARKDOWN_PROSE_CLASS}>
	                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{activityLog}</ReactMarkdown>
	                  </div>
	                ) : (
                  <div className="flex flex-col items-center justify-center text-stone-400 gap-4 h-full">
                    <List className="w-12 h-12 opacity-15" />
                    <p>{TAB_METADATA.activity.emptyState}</p>
                  </div>
                )}
              </div>
            )}

            {/* Saved Notes Tab */}
	            {activeTab === 'notes' && (
	              <div className="min-h-full">
	                {savedNotes ? (
	                  <div className={MARKDOWN_PROSE_CLASS}>
	                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{savedNotes}</ReactMarkdown>
	                  </div>
	                ) : (
                  <div className="flex flex-col items-center justify-center text-stone-400 gap-4 h-full">
                    <Bookmark className="w-12 h-12 opacity-15" />
                    <p>{TAB_METADATA.notes.emptyState}</p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'history' && (
              <div className="min-h-full">
                {historyError && (
                  <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    {historyError}
                  </div>
                )}

                {historyLoading && historySessions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center text-stone-400 gap-4 h-full">
                    <FileText className="w-12 h-12 opacity-15" />
                    <p>Loading session history…</p>
                  </div>
                ) : historySessions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center text-stone-400 gap-4 h-full">
                    <FileText className="w-12 h-12 opacity-15" />
                    <p>{TAB_METADATA.history.emptyState}</p>
                  </div>
                ) : (
                  <div className="grid gap-6 lg:grid-cols-[250px_minmax(0,1fr)]">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-medium uppercase tracking-[0.16em] text-stone-400">Sessions</div>
                        <button
                          onClick={() => void refreshHistorySessions()}
                          className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-50"
                        >
                          Refresh
                        </button>
                      </div>
                      <div className="space-y-2">
                        {historySessions.map((item) => (
                          <button
                            key={item.session.id}
                            onClick={() => setSelectedHistorySessionId(item.session.id)}
                            className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                              item.session.id === selectedHistorySessionId
                                ? 'border-teal-300 bg-teal-50'
                                : 'border-stone-200 bg-white hover:bg-stone-50'
                            }`}
                          >
                            <div className="text-sm font-semibold text-stone-900">
                              {new Date(item.session.startedAt).toLocaleString()}
                            </div>
                            <div className="mt-1 text-xs text-stone-500">
                              {item.session.personaId || 'No persona'} · {item.session.liveModel || 'Unknown model'}
                            </div>
                            <div className="mt-2 text-xs text-stone-500">
                              {item.latestSummary ? 'Recap ready' : 'No recap yet'}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="min-w-0 space-y-5">
                      {!selectedHistorySession || !selectedHistoryTimeline ? (
                        <div className="rounded-2xl border border-stone-200 bg-white p-6 text-sm text-stone-500">
                          Select a session to inspect its saved context and analysis.
                        </div>
                      ) : (
                        <>
                          <div className="rounded-2xl border border-stone-200 bg-white p-5">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="text-[11px] uppercase tracking-[0.16em] text-stone-400">Selected Session</div>
                                <h3 className="mt-1 text-lg font-semibold text-stone-900">
                                  {new Date(selectedHistorySession.session.startedAt).toLocaleString()}
                                </h3>
                              </div>
                              <div className="flex flex-wrap gap-2 text-xs text-stone-500">
                                <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1">
                                  {selectedHistoryTimeline.events.length} events
                                </span>
                                <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1">
                                  {selectedHistoryTimeline.turns.length} turns
                                </span>
                                <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1">
                                  {selectedHistoryTimeline.memories.length} saved items
                                </span>
                              </div>
                            </div>
                            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                              <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
                                <div className="text-[11px] uppercase tracking-[0.14em] text-stone-400">Persona</div>
                                <div className="mt-1 text-sm font-medium text-stone-700">{selectedHistorySession.session.personaId || 'Unknown'}</div>
                              </div>
                              <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
                                <div className="text-[11px] uppercase tracking-[0.14em] text-stone-400">Model</div>
                                <div className="mt-1 text-sm font-medium text-stone-700">{selectedHistorySession.session.liveModel || 'Unknown'}</div>
                              </div>
                              <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
                                <div className="text-[11px] uppercase tracking-[0.14em] text-stone-400">Capture</div>
                                <div className="mt-1 text-sm font-medium text-stone-700">{selectedHistorySession.session.captureMode}</div>
                              </div>
                              <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
                                <div className="text-[11px] uppercase tracking-[0.14em] text-stone-400">Ended</div>
                                <div className="mt-1 text-sm font-medium text-stone-700">
                                  {selectedHistorySession.session.endedAt ? new Date(selectedHistorySession.session.endedAt).toLocaleTimeString() : 'Still running'}
                                </div>
                              </div>
                            </div>
                          </div>

	                          <div className="rounded-2xl border border-stone-200 bg-white p-5">
	                            <div className="text-[11px] uppercase tracking-[0.16em] text-stone-400">Analysis</div>
	                            <h3 className="mt-1 text-lg font-semibold text-stone-900">Session recap</h3>
	                            {selectedHistorySummary ? (
	                              <div className={`${MARKDOWN_PROSE_CLASS} mt-4`}>
	                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedHistorySummary.markdown}</ReactMarkdown>
	                              </div>
	                            ) : (
                              <p className="mt-4 text-sm text-stone-500">
                                No recap has been generated for this session yet. Stop the session or refresh after the recap finishes.
                              </p>
                            )}
                          </div>

                          <div className="grid gap-5 xl:grid-cols-2">
                            <div className="rounded-2xl border border-stone-200 bg-white p-5">
                              <div className="text-[11px] uppercase tracking-[0.16em] text-stone-400">Saved Context</div>
                              <h3 className="mt-1 text-lg font-semibold text-stone-900">Memories and notes</h3>
	                              <div className="mt-4 space-y-3">
	                                {historyMemories.length > 0 ? historyMemories.map((memory) => (
	                                  <div key={memory.id} className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
	                                    <div className="text-sm font-medium text-stone-900">{memory.title}</div>
	                                    <div className="mt-1 text-xs uppercase tracking-[0.12em] text-teal-600">{memory.memoryType}</div>
	                                    <div className={`${MARKDOWN_PROSE_CLASS} mt-3 text-sm`}>
	                                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{memory.bodyMd}</ReactMarkdown>
	                                    </div>
	                                  </div>
	                                )) : (
	                                  <p className="text-sm text-stone-500">No saved context for this session yet.</p>
                                )}
                              </div>
                            </div>

                            <div className="rounded-2xl border border-stone-200 bg-white p-5">
                              <div className="text-[11px] uppercase tracking-[0.16em] text-stone-400">Conversation Context</div>
                              <h3 className="mt-1 text-lg font-semibold text-stone-900">Recent turns</h3>
                              <div className="mt-4 space-y-3">
                                {historyTurns.length > 0 ? historyTurns.map((turn) => (
                                  <div key={turn.id} className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
                                    <div className="flex items-center justify-between gap-3 text-xs text-stone-400">
                                      <span className="font-medium uppercase tracking-[0.12em] text-teal-600">{turn.role}</span>
                                      <span>{new Date(turn.startedAt).toLocaleTimeString()}</span>
                                    </div>
                                    <div className="mt-2 text-sm text-stone-700">{turn.transcript}</div>
                                  </div>
                                )) : (
                                  <p className="text-sm text-stone-500">No transcript turns stored for this session yet.</p>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="rounded-2xl border border-stone-200 bg-white p-5">
                            <div className="text-[11px] uppercase tracking-[0.16em] text-stone-400">Raw Context</div>
                            <h3 className="mt-1 text-lg font-semibold text-stone-900">Recent events</h3>
                            <div className="mt-4 space-y-3">
                              {historyEvents.length > 0 ? historyEvents.map((event) => (
                                <div key={event.id} className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
                                  <div className="flex flex-wrap items-center gap-2 text-xs text-stone-400">
                                    <span className="font-medium uppercase tracking-[0.12em] text-teal-600">{event.eventType}</span>
                                    <span>{new Date(event.occurredAt).toLocaleTimeString()}</span>
                                    {event.domain && <span>{event.domain}</span>}
                                  </div>
                                  <div className="mt-2 text-sm text-stone-700">
                                    {event.pageTitle || event.url || event.appName || 'No page or app context'}
                                  </div>
                                </div>
                              )) : (
                                <p className="text-sm text-stone-500">No raw events recorded for this session yet.</p>
                              )}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
	                )}
	              </div>
	            )}

	            {activeTab === 'memory' && (
	              <div className="min-h-full space-y-6">
	                {historyError && (
	                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
	                    {historyError}
	                  </div>
	                )}

	                <div className="rounded-2xl border border-teal-200 bg-teal-50/80 px-5 py-5">
	                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
	                    <div className="max-w-2xl">
	                      <div className="text-[11px] uppercase tracking-[0.16em] text-teal-700">Browser Memory</div>
	                      <h3 className="mt-1 text-lg font-semibold text-stone-900">Make the recap the product</h3>
	                      <p className="mt-2 text-sm leading-6 text-stone-600">
	                        BrowserBud should leave you with a reusable record: readable recap markdown, saved notes, structured activity, and context you can reopen later.
	                      </p>
	                    </div>
	                    <div className="grid grid-cols-3 gap-2 text-xs text-stone-600">
	                      <div className="rounded-xl border border-teal-200 bg-white px-3 py-2">
	                        <div className="uppercase tracking-[0.14em] text-stone-400">Sessions</div>
	                        <div className="mt-1 text-sm font-semibold text-stone-900">{historySessions.length}</div>
	                      </div>
	                      <div className="rounded-xl border border-teal-200 bg-white px-3 py-2">
	                        <div className="uppercase tracking-[0.14em] text-stone-400">Saved Items</div>
	                        <div className="mt-1 text-sm font-semibold text-stone-900">{selectedHistoryTimeline?.memories.length ?? 0}</div>
	                      </div>
	                      <div className="rounded-xl border border-teal-200 bg-white px-3 py-2">
	                        <div className="uppercase tracking-[0.14em] text-stone-400">Turns</div>
	                        <div className="mt-1 text-sm font-semibold text-stone-900">{selectedHistoryTimeline?.turns.length ?? logs.length}</div>
	                      </div>
	                    </div>
	                  </div>

	                  <div className="mt-4 flex flex-wrap items-center gap-2">
	                    <button
	                      onClick={() => setActiveTab('history')}
	                      className="rounded-full bg-teal-600 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-teal-700"
	                    >
	                      Open History
	                    </button>
	                    <button
	                      onClick={() => void refreshHistorySessions()}
	                      className="rounded-full border border-teal-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-teal-700 transition-colors hover:bg-teal-100"
	                    >
	                      Refresh Memory
	                    </button>
	                    <div className="rounded-full border border-teal-200 bg-white px-3 py-2 text-xs text-stone-500">
	                      {featuredMemorySummary ? 'Latest recap ready' : 'Your next finished session will generate a recap'}
	                    </div>
	                  </div>
	                </div>

	                {featuredMemorySummary ? (
	                  <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
	                    <div className="rounded-2xl border border-stone-200 bg-white p-5">
	                      <div className="text-[11px] uppercase tracking-[0.16em] text-stone-400">Recap</div>
	                      <h3 className="mt-1 text-lg font-semibold text-stone-900">
	                        {featuredMemorySession
	                          ? `Session recap for ${new Date(featuredMemorySession.session.startedAt).toLocaleString()}`
	                          : 'Latest recap'}
	                      </h3>
	                      <div className={`${MARKDOWN_PROSE_CLASS} mt-4`}>
	                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{featuredMemoryMarkdown}</ReactMarkdown>
	                      </div>
	                    </div>

	                    <div className="space-y-5">
	                      <div className="rounded-2xl border border-stone-200 bg-white p-5">
	                        <div className="text-[11px] uppercase tracking-[0.16em] text-stone-400">Saved context</div>
	                        <h3 className="mt-1 text-lg font-semibold text-stone-900">Memory cards</h3>
	                        <div className="mt-4 space-y-3">
	                          {historyMemories.length > 0 ? historyMemories.slice(0, 4).map((memory) => (
	                            <div key={memory.id} className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
	                              <div className="text-sm font-medium text-stone-900">{memory.title}</div>
	                              <div className="mt-1 text-xs uppercase tracking-[0.12em] text-teal-600">{memory.memoryType}</div>
	                              <div className={`${MARKDOWN_PROSE_CLASS} mt-3 text-sm`}>
	                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{memory.bodyMd}</ReactMarkdown>
	                              </div>
	                            </div>
	                          )) : (
	                            <p className="text-sm text-stone-500">No saved context for this session yet.</p>
	                          )}
	                        </div>
	                      </div>

	                      <div className="rounded-2xl border border-stone-200 bg-white p-5">
	                        <div className="text-[11px] uppercase tracking-[0.16em] text-stone-400">Recent conversation</div>
	                        <h3 className="mt-1 text-lg font-semibold text-stone-900">Latest turns</h3>
	                        <div className="mt-4 space-y-3">
	                          {historyTurns.length > 0 ? historyTurns.slice(0, 3).map((turn) => (
	                            <div key={turn.id} className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
	                              <div className="flex items-center justify-between gap-3 text-xs text-stone-400">
	                                <span className="font-medium uppercase tracking-[0.12em] text-teal-600">{turn.role}</span>
	                                <span>{new Date(turn.startedAt).toLocaleTimeString()}</span>
	                              </div>
	                              <div className="mt-2 text-sm leading-6 text-stone-700">{turn.transcript}</div>
	                            </div>
	                          )) : (
	                            <p className="text-sm text-stone-500">Select a finished session in History to inspect its recap and saved context here.</p>
	                          )}
	                        </div>
	                      </div>
	                    </div>
	                  </div>
	                ) : (
	                  <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-stone-200 bg-white px-6 py-16 text-center text-stone-400">
	                    <FileText className="h-12 w-12 opacity-15" />
	                    <p>{TAB_METADATA.memory.emptyState}</p>
	                  </div>
	                )}
	              </div>
	            )}

	          </div>
	        </div>

      </div>
    </div>
  );
}
