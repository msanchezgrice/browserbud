import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Modality, Type } from '@google/genai';
import { Play, Square, Mic, MicOff, User, Clock, MessageSquare, Monitor, MonitorOff, Info, Plus, Trash2, RotateCcw, Settings, Search, FileText, BookOpen, List, Bookmark } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey });
const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-3.1-flash-live-preview';

const STORAGE_KEYS = {
  customPersonas: 'browserbud.customPersonas',
  helpfulInfo: 'browserbud.helpfulInfo',
  activityLog: 'browserbud.activityLog',
  savedNotes: 'browserbud.savedNotes',
};

const MAX_RECONNECT_ATTEMPTS = 6;

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
  { id: 10000, name: 'Every 10 seconds' },
  { id: 30000, name: 'Every 30 seconds' },
  { id: 60000, name: 'Every 1 minute' },
  { id: 0, name: 'Off (Conversation Only)' },
];

type LogEntry = {
  id: string;
  timestamp: Date;
  text: string;
  role: 'user' | 'model' | 'system';
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
  const [frequency, setFrequency] = useState(FREQUENCIES[1].id); // Default to 30s
  const [isSharing, setIsSharing] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Notepad State
  const [activeTab, setActiveTab] = useState<'transcript' | 'info' | 'activity' | 'notes'>('transcript');
  const [helpfulInfo, setHelpfulInfo] = useState<string>(() => readStoredText(STORAGE_KEYS.helpfulInfo));
  const [activityLog, setActivityLog] = useState<string>(() => readStoredText(STORAGE_KEYS.activityLog));
  const [savedNotes, setSavedNotes] = useState<string>(() => readStoredText(STORAGE_KEYS.savedNotes));
  
  // Custom Persona State
  const [showAddPersona, setShowAddPersona] = useState(false);
  const [newPersonaName, setNewPersonaName] = useState('');
  const [newPersonaPrompt, setNewPersonaPrompt] = useState('');
  const [newPersonaVoice, setNewPersonaVoice] = useState(AVAILABLE_VOICES[0]);
  const [newPersonaSearch, setNewPersonaSearch] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Live API & Audio Refs
  const sessionRef = useRef<Promise<any> | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
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
  
  // Interval Refs
  const videoIntervalRef = useRef<ReturnType<typeof window.setInterval> | null>(null);
  const commentaryIntervalRef = useRef<ReturnType<typeof window.setInterval> | null>(null);

  useEffect(() => {
    isMicMutedRef.current = isMicMuted;
  }, [isMicMuted]);

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

  const cleanupLiveSession = ({ closeSession = false, stopMic = true }: { closeSession?: boolean; stopMic?: boolean } = {}) => {
    clearRuntimeTimers();

    activeSourcesRef.current.forEach((source) => {
      try {
        source.stop();
      } catch {}
    });
    activeSourcesRef.current = [];
    isModelSpeakingRef.current = false;
    currentInputTranscriptRef.current = '';
    currentOutputTranscriptRef.current = '';

    if (processorRef.current) {
      processorRef.current.onaudioprocess = null;
      processorRef.current.disconnect();
      processorRef.current = null;
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

    if (!apiKey) {
      alert('Missing GEMINI_API_KEY. Add it to .env.local and restart the dev server.');
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

    try {
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 } });
      console.debug('Microphone stream acquired', { tracks: micStream.getTracks().length });
      micStreamRef.current = micStream;

      playCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      micCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });

      void playCtxRef.current.resume().catch(() => {});
      void micCtxRef.current.resume().catch(() => {});

      nextPlayTimeRef.current = playCtxRef.current.currentTime;
      console.debug('Starting live session', { model: LIVE_MODEL, isReconnect });

      const currentPersonality = personas.find((p) => p.id === personality) || personas[0];
      let currentTurnText = '';

      const config: any = {
        responseModalities: [Modality.AUDIO],
        outputAudioTranscription: {},
        inputAudioTranscription: {},
        thinkingConfig: { thinkingLevel: 'minimal' },
        contextWindowCompression: { slidingWindow: {} },
        sessionResumption: { handle: sessionHandleRef.current || undefined },
        systemInstruction: {
          parts: [{ text: `${currentPersonality.prompt} You can see the user's screen and hear their voice. Respond to them naturally and conversationally. Keep your answers brief.

IMPORTANT: Prioritize a fast spoken reply first. Use tools only when they add clear value, and do not delay an initial response just to write notes.
- Use 'appendHelpfulInfo' after responding when a recommendation is worth saving for later.
- Use 'logActivity' only for meaningful changes in what the user is doing, not every turn.
- Use 'saveNote' when the user explicitly asks you to save something or remember a question.
- Use 'googleSearch' (if enabled) only for factual or up-to-date questions where grounding helps.` }]
        },
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: currentPersonality.voiceName } }
        },
        tools: [{
          functionDeclarations: [
            {
              name: 'appendHelpfulInfo',
              description: 'Append helpful information to the notepad. You MUST include a thinking trace explaining why this is helpful.',
              parameters: {
                type: Type.OBJECT,
                properties: {
                  thinking_trace: { type: Type.STRING, description: 'Explanation of why this information is helpful to the user right now.' },
                  content: { type: Type.STRING, description: 'Markdown formatted content to append.' }
                },
                required: ['thinking_trace', 'content']
              }
            },
            {
              name: 'logActivity',
              description: 'Log minutes or notes of what the user is doing (location, topic). Appends to the activity log.',
              parameters: {
                type: Type.OBJECT,
                properties: {
                  location: { type: Type.STRING, description: 'URL, App name, or context location' },
                  topic: { type: Type.STRING, description: 'Main topic of the activity' },
                  details: { type: Type.STRING, description: 'Brief details of what was done' }
                },
                required: ['location', 'topic', 'details']
              }
            },
            {
              name: 'saveNote',
              description: 'Log any asked questions or requested notes from the user. Appends to the saved notes notepad.',
              parameters: {
                type: Type.OBJECT,
                properties: { note: { type: Type.STRING, description: 'The question or note to save' } },
                required: ['note']
              }
            }
          ]
        }]
      };

      if (currentPersonality.useSearch) {
        config.tools.push({ googleSearch: {} });
        config.systemInstruction.parts[0].text += ' Use Google Search to find relevant information about what the user is looking at if needed.';
        config.toolConfig = { includeServerSideToolInvocations: true };
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

            const source = micCtxRef.current!.createMediaStreamSource(micStream);
            const processor = micCtxRef.current!.createScriptProcessor(2048, 1, 1);
            processorRef.current = processor;

            source.connect(processor);
            processor.connect(micCtxRef.current!.destination);

            processor.onaudioprocess = (e) => {
              if (isMicMutedRef.current) return;
              const inputData = e.inputBuffer.getChannelData(0);

              const outputData = e.outputBuffer.getChannelData(0);
              for (let i = 0; i < outputData.length; i++) {
                outputData[i] = 0;
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

            videoIntervalRef.current = setInterval(() => {
              const base64Image = captureFrame();
              if (base64Image) {
                sessionPromise.then((session) => {
                  session.sendRealtimeInput({ video: { data: base64Image, mimeType: 'image/jpeg' } });
                }).catch(() => {});
              }
            }, 2000);

            if (frequency > 0) {
              commentaryIntervalRef.current = setInterval(() => {
                if (!isModelSpeakingRef.current) {
                  sessionPromise.then((session) => {
                    session.sendRealtimeInput({ text: 'Analyze the current screen and provide a brief spoken commentary if something changed or stands out. Only use tools if there is genuinely useful information worth saving.' });
                  }).catch(() => {});
                }
              }, frequency);
            }

            setLogs((prev) => [{
              id: Math.random().toString(36).slice(2),
              timestamp: new Date(),
              text: isReconnect ? 'Live audio reconnected.' : 'Connected to Live Audio. You can talk now!',
              role: 'system'
            }, ...prev]);
          },
          onmessage: (message: any) => {
            const inputTranscription = message.serverContent?.inputTranscription;
            const outputTranscription = message.serverContent?.outputTranscription;
            const sessionResumptionUpdate = message.sessionResumptionUpdate;

            if (sessionResumptionUpdate?.resumable && sessionResumptionUpdate?.newHandle) {
              sessionHandleRef.current = sessionResumptionUpdate.newHandle;
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
              currentInputTranscriptRef.current = inputTranscription.text;
            }
            if (inputTranscription?.finished && currentInputTranscriptRef.current.trim()) {
              const text = currentInputTranscriptRef.current.trim();
              setLogs((prev) => [{ id: Math.random().toString(36).substring(7), timestamp: new Date(), text, role: 'user' }, ...prev]);
              currentInputTranscriptRef.current = '';
            }

            const parts = message.serverContent?.modelTurn?.parts;
            if (parts) {
              isModelSpeakingRef.current = true;
              for (const part of parts) {
                if (part?.text) {
                  currentTurnText += part.text;
                }
                if (part?.inlineData?.data) {
                  playAudioChunk(part.inlineData.data);
                }
              }
            }

            if (outputTranscription?.text !== undefined) {
              currentOutputTranscriptRef.current = outputTranscription.text;
            }
            if (outputTranscription?.finished && currentOutputTranscriptRef.current.trim()) {
              const text = currentOutputTranscriptRef.current.trim();
              setLogs((prev) => [{ id: Math.random().toString(36).substring(7), timestamp: new Date(), text, role: 'model' }, ...prev]);
              currentOutputTranscriptRef.current = '';
              currentTurnText = '';
            }

            if (message.serverContent?.turnComplete) {
              isModelSpeakingRef.current = false;
              const transcriptText = currentOutputTranscriptRef.current.trim();
              const fallbackText = currentTurnText.trim();
              const finalText = transcriptText || fallbackText;
              if (finalText) {
                setLogs((prev) => [{ id: Math.random().toString(36).substring(7), timestamp: new Date(), text: finalText, role: 'model' }, ...prev]);
              }
              currentTurnText = '';
              currentOutputTranscriptRef.current = '';
            }

            if (message.serverContent?.interrupted) {
              isModelSpeakingRef.current = false;
              activeSourcesRef.current.forEach((source) => source.stop());
              activeSourcesRef.current = [];
              if (playCtxRef.current) {
                nextPlayTimeRef.current = playCtxRef.current.currentTime;
              }
              if (currentTurnText.trim()) {
                const interruptedText = `${currentTurnText.trim()} [Interrupted]`;
                setLogs((prev) => [{ id: Math.random().toString(36).substring(7), timestamp: new Date(), text: interruptedText, role: 'model' }, ...prev]);
                currentTurnText = '';
              }
              currentOutputTranscriptRef.current = '';
            }

            if (message.toolCall) {
              const functionCalls = message.toolCall.functionCalls;
              if (functionCalls) {
                const functionResponses: any[] = [];
                for (const call of functionCalls) {
                  setLogs((prev) => [{ id: Math.random().toString(36).substring(7), timestamp: new Date(), text: `[Action]: Executing ${call.name}...`, role: 'system' }, ...prev]);

                  if (call.name === 'appendHelpfulInfo' || call.name === 'updateHelpfulInfo') {
                    const args = call.args as any;
                    const timestamp = new Date().toLocaleTimeString();
                    const infoEntry = `### [${timestamp}] Recommendation
**Thinking Trace:** ${args.thinking_trace || 'Thought this would be useful.'}

${args.content}

---

`;
                    setHelpfulInfo((prev) => infoEntry + prev);
                    functionResponses.push({ id: call.id, name: call.name, response: { result: 'success' } });
                  } else if (call.name === 'logActivity') {
                    const args = call.args as any;
                    const timestamp = new Date().toLocaleTimeString();
                    const logEntry = `- **[${timestamp}] ${args.location}** (${args.topic}): ${args.details}
`;
                    setActivityLog((prev) => logEntry + prev);
                    functionResponses.push({ id: call.id, name: call.name, response: { result: 'success' } });
                  } else if (call.name === 'saveNote') {
                    const args = call.args as any;
                    const timestamp = new Date().toLocaleTimeString();
                    const noteEntry = `- **[${timestamp}]** ${args.note}
`;
                    setSavedNotes((prev) => noteEntry + prev);
                    functionResponses.push({ id: call.id, name: call.name, response: { result: 'success' } });
                  }
                }
                sessionPromise.then((session) => {
                  session.sendToolResponse({ functionResponses });
                }).catch(() => {});
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
        <div className="lg:col-span-4 flex flex-col gap-6 h-full overflow-y-auto pr-2 pb-8">
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

          <div className="bg-white border border-stone-200 rounded-xl p-5 space-y-6 shadow-sm">
            
            {/* Screen Share Preview */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                  <Monitor className="w-4 h-4 text-slate-400" />
                  Screen Source
                </label>
                <button
                  onClick={toggleSharing}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                    isSharing 
                      ? 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200' 
                      : 'bg-sky-50 text-sky-700 hover:bg-sky-100 border border-sky-200'
                  }`}
                >
                  {isSharing ? 'Stop Sharing' : 'Share Tab/Screen'}
                </button>
              </div>
              
              <div className="relative aspect-video bg-slate-100 rounded-xl overflow-hidden border border-slate-200 flex items-center justify-center">
                {!isSharing && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 gap-2">
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
              
              <div className="flex items-start gap-2 text-xs text-slate-600 bg-sky-50 p-3 rounded-xl border border-sky-100">
                <Info className="w-4 h-4 shrink-0 text-sky-600" />
                <p>To have the companion follow you across all tabs, choose <strong>"Entire Screen"</strong> when sharing.</p>
              </div>
            </div>

            {/* Personality Select & Management */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                  <User className="w-4 h-4 text-slate-400" />
                  Companion Personality
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={resetPersonas}
                    className="text-xs text-slate-500 hover:text-slate-700 transition-colors"
                    title="Reset to defaults"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setShowAddPersona(!showAddPersona)}
                    className="text-xs text-sky-700 hover:text-sky-800 transition-colors flex items-center gap-1"
                  >
                    <Plus className="w-4 h-4" /> Add
                  </button>
                </div>
              </div>

              {showAddPersona && (
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                  <input
                    type="text"
                    placeholder="Persona Name (e.g. Pirate)"
                    value={newPersonaName}
                    onChange={e => setNewPersonaName(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
                  />
                  <textarea
                    placeholder="Prompt (e.g. You are a pirate looking at the screen...)"
                    value={newPersonaPrompt}
                    onChange={e => setNewPersonaPrompt(e.target.value)}
                    rows={3}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-500 resize-none"
                  />
                  <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={newPersonaSearch} 
                      onChange={e => setNewPersonaSearch(e.target.checked)}
                      className="rounded border-slate-300 bg-white text-sky-600 focus:ring-sky-500"
                    />
                    Enable Google Search (Grounded, slower)
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={newPersonaVoice}
                      onChange={e => setNewPersonaVoice(e.target.value)}
                      className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
                    >
                      {AVAILABLE_VOICES.map(v => <option key={v} value={v}>{v} Voice</option>)}
                    </select>
                    <button
                      onClick={addPersona}
                      className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
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
                    className={`text-left px-4 py-3 rounded-xl text-sm transition-all border flex items-center justify-between group ${
                      personality === p.id 
                        ? 'bg-sky-50 border-sky-200 text-sky-900' 
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    } ${isRunning ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <div className="flex items-center gap-2">
                      <div className="font-medium">{p.name}</div>
                      {p.useSearch && <span title="Uses Google Search"><Search className="w-3 h-3 text-sky-600" /></span>}
                    </div>
                    {p.isCustom && !isRunning && (
                      <Trash2 
                        className="w-4 h-4 text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity hover:text-rose-600" 
                        onClick={(e) => deletePersona(p.id, e)}
                      />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Frequency Select */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-400" />
                Auto-Commentary Frequency
              </label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(Number(e.target.value))}
                disabled={isRunning}
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/30 appearance-none disabled:opacity-50"
              >
                {FREQUENCIES.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>

            {/* Controls */}
            <div className="pt-4 border-t border-slate-200 flex gap-3">
              <button
                onClick={toggleRunning}
                disabled={!isSharing}
                className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium transition-all ${
                  !isSharing
                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                    : isRunning 
                      ? 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200' 
                      : 'bg-slate-900 text-white hover:bg-slate-800 shadow-lg shadow-slate-300/50'
                }`}
              >
                {isRunning ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                {isRunning ? 'Stop Companion' : 'Start Companion'}
              </button>
              
              <button
                onClick={() => setIsMicMuted(!isMicMuted)}
                disabled={!isRunning}
                className={`p-3 rounded-xl border transition-all ${
                  !isRunning 
                    ? 'bg-slate-100 border-slate-200 text-slate-300 cursor-not-allowed'
                    : isMicMuted 
                      ? 'bg-rose-50 border-rose-200 text-rose-600' 
                      : 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                }`}
                title={isMicMuted ? "Unmute Microphone" : "Mute Microphone"}
              >
                {isMicMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>

        {/* Right Panel: Feed & Notepad */}
        <div className="lg:col-span-8 flex flex-col h-full bg-white/80 border border-slate-200 rounded-2xl overflow-hidden shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur">
          
          {/* Tabs Header */}
          <div className="px-4 pt-4 border-b border-slate-200 bg-white/95 flex flex-col gap-4 z-10">
            <div className="flex items-center justify-between px-2">
              <div className="flex items-center gap-4">
                <div className={`flex items-center gap-2 text-xs font-medium px-2.5 py-1 rounded-full border ${
                  isRunning ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'
                }`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${isRunning ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                  {isRunning ? 'LIVE' : 'OFFLINE'}
                </div>
                
                <button 
                  onClick={() => {
                    if (sessionRef.current) {
                      sessionRef.current.then(session => {
                        session.sendRealtimeInput({ text: "Provide a brief commentary on what is happening on the screen right now." });
                      });
                    }
                  }}
                  disabled={!isRunning}
                  className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                >
                  Force Comment
                </button>
              </div>
            </div>

            <div className="flex gap-1 overflow-x-auto custom-scrollbar pb-2">
              <button
                onClick={() => setActiveTab('transcript')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === 'transcript' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <MessageSquare className="w-4 h-4" />
                Live Transcript
              </button>
              <button
                onClick={() => setActiveTab('info')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === 'info' ? 'bg-sky-100 text-sky-800' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <BookOpen className="w-4 h-4" />
                Helpful Info
              </button>
              <button
                onClick={() => setActiveTab('activity')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === 'activity' ? 'bg-sky-100 text-sky-800' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <List className="w-4 h-4" />
                Activity Log
              </button>
              <button
                onClick={() => setActiveTab('notes')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === 'notes' ? 'bg-sky-100 text-sky-800' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Bookmark className="w-4 h-4" />
                Saved Notes
              </button>
            </div>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto p-6 relative">
            
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
                          ? 'bg-slate-50 border-slate-200 text-center'
                          : log.role === 'user'
                            ? 'bg-sky-50 border-sky-200 ml-12'
                            : i === 0 
                              ? 'bg-amber-50 border-amber-200 shadow-lg shadow-amber-100/60 mr-12' 
                              : 'bg-white border-slate-200 opacity-90 mr-12'
                      }`}
                    >
                      {log.role !== 'system' && (
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            {log.role === 'user' ? <User className="w-3 h-3" /> : <Monitor className="w-3 h-3" />}
                            <span className="font-medium">{log.role === 'user' ? 'You' : 'Companion'}</span>
                            <span>•</span>
                            <Clock className="w-3 h-3" />
                            {log.timestamp.toLocaleTimeString()}
                          </div>
                        </div>
                      )}
                      <p className={`text-lg leading-relaxed ${
                        log.role === 'system' ? 'text-sm text-slate-600' :
                        i === 0 ? 'text-slate-900' : 'text-slate-700'
                      }`}>
                        {log.text}
                      </p>
                    </motion.div>
                  ))}
                </AnimatePresence>
                
                {logs.length === 0 && (
                  <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-4 h-full">
                    <MessageSquare className="w-12 h-12 opacity-20" />
                    <p>No transcript yet. Share your screen and click "Start Companion" to begin.</p>
                  </div>
                )}
              </div>
            )}

            {/* Helpful Info Tab */}
            {activeTab === 'info' && (
              <div className="h-full">
                {helpfulInfo ? (
                  <div className="prose prose-slate max-w-none prose-headings:text-slate-900 prose-strong:text-slate-900 prose-a:text-sky-700">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{helpfulInfo}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center text-slate-400 gap-4 h-full">
                    <BookOpen className="w-12 h-12 opacity-20" />
                    <p>No helpful info prepped yet. Ask the companion to prepare some information.</p>
                  </div>
                )}
              </div>
            )}

            {/* Activity Log Tab */}
            {activeTab === 'activity' && (
              <div className="h-full">
                {activityLog ? (
                  <div className="prose prose-slate max-w-none prose-headings:text-slate-900 prose-strong:text-slate-900 prose-a:text-sky-700">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{activityLog}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center text-slate-400 gap-4 h-full">
                    <List className="w-12 h-12 opacity-20" />
                    <p>No activity logged yet. Ask the companion to take minutes of what you are doing.</p>
                  </div>
                )}
              </div>
            )}

            {/* Saved Notes Tab */}
            {activeTab === 'notes' && (
              <div className="h-full">
                {savedNotes ? (
                  <div className="prose prose-slate max-w-none prose-headings:text-slate-900 prose-strong:text-slate-900 prose-a:text-sky-700">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{savedNotes}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center text-slate-400 gap-4 h-full">
                    <Bookmark className="w-12 h-12 opacity-20" />
                    <p>No notes saved yet. Ask the companion to log a question or save a note.</p>
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
