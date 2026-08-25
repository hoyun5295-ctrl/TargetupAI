/**
 * utils/pop3-client.ts — 소형 POP3S 클라이언트 CT (★2026-08-26 §18 · 대행발송 이메일 접수 전용)
 *
 * 하이웍스 실측(2026-08-26)이 이 구현의 계약이다:
 *   - 하이웍스는 POP3S만 지원한다(pop3s.hiworks.com:995 · IMAP 미지원).
 *   - CAPA는 미구현(-ERR)이고 **APOP은 서버가 거부한다** → ⛔ USER/PASS 평문(TLS 안)만 쓴다.
 *   - UIDL·TOP 지원 확정(멱등 키 · 헤더 선수신의 근거).
 * 왜 자체 구현인가: node IMAP 라이브러리는 무용해졌고 POP3 라이브러리는 장기 미유지보수라
 * 공급망 위험이 더 크다(§18-11). POP3는 6명령(USER/PASS/STAT/UIDL/TOP/RETR/QUIT)뿐이다.
 * ⛔ MIME 해석은 여기서 하지 않는다 — mailparser의 일이다(직접 파싱 금지 · §18-11).
 * ⛔ DELE는 구현하지 않는다 — 서버 메일은 건드리지 않는다(§18-5 · 처리 상태는 intake 원장 단독).
 */
import tls from 'tls';

export type Pop3ErrorKind = 'network' | 'auth' | 'protocol';

export class Pop3Error extends Error {
  constructor(message: string, public kind: Pop3ErrorKind) {
    super(message);
    this.name = 'Pop3Error';
  }
}

export interface Pop3ConnectOptions {
  host: string;
  port: number;
  user: string;
  pass: string;
  /** TLS 연결 수립 상한(기본 10초) */
  connectTimeoutMs?: number;
  /** 명령 1회 응답 상한(기본 20초 · RETR 같은 대용량도 이 안에 와야 한다) */
  commandTimeoutMs?: number;
}

export interface Pop3UidlEntry { seq: number; uidl: string }
export interface Pop3ListEntry { seq: number; octets: number }

const CRLF = Buffer.from('\r\n');
const TERM = Buffer.from('\r\n.\r\n');

/** multiline 본문의 dot-stuffing 해제: 줄 머리 ".."은 "."이다(RFC 1939) */
function unstuff(body: Buffer): Buffer {
  const lines = body.length === 0 ? [] : body.toString('binary').split('\r\n');
  const out = lines.map((l) => (l.startsWith('..') ? l.slice(1) : l));
  return Buffer.from(out.join('\r\n'), 'binary');
}

export class Pop3Client {
  private buf: Buffer = Buffer.alloc(0);
  private waiter: { resolve: () => void } | null = null;
  private closed = false;
  private closeErr: Error | null = null;

  private constructor(private socket: tls.TLSSocket, private commandTimeoutMs: number) {
    socket.on('data', (chunk: Buffer) => {
      this.buf = Buffer.concat([this.buf, chunk]);
      this.waiter?.resolve();
    });
    const onGone = (err?: Error) => {
      this.closed = true;
      this.closeErr = err || null;
      this.waiter?.resolve();
    };
    socket.on('error', (err: Error) => onGone(err));
    socket.on('close', () => onGone());
  }

  /** 접속 + 인사말 확인 + USER/PASS 로그인. 로그인 거절은 kind='auth'로 구분해 던진다(3연속 정지 판정용). */
  static async connect(opts: Pop3ConnectOptions): Promise<Pop3Client> {
    const connectTimeoutMs = opts.connectTimeoutMs ?? 10_000;
    const commandTimeoutMs = opts.commandTimeoutMs ?? 20_000;
    const socket: tls.TLSSocket = await new Promise((resolve, reject) => {
      const s = tls.connect({ host: opts.host, port: opts.port, servername: opts.host }, () => {
        clearTimeout(timer);
        resolve(s);
      });
      const timer = setTimeout(() => {
        s.destroy();
        reject(new Pop3Error(`접속 시간 초과: ${opts.host}:${opts.port}`, 'network'));
      }, connectTimeoutMs);
      s.once('error', (err) => {
        clearTimeout(timer);
        reject(new Pop3Error(`접속 실패: ${err?.message || err}`, 'network'));
      });
    });
    const client = new Pop3Client(socket, commandTimeoutMs);
    const greeting = await client.readLine();
    if (!greeting.startsWith('+OK')) {
      client.destroy();
      throw new Pop3Error(`서버 인사말이 올바르지 않습니다: ${greeting}`, 'protocol');
    }
    const u = await client.command(`USER ${opts.user}`);
    if (!u.ok) {
      client.destroy();
      throw new Pop3Error(`USER 거절: ${u.first}`, 'auth');
    }
    const p = await client.command(`PASS ${opts.pass}`);
    if (!p.ok) {
      client.destroy();
      throw new Pop3Error(`로그인 거절: ${p.first}`, 'auth');
    }
    return client;
  }

  private async waitData(): Promise<void> {
    if (this.closed) throw new Pop3Error(`연결이 끊겼습니다: ${this.closeErr?.message || 'closed'}`, 'network');
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new Pop3Error('응답 시간 초과', 'network'));
      }, this.commandTimeoutMs);
      this.waiter = {
        resolve: () => {
          clearTimeout(timer);
          this.waiter = null;
          resolve();
        },
      };
    });
    if (this.closed && this.buf.length === 0) {
      throw new Pop3Error(`연결이 끊겼습니다: ${this.closeErr?.message || 'closed'}`, 'network');
    }
  }

  private async readLine(): Promise<string> {
    for (;;) {
      const idx = this.buf.indexOf(CRLF);
      if (idx >= 0) {
        const line = this.buf.subarray(0, idx).toString('utf8');
        this.buf = this.buf.subarray(idx + 2);
        return line;
      }
      await this.waitData();
    }
  }

  /** 첫 줄이 +OK인 multiline 응답의 본문(dot-unstuffed)을 모은다 */
  private async readMultiline(): Promise<Buffer> {
    for (;;) {
      // 본문이 비어 곧장 종료되는 경우: 남은 버퍼가 ".\r\n"으로 시작
      if (this.buf.length >= 3 && this.buf[0] === 0x2e && this.buf[1] === 0x0d && this.buf[2] === 0x0a) {
        this.buf = this.buf.subarray(3);
        return Buffer.alloc(0);
      }
      const idx = this.buf.indexOf(TERM);
      if (idx >= 0) {
        const body = this.buf.subarray(0, idx);
        this.buf = this.buf.subarray(idx + TERM.length);
        return unstuff(body);
      }
      await this.waitData();
    }
  }

  async command(line: string, multiline = false): Promise<{ ok: boolean; first: string; data: Buffer }> {
    if (this.closed) throw new Pop3Error('연결이 이미 닫혔습니다.', 'network');
    this.socket.write(line + '\r\n');
    const first = await this.readLine();
    const ok = first.startsWith('+OK');
    if (!ok || !multiline) return { ok, first, data: Buffer.alloc(0) };
    const data = await this.readMultiline();
    return { ok, first, data };
  }

  /** 받은편지함 통수 */
  async stat(): Promise<number> {
    const r = await this.command('STAT');
    if (!r.ok) throw new Pop3Error(`STAT 실패: ${r.first}`, 'protocol');
    return Number(r.first.split(' ')[1]) || 0;
  }

  /** 메시지별 고유 식별자(멱등 1층 키). 순서 = 메시지 번호 오름차순(오래된 것부터) */
  async uidl(): Promise<Pop3UidlEntry[]> {
    const r = await this.command('UIDL', true);
    if (!r.ok) throw new Pop3Error(`UIDL 실패: ${r.first}`, 'protocol');
    return r.data.toString('utf8').split('\r\n').filter(Boolean).map((l) => {
      const [seq, uidl] = l.trim().split(/\s+/);
      return { seq: Number(seq), uidl: String(uidl || '') };
    }).filter((e) => Number.isFinite(e.seq) && e.seq > 0 && e.uidl);
  }

  /** 메시지별 크기(octets) — RETR 전에 대용량을 거르는 근거 */
  async list(): Promise<Pop3ListEntry[]> {
    const r = await this.command('LIST', true);
    if (!r.ok) throw new Pop3Error(`LIST 실패: ${r.first}`, 'protocol');
    return r.data.toString('utf8').split('\r\n').filter(Boolean).map((l) => {
      const [seq, octets] = l.trim().split(/\s+/);
      return { seq: Number(seq), octets: Number(octets) || 0 };
    }).filter((e) => Number.isFinite(e.seq) && e.seq > 0);
  }

  /** 헤더만(본문 0줄) — 신원 판정 전 첨부 미다운로드의 근거(§18-5) */
  async top(seq: number): Promise<Buffer> {
    const r = await this.command(`TOP ${seq} 0`, true);
    if (!r.ok) throw new Pop3Error(`TOP 실패: ${r.first}`, 'protocol');
    return r.data;
  }

  /** 메시지 전문 — 신원 통과 뒤에만 부른다 */
  async retr(seq: number): Promise<Buffer> {
    const r = await this.command(`RETR ${seq}`, true);
    if (!r.ok) throw new Pop3Error(`RETR 실패: ${r.first}`, 'protocol');
    return r.data;
  }

  async quit(): Promise<void> {
    try { await this.command('QUIT'); } catch { /* 끊기는 중이면 그대로 닫는다 */ }
    this.destroy();
  }

  destroy(): void {
    this.closed = true;
    try { this.socket.destroy(); } catch { /* noop */ }
  }
}
