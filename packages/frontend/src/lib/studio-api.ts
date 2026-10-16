/**
 * lib/studio-api.ts — 이미지 스튜디오 요청 공용 (2026-10-16 · 설계서 2026-10-16-image-studio-picker-channel §2-5)
 *
 * 스튜디오 화면과 DM 삽입 창이 같은 함수를 지난다. 특히 /save 의 409 두 코드를 두 화면이 같은 방식으로 가른다
 * (LESSONS_FRONTEND 「같은 응답 코드를 받는 창 중 1곳 누락 = 막다른 창」):
 *   - STORAGE_FULL  = 저장 공간 가득. 서버가 원본 임시 파일을 남기므로 정리 뒤 같은 그림으로 다시 저장할 수 있다.
 *   - ALREADY_SAVED = 이미 저장됨(응답 유실 · 두 번 누름) 또는 기간 만료. 라이브러리에서 그 파일을 찾으면 저장된 것이다.
 * 검증 = backend/src/utils/__tests__/image-studio-picker-channel-1016.test.ts
 */

const authHeader = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

/**
 * 요청 시간 안전판. 서버 최악(대체 판정 30초 + 엔진 120초)보다 길게 잡아 서버보다 먼저 끊지 않는다
 * (먼저 끊으면 화면은 실패인데 서버는 성공 뒤 차감한다). 응답이 끝내 안 올 때 「만드는 중」에 영영 묶이는 것만 막는다.
 */
export const STUDIO_REQUEST_TIMEOUT_MS = 300_000;

export interface StudioResponse { status: number; ok: boolean; data: any }

/** 인증 · 시간 제한을 붙인 요청. 연결 실패·시간 초과는 status 0 과 사람말 오류로 돌려준다(던지지 않는다). */
export async function studioFetch(url: string, init: RequestInit = {}): Promise<StudioResponse> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), STUDIO_REQUEST_TIMEOUT_MS);
  try {
    const r = await fetch(url, { ...init, headers: { ...(init.headers || {}), ...authHeader() }, signal: ac.signal });
    const data = await r.json().catch(() => ({}));
    return { status: r.status, ok: r.ok && !!data?.success, data: data || {} };
  } catch (e: any) {
    const error = e?.name === 'AbortError' ? '응답이 늦어요. 잠시 뒤 다시 시도해주세요.' : '연결이 끊겼어요. 잠시 뒤 다시 시도해주세요.';
    return { status: 0, ok: false, data: { error } };
  } finally {
    clearTimeout(timer);
  }
}

export function studioPost(url: string, body: unknown): Promise<StudioResponse> {
  return studioFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

export interface SavedStudioAsset { id: string; url: string; filename: string | null }

export type StudioSaveResult =
  | { ok: true; asset: SavedStudioAsset }
  | { ok: false; code: 'STORAGE_FULL' | 'EXPIRED' | 'FAILED'; error: string };

/**
 * 라이브러리(최신 200건)에서 그 임시 그림으로 저장된 소재를 찾는다. 저장 파일명 = `${tempId}.${ext}`(backend moveTempToPermanent).
 * 조회 실패(error)와 조회는 됐는데 없음(missing)을 가른다 — 조회 장애를 만료로 확정하면 정상 저장본을 버리게 된다(Codex 1016 1R).
 */
export type SavedStudioLookup = { status: 'found'; asset: SavedStudioAsset } | { status: 'missing' } | { status: 'error' };
export async function findSavedStudioAsset(tempId: string): Promise<SavedStudioLookup> {
  const { ok, data } = await studioFetch('/api/assets');
  if (!ok || !Array.isArray(data.assets)) return { status: 'error' };
  const a = data.assets.find((x: any) => typeof x?.url === 'string' && x.url.includes(`/${tempId}.`));
  return a ? { status: 'found', asset: { id: String(a.id), url: a.url, filename: a.filename ?? null } } : { status: 'missing' };
}

/** 임시 그림 → 라이브러리 저장. 두 화면의 /save 는 전부 이 함수를 지난다. */
export async function saveStudioTemp(tempId: string, title?: string | null): Promise<StudioSaveResult> {
  const { status, ok, data } = await studioPost('/api/image-studio/save', { tempId, title: title || undefined });
  if (ok && data.asset?.url) return { ok: true, asset: { id: String(data.asset.id), url: data.asset.url, filename: null } };
  if (status === 409 && data.code === 'ALREADY_SAVED') {
    const found = await findSavedStudioAsset(tempId);
    if (found.status === 'found') return { ok: true, asset: found.asset };
    if (found.status === 'missing') return { ok: false, code: 'EXPIRED', error: '기간이 지나 저장할 수 없어요. 다시 만들어 주세요.' };
    // 조회 장애 = 만료로 단정하지 않는다 · 결과를 남겨 같은 그림으로 다시 누르게 한다
    return { ok: false, code: 'FAILED', error: '저장됐는지 확인하지 못했어요. 잠시 뒤 다시 눌러 주세요.' };
  }
  if (status === 409 && data.code === 'STORAGE_FULL') {
    return { ok: false, code: 'STORAGE_FULL', error: data.error || '저장 공간이 가득 찼어요. 라이브러리에서 정리한 뒤 다시 저장해주세요.' };
  }
  if (status === 503 && data.code === 'DB_MIGRATION_PENDING') {
    return { ok: false, code: 'FAILED', error: '라이브러리를 준비 중이에요. 잠시 뒤 다시 시도해주세요.' };
  }
  return { ok: false, code: 'FAILED', error: data.error || '저장에 실패했어요.' };
}
