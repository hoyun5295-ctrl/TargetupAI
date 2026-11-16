/**
 * ★ 2026-11-14 C133 F4 — 나눠 보내기 「시작 요청」의 상태(화면 쪽 · React 밖 · 가져오는 것 없음 = 서버 시험이 그대로 돌린다)
 *
 * 주인은 결과 창 하나다(패널이 다시 만들어져도 · 채널을 바꿔도 · 창을 닫았다 열어도 남는다).
 *
 * 규칙 하나 — 서버에 한 번이라도 보낸 요청(sent)은 서버의 답으로만 떠난다.
 *   · 시작됨 = 서버가 그 id 의 나눠 보내기를 돌려줬다(시작 응답 · 읽기 · 버리기의 답 어느 것이든).
 *   · 버려짐 = 서버가 그 id 를 닫았다고 답했다(버리기). 화면은 「안 만들어졌겠지」를 짐작하지 않는다
 *     (거절 응답 · 404 · 서버 오류 어느 것도 요청을 버릴 근거가 아니다 — 응답이 끊겼던 앞 요청이 만들었을 수 있다).
 *   요청(pending)이 있는 동안 확인 창이 떠 있고, 새 시작 · 문안 하나 발송은 잠긴다.
 */

export interface SplitStartAnswer { ok: boolean; status: number; body: any }

/** 확인 창을 연 순간의 요청 — id · 본문 · 그때 보여 준 것(view)을 묶어 둔다(그 뒤의 편집과 무관 · 다시 보내도 이 요청 그대로) */
export interface SplitStartRequest<V> { id: string; body: Record<string, unknown>; view: V; sent: boolean }

export type SplitStartPhase =
  | { kind: 'idle' | 'busy' | 'closing' }
  | { kind: 'error' | 'unknown'; message: string };

export interface SplitStartState<V, S> {
  pending: SplitStartRequest<V> | null;
  phase: SplitStartPhase;
  /** 이 결과 창에서 시작한 나눠 보내기 — 창을 새로 열 때까지 문안 하나 발송을 잠근다 */
  started: S | null;
}

export const splitStartEmpty = <V, S>(): SplitStartState<V, S> => ({ pending: null, phase: { kind: 'idle' }, started: null });

/** 결과 창이 「캠페인 확정」을 잠글 때 — 요청이 떠 있거나 · 이미 시작했다 */
export const splitStartLocked = (s: SplitStartState<unknown, unknown>): boolean => !!s.pending || !!s.started;

export interface SplitStartIo<S> {
  post: (body: Record<string, unknown>) => Promise<SplitStartAnswer>;
  read: (id: string) => Promise<SplitStartAnswer>;
  discard: (id: string) => Promise<SplitStartAnswer>;
  /** 발신 인증 요구 응답이면 인증 창을 띄우고 true(인증 뒤 retry 를 부른다) */
  senderAuth?: (body: any, retry: () => void) => boolean;
  onStarted?: (split: S) => void;
}

export const SPLIT_START_UNKNOWN = '시작됐는지 확인하지 못했어요. [다시 확인]을 눌러 주세요.';
export const SPLIT_START_FAILED = '시작하지 못했어요. 잠시 뒤 다시 눌러 주세요.';

export function splitStartMachine<V, S>(
  store: { get: () => SplitStartState<V, S>; set: (s: SplitStartState<V, S>) => void },
  io: SplitStartIo<S>,
) {
  const working = () => { const k = store.get().phase.kind; return k === 'busy' || k === 'closing'; };
  const phase = (p: SplitStartPhase) => store.set({ ...store.get(), phase: p });
  const started = (split: S) => {
    store.set({ pending: null, phase: { kind: 'idle' }, started: split });
    io.onStarted?.(split);
  };

  const api = {
    /** 확인 창을 연다 — 떠 있는 요청이 있거나 이미 시작했으면 아무 일도 없다 */
    open(req: { id: string; body: Record<string, unknown>; view: V }): void {
      const s = store.get();
      if (s.pending || s.started) return;
      store.set({ ...s, pending: { ...req, sent: false }, phase: { kind: 'idle' } });
    },

    /** 시작(다시 확인 · 다시 시작 · 발신 인증 뒤 재시도도 이 함수 = 같은 id · 같은 본문). onlyId = 그 요청이 아직 떠 있을 때만 */
    async submit(onlyId?: string): Promise<void> {
      const s = store.get();
      const req = s.pending;
      if (!req || working() || (onlyId !== undefined && req.id !== onlyId)) return;
      store.set({ ...s, pending: { ...req, sent: true }, phase: { kind: 'busy' } });
      const r = await io.post(req.body);
      if (r.ok && r.body?.split) return started(r.body.split as S);
      if (r.status === 403 && io.senderAuth?.(r.body, () => { void api.submit(req.id); })) return phase({ kind: 'idle' });
      // 서버가 거절했다고 답했다 = 이 요청은 만들지 않았다(앞서 끊긴 요청이 만들었는지는 버릴 때 서버가 정한다)
      if (r.status >= 400 && r.status < 500 && r.body) return phase({ kind: 'error', message: String(r.body.error || SPLIT_START_FAILED) });
      // 응답이 끊겼거나 서버 오류 = 시작됐는지 모른다 → 같은 id 로 지금 상태를 읽어 본다(있으면 시작된 것)
      const seen = await io.read(req.id);
      if (seen.ok && seen.body?.split) return started(seen.body.split as S);
      return phase({ kind: 'unknown', message: SPLIT_START_UNKNOWN });
    },

    /** 요청을 떠난다 — 보낸 적 없는 요청은 그냥 버리고, 보낸 요청은 서버에 닫아 달라고 한다(서버가 「이미 시작됐다」고 하면 시작된 것) */
    async leave(): Promise<void> {
      const s = store.get();
      const req = s.pending;
      if (!req || working()) return;
      if (!req.sent) { store.set({ ...s, pending: null, phase: { kind: 'idle' } }); return; }
      phase({ kind: 'closing' });
      const r = await io.discard(req.id);
      if (r.ok && r.body?.success === true) {
        if (r.body.split) return started(r.body.split as S);
        store.set({ ...store.get(), pending: null, phase: { kind: 'idle' } });
        return;
      }
      return phase({ kind: 'unknown', message: '확인하지 못했어요. 잠시 뒤 다시 눌러 주세요.' });
    },

    /** 결과 창을 새로 열 때 — 서버의 답을 못 받은 요청은 그대로 둔다(잠금이 이어진다) · 그 밖은 처음 상태로 */
    reopen(): void {
      if (store.get().pending?.sent) return;
      store.set(splitStartEmpty<V, S>());
    },

    /** 진행 상황 창이 바꾼 값(그만 · 이어 보내기)을 받아 둔다 */
    changed(split: S): void {
      if (!store.get().started) return;
      store.set({ ...store.get(), started: split });
      io.onStarted?.(split);
    },
  };
  return api;
}
