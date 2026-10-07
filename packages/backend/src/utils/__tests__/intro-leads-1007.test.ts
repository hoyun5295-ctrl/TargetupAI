/**
 * ★ 2026-10-07 (Harold) 공개 소개 페이지 /intro · 시연 요청 · 슈퍼관리자 「소개 방문 · 시연 요청」(ceo · suran)
 *   영상은 정보 입력 없이 재생 · 개인정보는 시연 요청 때만 · 방문은 서버가 IP 를 남긴다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { parseDemoRequest, parseIntroLeadsQuery, INTRO_ACTIONS } from '../intro-leads';
import { PERMISSION_MATRIX } from '../admin-role';

const back = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');
const front = (p: string) => readFileSync(join(__dirname, '..', '..', '..', '..', 'frontend', p), 'utf8');

describe('시연 요청 정규화', () => {
  const ok = { companyName: ' ○○코스메틱 ', contactName: '김담당', phone: '010-0000-0000', method: 'video', memo: '', consent: true };
  it('정상 값 · 번호는 숫자만 · 방식 보존', () => {
    const r = parseDemoRequest(ok);
    expect(r.ok && r.value).toEqual({ companyName: '○○코스메틱', contactName: '김담당', phone: '01000000000', method: 'video', memo: '' });
  });
  it('동의 없으면 거절 · 번호 틀리면 거절 · 모르는 방식은 방문', () => {
    expect(parseDemoRequest({ ...ok, consent: false }).ok).toBe(false);
    expect(parseDemoRequest({ ...ok, consent: 'true' }).ok).toBe(false);
    expect(parseDemoRequest({ ...ok, phone: '12345' }).ok).toBe(false);
    expect(parseDemoRequest({ ...ok, companyName: '  ' }).ok).toBe(false);
    const r = parseDemoRequest({ ...ok, method: 'x' });
    expect(r.ok && r.value.method).toBe('visit');
  });
  it('목록 조건 기본값', () => {
    expect(parseIntroLeadsQuery({})).toEqual({ kind: 'all', page: 1 });
    expect(parseIntroLeadsQuery({ kind: 'request', page: '3' })).toEqual({ kind: 'request', page: 3 });
    expect(parseIntroLeadsQuery({ kind: 'bad', page: '-2' })).toEqual({ kind: 'all', page: 1 });
  });
});

describe('열람 = ceo · suran', () => {
  it('ENV 기본 ceo,suran · 등급표 대표 · 지원팀장 조회 · 지원팀원 닫힘', () => {
    expect(back('utils/audit-log.ts')).toContain("isSuperAdminAllowed(superAdminId, 'INTRO_LEADS_VIEWER_IDS', 'ceo,suran', 'intro-leads', 'introLeads')");
    expect(PERMISSION_MATRIX.find((r) => r.key === 'introLeads')?.levels).toEqual({ super: 'R', lead: 'R', support: 'NONE' });
  });
  it('조회 라우트는 슈퍼관리자 + 허용 판정 뒤에만', () => {
    const admin = back('routes/admin.ts');
    expect(admin).toContain("router.get('/intro-leads/access', authenticate, requireSuperAdmin");
    const r = admin.slice(admin.indexOf("router.get('/intro-leads', authenticate, requireSuperAdmin"));
    expect(r.indexOf('isIntroLeadsViewer')).toBeGreaterThan(0);
    expect(r.indexOf('isIntroLeadsViewer')).toBeLessThan(r.indexOf('loadIntroLeads('));
  });
  it('공개 경로 = 방문 · 시연 요청 두 개 · IP 한도', () => {
    const pub = back('routes/intro-public.ts');
    expect(pub).toContain("router.post('/view', limiter(INTRO_RATE.view)");
    expect(pub).toContain("router.post('/demo-request', limiter(INTRO_RATE.request)");
    expect(back('app.ts')).toContain("app.use('/api/public/intro', introPublicRoutes);");
    expect(INTRO_ACTIONS).toEqual({ view: 'intro_view', request: 'intro_demo_request' });
  });
});

describe('화면', () => {
  it('/intro 는 로그인 없이 · /about 은 그대로 hoyun 전용', () => {
    const app = front('src/App.tsx');
    expect(app).toContain('<Route path="/intro" element={<IntroPage />} />');
    expect(app).toContain('<Route path="/about" element={<PrivateRoute><AboutGate><AboutPage /></AboutGate></PrivateRoute>} />');
  });
  it('영상은 입력 없이 바로 재생 · 다운로드 버튼 없음', () => {
    const page = front('src/pages/IntroPage.tsx');
    expect(page).toContain('<video src="/intro-media/hanjul-allinone.mp4"');
    expect(page).toContain('controlsList="nodownload');
    expect(page).not.toContain('동의하고 보기');
    // 입력 칸은 시연 요청 창 안에만 · 페이지 본문(영상 둘레)에는 입력 칸이 없다
    expect(page.slice(page.indexOf('export default function IntroPage'))).not.toContain('<input');
  });
  it('★ 공개 폴더 이름이 화면 주소와 겹치지 않는다(겹치면 nginx 가 폴더로 보고 /intro → /intro/ → 403 · 1007 실측)', () => {
    const app = front('src/App.tsx');
    const routes = new Set([...app.matchAll(/path="\/([A-Za-z0-9_-]+)"/g)].map((m) => m[1]));
    const dirs = readdirSync(join(__dirname, '..', '..', '..', '..', 'frontend', 'public'), { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name);
    expect(dirs.filter((d) => routes.has(d))).toEqual([]);
  });
  it('로그인 화면 소개 링크 = /intro · 옛 소개 주소도 /intro', () => {
    const login = front('src/pages/LoginPage.tsx');
    expect(login.match(/to="\/intro"/g)?.length).toBe(2);
    expect(login).not.toContain('to="/about"');
    expect(front('public/about-ai-operator.html')).toContain("location.replace('/intro')");
  });
});
