const MOBILE_OS_PATTERN = /Android|iPhone|iPad|iPod/i;
const MOBILE_VIEWPORT_MAX_WIDTH = 900;

export type RuntimeSupportInput = {
  userAgent?: string;
  viewportWidth?: number;
  hasDisplayMedia: boolean;
  hasUserMedia: boolean;
  hasAudioContext: boolean;
  hasAudioWorklet: boolean;
};

export type RuntimeSupport = {
  supported: boolean;
  desktopOnly: boolean;
  mobileOs: boolean;
  mobileViewport: boolean;
  reasons: string[];
};

export function assessRuntimeSupport(input: RuntimeSupportInput): RuntimeSupport {
  const userAgent = input.userAgent || '';
  const viewportWidth = input.viewportWidth || 0;
  const mobileOs = MOBILE_OS_PATTERN.test(userAgent);
  const mobileViewport = viewportWidth > 0 && viewportWidth < MOBILE_VIEWPORT_MAX_WIDTH;
  const desktopOnly = mobileOs && mobileViewport;
  const reasons: string[] = [];

  if (desktopOnly) {
    reasons.push('Mobile browsers are desktop-only for now because BrowserBud needs stable screen sharing and live audio APIs.');
  }
  if (!input.hasDisplayMedia) {
    reasons.push('This browser cannot share a tab or screen with getDisplayMedia.');
  }
  if (!input.hasUserMedia) {
    reasons.push('This browser cannot access the microphone with getUserMedia.');
  }
  if (!input.hasAudioContext || !input.hasAudioWorklet) {
    reasons.push('This browser is missing the realtime audio pipeline BrowserBud needs.');
  }

  return {
    supported: reasons.length === 0,
    desktopOnly,
    mobileOs,
    mobileViewport,
    reasons,
  };
}

export function getRuntimeSupport(): RuntimeSupport {
  const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  return assessRuntimeSupport({
    userAgent: navigator.userAgent,
    viewportWidth: window.innerWidth,
    hasDisplayMedia: typeof navigator.mediaDevices?.getDisplayMedia === 'function',
    hasUserMedia: typeof navigator.mediaDevices?.getUserMedia === 'function',
    hasAudioContext: typeof AudioContextCtor === 'function',
    hasAudioWorklet: typeof window.AudioWorkletNode !== 'undefined',
  });
}
