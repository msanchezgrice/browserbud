export const DEFAULT_AUTO_SAVE_INTERVAL_MS = 30000;

export function buildAutoSavePrompt(): string {
  return [
    'Background auto-save check.',
    'Do not speak aloud unless there is an urgent warning.',
    'Call appendHelpfulInfo exactly once in this turn.',
    'Save a concise markdown note about what the user is looking at, doing, or deciding right now.',
    'Include practical context, key takeaways, and anything worth remembering later.',
    'If very little changed, still save a short progress update instead of skipping the tool call.',
    'Do not ask follow-up questions.',
    'Keep any spoken reply extremely brief or silent unless there is an urgent warning.',
  ].join(' ');
}
