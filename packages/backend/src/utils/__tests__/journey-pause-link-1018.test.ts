/**
 * ★ 2026-10-18 여정 정지 링크 결함 정정(설계서 docs/2026-10-18-planner-v2-design.md §3-1)
 *
 * 고정하는 것
 *   ① 서명 키 기본값 없음 — 미설정이면 발급 throw · 검증 null · 서명이 한 글자라도 다르면 null
 *   ② 주소 = HANJUL_BASE_URL + /journey-pause#t= (경로 토큰 · 단축 주소 변수 아님)
 *   ③ [이 발송 정지] = 그 여정 · 그 단계 · 그날 active 실행을 잠그고(FOR UPDATE) 전부 멈춘다 · 기록 1행에 멈춘 수 · 받은 번호
 *   ④ 이미 보내기 시작한 건수를 사실대로 돌려준다
 *   ⑤ 공개 API 는 /api/journey-pause 아래 · 토큰은 헤더 · 옛 루트 마운트 없음 · 화면은 헤더로 부른다 · 번호 입력칸 없음
 *   ⑥ 안내 문자 — 키가 없으면 링크 줄만 빼고 보낸다 · 자동 보정은 알림 설정과 무관하게 알린다
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const clientQuery = vi.fn();
const release = vi.fn();
vi.mock('../../config/database', () => ({
  pool: { connect: vi.fn(async () => ({ query: clientQuery, release })) },
  query: vi.fn(async () => ({ rows: [] })),
}));

import { query } from '../../config/database';
import {
  generatePauseToken, verifyPauseToken, buildJourneyPauseUrl, pauseStepForDay,
} from '../journey-pause-handler';
import { buildPretestLmsBody } from '../journey-pretest-notifier';

const qmock = query as unknown as ReturnType<typeof vi.fn>;
const SRC = join(__dirname, '..', '..');
const FE = join(SRC, '..', '..', 'frontend', 'src');
const src = (p: string) => readFileSync(join(SRC, p), 'utf8');
const fe = (p: string) => readFileSync(join(FE, p), 'utf8');

const BASE = { stepId: '11111111-1111-1111-1111-111111111111', executionId: '22222222-2222-2222-2222-222222222222', companyId: '33333333-3333-3333-3333-333333333333', journeyId: '44444444-4444-4444-4444-444444444444' };

describe('여정 정지 토큰 · 주소', () => {
  const prev = process.env.JOURNEY_PAUSE_TOKEN_SECRET;
  afterEach(() => { process.env.JOURNEY_PAUSE_TOKEN_SECRET = prev; });

  it('① 키가 없으면 발급은 던지고 검증은 null', async () => {
    delete process.env.JOURNEY_PAUSE_TOKEN_SECRET;
    await expect(generatePauseToken(BASE)).rejects.toThrow(/미설정/);
    process.env.JOURNEY_PAUSE_TOKEN_SECRET = 'k1';
    const t = await generatePauseToken(BASE);
    delete process.env.JOURNEY_PAUSE_TOKEN_SECRET;
    expect(await verifyPauseToken(t)).toBeNull();
    // 옛 기본값으로 서명한 토큰도 통하지 않는다
    process.env.JOURNEY_PAUSE_TOKEN_SECRET = 'd218_pause_default_secret';
    const forged = await generatePauseToken(BASE);
    process.env.JOURNEY_PAUSE_TOKEN_SECRET = 'real-secret';
    expect(await verifyPauseToken(forged)).toBeNull();
  });

  it('① 받은 번호 · 발송 날짜가 실리고 서명이 다르면 null', async () => {
    process.env.JOURNEY_PAUSE_TOKEN_SECRET = 'k1';
    const t = await generatePauseToken({ ...BASE, phone: '010-1234-5678', sendDate: '2026-10-20' });
    const p = await verifyPauseToken(t);
    expect(p).toMatchObject({ step_id: BASE.stepId, phone: '01012345678', send_date: '2026-10-20' });
    const [body, sig] = t.split('.');
    const bad = `${body}.${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`;
    expect(await verifyPauseToken(bad)).toBeNull();
    expect(await verifyPauseToken(`${body}.`)).toBeNull();
  });

  it('② 주소 = HANJUL_BASE_URL/journey-pause#t=', () => {
    const prevBase = process.env.HANJUL_BASE_URL;
    process.env.HANJUL_BASE_URL = 'https://hanjul.ai/';
    expect(buildJourneyPauseUrl('abc.def')).toBe('https://hanjul.ai/journey-pause#t=abc.def');
    process.env.HANJUL_BASE_URL = prevBase;
    expect(src('utils/journey-pretest-notifier.ts')).not.toMatch(/SHORT_URL_BASE/);
    expect(src('utils/journey-pretest-notifier.ts')).not.toMatch(/journey-pause\/\$\{/);
  });
});

describe('③④ [이 발송 정지] = 그날 대상 전부', () => {
  beforeEach(() => {
    process.env.JOURNEY_PAUSE_TOKEN_SECRET = 'k1';
    clientQuery.mockReset();
    release.mockReset();
    qmock.mockReset();
  });

  it('잠그고 전부 멈춘 뒤 기록 1행 · 이미 시작한 수를 센다', async () => {
    const t = await generatePauseToken({ ...BASE, phone: '01099998888', sendDate: '2026-10-20' });
    clientQuery.mockImplementation(async (sql: string) => {
      if (/FROM journeys WHERE id/.test(sql)) return { rows: [{ '?column?': 1 }] };
      if (/FOR UPDATE OF je/.test(sql)) return { rows: [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }] };
      if (/UPDATE journey_executions SET status = 'ended'/.test(sql)) return { rows: [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }] };
      if (/journey_step_snapshots/.test(sql)) return { rows: [{ id: 'snap', message_body: '본문' }] };
      return { rows: [] };
    });
    qmock.mockImplementation(async (sql: string) => {
      if (/journey_step_logs/.test(sql)) return { rows: [{ n: 4 }] };
      return { rows: [] };
    });
    const r = await pauseStepForDay(t);
    expect(r).toEqual({ ok: true, paused: 3, startedCount: 4, sendDate: '2026-10-20' });
    const sqls = clientQuery.mock.calls.map((c) => String(c[0]));
    const lockIdx = sqls.findIndex((s) => /FOR UPDATE OF je/.test(s));
    const updIdx = sqls.findIndex((s) => /SET status = 'ended', completed_at = NOW\(\)/.test(s));
    expect(sqls.some((s) => /UPDATE journey_executions SET status = 'paused'/.test(s))).toBe(false);
    expect(lockIdx).toBeGreaterThan(-1);
    expect(updIdx).toBeGreaterThan(lockIdx);
    // 그 단계 · 그날 · active 조건이 잠금 조회에 있다
    const lockSql = sqls[lockIdx];
    expect(lockSql).toMatch(/je\.status = 'active'/);
    expect(lockSql).toMatch(/AT TIME ZONE 'Asia\/Seoul'\)::date = \$3::date/);
    expect(clientQuery.mock.calls[lockIdx][1]).toEqual([BASE.journeyId, BASE.stepId, '2026-10-20']);
    expect(clientQuery.mock.calls[updIdx][1]).toEqual([['e1', 'e2', 'e3']]);
    const ins = clientQuery.mock.calls.find((c) => /INSERT INTO journey_step_pause_logs/.test(String(c[0])));
    expect(ins![1][7]).toBe('01099998888'); // paused_phone = 토큰의 받은 번호
    expect(ins![1][9]).toBe(3);              // target_count_snapshot = 멈춘 수
    expect(sqls).toContain('COMMIT');
  });

  it('무효 토큰은 아무것도 바꾸지 않는다', async () => {
    const r = await pauseStepForDay('not-a-token');
    expect(r).toEqual({ ok: false, error: 'token_invalid_or_expired' });
    expect(clientQuery).not.toHaveBeenCalled();
  });
});

describe('⑤ 공개 API · 화면', () => {
  it('라우트는 /api/journey-pause 아래 · 헤더 토큰 · 옛 루트 마운트 없음', () => {
    const app = src('app.ts');
    expect(app).toMatch(/app\.use\('\/api\/journey-pause', journeyPausePublicRouter\)/);
    expect(app).not.toMatch(/app\.use\('\/', journeyPausePublicRouter\)/);
    expect(app).toMatch(/app\.use\('\/api\/journey-pause', rateLimit/);
    const route = src('routes/journey-pause-public.ts');
    expect(route).toMatch(/JOURNEY_PAUSE_TOKEN_HEADER/);
    expect(route).not.toMatch(/req\.params\.token/);
    expect(route).not.toMatch(/paused_phone/);
  });

  it('화면은 헤더로 부르고 번호 입력칸 · 내부 식별자가 없다', () => {
    const page = fe('pages/JourneyPausePage.tsx');
    expect(page).toMatch(/'X-Journey-Pause-Token': token/);
    expect(page).toMatch(/\/api\/journey-pause\/info/);
    expect(page).not.toMatch(/fetch\(`\/journey-pause\//);
    expect(page).not.toMatch(/paused_phone|type="tel"/);
    expect(page).not.toMatch(/CT-94|journey_step_pause_logs|execution/);
    expect(page).toMatch(/LinkConfirmSheet/);
  });
});

describe('⑥ 안내 문자', () => {
  it('링크가 없으면 링크 줄만 빠진다', () => {
    const at = new Date('2026-10-20T01:00:00Z');
    const withLink = buildPretestLmsBody({ journeyName: '여정', stepOrder: 2, scheduledSendAt: at, messagePreview: '미리', pauseUrl: 'https://hanjul.ai/journey-pause#t=x', mode: 'pretest_pass' });
    expect(withLink).toContain('즉시 정지: https://hanjul.ai/journey-pause#t=x');
    const noLink = buildPretestLmsBody({ journeyName: '여정', stepOrder: 2, scheduledSendAt: at, messagePreview: '미리', pauseUrl: null, mode: 'pretest_paused' });
    expect(noLink).toContain('[발송 정지 안내]');
    expect(noLink).not.toMatch(/https?:\/\//);
  });

  it('자동 보정은 단계 알림 설정과 무관하게 알린다 · 발급 실패는 삼키고 안내를 보낸다', () => {
    const n = src('utils/journey-pretest-notifier.ts');
    expect(n).not.toMatch(/if \(b\.notifyManager\) await safeNotify\(b, regenBody, 'pretest_autofixed'\)/);
    expect(n).toMatch(/await safeNotify\(b, regenBody, 'pretest_autofixed'\)/);
    expect(n).toMatch(/정지 링크 발급 실패\(링크 없이 안내\)/);
  });
});
