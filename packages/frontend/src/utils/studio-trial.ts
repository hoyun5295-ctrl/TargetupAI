/**
 * studio-trial.ts — 이미지 스튜디오 무료체험 3회의 서버 호출 (★ 2026-11-15 C135 · 설계서 docs/2026-11-15-v3-popup-trial-design.md §5)
 *
 * 자격 · 횟수의 판정은 서버가 한다(backend utils/studio-trial.ts). 화면은 묻기만 한다.
 * 모르면 열지 않는다 — 응답 실패 · 시간 제한 · 표 없음(503) · 꼴이 다른 응답 = null.
 */
import { fetchJson, sendJson } from './dashboard-live';

export interface StudioTrialState { eligible: boolean; requested: boolean; granted: number; used: number; remaining: number }

function read(ok: boolean, body: any): StudioTrialState | null {
  if (!ok || !body?.success || typeof body.requested !== 'boolean') return null;
  return {
    eligible: body.eligible === true,
    requested: body.requested,
    granted: Number(body.granted) || 0,
    used: Number(body.used) || 0,
    remaining: Number(body.remaining) || 0,
  };
}

/** 지금 상태(자격 · 신청 여부 · 남은 횟수) */
export async function fetchStudioTrial(): Promise<StudioTrialState | null> {
  if (!localStorage.getItem('token')) return null;
  const r = await fetchJson('/api/image-studio/trial');
  return read(r.ok, r.body);
}

/** 「무료체험 3회 이용하고 싶습니다」 — 열렸으면 상태를 돌려준다(두 번 눌러도 같은 답) */
export async function requestStudioTrial(): Promise<StudioTrialState | null> {
  if (!localStorage.getItem('token')) return null;
  const r = await sendJson('/api/image-studio/trial/request', { method: 'POST' });
  return read(r.ok, r.body);
}
