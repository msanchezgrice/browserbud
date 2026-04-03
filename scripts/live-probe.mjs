import dotenv from 'dotenv';
import { GoogleGenAI, Modality } from '@google/genai';

dotenv.config({ path: '.env.local' });

const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_LIVE_MODEL || 'gemini-3.1-flash-live-preview';

if (!apiKey) {
  console.error('Missing GEMINI_API_KEY');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

let session;
let transcript = '';
let gotAudio = false;
let finished = false;

const timeout = setTimeout(async () => {
  console.error('Timed out waiting for live response');
  if (session) {
    await session.close();
  }
  process.exit(1);
}, 20000);

try {
  session = await ai.live.connect({
    model,
    config: {
      responseModalities: [Modality.AUDIO],
      outputAudioTranscription: {},
    },
    callbacks: {
      onopen: () => {
        console.log(`Connected to ${model}`);
      },
      onmessage: async (message) => {
        const parts = message.serverContent?.modelTurn?.parts || [];
        for (const part of parts) {
          if (part?.text) {
            transcript += part.text;
          }
          if (part?.inlineData?.data) {
            gotAudio = true;
          }
        }

        if (message.serverContent?.turnComplete && !finished) {
          finished = true;
          console.log(`Transcript: ${transcript.trim() || '[none]'}`);
          console.log(`Audio chunks received: ${gotAudio ? 'yes' : 'no'}`);
          await session.close();
          clearTimeout(timeout);
          process.exit(0);
        }
      },
      onerror: (error) => {
        console.error('Live API probe error:', error);
      },
      onclose: (event) => {
        if (!finished) {
          console.log('Live session closed before turn completion');
          console.log(event);
        }
      },
    },
  });

  session.sendRealtimeInput({
    text: 'Reply with one short sentence about audio test success.',
  });
} catch (error) {
  clearTimeout(timeout);
  console.error('Failed to establish live session:', error);
  process.exit(1);
}
