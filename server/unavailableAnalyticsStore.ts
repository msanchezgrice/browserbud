import type { AnalyticsStoreAdapter } from './analyticsBackend';
import { AnalyticsBackendUnavailableError } from './analyticsBackend';

export class UnavailableAnalyticsStore implements AnalyticsStoreAdapter {
  constructor(private readonly message: string) {}

  initialize() {}

  close() {}

  private fail(): never {
    throw new AnalyticsBackendUnavailableError(this.message);
  }

  createSession() {
    return this.fail();
  }

  getSession() {
    return this.fail();
  }

  completeSession() {
    return this.fail();
  }

  appendRawEvent() {
    return this.fail();
  }

  saveConversationTurn() {
    return this.fail();
  }

  saveMemory() {
    return this.fail();
  }

  listSessionTimeline() {
    return this.fail();
  }

  listRecentSessions() {
    return this.fail();
  }

  getLatestSessionTimeline() {
    return this.fail();
  }

  generateSessionRecap() {
    return this.fail();
  }
}
