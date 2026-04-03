import React, { useState, useEffect, useRef } from 'react';
import { FunctionCallingConfigMode, GoogleGenAI, Modality, Type } from '@google/genai';
import { Play, Square, Mic, MicOff, User, Clock, MessageSquare, Monitor, MonitorOff, Info, Plus, Trash2, RotateCcw, Settings, Search, FileText, BookOpen, List, Bookmark } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { formatLatency, mergeIncrementalTranscript, truncateSessionHandle } from './liveUtils';

const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;
const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-3.1-flash-live-preview';

const STORAGE_KEYS = {
  customPersonas: 'browserbud.customPersonas',
  helpfulInfo: 'browserbud.helpfulInfo',
  activityLog: 'browserbud.activityLog',
  savedNotes: 'browserbud.savedNotes',
};

const MAX_RECONNECT_ATTEMPTS = 6;
const AUTO_COMMENTARY_USER_COOLDOWN_MS = 15000;

const readStoredText = (key: string) => {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
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
  { id: 0, name: 'Off (Conversation Only)' },
  { id: 10000, name: 'Every 10 seconds' },
  { id: 30000, name: 'Every 30 seconds' },
  { id: 60000, name: 'Every 1 minute' },
];

type AppTab = 'transcript' | 'info' | 'activity' | 'notes';

type LogEntry = {
  id: string;
  timestamp: Date;
  text: string;
  role: 'user' | 'model' | 'system';
};

type DebugState = {
  currentSessionHandle: string | null;
  firstAudioLatencyMs: number | null;
  reconnectAttempts: number;
  lastReconnectReason: string | null;
  lastReconnectAt: string | null;
  lastAutoCommentaryAt: string | null;
};

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
    description: 'Meaningful task and page changes are summarized here.',
    emptyState: 'No activity logged yet. Ask the companion to log what you are doing.',
  },
  notes: {
    label: 'Saved Notes',
    toolName: 'Tool: saveNote',
    description: 'Direct reminders, todos, and remember-this requests land here.',
    emptyState: 'No notes saved yet. Say add a note or remember this to trigger saveNote.',
  },
};

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
  const [frequency, setFrequency] = useState(0);
  const [isSharing, setIsSharing] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Notepad State
  const [activeTab, setActiveTab] = useState<AppTab>('transcript');
  const [helpfulInfo, setHelpfulInfo] = useState<string>(() => readStoredText(STORAGE_KEYS.helpfulInfo));
  const [activityLog, setActivityLog] = useState<string>(() => readStoredText(STORAGE_KEYS.activityLog));
  const [savedNotes, setSavedNotes] = useState<string>(() => readStoredText(STORAGE_KEYS.savedNotes));
  
  // Custom Persona State
  const [showAddPersona, setShowAddPersona] = useState(false);
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
    lastAutoCommentaryAt: null,
  });

  const selectedPersonality = personas.find((option) => option.id === personality) || personas[0];
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
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
  
  // Interval Refs
  const videoIntervalRef = useRef<number | null>(null);
  const commentaryIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    isMicMutedRef.current = isMicMuted;
  }, [isMicMuted]);

  useEffect(() => {
    if (!isRunning) {
      setSessionSearchEnabled(Boolean(selectedPersonality?.useSearch));
    }
  }, [isRunning, selectedPersonality]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.helpfulInfo, helpfulInfo);
  }, [helpfulInfo]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.activityLog, activityLog);
  }, [activityLog]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.savedNotes, savedNotes);
  }, [savedNotes]);

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
  };

  const clearReconnectTimer = () => {
    if (reconnectTimeoutRef.current) {
      window.clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  };

  const sendSessionPrompt = (text: string, { isAuto = false }: { isAuto?: boolean } = {}) => {
    const pendingSession = sessionRef.current;
    if (!pendingSession) {
      return;
    }

    pendingTurnRef.current = true;
    lastPromptAtRef.current = Date.now();

    if (isAuto) {
      setDebugState((prev) => ({
        ...prev,
        lastAutoCommentaryAt: new Date().toLocaleTimeString(),
      }));
    }

    void pendingSession.then((session) => {
      session.sendClientContent({ turns: text, turnComplete: true });
    }).catch(() => {});
  };

  const maybeTriggerAutoCommentary = () => {
    if (frequency <= 0) {
      return;
    }

    const now = Date.now();
    if (isModelSpeakingRef.current || pendingTurnRef.current || pendingToolCallRef.current || reconnectTimeoutRef.current) {
      return;
    }
    if (now - lastUserActivityAtRef.current < AUTO_COMMENTARY_USER_COOLDOWN_MS) {
      return;
    }
    if (now - lastPromptAtRef.current < AUTO_COMMENTARY_USER_COOLDOWN_MS) {
      return;
    }

    sendSessionPrompt('Analyze the current screen and provide a brief spoken commentary only if something meaningfully changed or stands out. Use tools only when there is genuinely useful information worth saving.', { isAuto: true });
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

    if (!isSharing) {
      alert('Please share a tab or screen first!');
      return;
    }

    if (!apiKey || !ai) {
      alert('Missing GEMINI_API_KEY. Add it to your environment and restart the app.');
      return;
    }

    console.debug('Start live requested', { isSharing, hasApiKey: Boolean(apiKey), isReconnect });
    isStartingRef.current = true;
    isStoppingRef.current = false;
    setErrorMsg(null);
    clearReconnectTimer();

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
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 } });
      console.debug('Microphone stream acquired', { tracks: micStream.getTracks().length });
      micStreamRef.current = micStream;

      playCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      micCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });

      void playCtxRef.current.resume().catch(() => {});
      void micCtxRef.current.resume().catch(() => {});
      await micCtxRef.current.audioWorklet.addModule('/pcm-recorder-worklet.js');

      nextPlayTimeRef.current = playCtxRef.current.currentTime;
      console.debug('Starting live session', { model: LIVE_MODEL, isReconnect, searchEnabled: sessionSearchEnabled });

      let currentTurnText = '';
      const commitModelTurn = (suffix = '') => {
        const transcriptText = currentOutputTranscriptRef.current.trim();
        const fallbackText = currentTurnText.trim();
        const finalText = transcriptText || fallbackText;
        if (finalText) {
          setLogs((prev) => [{
            id: Math.random().toString(36).substring(7),
            timestamp: new Date(),
            text: `${finalText}${suffix}`.trim(),
            role: 'model'
          }, ...prev]);
        }
        currentTurnText = '';
        currentOutputTranscriptRef.current = '';
        pendingTurnRef.current = false;
        pendingToolCallRef.current = false;
      };

      const config: any = {
        responseModalities: [Modality.AUDIO],
        outputAudioTranscription: {},
        inputAudioTranscription: {},
        thinkingConfig: { thinkingLevel: 'minimal' },
        contextWindowCompression: { slidingWindow: {} },
        sessionResumption: { handle: sessionHandleRef.current || undefined },
        systemInstruction: {
          parts: [{ text: `${selectedPersonality.prompt} You can see the user's screen and hear their voice. Respond naturally and keep spoken replies brief.

Tool rules:
- The Helpful Info tab stores reusable recommendations, links, and takeaways. If the user asks you to save something useful for later, call appendHelpfulInfo in this turn.
- The Activity Log tab stores concise records of meaningful task changes. Call logActivity when the user explicitly asks for it or when there is a clear task/page change worth recording.
- The Saved Notes tab stores direct reminders, todos, and remember-this requests. If the user says add a note, save this, or remember this, you must call saveNote in this turn before you finish responding.
- Do not use tools on every turn.
- Prioritize clean, complete spoken responses over fragmented quick replies.` }]
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
              description: 'Add a concise entry to the Activity Log tab describing a meaningful task or page change.',
              parameters: {
                type: Type.OBJECT,
                properties: {
                  location: { type: Type.STRING, description: 'URL, app name, or context location.' },
                  topic: { type: Type.STRING, description: 'Main topic of the activity.' },
                  details: { type: Type.STRING, description: 'Brief details of what happened.' }
                },
                required: ['location', 'topic', 'details']
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
            }
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

      const sessionPromise = ai.live.connect({
        model: LIVE_MODEL,
        config,
        callbacks: {
          onopen: () => {
            console.debug('Live session opened', { model: LIVE_MODEL, resumed: Boolean(sessionHandleRef.current), isReconnect });
            reconnectAttemptsRef.current = 0;
            setErrorMsg(null);
            setIsRunning(true);
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

            videoIntervalRef.current = window.setInterval(() => {
              const base64Image = captureFrame();
              if (base64Image) {
                sessionPromise.then((session) => {
                  session.sendRealtimeInput({ video: { data: base64Image, mimeType: 'image/jpeg' } });
                }).catch(() => {});
              }
            }, 2000);

            if (frequency > 0) {
              commentaryIntervalRef.current = window.setInterval(() => {
                maybeTriggerAutoCommentary();
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
            }
            if (inputTranscription?.finished && currentInputTranscriptRef.current.trim()) {
              const text = currentInputTranscriptRef.current.trim();
              setLogs((prev) => [{ id: Math.random().toString(36).substring(7), timestamp: new Date(), text, role: 'user' }, ...prev]);
              currentInputTranscriptRef.current = '';
            }

            const parts = message.serverContent?.modelTurn?.parts;
            if (parts?.length) {
              pendingTurnRef.current = true;
              isModelSpeakingRef.current = true;
              for (const part of parts) {
                if (part?.text) {
                  currentTurnText += part.text;
                }
                if (part?.inlineData?.data) {
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

            if (outputTranscription?.text !== undefined) {
              currentOutputTranscriptRef.current = mergeIncrementalTranscript(currentOutputTranscriptRef.current, outputTranscription.text);
            }

            if (message.serverContent?.turnComplete) {
              isModelSpeakingRef.current = false;
              commitModelTurn();
            }

            if (message.serverContent?.interrupted) {
              isModelSpeakingRef.current = false;
              activeSourcesRef.current.forEach((source) => source.stop());
              activeSourcesRef.current = [];
              if (playCtxRef.current) {
                nextPlayTimeRef.current = playCtxRef.current.currentTime;
              }
              commitModelTurn(' [Interrupted]');
            }

            if (message.toolCall) {
              pendingToolCallRef.current = true;
              pendingTurnRef.current = true;
              const functionCalls = message.toolCall.functionCalls;
              if (functionCalls) {
                const functionResponses: any[] = [];
                for (const call of functionCalls) {
                  const timestamp = new Date().toLocaleTimeString();

                  if (call.name === 'appendHelpfulInfo') {
                    const args = call.args as any;
                    const title = args.title?.trim();
                    const heading = title ? `### [${timestamp}] ${title}` : `### [${timestamp}] Helpful Info`;
                    const infoEntry = `${heading}\n\n${args.content}\n\n---\n\n`;
                    setHelpfulInfo((prev) => infoEntry + prev);
                    setLogs((prev) => [{ id: Math.random().toString(36).substring(7), timestamp: new Date(), text: '[Action]: Added helpful info to the Helpful Info tab.', role: 'system' }, ...prev]);
                    functionResponses.push({ id: call.id, name: call.name, response: { result: 'success' } });
                  } else if (call.name === 'logActivity') {
                    const args = call.args as any;
                    const logEntry = `- **[${timestamp}] ${args.location}** (${args.topic}): ${args.details}\n`;
                    setActivityLog((prev) => logEntry + prev);
                    setLogs((prev) => [{ id: Math.random().toString(36).substring(7), timestamp: new Date(), text: '[Action]: Logged activity to the Activity Log tab.', role: 'system' }, ...prev]);
                    functionResponses.push({ id: call.id, name: call.name, response: { result: 'success' } });
                  } else if (call.name === 'saveNote') {
                    const args = call.args as any;
                    const noteEntry = `- **[${timestamp}]** ${args.note}\n`;
                    setSavedNotes((prev) => noteEntry + prev);
                    setLogs((prev) => [{ id: Math.random().toString(36).substring(7), timestamp: new Date(), text: '[Action]: Saved note to the Saved Notes tab.', role: 'system' }, ...prev]);
                    functionResponses.push({ id: call.id, name: call.name, response: { result: 'success' } });
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
    shouldStayConnectedRef.current = false;
    isStoppingRef.current = true;
    clearReconnectTimer();
    cleanupLiveSession({ closeSession: true, stopMic: true });
    setIsRunning(false);
    setErrorMsg(null);
    setLogs((prev) => [{ id: Math.random().toString(), timestamp: new Date(), text: 'Disconnected.', role: 'system' }, ...prev]);
  };

  const toggleRunning = () => {
    console.debug('Toggle running clicked', { isSharing, isRunning, hasApiKey: Boolean(apiKey) });
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
      cleanupLiveSession({ closeSession: true, stopMic: true });
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#FAFAF8] text-stone-900 font-sans selection:bg-teal-500/20">
      <canvas ref={canvasRef} className="hidden" />

      <div className="max-w-6xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-8 h-screen max-h-screen overflow-hidden">

        {/* Left Panel: Configuration */}
        <div className="lg:col-span-4 flex flex-col gap-6 h-full overflow-y-auto pr-2 pb-8 custom-scrollbar">
          <div className="space-y-3">
            <div className="space-y-2">
              <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2.5">
                <Monitor className="w-6 h-6 text-teal-600" />
                BrowserBud
              </h1>
              <p className="text-sm text-stone-500">
                Your AI browsing assistant — watches your screen, takes notes, and answers questions while you work.
              </p>
            </div>
            {errorMsg && (
              <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700 shadow-sm">
                {errorMsg}
              </div>
            )}
          </div>

          <div className="bg-white border border-[#E8E5E0] rounded-xl p-5 space-y-6 shadow-sm">

            {/* Screen Share Preview */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-stone-700 flex items-center gap-2">
                  <Monitor className="w-4 h-4 text-stone-400" />
                  Screen Source
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
                <p>To have the companion follow you across all tabs, choose <strong>"Entire Screen"</strong> when sharing.</p>
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
                Off is the most reliable mode for voice requests. Timed commentary only runs after a short user-silence cooldown now.
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
                onClick={toggleRunning}
                disabled={!isSharing}
                className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-lg font-medium transition-all ${
                  !isSharing
                    ? 'bg-stone-100 text-stone-400 cursor-not-allowed'
                    : isRunning
                      ? 'bg-rose-50 text-rose-600 hover:bg-rose-100 border border-rose-200'
                      : 'bg-teal-600 text-white hover:bg-teal-700 shadow-md shadow-teal-600/15'
                }`}
              >
                {isRunning ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                {isRunning ? 'Stop Companion' : 'Start Companion'}
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
        <div className="lg:col-span-8 flex flex-col h-full bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">

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
                    onClick={() => sendSessionPrompt('Provide a brief commentary on what is happening on the screen right now.')}
                    disabled={!isRunning}
                    className="text-xs bg-stone-100 hover:bg-stone-200 text-stone-600 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                  >
                    Force Comment
                  </button>
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
                    {debugState.lastAutoCommentaryAt ? `Last auto comment ${debugState.lastAutoCommentaryAt}` : 'No auto commentary yet'}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex gap-1 overflow-x-auto custom-scrollbar pb-2">
              <button
                onClick={() => setActiveTab('transcript')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === 'transcript' ? 'bg-stone-100 text-stone-900 font-medium' : 'text-stone-500 hover:text-stone-700 hover:bg-stone-50'
                }`}
              >
                <MessageSquare className="w-4 h-4" />
                Live Transcript
              </button>
              <button
                onClick={() => setActiveTab('info')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === 'info' ? 'bg-teal-50 text-teal-700 font-medium' : 'text-stone-500 hover:text-stone-700 hover:bg-stone-50'
                }`}
              >
                <BookOpen className="w-4 h-4" />
                Helpful Info
              </button>
              <button
                onClick={() => setActiveTab('activity')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === 'activity' ? 'bg-teal-50 text-teal-700 font-medium' : 'text-stone-500 hover:text-stone-700 hover:bg-stone-50'
                }`}
              >
                <List className="w-4 h-4" />
                Activity Log
              </button>
              <button
                onClick={() => setActiveTab('notes')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === 'notes' ? 'bg-teal-50 text-teal-700 font-medium' : 'text-stone-500 hover:text-stone-700 hover:bg-stone-50'
                }`}
              >
                <Bookmark className="w-4 h-4" />
                Saved Notes
              </button>
            </div>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto p-6 relative custom-scrollbar">
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
              <div className="flex flex-col gap-4 flex-col-reverse h-full">
                <AnimatePresence initial={false}>
                  {logs.map((log, i) => (
                    <motion.div
                      key={log.id}
                      initial={{ opacity: 0, y: -20, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ duration: 0.3, ease: "easeOut" }}
                      className={`p-5 rounded-2xl border ${
                        log.role === 'system'
                          ? 'bg-stone-50 border-stone-200 text-center'
                          : log.role === 'user'
                            ? 'bg-teal-50 border-teal-200 ml-16'
                            : i === 0
                              ? 'bg-white border-stone-200 shadow-sm mr-16'
                              : 'bg-stone-50 border-stone-100 opacity-70 mr-16'
                      }`}
                    >
                      {log.role !== 'system' && (
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2 text-xs text-stone-400">
                            {log.role === 'user' ? <User className="w-3 h-3" /> : <Monitor className="w-3 h-3" />}
                            <span className="font-medium">{log.role === 'user' ? 'You' : 'Companion'}</span>
                            <span>•</span>
                            <Clock className="w-3 h-3" />
                            {log.timestamp.toLocaleTimeString()}
                          </div>
                        </div>
                      )}
                      <p className={`text-lg leading-relaxed ${
                        log.role === 'system' ? 'text-sm text-stone-400' :
                        i === 0 ? 'text-stone-800' : 'text-stone-600'
                      }`}>
                        {log.text}
                      </p>
                    </motion.div>
                  ))}
                </AnimatePresence>

                {logs.length === 0 && (
                  <div className="flex-1 flex flex-col items-center justify-center text-stone-400 gap-4 h-full">
                    <MessageSquare className="w-12 h-12 opacity-15" />
                    <p>{TAB_METADATA.transcript.emptyState}</p>
                  </div>
                )}
              </div>
            )}

            {/* Helpful Info Tab */}
            {activeTab === 'info' && (
              <div className="h-full">
                {helpfulInfo ? (
                  <div className="prose prose-stone prose-teal max-w-none">
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
              <div className="h-full">
                {activityLog ? (
                  <div className="prose prose-stone prose-teal max-w-none">
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
              <div className="h-full">
                {savedNotes ? (
                  <div className="prose prose-stone prose-teal max-w-none">
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

          </div>
        </div>

      </div>
    </div>
  );
}
