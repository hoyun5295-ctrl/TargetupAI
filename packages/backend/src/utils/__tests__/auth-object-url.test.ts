/**
 * 인증이 필요한 그림을 화면에 띄우는 주소 만들기 (2026-09-23 · frontend/src/lib/auth-download.ts)
 *
 * 못 박는 것 (0922 남지현 접수 · DM 블록 「이미지 스튜디오에서 제작 후 삽입」 결과 미리보기 빈칸):
 *   1. 로그인 토큰을 Authorization 헤더로 붙여 받는다 — `<img src>` 는 헤더를 못 붙여 인증 서빙 주소가 깨진다.
 *   2. 받은 그림은 화면이 바로 쓰는 blob 주소로 돌려준다.
 *   3. 서버가 거절하면(401·404) 깨진 주소를 돌려주지 않고 실패로 알린다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchAuthObjectUrl, fetchAuthJson } from '../../../../frontend/src/lib/auth-download';

const realFetch = globalThis.fetch;

beforeEach(() => {
  (globalThis as any).localStorage = { getItem: (k: string) => (k === 'token' ? 'tok-123' : null) };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete (globalThis as any).localStorage;
});

describe('fetchAuthObjectUrl', () => {
  it('토큰을 붙여 받고 blob 주소를 돌려준다', async () => {
    const spy = vi.fn(async (_url: string, init?: RequestInit) =>
      new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), { status: 200 }));
    globalThis.fetch = spy as any;
    const u = await fetchAuthObjectUrl('/api/image-studio/temp/abc');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('/api/image-studio/temp/abc');
    expect((spy.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
    expect(u.startsWith('blob:')).toBe(true);
    URL.revokeObjectURL(u);
  });

  it('서버가 거절하면 실패로 알린다', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{"error":"No token provided"}', { status: 401 })) as any;
    await expect(fetchAuthObjectUrl('/api/image-studio/temp/abc')).rejects.toThrow();
  });

  it('★1026 상한을 주지 않으면 종전 그대로(끊는 신호 없음)', async () => {
    const spy = vi.fn(async () => new Response(new Blob([new Uint8Array([1])]), { status: 200 }));
    globalThis.fetch = spy as any;
    const u = await fetchAuthObjectUrl('/api/sns/media/m1');
    expect((spy.mock.calls[0] as any[])[1]?.signal).toBeUndefined();
    URL.revokeObjectURL(u);
  });

  it('★1026 상한 안에 못 받으면 끊고 실패로 알린다(끝없는 기다림 0)', async () => {
    globalThis.fetch = hangingFetch() as any;
    await expect(fetchAuthObjectUrl('/api/sns/media/m1', 30)).rejects.toThrow();
  });
});

/** 끊는 신호가 와야만 끝나는 요청(응답이 오지 않는 서버) */
function hangingFetch() {
  return vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  }));
}

describe('★1026 fetchAuthJson', () => {
  it('토큰을 붙이고 부른 쪽 머리말을 지키며 본문을 돌려준다', async () => {
    const spy = vi.fn(async () => new Response('{"success":true,"items":[]}', { status: 200 }));
    globalThis.fetch = spy as any;
    const { res, data } = await fetchAuthJson('/api/sns/media/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, 1000);
    const init = (spy.mock.calls[0] as any[])[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.method).toBe('POST');
    expect(init.signal).toBeDefined();
    expect(res.ok).toBe(true);
    expect(data).toEqual({ success: true, items: [] });
  });

  it('본문이 JSON 이 아니면 data = null(부르는 쪽 실패 갈래)', async () => {
    globalThis.fetch = vi.fn(async () => new Response('<html>502</html>', { status: 502 })) as any;
    const { res, data } = await fetchAuthJson('/api/sns/posts/p1', {}, 1000);
    expect(res.status).toBe(502);
    expect(data).toBeNull();
  });

  it('상한 안에 못 받으면 끊고 던진다(복원 판정 · 사진 확인 잠금이 끝없이 남지 않게)', async () => {
    globalThis.fetch = hangingFetch() as any;
    await expect(fetchAuthJson('/api/sns/posts/p1', {}, 30)).rejects.toThrow();
  });
});
