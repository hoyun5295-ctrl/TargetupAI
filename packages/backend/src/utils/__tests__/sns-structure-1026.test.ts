/**
 * 1026 이미지 스튜디오 · SNS 구조체크 짝 시험(원장 docs/2026-10-26-image-studio-sns-structure-check.md §2 · §5)
 * 동작을 잠근다 — 계약(소스 꼴)은 root-ledger.test.ts 끝 「1026 스튜디오 · SNS」 묶음.
 */
import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isSnsMediaUrlLive } from '../sns-signed-media';
import { metaErrorKind, SnsAdapterError, isSnsNotFound } from '../sns/adapter';
import { getSnsAdapter, isSnsPublishAdapter, type ISnsPublishAdapter, type SnsPublishRequest } from '../sns';
import { isSnsReauthError, snsOwnerClause } from '../sns-accounts';
import { uploadGuard, uploadErrorText } from '../http-error';
import { composeSnsPost } from '../sns-compose';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
function mockFetch(status: number, body: unknown) {
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })) as any;
}
function pub(p: 'instagram' | 'threads' | 'facebook_page' | 'x'): ISnsPublishAdapter {
  const a = getSnsAdapter(p);
  if (!isSnsPublishAdapter(a)) throw new Error('not publish adapter');
  return a;
}
const req: SnsPublishRequest = { externalAccountId: 'ACC', accessToken: 'TOK', caption: '글', format: 'feed', media: [] };

describe('S1 · R18 — 서명 주소 시계 = 게시를 시작한 시각', () => {
  const now = new Date('2026-10-29T10:00:00+09:00');
  const savedAt = new Date('2026-10-26T10:00:00+09:00');
  it('저장 3일 뒤로 예약한 글 = 선점 직후 · 컨테이너 직후 주소가 산다(옛: live=false)', () => {
    expect(isSnsMediaUrlLive({ status: 'claimed', container_created_at: null, created_at: savedAt, claimed_at: now, verified_at: null }, now)).toBe(true);
    expect(isSnsMediaUrlLive({ status: 'submitted', container_created_at: now, created_at: savedAt, claimed_at: now, verified_at: null }, now)).toBe(true);
  });
  it('선점하고 36시간이 넘으면 죽는다 · 선점 시각이 없는 옛 행 = 저장 시각', () => {
    const claimed = new Date(now.getTime() - 37 * 60 * 60 * 1000);
    expect(isSnsMediaUrlLive({ status: 'submitted', container_created_at: null, created_at: savedAt, claimed_at: claimed, verified_at: null }, now)).toBe(false);
    expect(isSnsMediaUrlLive({ status: 'submitted', container_created_at: null, created_at: savedAt, verified_at: null }, now)).toBe(false);
  });
});

describe('S2 · S4 — 오류 종류 = 본문 코드(상태 코드 · 문장 글자 0)', () => {
  it('Meta 코드 → 종류', () => {
    expect(metaErrorKind(400, { code: 190 })).toBe('auth');
    expect(metaErrorKind(400, { code: 102 })).toBe('auth');
    expect(metaErrorKind(403, { code: 10 })).toBe('auth');
    expect(metaErrorKind(400, { code: 200 })).toBe('auth');
    expect(metaErrorKind(400, { code: 4 })).toBe('rate');
    expect(metaErrorKind(400, { code: 32 })).toBe('rate');
    expect(metaErrorKind(400, { code: 80002 })).toBe('rate');
    expect(metaErrorKind(400, { code: 100, error_subcode: 33 })).toBe('not_found');
    expect(metaErrorKind(400, { code: 100 })).toBe('other');
    expect(metaErrorKind(400, {})).toBe('other');
    expect(metaErrorKind(401, {})).toBe('auth');
    expect(metaErrorKind(404, {})).toBe('not_found');
  });
  it('다시 연결 판정 = 종류 auth 만(400 · 「invalid」 문장 = 끊김이 아니다)', () => {
    expect(isSnsReauthError(new SnsAdapterError('instagram', 'x', 'Invalid parameter', 400, null, 'other'))).toBe(false);
    expect(isSnsReauthError(new SnsAdapterError('instagram', 'x', 'rate', 400, null, 'rate'))).toBe(false);
    expect(isSnsReauthError(new SnsAdapterError('instagram', 'x', 'expired', 400, null, 'auth'))).toBe(true);
    expect(isSnsReauthError(new SnsAdapterError('x', 'token:missing', '끊김', 401))).toBe(true);
    expect(isSnsReauthError(new Error('expired'))).toBe(false);
  });
  it('재조회: 만료 토큰(400 · 190) = 던진다(삭제됨 아님) · 「대상 없음」 = 없음 · 404 = 없음', async () => {
    for (const p of ['instagram', 'threads', 'facebook_page'] as const) {
      mockFetch(400, { error: { message: 'Error validating access token', type: 'OAuthException', code: 190 } });
      await expect(pub(p).fetchPost(req, 'P1')).rejects.toSatisfy((e: unknown) => isSnsReauthError(e));
      mockFetch(400, { error: { message: 'Unsupported get request', code: 100, error_subcode: 33 } });
      expect((await pub(p).fetchPost(req, 'P1')).exists).toBe(false);
      mockFetch(404, {});
      expect((await pub(p).fetchPost(req, 'P1')).exists).toBe(false);
      mockFetch(400, { error: { message: 'Something else', code: 1 } });
      await expect(pub(p).fetchPost(req, 'P1')).rejects.toSatisfy((e: unknown) => e instanceof SnsAdapterError && !isSnsNotFound(e));
    }
  });
  it('X: 401 = 끊김 · refresh token 무효(invalid_grant) = 끊김 · 404 = 없음', async () => {
    mockFetch(401, { title: 'Unauthorized' });
    await expect(pub('x').fetchPost(req, 'T1')).rejects.toSatisfy((e: unknown) => isSnsReauthError(e));
    mockFetch(404, {});
    expect((await pub('x').fetchPost(req, 'T1')).exists).toBe(false);
    const x = getSnsAdapter('x')!;
    mockFetch(400, { error: 'invalid_grant', error_description: 'Value passed for the token was invalid.' });
    await expect(x.refreshToken({ clientId: 'c', clientSecret: 's', redirectUri: 'r' }, 'a', 'R')).rejects.toSatisfy((e: unknown) => isSnsReauthError(e));
  });
});

describe('S3 — 범위 조각 한 꼴', () => {
  it('관리자 = null(회사 전체) · 담당자 = 그 칸 일치', () => {
    expect(snsOwnerClause('p.created_by', 3)).toBe('($3::uuid IS NULL OR p.created_by = $3::uuid)');
  });
});

describe('S6 — 업로드 감싸개', () => {
  const run = (err: unknown) => {
    const res: any = { code: 0, body: null, status(c: number) { this.code = c; return this; }, json(b: unknown) { this.body = b; return this; } };
    let passed = false;
    uploadGuard((_q, _s, next) => next(err), { fileSize: 20 * 1024 * 1024, files: 1 })({}, res, () => { passed = true; });
    return { res, passed };
  };
  it('크기 초과 = 400 + 그 상한 문장(옛: 전역 처리기 500 「서버 오류」)', () => {
    const { res, passed } = run(Object.assign(new Error('File too large'), { name: 'MulterError', code: 'LIMIT_FILE_SIZE' }));
    expect(passed).toBe(false);
    expect(res.code).toBe(400);
    expect(res.body.error).toBe('파일 하나는 20MB 이하만 올릴 수 있어요.');
    expect(res.body.error).not.toMatch(/File too large/);
  });
  it('형식 거름(우리 한국어 문장) = 그 문장 · 오류 없음 = 다음으로', () => {
    expect(run(new Error('허용되지 않는 파일 형식입니다. (PDF, JPG, PNG 등만 가능)')).res.body.error).toBe('허용되지 않는 파일 형식입니다. (PDF, JPG, PNG 등만 가능)');
    expect(run(undefined).passed).toBe(true);
    expect(uploadErrorText(Object.assign(new Error('x'), { code: 'LIMIT_FILE_COUNT' }), { files: 1 })).toBe('파일은 한 번에 1개까지 올릴 수 있어요.');
  });
});

describe('S13 — 저장 = 언제나 올리기(초안 갈래 0)', () => {
  it('publish 없이 오면 DB 를 건드리기 전에 400', async () => {
    const r = await composeSnsPost({
      companyId: '11111111-1111-4111-8111-111111111111', userId: null, body: '글', tags: [], mediaIds: [],
      accountIds: ['22222222-2222-4222-8222-222222222222'], publish: null,
    });
    expect(r).toMatchObject({ ok: false, status: 400, code: 'BAD_REQUEST' });
  });
});

describe('S10 — SNS 파일 정리 짝', () => {
  let dir: string;
  let mod: typeof import('../sns-media');
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sns-sweep-'));
    process.env.SNS_RENDER_PATH = path.join(dir, 'render');
    process.env.SNS_MEDIA_PATH = path.join(dir, 'media');
    vi.resetModules();
    mod = await import('../sns-media');
  });
  afterAll(() => {
    delete process.env.SNS_RENDER_PATH;
    delete process.env.SNS_MEDIA_PATH;
    fs.rmSync(dir, { recursive: true, force: true });
    vi.resetModules();
  });
  const company = '33333333-3333-4333-8333-333333333333';
  const touch = (abs: string, daysAgo: number) => {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'x');
    const t = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    fs.utimesSync(abs, t, t);
  };
  it('게시본 = 7일 지난 것만 지운다', () => {
    const oldF = path.join(dir, 'render', company, 'a-old.jpg');
    const newF = path.join(dir, 'render', company, 'a-new.jpg');
    touch(oldF, 8); touch(newF, 1);
    expect(mod.sweepSnsRenderFiles()).toBe(1);
    expect(fs.existsSync(oldF)).toBe(false);
    expect(fs.existsSync(newF)).toBe(true);
  });
  it('원본 = 90일 지났어도 행이 남으면(쓰이는 중) 남기고 · 고아 · 지운 행의 파일만 지운다 · 조회 실패 = 지우지 않는다', async () => {
    const used = path.join(dir, 'media', company, 'used.jpg');
    const orphan = path.join(dir, 'media', company, 'orphan.jpg');
    const fresh = path.join(dir, 'media', company, 'fresh.jpg');
    const broken = path.join(dir, 'media', company, 'broken.jpg');
    touch(used, 120); touch(orphan, 120); touch(fresh, 10); touch(broken, 120);
    const deleted: string[] = [];
    const db = {
      query: async (sql: string, params: any[] = []) => {
        if (String(params[1]).endsWith('broken.jpg')) throw new Error('db down');
        if (sql.startsWith('DELETE')) { deleted.push(String(params[1])); return { rows: [], rowCount: 0 }; }
        return { rows: String(params[1]).endsWith('used.jpg') ? [{ x: 1 }] : [] };
      },
    };
    expect(await mod.sweepSnsMediaFiles(db)).toBe(1);
    expect(fs.existsSync(used)).toBe(true);
    expect(fs.existsSync(orphan)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(broken)).toBe(true);
    expect(deleted).not.toContain(`${company}/fresh.jpg`);
  });
});
