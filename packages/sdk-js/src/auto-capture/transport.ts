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
  /**
   * ★ 2026-10-04 이 페이지의 회원 증명 — 마지막 identify 가 정한다(토큰 없는 identify · 로그아웃 = 지움). 매 전송에 싣는다.
   *   서버는 identify 가 없는 배치를 이 증명으로만 회원에 잇는다(옛: 익명 아이디로 예전 연결을 다시 써서 공용 PC 로그아웃 뒤 행동이 앞사람에게 붙었다).
   *   메모리에만 둔다 — 페이지가 바뀌면 그 페이지의 identify 가 다시 정한다.
   */
  private member: { external_id: string; member_token: string } | null = null;
  /**
   * 지금 이벤트가 누구 것인가 — 세 상태다(Codex 1004 R3 high: 「아직 식별 전」과 「로그아웃」을 한 값으로 뭉개 로그아웃 뒤 행동이 다음 회원 배치에 섞였다).
   *   null = 이 페이지에서 아직 식별 전(첫 식별이 오면 그 앞 이벤트도 같은 사람 것으로 함께 보낸다)
   *   LOGGED_OUT = 로그아웃 뒤(익명) · 그 밖 = 마지막 identify 의 아이디 + 토큰 유무
   * 상태가 바뀌면(첫 식별 제외) 그 전에 모은 이벤트를 먼저 보낸다 = 한 배치에 한 사람.
   */
  private identityKey: string | null = null;
  private static readonly LOGGED_OUT = '\u0000logged-out';

  constructor(config: TransportConfig) {
    this.apiKey = config.apiKey;
    this.endpoint = config.endpoint.replace(/\/+$/, '');
    this.batchSize = config.batchSize ?? 20;
    this.flushIntervalMs = config.flushIntervalMs ?? 5000;
    this.retries = config.retries ?? 2;
    this.queueArr = [];
    this.timer = null;

    // ★ 2026-10-04 페이지를 떠날 때 남은 이벤트를 바로 보낸다 — 옛: 5초 타이머를 기다리다 링크 클릭·장바구니 담은 뒤 이동·
    //   결제 화면 이동 직전 이벤트가 페이지와 함께 사라졌다. fetch keepalive 는 요청이 시작돼야 의미가 있어,
    //   pagehide(뒤로가기 캐시 포함)와 화면이 숨겨질 때(모바일 앱 전환) flush 를 바로 부른다(첫 fetch 는 동기로 시작된다).
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      const flushNow = () => { void this.flush(); };
      window.addEventListener('pagehide', flushNow);
      if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') flushNow();
        });
      }
    }
  }

  /** 로그아웃(회원 표식이 사라짐) — 그때까지 모은 것은 앞 회원 것으로 먼저 보내고, 이후 전송은 익명 */
  clearMember(): void {
    this.switchIdentity(Transport.LOGGED_OUT);
    this.member = null;
  }

  /** 상태가 바뀌면(첫 식별 제외) 지금까지 모은 것을 먼저 보낸다. flush 는 큐 비우기와 본문(member 포함) 생성을 첫 await 전에 동기로 하므로 뒤에서 member 를 바꿔도 앞 배치에 섞이지 않는다. */
  private switchIdentity(next: string): void {
    if (this.identityKey !== null && this.identityKey !== next) void this.flush();
    this.identityKey = next;
  }

  queue(event: QueuedEvent): void {
    if (event.type === 'identify') {
      const raw = event.external_id;
      const id = (typeof raw === 'string' || typeof raw === 'number') && String(raw) ? String(raw) : null;
      const token = typeof event.member_token === 'string' && event.member_token ? event.member_token : null;
      // ★ 2026-10-04 회원이 바뀌면(다른 아이디 · 토큰이 생기거나 사라짐 · 로그아웃 뒤 재식별) 그 전에 모은 이벤트를 먼저 보낸다.
      //   서버는 배치의 마지막 identify 하나로 판정하고 틀리면 익명이다(Codex 1004 R2 · R3 high).
      this.switchIdentity(`${id ?? ''}|${token ? 'v' : 'x'}`);
      this.member = id && token ? { external_id: id, member_token: token } : null;
    }
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
      ...(this.member ? { member: this.member } : {}),
    };

    const url = `${this.endpoint}/ingest`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Hanjullo-Key': this.apiKey,
      'X-Hanjullo-Schema-Version': SCHEMA_VERSION,
      'X-Hanjullo-SDK-Version': '0.3.6-a',
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
