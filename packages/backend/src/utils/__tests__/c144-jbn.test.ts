/**
 * C144 — JBN 특별가(★ 2026-11-18 · 설계서 docs/2026-11-18-c144-jbn-special-price-design.md §6)
 *   ① 신청 정규화(필수 칸 · 번호 · 동의 · 길이 · 관심 요금제 허용 목록 · id)
 *   ② 단계 · 상태 이동 허용표 · 찾기(순수)
 *   ③ 소스 계약 — 공개 목록 셋이 거름 조각을 쓴다 · 관리자 대시보드는 관리자 요금제 목록 · 관리자 주소 넷이 관문 ·
 *      공개 라우터는 전역 파서 뒤 · 공개 화면 글에 가운뎃점 · 줄표 · 모델명 0 · 검색 제외 meta · 병합 축 · 감사 기록에 개인정보 0
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';

vi.mock('../../config/database', () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));

import {
  parseJbnApplication, canMoveJbnStatus, jbnStageOf, matchesJbnSearch, parseJbnOverviewQuery, isUuid,
  type JbnApplicationRow,
} from '../jbn';
import { PUBLIC_CATALOG_PLAN_SQL } from '../plan-guard';
import { DIAGNOSIS_PLAN_ROWS_SQL } from '../marketing-diagnosis-store';
import { COMPANY_MERGE_AXES } from '../company-merge';

const back = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8').replace(/\r\n/g, '\n');
const FRONT = resolve(__dirname, '../../../../frontend/src');
const front = (rel: string) => readFileSync(join(FRONT, rel), 'utf8').replace(/\r\n/g, '\n');

const ID = '3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b';
const ok = { id: ID, companyName: ' 한줄상사 ', ownerName: '홍길동', nickname: '한줄상사 홍길동', phone: '010-0000-0144', consultMethod: 'visit', memo: '문의', interestPlanCode: 'BASIC', consent: true };
const ALLOWED = ['STARTER', 'BASIC', 'PRO'];

describe('① 신청 정규화 — parseJbnApplication', () => {
  it('맞는 신청 = 다듬은 값 · 번호는 숫자만 · id 소문자', () => {
    const r = parseJbnApplication({ ...ok, id: ID.toUpperCase() }, ALLOWED);
    expect(r).toEqual({ ok: true, value: { id: ID, companyName: '한줄상사', ownerName: '홍길동', nickname: '한줄상사 홍길동', phone: '01000000144', interestPlanCode: 'BASIC', consultMethod: 'visit', memo: '문의' } });
  });
  it('필수 칸 · 번호 · 동의 · id', () => {
    expect(parseJbnApplication({ ...ok, id: 'x' }, ALLOWED)).toMatchObject({ ok: false });
    expect(parseJbnApplication({ ...ok, companyName: ' ' }, ALLOWED)).toEqual({ ok: false, error: '회사명을 입력해 주세요.' });
    expect(parseJbnApplication({ ...ok, ownerName: '' }, ALLOWED)).toEqual({ ok: false, error: '대표자 성함을 입력해 주세요.' });
    expect(parseJbnApplication({ ...ok, nickname: '' }, ALLOWED)).toEqual({ ok: false, error: 'JBN 단톡방 닉네임을 입력해 주세요. 회원 확인에 씁니다.' });
    expect(parseJbnApplication({ ...ok, phone: '12345' }, ALLOWED)).toEqual({ ok: false, error: '연락받으실 휴대폰 번호를 확인해 주세요.' });
    expect(parseJbnApplication({ ...ok, consent: 'true' }, ALLOWED)).toEqual({ ok: false, error: '개인정보 수집과 이용에 동의해 주셔야 신청을 받을 수 있습니다.' });
  });
  it('관심 요금제 = 허용 목록만(그 밖 = 아직 모름 null) · 상담 방식 모르면 전화 · 길이 자름', () => {
    const r = parseJbnApplication({ ...ok, interestPlanCode: 'JBN_BASIC', consultMethod: 'fax', memo: 'x'.repeat(900), nickname: 'n'.repeat(80) }, ALLOWED);
    expect(r.ok && r.value.interestPlanCode).toBe(null);
    expect(r.ok && r.value.consultMethod).toBe('phone');
    expect(r.ok && r.value.memo.length).toBe(500);
    expect(r.ok && r.value.nickname.length).toBe(40);
  });
  it('isUuid', () => {
    expect(isUuid(ID)).toBe(true);
    expect(isUuid('00000000-0000-0000-0000-000000000000')).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});

describe('② 단계 · 상태 이동 · 찾기', () => {
  it('상태 이동 허용표(기대값 = 손으로 적은 표)', () => {
    const table: Array<[string, string, boolean, boolean]> = [
      ['pending', 'verified', false, true], ['pending', 'rejected', false, true], ['pending', 'pending', false, false],
      ['rejected', 'pending', false, true], ['rejected', 'verified', false, false],
      ['verified', 'pending', false, true], ['verified', 'pending', true, false], ['verified', 'rejected', false, false],
    ];
    for (const [from, to, linked, want] of table) expect(canMoveJbnStatus(from as any, to as any, linked), `${from}→${to} linked=${linked}`).toBe(want);
  });
  it('단계 = 연결 회사가 JBN 판이면 적용 중', () => {
    expect(jbnStageOf('verified', true)).toBe('on');
    expect(jbnStageOf('verified', false)).toBe('verified');
    expect(jbnStageOf('pending', false)).toBe('pending');
    expect(jbnStageOf('rejected', false)).toBe('rejected');
  });
  it('찾기 = 회사명 · 성함 · 닉네임 · 연결 회사명 · 번호(숫자 3자 이상)', () => {
    const row = { companyName: '바른손공방', ownerName: '김도윤', nickname: '바른손 김도윤', phone: '01000004821', linkedCompanyName: '바른손(주)' } as JbnApplicationRow;
    expect(matchesJbnSearch(row, '공방')).toBe(true);
    expect(matchesJbnSearch(row, '김도윤')).toBe(true);
    expect(matchesJbnSearch(row, '(주)')).toBe(true);
    expect(matchesJbnSearch(row, '4821')).toBe(true);
    expect(matchesJbnSearch(row, '48')).toBe(false);
    expect(matchesJbnSearch(row, '없는말')).toBe(false);
  });
  it('주소 값 = 모르는 단계는 확인 전', () => {
    expect(parseJbnOverviewQuery({ stage: 'x' })).toEqual({ stage: 'pending', q: '' });
    expect(parseJbnOverviewQuery({ stage: 'on', q: ' 공방 ' })).toEqual({ stage: 'on', q: '공방' });
  });
});

describe('③ 소스 계약', () => {
  const frag = PUBLIC_CATALOG_PLAN_SQL;
  it('공개 요금제 판정 조각 = 칸이 없을 때도 참(to_jsonb)', () => {
    expect(frag).toBe(`(to_jsonb(p) ->> 'partner_code') IS NULL`);
  });
  it('공개 목록 셋이 조각을 쓴다(요금표 · 진단 추천 · 무료 수량)', () => {
    expect(back('routes/plans.ts')).toContain("FROM plans p WHERE p.is_active = true AND ${PUBLIC_CATALOG_PLAN_SQL} ORDER BY");
    expect(DIAGNOSIS_PLAN_ROWS_SQL).toContain(frag);
    expect(back('utils/free-messaging.ts')).toContain("FROM plans p WHERE p.is_active = true AND ${PUBLIC_CATALOG_PLAN_SQL}`");
  });
  it('공개 요금제 주소(/api/plans)를 읽는 화면은 고객 화면만 · 슈퍼관리자 대시보드는 관리자 목록의 활성 행', () => {
    const dash = front('pages/AdminDashboard.tsx');
    expect(dash).not.toMatch(/plansApi\.list\(\)/);
    expect(dash).toMatch(/fetch\('\/api\/admin\/plans'[\s\S]{0,400}?\.filter\(\(p: any\) => p\.is_active !== false\)/);
  });
  it('관리자 JBN 주소 넷 = 관문(ceo · suran) 뒤', () => {
    const src = back('routes/admin.ts');
    const routes = [...src.matchAll(/router\.(get|post|delete)\('\/jbn\/[^']*'[\s\S]*?\n\}\);/g)].map((m) => m[0]);
    expect(routes.length).toBe(5);
    for (const r of routes) expect(r).toContain('isIntroLeadsViewer(req.user?.userId)');
    for (const r of routes.filter((x) => !x.includes("'/jbn/access'"))) expect(r).toMatch(/if \(!\(await isIntroLeadsViewer\(req\.user\?\.userId\)\)\) return jbnDenied\(res\);/);
  });
  it('공개 라우터는 전역 express.json 뒤에 마운트', () => {
    const app = back('app.ts');
    expect(app.indexOf("app.use('/api/public/jbn', jbnPublicRoutes)")).toBeGreaterThan(app.indexOf('app.use(express.json({ limit: LIMITS.requestBodySize }))'));
  });
  it('병합 축 = jbn_applications move', () => {
    expect(COMPANY_MERGE_AXES.find((a) => a.table === 'jbn_applications')?.action).toBe('move');
  });
  it('감사 기록에 신청 개인정보를 싣지 않는다', () => {
    const src = back('utils/jbn.ts');
    const calls = [...src.matchAll(/recordAuditLog\(\{[^}]*\}[^)]*\)/g)].map((m) => m[0]);
    expect(calls.length).toBe(4);
    for (const c of calls) expect(c).not.toMatch(/nickname|phone|ownerName|owner_name|companyName|company_name|memo/);
  });
  it('공개 화면 = 가운뎃점 · 줄표 · 모델명 0 · 검색 제외 meta · 공개 주소 둘 · 그림 폴더', () => {
    const page = front('pages/JbnPage.tsx');
    // 기능 구역(1118 덧붙임) = components/jbn/JbnFeatures. 같은 글 규칙 + 스팸 점검은 「테스트폰」이 아니라 자체 점검 기술로 쓴다(Harold 1118)
    const feat = front('components/jbn/JbnFeatures.tsx');
    for (const src of [page, feat]) {
      expect(src).not.toMatch(/[·—]/);
      expect(src).not.toMatch(/Opus|Sonnet|Haiku|GPT|Claude|Anthropic|Gemini/i);
    }
    expect(feat).not.toMatch(/테스트폰|테스트 폰/);
    expect(feat).toContain('자체 개발한 점검 기술');
    // 회사 명단으로만 열리는 SNS 채널은 싣지 않는다
    expect(feat).not.toMatch(/SNS/);
    expect(page).toContain('<JbnFeatures />');
    expect(page).toContain("'noindex, nofollow'");
    expect(page).toContain("from '../utils/jbn-public'");
    expect(feat).toContain("const A = '/jbn-assets/'");
    const util = front('utils/jbn-public.ts');
    expect(util).toContain("JBN_PLANS_URL = '/api/public/jbn/plans'");
    expect(util).toContain("JBN_APPLY_URL = '/api/public/jbn/apply'");
    expect(util).not.toMatch(/[·—]/);
    // 400(받지 않음) 만 칸을 풀어 새 신청 · 그 밖 실패는 같은 id 와 같은 내용 그대로 다시(Codex 구현 1R) · 완료 화면 = 보낸 내용
    expect(page).toMatch(/if \(r\.definitive\) setSent\(null\);/);
    expect(page).toContain('if (sent) { await send(sent); return; }');
    expect(page).toContain('const locked = sending || sent !== null;');
    expect(page).toContain('<fieldset disabled={locked}');
    // 잠긴 동안 칸은 보낸 내용만 그린다(칸 밖 입구가 고치는 값을 바꿔도 어긋나지 않음 · Codex 구현 2R) · 카드 단추도 잠금을 지킨다
    expect(page).toContain('const shown = sent ?? { ...form, interestPlanCode: plan, consultMethod: method, consent };');
    expect(page).not.toMatch(/value=\{form\./);
    expect(page).toContain('if (!locked) setPlan(code);');
    expect(page).toContain('<dd>{sent?.nickname}</dd>');
    expect(front('App.tsx')).toMatch(/<Route path="\/jbn" element={<JbnPage \/>} \/>/);
  });
});
