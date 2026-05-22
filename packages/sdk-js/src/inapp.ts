/**
 * @hanjullo/sdk — In-app Message 모듈 (D175-A, 2026-05-19)
 *
 * 자사몰 페이지 로드 시 자동으로 active 메시지 조회 + 표시.
 *
 * 사용:
 *   hanjullo.inapp.init({ externalId: 'user_123' });  // 페이지 어디서나 호출
 *
 * 표시 위치: top_banner / bottom_banner / center_modal
 * 빈도 제어: once_per_session (sessionStorage) / once_per_day (localStorage + 서버 검증) / always
 */

export interface InAppInitInput {
  externalId?: string;
  anonymousId?: string;
  trigger?: string;  // 'page_load' (default) / 'cart_add' 등
  containerSelector?: string;  // 메시지를 표시할 DOM 선택자 (기본 body)
}

interface InAppMessage {
  id: string;
  title: string;
  body: string;
  actionUrl: string | null;
  actionLabel: string;
  position: 'top_banner' | 'bottom_banner' | 'center_modal';
  backgroundColor: string;
  textColor: string;
  triggerEvent: string;
  displayFrequency: 'once_per_session' | 'once_per_day' | 'always';
}

const STORAGE_KEY = 'hanjullo_inapp_seen';
const SESSION_KEY = 'hanjullo_inapp_session';

export class HanjulloInAppModule {
  constructor(
    private readonly apiKey: string,
    private readonly secret: string,
    private readonly endpoint: string,
  ) {}

  /**
   * 페이지 로드 시 호출 — 사용자에게 표시할 메시지 자동 fetch + render.
   */
  async init(input: InAppInitInput = {}): Promise<void> {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    try {
      const trigger = input.trigger || 'page_load';
      const seenSession = this.getSeenSession();
      const seenIds = seenSession.join(',');

      const params = new URLSearchParams({ trigger });
      if (input.externalId) params.set('external_id', input.externalId);
      if (input.anonymousId) params.set('anonymous_id', input.anonymousId);
      if (seenIds) params.set('seen', seenIds);

      const res = await fetch(`${this.endpoint}/inapp/active?${params.toString()}`, {
        headers: {
          'X-Hanjullo-Key': this.apiKey,
          'X-Hanjullo-Secret': this.secret,
        },
      });
      const data = await res.json();
      if (!data?.success || !Array.isArray(data.messages)) return;

      for (const msg of data.messages as InAppMessage[]) {
        this.renderMessage(msg, input);
      }
    } catch (err) {
      // SDK는 자사몰 페이지 안에서 동작 — 에러로 자사몰 깨지면 안 됨 (조용히 실패)
      console.warn('[Hanjullo InApp] init 실패:', err);
    }
  }

  // ════════════════════════════════════════════════════════════════
  // 렌더링
  // ════════════════════════════════════════════════════════════════

  private renderMessage(msg: InAppMessage, input: InAppInitInput): void {
    const root = document.createElement('div');
    root.setAttribute('data-hanjullo-msg', msg.id);
    Object.assign(root.style, this.basePositionStyle(msg.position));
    root.style.backgroundColor = msg.backgroundColor;
    root.style.color = msg.textColor;
    root.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    root.style.zIndex = '2147483647';

    if (msg.position === 'center_modal') {
      const backdrop = document.createElement('div');
      Object.assign(backdrop.style, {
        position: 'fixed',
        inset: '0',
        background: 'rgba(0,0,0,0.4)',
        zIndex: '2147483646',
      });
      backdrop.appendChild(root);
      document.body.appendChild(backdrop);
      root.style.position = 'relative';
      root.style.maxWidth = '400px';
      root.style.margin = '0 auto';
      root.style.top = '50%';
      root.style.transform = 'translateY(-50%)';
      root.style.borderRadius = '12px';
      root.style.padding = '24px';
      root.style.boxShadow = '0 10px 30px rgba(0,0,0,0.2)';
      this.fillContent(root, msg, () => document.body.removeChild(backdrop), input);
    } else {
      document.body.appendChild(root);
      this.fillContent(root, msg, () => document.body.removeChild(root), input);
    }

    // impression 트래킹
    this.track(msg.id, 'impression', input);
    // 표시 이력 저장
    this.markSeen(msg);
  }

  private basePositionStyle(position: string): Record<string, string> {
    if (position === 'top_banner') {
      return {
        position: 'fixed',
        top: '0',
        left: '0',
        right: '0',
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
      };
    }
    if (position === 'bottom_banner') {
      return {
        position: 'fixed',
        bottom: '0',
        left: '0',
        right: '0',
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        boxShadow: '0 -2px 8px rgba(0,0,0,0.1)',
      };
    }
    return {};
  }

  private fillContent(root: HTMLElement, msg: InAppMessage, onClose: () => void, input: InAppInitInput): void {
    const text = document.createElement('div');
    text.style.flex = '1';
    text.style.minWidth = '0';
    const titleEl = document.createElement('div');
    titleEl.style.fontWeight = 'bold';
    titleEl.style.fontSize = '14px';
    titleEl.style.marginBottom = '4px';
    titleEl.textContent = msg.title;
    const bodyEl = document.createElement('div');
    bodyEl.style.fontSize = '13px';
    bodyEl.style.opacity = '0.9';
    bodyEl.textContent = msg.body;
    text.appendChild(titleEl);
    text.appendChild(bodyEl);
    root.appendChild(text);

    if (msg.actionUrl) {
      const cta = document.createElement('button');
      cta.textContent = msg.actionLabel || '자세히 보기';
      Object.assign(cta.style, {
        background: 'rgba(255,255,255,0.2)',
        border: '1px solid rgba(255,255,255,0.4)',
        color: 'inherit',
        padding: '6px 14px',
        borderRadius: '6px',
        fontSize: '13px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      });
      cta.addEventListener('click', () => {
        this.track(msg.id, 'click', input);
        window.location.href = msg.actionUrl!;
      });
      root.appendChild(cta);
    }

    const close = document.createElement('button');
    close.textContent = '✕';
    Object.assign(close.style, {
      background: 'transparent',
      border: 'none',
      color: 'inherit',
      fontSize: '16px',
      cursor: 'pointer',
      padding: '4px 8px',
      opacity: '0.7',
    });
    close.addEventListener('click', () => {
      this.track(msg.id, 'dismiss', input);
      onClose();
    });
    root.appendChild(close);
  }

  // ════════════════════════════════════════════════════════════════
  // 트래킹
  // ════════════════════════════════════════════════════════════════

  private async track(messageId: string, eventType: 'impression' | 'click' | 'dismiss', input: InAppInitInput): Promise<void> {
    try {
      await fetch(`${this.endpoint}/inapp/track`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hanjullo-Key': this.apiKey,
          'X-Hanjullo-Secret': this.secret,
        },
        body: JSON.stringify({
          message_id: messageId,
          event_type: eventType,
          external_id: input.externalId,
          anonymous_id: input.anonymousId,
        }),
      });
    } catch {
      // 조용히 실패
    }
  }

  // ════════════════════════════════════════════════════════════════
  // 빈도 제어 (sessionStorage + localStorage)
  // ════════════════════════════════════════════════════════════════

  private getSeenSession(): string[] {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  private markSeen(msg: InAppMessage): void {
    try {
      if (msg.displayFrequency === 'once_per_session') {
        const seen = this.getSeenSession();
        if (!seen.includes(msg.id)) {
          seen.push(msg.id);
          sessionStorage.setItem(SESSION_KEY, JSON.stringify(seen));
        }
      } else if (msg.displayFrequency === 'once_per_day') {
        const raw = localStorage.getItem(STORAGE_KEY);
        const map = raw ? JSON.parse(raw) : {};
        map[msg.id] = Date.now();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
      }
    } catch {
      // 조용히 실패
    }
  }
}
