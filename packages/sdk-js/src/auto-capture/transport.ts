/**
 * Transport — batch + retry + schema_version v1 (§12 #5).
 * POST /api/cdp/ingest 안 5 event 모음 또는 5초 timer 흐름 자동 flush.
 * §12 #5 — 모든 ingestion payload schema_version: 'v1' 필수 필드.
 */

import { getAnonymousId, getSessionId } from './storage';

export interface TransportConfig {
  apiKey: string;
  endpoint: string;
  batchSize?: number;
  flushIntervalMs?: number;
  retries?: number;
}

export interface QueuedEvent {
  type: string;
  [k: string]: unknown;
}

const SCHEMA_VERSION = 'v1';

export class Transport {
  private apiKey: string;
  private endpoint: string;
  private batchSize: number;
  private flushIntervalMs: number;
  private retries: number;
  private queueArr: QueuedEvent[];
  private timer: ReturnType<typeof setTimeout> | null;

  constructor(config: TransportConfig) {
    this.apiKey = config.apiKey;
    this.endpoint = config.endpoint.replace(/\/+$/, '');
    this.batchSize = config.batchSize ?? 20;
    this.flushIntervalMs = config.flushIntervalMs ?? 5000;
    this.retries = config.retries ?? 2;
    this.queueArr = [];
    this.timer = null;
  }

  queue(event: QueuedEvent): void {
    this.queueArr.push(event);
    if (this.queueArr.length >= this.batchSize) {
      this.flush();
    } else if (this.timer === null) {
      this.timer = setTimeout(() => this.flush(), this.flushIntervalMs);
    }
  }

  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.queueArr.length === 0) return;

    const events = this.queueArr.splice(0);
    const payload = {
      schema_version: SCHEMA_VERSION,
      anonymous_id: getAnonymousId(),
      session_id: getSessionId(),
      sent_at: new Date().toISOString(),
      events,
    };

    const url = `${this.endpoint}/ingest`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Hanjullo-Key': this.apiKey,
      'X-Hanjullo-Schema-Version': SCHEMA_VERSION,
      'X-Hanjullo-SDK-Version': '0.3.5-a',
    };

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          keepalive: true,
        });
        if (res.ok) return;
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          return;
        }
      } catch {
        // 네트워크 실패 = retry 흐름
      }
      if (attempt < this.retries) {
        const delay = Math.min(2000, 200 * Math.pow(2, attempt));
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
}
