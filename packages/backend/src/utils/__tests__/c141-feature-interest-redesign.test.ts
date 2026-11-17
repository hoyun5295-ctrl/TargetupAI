/**
 * C141 — 슈퍼관리자 「기능 관심 업체」 통합안 (★ 2026-11-17 · 설계 docs/2026-11-17-c141-feature-interest-redesign-design.md)
 *   Harold 「정신없다 · 무료체험이 누구인지도 모르겠다 · 칸도 벗어난다」 → 「통합안으로 구현 · 글씨는 작아도 되고 답답하지 않게」
 *
 * ① 7일 무료체험 목록(CT utils/line-trial.ts) — 기록자 머리 → 길 · 행 → 화면 꼴 · 표 없음 = null
 * ② 서버 집계(utils/feature-interest.ts) — 7일 체험을 업체 줄에 합친다 · 기능 줄의 누른 수 · 못 읽으면 「모름」
 * ③ 화면 판정(순수 · frontend utils/feature-interest-view.ts) — 단계 · 정렬 · 안내별 수 · 본 것 · 누른 것 · 일어난 일(기대값 = 손으로 적은 표)
 * ④ 소스 계약 — 탭(단계 칸 · 못 읽은 목록 · 거르기 · 폭) · 등록부 이름
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';

vi.mock('../../config/database', () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));
vi.mock('../plan-guard', () => ({
  loadPlanContext: vi.fn(async (id: string) => ({ planName: id === 'c-paid' ? '스타터' : id === 'c-a' ? '무료체험' : '무료' })),
  isActivePaidPlan: (ctx: any) => ctx?.planName === '스타터' || ctx?.planName === '무료체험',
}));

import { query } from '../../config/database';
import { loadFeatureInterest, parseFeatureInterestQuery, TRIAL_BUTTON_FEATURE_IDS } from '../feature-interest';
import { LINE_TRIAL_LIST_SQL, LINE_BANNER_GRANTOR, lineTrialSourceOf, loadLineTrials, trialFutureSql, trialDaysLeftSql } from '../line-trial';
import {
  normalizeInterest, inStage, stageRows, stageCounts, guideStats, sawGuide, seenParts, pressedParts, recentActivity, daysLeftText, lineTrialSourceText,
  FEATURE_GUIDE, STAGES, type InterestRowLike,
} from '../../../../frontend/src/utils/feature-interest-view';
import { LOGIN_POPUPS, LINE_TRIAL_BANNER_ID, STUDIO_TRIAL_POPUP_ID } from '../../../../frontend/src/constants/login-popups';

const mockQuery = query as unknown as ReturnType<typeof vi.fn>;
const back = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8').replace(/\r\n/g, '\n');
const FRONT = resolve(__dirname, '../../../../frontend/src');
const front = (rel: string) => readFileSync(join(FRONT, rel), 'utf8').replace(/\r\n/g, '\n');
const noComment = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

beforeEach(() => { mockQuery.mockReset(); });

describe('① 7일 무료체험 목록 — CT utils/line-trial.ts', () => {
  it('기록자 머리 → 길(배너 · 슈퍼관리자 부여 · 그 밖 = 진단 설문)', () => {
    expect(LINE_BANNER_GRANTOR).toBe('line-banner:');
    expect(lineTrialSourceOf('line-banner:6c78f52f-2c36-4a71-a714-c99e18eec2f5')).toBe('banner');
    expect(lineTrialSourceOf('admin:1b0c')).toBe('admin');
    expect(lineTrialSourceOf('diagnosis-auto')).toBe('diagnosis');
    expect(lineTrialSourceOf('')).toBe('diagnosis');
    expect(lineTrialSourceOf(null)).toBe('diagnosis');
    // 배너 시작 함수가 같은 머리로 적는다(두 벌 0)
    expect(back('utils/line-trial.ts')).toContain('grantedBy: `${LINE_BANNER_GRANTOR}${userId ?? \'unknown\'}`');
  });

  it('목록 문장 = 배너 판정과 같은 술어(만료 · 남은 날) · 켠 사람은 배너 지급만 계정과 잇는다', () => {
    expect(LINE_TRIAL_LIST_SQL).toContain(`${trialFutureSql('c')} AS trial_future`);
    expect(LINE_TRIAL_LIST_SQL).toContain(`${trialDaysLeftSql('c')} AS days_left`);
    expect(LINE_TRIAL_LIST_SQL).toContain("LEFT JOIN users u ON g.granted_by LIKE 'line-banner:%' AND u.id::text = substring(g.granted_by from 13)");
    expect(LINE_TRIAL_LIST_SQL).toContain('FROM diagnosis_trial_grants g');
  });

  it('행 → 화면 꼴 — 살아 있음 = 체험 요금제 + 만료 전 · 남은 날은 살아 있을 때만 · 끝나는 시각 = 살아 있으면 회사 · 끝났으면 지급 때', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [
      { company_id: 'c-a', granted_by: 'line-banner:u1', granted_at: new Date('2026-11-17T03:16:12Z'), grant_ends_at: new Date('2026-11-24T03:16:12Z'), company_ends_at: new Date('2026-11-24T03:16:12Z'), granted_by_name: '김담당', plan_code: 'TRIAL', trial_future: true, days_left: 7 },
      { company_id: 'c-b', granted_by: 'diagnosis-auto', granted_at: new Date('2026-11-01T00:00:00Z'), grant_ends_at: new Date('2026-11-08T00:00:00Z'), company_ends_at: null, granted_by_name: '', plan_code: 'FREE', trial_future: false, days_left: null },
      { company_id: 'c-c', granted_by: 'admin:s1', granted_at: new Date('2026-11-16T00:00:00Z'), grant_ends_at: new Date('2026-11-23T00:00:00Z'), company_ends_at: new Date('2026-11-23T00:00:00Z'), granted_by_name: '', plan_code: 'TRIAL', trial_future: true, days_left: 0 },
      // 체험 요금제인데 만료가 지남(강등 워커 전) = 끝남
      { company_id: 'c-d', granted_by: 'line-banner:u9', granted_at: new Date('2026-11-09T00:00:00Z'), grant_ends_at: new Date('2026-11-16T00:00:00Z'), company_ends_at: new Date('2026-11-16T00:00:00Z'), granted_by_name: '', plan_code: 'TRIAL', trial_future: false, days_left: -1 },
      // 체험 중에 유료로 바꿈 = 만료가 남아 있어도 체험이 아니다(남은 날 없음 · 끝나는 시각 = 지급 때)
      { company_id: 'c-e', granted_by: 'line-banner:u5', granted_at: new Date('2026-11-15T00:00:00Z'), grant_ends_at: new Date('2026-11-22T00:00:00Z'), company_ends_at: new Date('2026-11-20T00:00:00Z'), granted_by_name: '정사원', plan_code: 'BASIC', trial_future: true, days_left: 3 },
    ] });
    expect(await loadLineTrials()).toEqual([
      { companyId: 'c-a', source: 'banner', grantedAt: '2026-11-17T03:16:12.000Z', grantedBy: '김담당', alive: true, daysLeft: 7, endsAt: '2026-11-24T03:16:12.000Z' },
      { companyId: 'c-b', source: 'diagnosis', grantedAt: '2026-11-01T00:00:00.000Z', grantedBy: '', alive: false, daysLeft: null, endsAt: '2026-11-08T00:00:00.000Z' },
      { companyId: 'c-c', source: 'admin', grantedAt: '2026-11-16T00:00:00.000Z', grantedBy: '', alive: true, daysLeft: 0, endsAt: '2026-11-23T00:00:00.000Z' },
      { companyId: 'c-d', source: 'banner', grantedAt: '2026-11-09T00:00:00.000Z', grantedBy: '', alive: false, daysLeft: null, endsAt: '2026-11-16T00:00:00.000Z' },
      { companyId: 'c-e', source: 'banner', grantedAt: '2026-11-15T00:00:00.000Z', grantedBy: '정사원', alive: false, daysLeft: null, endsAt: '2026-11-22T00:00:00.000Z' },
    ]);
    expect(mockQuery.mock.calls[0][0]).toBe(LINE_TRIAL_LIST_SQL);
  });

  it('표가 없으면(42P01) null · 다른 오류는 그대로 던진다', async () => {
    mockQuery.mockRejectedValueOnce(Object.assign(new Error('no table'), { code: '42P01' }));
    expect(await loadLineTrials()).toBeNull();
    mockQuery.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: '57014' }));
    await expect(loadLineTrials()).rejects.toThrow('boom');
  });
});

describe('② 서버 집계 — 7일 체험을 업체 줄에 · 기능 줄의 누른 수', () => {
  const seen = [
    { action: 'plan_feature_open', created_at: '2026-11-17T01:00:00Z', feature_id: 'line-trial', company_id: 'c-a', user_name: '김담당', login_id: 'a1' },
    { action: 'plan_feature_go', created_at: '2026-11-17T03:16:12Z', feature_id: 'line-trial', company_id: 'c-a', user_name: '김담당', login_id: 'a1' },
    { action: 'plan_feature_open', created_at: '2026-11-16T01:00:00Z', feature_id: 'sns', company_id: 'c-paid', user_name: '박점장', login_id: 'p1' },
    { action: 'plan_feature_pricing', created_at: '2026-11-16T01:01:00Z', feature_id: 'sns', company_id: 'c-paid', user_name: '박점장', login_id: 'p1' },
  ];
  const NAMES: Record<string, string> = { 'c-a': '봄날 베이커리', 'c-paid': '표본카페', 'c-gone': '체험만 끝남', 'c-new': '방금 켬' };
  const LINE = [
    { company_id: 'c-a', granted_by: 'line-banner:a-user', granted_at: '2026-11-17T03:16:12Z', grant_ends_at: '2026-11-24T03:16:12Z', company_ends_at: '2026-11-24T03:16:12Z', granted_by_name: '김담당', plan_code: 'TRIAL', trial_future: true, days_left: 7 },
    { company_id: 'c-gone', granted_by: 'diagnosis-auto', granted_at: '2026-11-01T00:00:00Z', grant_ends_at: '2026-11-08T00:00:00Z', company_ends_at: null, granted_by_name: '', plan_code: 'FREE', trial_future: false, days_left: null },
    // 본 기록 없이 가장 최근에 켠 회사(관리자 부여) — 줄 순서 맨 위
    { company_id: 'c-new', granted_by: 'admin:s1', granted_at: '2026-11-18T00:00:00Z', grant_ends_at: '2026-11-25T00:00:00Z', company_ends_at: '2026-11-25T00:00:00Z', granted_by_name: '', plan_code: 'TRIAL', trial_future: true, days_left: 7 },
  ];
  function fakeDb(line: any = LINE) {
    mockQuery.mockImplementation(async (sql: string) => {
      const q = String(sql);
      if (q.includes('FROM diagnosis_trial_grants')) {
        if (typeof line === 'string') throw Object.assign(new Error(line), { code: line === 'no-table' ? '42P01' : '57014' });
        return { rows: line };
      }
      if (q.includes('FROM image_studio_trials') || q.includes('FROM user_intro_acks')) return { rows: [] };
      if (q.includes('GROUP BY 1, 2, 3')) {
        const m = new Map<string, any>();
        for (const r of seen) {
          const k = `${r.company_id}|${r.feature_id}|${r.action}`;
          const v = m.get(k) || { company_id: r.company_id, feature_id: r.feature_id, action: r.action, n: 0, last_at: r.created_at };
          v.n += 1;
          m.set(k, v);
        }
        return { rows: Array.from(m.values()) };
      }
      if (q.includes('SELECT DISTINCT')) return { rows: seen.map((r) => ({ company_id: r.company_id, login_id: r.login_id, user_name: r.user_name })) };
      if (q.includes('ROW_NUMBER()') && q.includes('AND al.action IN ($2, $3)')) return { rows: seen.filter((r) => r.action !== 'plan_feature_open') };
      if (q.includes('ROW_NUMBER()')) return { rows: seen };
      if (q.includes('FROM companies')) return { rows: Object.entries(NAMES).map(([id, company_name]) => ({ id, company_name })) };
      throw new Error('예상 밖 SQL: ' + q.slice(0, 60));
    });
  }
  const load = () => loadFeatureInterest(parseFeatureInterestQuery({ period: 'all' }));

  it('7일 체험이 업체 줄에 붙는다 · 본 기록이 없는 체험 회사도 줄이 된다 · 줄 순서에 켠 시각이 들어간다', async () => {
    fakeDb();
    const d = await load();
    expect(d.lineTrialsKnown).toBe(true);
    const by = new Map(d.companies.map((c) => [c.companyId, c]));
    expect(by.get('c-a')!.lineTrial).toEqual({ source: 'banner', grantedAt: '2026-11-17T03:16:12.000Z', grantedBy: '김담당', alive: true, daysLeft: 7, endsAt: '2026-11-24T03:16:12.000Z' });
    expect(by.get('c-gone')).toMatchObject({ seen: false, companyName: '체험만 끝남', features: [], lineTrial: { source: 'diagnosis', alive: false, daysLeft: null, endsAt: '2026-11-08T00:00:00.000Z' } });
    expect(by.get('c-paid')!.lineTrial).toBeNull();
    expect(d.companies.map((c) => c.companyId)).toEqual(['c-new', 'c-a', 'c-paid', 'c-gone']);
  });

  it('기능 줄 = 안내마다 본 수 + 누른 수(주 버튼 · 요금제 보기) · 총합은 그대로', async () => {
    fakeDb();
    const d = await load();
    const a = d.companies.find((c) => c.companyId === 'c-a')!;
    expect(a.features).toEqual([{ featureId: 'line-trial', opens: 1, clicks: 1 }]);
    expect({ go: a.goClicks, pricing: a.pricingClicks }).toEqual({ go: 1, pricing: 0 });
    const p = d.companies.find((c) => c.companyId === 'c-paid')!;
    expect(p.features).toEqual([{ featureId: 'sns', opens: 1, clicks: 1 }]);
    expect({ go: p.goClicks, pricing: p.pricingClicks }).toEqual({ go: 0, pricing: 1 });
    // 최근 누름 = 열람을 뺀 기록(최근 순)
    expect(a.recentClicks).toEqual([{ at: '2026-11-17T03:16:12.000Z', event: 'go', featureId: 'line-trial', userName: '김담당' }]);
    expect(p.recentClicks).toEqual([{ at: '2026-11-16T01:01:00.000Z', event: 'pricing', featureId: 'sns', userName: '박점장' }]);
  });

  it('7일 체험 목록을 못 읽어도(표 없음 · 다른 오류) 나머지는 그대로 · 그 목록은 「모름」', async () => {
    for (const kind of ['no-table', 'boom']) {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      fakeDb(kind);
      const d = await load();
      err.mockRestore();
      expect(d.lineTrialsKnown, kind).toBe(false);
      expect(d.companies.map((c) => c.companyId).sort(), kind).toEqual(['c-a', 'c-paid']);
      expect(d.companies.every((c) => c.lineTrial === null), kind).toBe(true);
    }
  });
});

describe('③ 화면 판정(순수) — 단계 · 안내 · 본 것 · 일어난 일', () => {
  const base = (id: string, o: Partial<InterestRowLike>): InterestRowLike => ({
    companyId: id, companyName: `회사${id}`, seen: true, lastAt: '2026-11-17T00:00:00.000Z', pricingClicks: 0, goClicks: 0,
    features: [], trial: null, lineTrial: null, dismissed: [], events: [], recentClicks: [], ...o,
  });
  const LT = (o: Partial<NonNullable<InterestRowLike['lineTrial']>>) => ({ source: 'banner' as const, grantedAt: '2026-11-15T00:00:00.000Z', grantedBy: '김담당', alive: true, daysLeft: 3, endsAt: null, ...o });
  const ROWS = [
    base('A', { lineTrial: LT({ daysLeft: 2, grantedAt: '2026-11-15T00:00:00.000Z' }), goClicks: 1, features: [{ featureId: 'line-trial', opens: 2, clicks: 1 }],
      recentClicks: [{ at: '2026-11-15T00:02:00.000Z', event: 'go', featureId: 'line-trial', userName: '김담당' }] }),   // 켠 무렵의 누름 = 켬 한 줄로
    base('B', { lineTrial: LT({ source: 'diagnosis', grantedBy: '', daysLeft: 0, grantedAt: '2026-11-10T00:00:00.000Z' }), trial: { requestedBy: '이대리', requestedAt: '2026-11-15T00:00:00.000Z', used: 1, granted: 3 },
      features: [{ featureId: 'login-promo', opens: 4, clicks: 0 }] }),
    base('C', { trial: { requestedBy: '최과장', requestedAt: '2026-11-16T00:00:00.000Z', used: 0, granted: 3 }, goClicks: 1, features: [{ featureId: 'studio-trial', opens: 1, clicks: 1 }],
      recentClicks: [{ at: '2026-11-15T23:55:00.000Z', event: 'go', featureId: 'studio-trial', userName: '최과장' }] }),   // 신청 무렵의 누름 = 신청 한 줄로
    base('D', { lineTrial: LT({ alive: false, daysLeft: null, endsAt: '2026-11-08T00:00:00.000Z', grantedAt: '2026-11-01T00:00:00.000Z', source: 'admin', grantedBy: '' }), pricingClicks: 1,
      features: [{ featureId: 'sns', opens: 2, clicks: 1 }], recentClicks: [{ at: '2026-11-17T02:00:00.000Z', event: 'pricing', featureId: 'sns', userName: '박점장' }] }),
    base('E', { goClicks: 2, features: [{ featureId: 'login-promo', opens: 5, clicks: 2 }], recentClicks: [{ at: '2026-11-17T01:00:00.000Z', event: 'go', featureId: 'login-promo', userName: '정사원' }] }),
    base('F', { features: [{ featureId: 'login-promo', opens: 1, clicks: 0 }, { featureId: 'sns', opens: 1, clicks: 0 }, { featureId: 'journeys', opens: 2, clicks: 0 }, { featureId: 'auto', opens: 1, clicks: 0 }] }),
    base('G', { seen: false, lastAt: '1970-01-01T00:00:00.000Z', dismissed: [{ introKey: 'v3-scenes', at: '2026-11-16T05:00:00.000Z', userName: '', loginId: 'g1' }, { introKey: 'v3-intro', at: '2026-11-12T00:00:00.000Z', userName: '', loginId: 'g2' }] }),
  ];
  const TITLE: Record<string, string> = { sns: 'SNS 콘텐츠', journeys: '여정', auto: '자동 마케팅' };
  const titleOf = (id: string) => TITLE[id] || id;
  const ids = (rows: InterestRowLike[]) => rows.map((r) => r.companyId);

  it('단계 넷 — 체험 둘은 겹칠 수 있다 · 버튼만 누름 · 보기만 함은 체험이 아닌 회사를 나눈다 · 끝난 7일 체험은 체험 칸이 아니다', () => {
    expect(STAGES.map((s) => s.key)).toEqual(['line', 'studio', 'pressed', 'seen']);
    expect(STAGES.map((s) => s.name)).toEqual(['7일 무료체험 중', '이미지 체험 신청', '버튼만 누름', '보기만 함']);
    expect(ROWS.filter((c) => inStage(c, 'line')).map((c) => c.companyId)).toEqual(['A', 'B']);
    expect(ROWS.filter((c) => inStage(c, 'studio')).map((c) => c.companyId)).toEqual(['B', 'C']);
    expect(ROWS.filter((c) => inStage(c, 'pressed')).map((c) => c.companyId)).toEqual(['D', 'E']);
    expect(ROWS.filter((c) => inStage(c, 'seen')).map((c) => c.companyId)).toEqual(['F', 'G']);
    expect(stageCounts(ROWS)).toEqual({ line: 2, studio: 2, pressed: 2, seen: 2 });
    // 체험이 아닌 회사는 정확히 한 칸(버튼만 누름 또는 보기만 함)
    for (const c of ROWS.filter((r) => !inStage(r, 'line') && !inStage(r, 'studio'))) expect([inStage(c, 'pressed'), inStage(c, 'seen')].filter(Boolean)).toHaveLength(1);
  });

  it('정렬 — 7일 체험 = 남은 날 적은 순 · 이미지 체험 = 최근 신청 순 · 그 밖 = 받은 순서 · 원래 배열은 그대로', () => {
    expect(ids(stageRows(ROWS, 'line'))).toEqual(['B', 'A']);
    expect(ids(stageRows(ROWS, 'studio'))).toEqual(['C', 'B']);
    expect(ids(stageRows(ROWS, 'pressed'))).toEqual(['D', 'E']);
    expect(ids(ROWS)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
    // 남은 날이 같으면 최근에 켠 회사가 먼저
    const tie = [base('X', { lineTrial: LT({ daysLeft: 3, grantedAt: '2026-11-10T00:00:00.000Z' }) }), base('Y', { lineTrial: LT({ daysLeft: 3, grantedAt: '2026-11-12T00:00:00.000Z' }) })];
    expect(ids(stageRows(tie, 'line'))).toEqual(['Y', 'X']);
  });

  it('안내별 — 등록부 차례 + 기능 안내 창 · 본 회사 → 누른 회사 → 결과(체험 둘만)', () => {
    expect(guideStats(ROWS)).toEqual([
      { key: 'line-trial', name: '7일 무료체험 배너', seen: 1, pressed: 1, pressLabel: '7일 무료로 써 보기', result: { label: '체험 중', n: 1, unit: '곳' } },   // B 는 진단으로 켜서 배너 결과가 아니다
      { key: 'studio-trial', name: '이미지 체험 안내', seen: 1, pressed: 1, pressLabel: '체험 신청', result: { label: '써 봄', n: 1, unit: '곳' } },
      { key: 'login-promo', name: '로그인 안내 창', seen: 3, pressed: 1, pressLabel: '바로가기', result: null },
      { key: FEATURE_GUIDE, name: '기능 안내 창', seen: 2, pressed: 1, pressLabel: '요금제 보기', result: null },
    ]);
    expect(sawGuide(ROWS[5], FEATURE_GUIDE)).toBe(true);
    expect(sawGuide(ROWS[6], 'login-promo')).toBe(false);
    // 본 기록이 없는 누름(기간 경계)도 그 안내를 본 회사로 센다
    expect(sawGuide(base('Z', { features: [{ featureId: 'sns', opens: 0, clicks: 1 }] }), FEATURE_GUIDE)).toBe(true);
  });

  it('본 것 한 줄 — 등록부 차례 · 기능 안내 창은 합쳐 세고 기능 이름 둘까지', () => {
    expect(seenParts(ROWS[5], titleOf)).toEqual(['로그인 안내 창 1번', '기능 안내 창 4번(SNS 콘텐츠, 여정 외 1)']);
    expect(seenParts(base('Q', { features: [{ featureId: 'login-promo', opens: 2, clicks: 0 }, { featureId: 'studio-trial', opens: 1, clicks: 0 }] }), titleOf)).toEqual(['이미지 체험 안내 1번', '로그인 안내 창 2번']);
    expect(seenParts(ROWS[6], titleOf)).toEqual([]);
    expect(seenParts(base('R', { features: [{ featureId: 'sns', opens: 0, clicks: 1 }] }), titleOf)).toEqual([]);   // 누르기만 한 안내는 「본 것」에 없다
  });

  it('누른 것 한 줄 — 등록부 창은 그 창의 주 버튼 이름 · 기능 안내 창은 요금제 보기', () => {
    expect(pressedParts(ROWS[3], titleOf)).toEqual(['SNS 콘텐츠 안내 창에서 요금제 보기 1번']);
    expect(pressedParts(ROWS[4], titleOf)).toEqual(['로그인 안내 창에서 바로가기 2번']);
    expect(pressedParts(ROWS[0], titleOf)).toEqual(['7일 무료체험 배너에서 7일 무료로 써 보기 1번']);
  });

  it('최근 일어난 일 — 켬 · 신청 · 누름 · 다시 보지 않기 · 최근 순 · 본 것과 두 체험 안내의 누름은 겹쳐 적지 않는다', () => {
    expect(recentActivity(ROWS, titleOf, 20).map((a) => [a.at, a.companyId, a.text, a.accent])).toEqual([
      ['2026-11-17T02:00:00.000Z', 'D', 'SNS 콘텐츠 안내 창에서 요금제 보기', false],
      ['2026-11-17T01:00:00.000Z', 'E', '로그인 안내 창에서 바로가기', false],
      ['2026-11-16T05:00:00.000Z', 'G', '로그인 안내 창 다시 보지 않기', false],   // 같은 창의 판 열쇠 둘 = 한 줄 · 가장 최근 시각
      ['2026-11-16T00:00:00.000Z', 'C', '이미지 체험 신청', false],
      ['2026-11-15T00:00:00.000Z', 'A', '배너로 7일 무료체험 켬', true],
      ['2026-11-15T00:00:00.000Z', 'B', '이미지 체험 신청', false],
      ['2026-11-10T00:00:00.000Z', 'B', '진단 설문으로 7일 무료체험 켬', true],
      ['2026-11-01T00:00:00.000Z', 'D', '슈퍼관리자 부여로 7일 무료체험 켬', true],
    ]);
    expect(recentActivity(ROWS, titleOf)).toHaveLength(6);
    expect(recentActivity([], titleOf)).toEqual([]);
  });

  it('★ Codex 구현 1R · 2R — 체험 단추 누름은 그 회사에 결과가 있을 때만 결과 한 줄로 대신한다 · 결과가 없거나 목록을 못 읽었으면 누름이 남는다', () => {
    const go = (at: string, featureId: string) => ({ at, event: 'go' as const, featureId, userName: '김담당' });
    // 7일 체험 목록을 못 읽음 · 받은 적 없음(lineTrial null) = 누름이 남는다(여러 번 = 여러 줄)
    expect(recentActivity([base('U', { recentClicks: [go('2026-11-17T03:00:00.000Z', 'line-trial'), go('2026-11-17T02:00:00.000Z', 'line-trial')] })], titleOf).map((a) => a.text))
      .toEqual(['7일 무료체험 배너에서 7일 무료로 써 보기', '7일 무료체험 배너에서 7일 무료로 써 보기']);
    // 결과가 있으면 시각과 무관하게 결과 한 줄(그 단추는 결과 뒤 다시 뜨지 않는다)
    expect(recentActivity([base('V', { lineTrial: LT({ grantedAt: '2026-11-10T00:00:00.000Z' }), recentClicks: [go('2026-11-09T23:00:00.000Z', 'line-trial'), go('2026-11-10T00:00:00.000Z', 'line-trial')] })], titleOf).map((a) => a.text))
      .toEqual(['배너로 7일 무료체험 켬']);
    expect(recentActivity([base('W', { trial: { requestedBy: '', requestedAt: '2026-11-16T00:00:00.000Z', used: 0, granted: 3 }, recentClicks: [go('2026-11-15T23:00:00.000Z', 'studio-trial')] })], titleOf).map((a) => a.text))
      .toEqual(['이미지 체험 신청']);
    expect(recentActivity([base('X', { recentClicks: [go('2026-11-16T00:00:00.000Z', 'studio-trial')] })], titleOf).map((a) => a.text))
      .toEqual(['이미지 체험 안내에서 체험 신청']);
    // 다른 체험의 결과는 이 단추 누름을 가리지 않는다(7일 체험이 있어도 이미지 체험 단추 누름은 남는다)
    expect(recentActivity([base('Z', { lineTrial: LT({ grantedAt: '2026-11-10T00:00:00.000Z' }), recentClicks: [go('2026-11-11T00:00:00.000Z', 'studio-trial')] })], titleOf).map((a) => a.text))
      .toEqual(['이미지 체험 안내에서 체험 신청', '배너로 7일 무료체험 켬']);
    // 누름의 원천은 recentClicks 하나(상세 기록 events 의 누름은 쓰지 않는다 = 30건 상한에 밀리지 않는다)
    expect(recentActivity([base('Y', { events: [go('2026-11-17T00:00:00.000Z', 'login-promo')] })], titleOf)).toEqual([]);
  });

  it('남은 날 · 켠 길 문구', () => {
    expect([daysLeftText(0), daysLeftText(1), daysLeftText(7), daysLeftText(null), daysLeftText(-1)]).toEqual(['오늘까지', '1일 남음', '7일 남음', '', '']);
    expect(lineTrialSourceText(LT({}))).toBe('배너, 김담당');
    expect(lineTrialSourceText(LT({ grantedBy: '' }))).toBe('배너, 이름 없음');
    expect(lineTrialSourceText(LT({ source: 'diagnosis' }))).toBe('진단 설문');
    expect(lineTrialSourceText(LT({ source: 'admin' }))).toBe('슈퍼관리자 부여');
  });

  it('받는 자리 — 최근 누름은 누름(go · pricing)만 남긴다', () => {
    const d = normalizeInterest<InterestRowLike>({ companies: [{ companyId: 'n', companyName: '새', recentClicks: [{ at: 'x', event: 'open', featureId: 'sns', userName: '' }, { at: 'y', event: 'pricing', featureId: 'sns', userName: '' }, null, 3] }] });
    expect(d.companies[0].recentClicks).toEqual([{ at: 'y', event: 'pricing', featureId: 'sns', userName: '' }]);
  });

  it('받는 자리 — 옛 서버 답(체험 · 숨김 칸 · 누른 수 없음)도 판정 함수가 터지지 않는다 · 단계는 보기만 함', () => {
    const d = normalizeInterest<InterestRowLike>({ companies: [{ companyId: 'o', companyName: '옛', features: [{ featureId: 'login-promo', opens: 1 }], users: [], events: [], pricingClicks: 0, goClicks: 0 }] });
    expect(stageCounts(d.companies)).toEqual({ line: 0, studio: 0, pressed: 0, seen: 1 });
    expect(guideStats(d.companies).find((g) => g.key === 'login-promo')).toMatchObject({ seen: 1, pressed: 0 });
    expect(seenParts(d.companies[0], titleOf)).toEqual(['로그인 안내 창 1번']);
    expect(recentActivity(d.companies, titleOf)).toEqual([]);
  });
});

describe('④ 소스 계약 — 탭 · 등록부', () => {
  const tab = front('components/admin/FeatureInterestTab.tsx');
  const code = noComment(tab);

  it('★ Codex 구현 2R · 3R — 서버의 최근 누름 = 체험 단추마다 · 그 밖을 회사마다 화면 건수만큼 따로 · 체험 단추 id = 화면 등록부', () => {
    const fi = back('utils/feature-interest.ts');
    expect(TRIAL_BUTTON_FEATURE_IDS).toEqual([LINE_TRIAL_BANNER_ID, STUDIO_TRIAL_POPUP_ID]);
    // 상한 = 화면 「최근 일어난 일」 건수(한 묶음이 그보다 많이 들어갈 수 없어 전체 최근 여섯이 빠지지 않는다)
    expect(fi).toContain('const CLICKS_PER_COMPANY = 6;');
    expect(tab).toContain('const activity = useMemo(() => recentActivity(all, featureName, 6), [all, intros]);');
    // 묶음 = 체험 단추마다 · 그 밖(한 묶음 안의 누름은 화면에서 다 보이거나 다 가려진다 · Codex 구현 3R)
    expect(fi).toContain("ROW_NUMBER() OVER (PARTITION BY ${companyExpr}${onlyClicks ? \", CASE WHEN al.action = $3 AND al.details->>'featureId' = ANY($4::text[]) THEN al.details->>'featureId' ELSE '' END\" : ''} ORDER BY al.created_at DESC) AS rn");
    expect(fi).toContain('query(recentSql(CLICKS_PER_COMPANY, true), [...params, [...TRIAL_BUTTON_FEATURE_IDS]]),');
  });

  it('등록부 = 체험 둘의 이름을 가른다 · 차례 = 안내별 칸의 차례', () => {
    expect(LOGIN_POPUPS.map((p) => [p.id, p.name, p.goLabel])).toEqual([
      ['line-trial', '7일 무료체험 배너', '7일 무료로 써 보기'],
      ['studio-trial', '이미지 체험 안내', '체험 신청'],
      ['login-promo', '로그인 안내 창', '바로가기'],
    ]);
    // 이 이름은 슈퍼관리자 화면에만 쓰인다 — 고객 화면 파일에 이 이름 글자 0
    for (const f of ['components/dashboard/LineTrialBanner.tsx', 'components/v3/StudioTrialPromo.tsx', 'components/AiOperatorLoginPromo.tsx']) {
      expect(noComment(front(f)), f).not.toMatch(/7일 무료체험 배너|이미지 체험 안내/);
    }
  });

  it('서버에는 기간 · 회사만 보낸다 · 받는 자리에서 한 번 정규화 · 단계 · 안내 · 다시 보지 않기는 받아 둔 줄을 화면에서 거른다', () => {
    expect(tab).toContain('const params = new URLSearchParams({ period, plan });');
    expect(tab).toContain('}, [period, plan]);');
    expect(tab).toContain('setData(normalizeInterest<CompanyRow>(d));');
    expect(tab).toContain('const inStageRows = useMemo(() => stageRows(all, stage).filter((c) => !guide || sawGuide(c, guide)), [all, stage, guide]);');
    expect(tab).toContain('const rows = useMemo(() => (dismissedOnly ? inStageRows.filter((c) => c.dismissed.length > 0) : inStageRows), [inStageRows, dismissedOnly]);');
    expect(tab).toContain('const counts = useMemo(() => stageCounts(all), [all]);');
    expect(tab).toContain('const guides = useMemo(() => guideStats(all), [all]);');
    expect(tab).toContain('const activity = useMemo(() => recentActivity(all, featureName, 6), [all, intros]);');
    // 거르기를 바꾸면 1쪽으로
    expect(tab).toContain('const pick = (k: InterestStage) => { setStage(k); setPage(1); };');
    expect(tab.match(/setPage\(1\); \}\}/g)!.length).toBeGreaterThanOrEqual(3);
    for (const gone of ['visibleInterestRows', 'featureCounts', "params.set('featureId'", 'data.summary', 'data?.summary']) expect(code, gone).not.toContain(gone);
  });

  it('못 읽은 목록 — 단계 칸의 수는 「?」 · 그 단계를 고르면 수 · 회사를 그리지 않고 안내 하나만(갈림 한 곳)', () => {
    // 버튼만 누름 · 보기만 함 = 체험이 아닌 회사 → 체험 목록 둘을 다 읽었을 때만(못 읽으면 체험 회사가 섞여 보인다 · 화면 확인에서 찾음)
    expect(tab).toContain("const stageKnown = (k: InterestStage) => !data || (k === 'line' ? data.lineTrialsKnown : k === 'studio' ? data.trialsKnown : data.lineTrialsKnown && data.trialsKnown);");
    // 수를 모르면 단위(곳)도 붙이지 않는다
    expect(tab).toContain("{data && known && <span className=\"ml-0.5 text-[13px] font-semibold text-gray-500\">곳</span>}");
    expect(tab).toContain('const listUnknown = !!data && (!stageKnown(stage) || (dismissedOnly && !data.dismissalsKnown));');
    expect(tab).toContain("{!data ? '-' : known ? counts[s.key].toLocaleString() : '?'}");
    expect(code.match(/listUnknown \? \(/g)).toHaveLength(1);
    const split = tab.indexOf('{listUnknown ? (');
    const known = tab.indexOf(') : (<>', split);
    const close = tab.indexOf('</>)}', known);
    expect(tab.slice(split, known)).toContain('이 목록을 읽지 못했습니다');
    for (const drawn of ['{pageSlice(rows, page).map((c) => (', '<ListPager', '이 조건에 맞는 회사가 없습니다']) {
      const at = tab.indexOf(drawn);
      expect(at, drawn).toBeGreaterThan(known);
      expect(at, drawn).toBeLessThan(close);
      expect(tab.indexOf(drawn, at + 1), drawn).toBe(-1);
    }
    // 다시 보지 않기 기록은 그 목록을 읽었을 때만 줄 · 단추 수에 쓴다(못 읽은 것을 「없음」 · 0 으로 보이게 하지 않는다)
    expect(tab).toContain("다시 보지 않기 누른 회사만 <b className=\"tabular-nums\">{!data ? '-' : data.dismissalsKnown ? dismissedInStage : '?'}</b>");
    expect(tab).toContain('    if (data?.dismissalsKnown) {');
    expect(tab).toContain("{!data ? '-' : (g.key === LINE_TRIAL_BANNER_ID ? data.lineTrialsKnown : data.trialsKnown) ? `${g.result.n}${g.result.unit}` : '?'}");
  });

  it('「없음」을 줄마다 되풀이하지 않는다 · 강조색은 주황 하나 · 보라 · 하늘색 0', () => {
    expect(code).not.toMatch(/'없음'|>없음</);
    expect(code).not.toMatch(/\b(violet|purple|fuchsia|indigo|cyan)-\d/);
    expect(tab).toContain("const ACC = 'text-[#A8380B]';");
  });

  it('줄표 · 모델명 · native dialog 0 · 판정 파일도', () => {
    for (const f of ['components/admin/FeatureInterestTab.tsx', 'utils/feature-interest-view.ts', 'constants/login-popups.ts']) {
      const src = noComment(front(f));
      expect(src, f).not.toContain('—');
      expect(src, f).not.toMatch(/Opus|Sonnet|Haiku|GPT|Claude|Anthropic|claude-/);
      expect(src, f).not.toMatch(/\b(alert|confirm|prompt)\(/);
    }
  });
});
