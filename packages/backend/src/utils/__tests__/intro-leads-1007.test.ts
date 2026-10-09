/**
 * ★ 2026-10-07 (Harold) 공개 소개 페이지 /intro · 시연 요청 · 슈퍼관리자 「소개 방문 · 시연 요청」(ceo · suran)
 *   영상은 정보 입력 없이 재생 · 개인정보는 시연 요청 때만 · 방문은 서버가 IP 를 남긴다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { parseDemoRequest, parseIntroLeadsQuery, INTRO_ACTIONS, isIntroBot, INTRO_BOT_UA_PATTERN } from '../intro-leads';
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

/**
 * ★ 2026-10-09 (Harold 「밤 12시 방문 수상하다」) — 실측 원문 4건(audit_logs intro_view · .62 조회)으로 고정한다.
 *   스스로 로봇이라고 밝힌 방문만 「검색 로봇」 · 방문 숫자에서 뺀다. 로봇 표시 없는 데이터센터 크롬은 방문으로 둔다.
 */
describe('검색 로봇 판정 = 브라우저 원문이 로봇이라고 밝힌 것만', () => {
  const AHREFS = 'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)';
  const BING = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/136.0.0.0 Safari/537.36';
  const AWS_CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
  const NAVERWORKS_IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ipad WorksMobile/4.6.1.13 (NaverWorks) GSaaSMobileApp';

  it('실측 4건 = 로봇 2 · 사람/미상 2', () => {
    expect(isIntroBot(AHREFS)).toBe(true);
    expect(isIntroBot(BING)).toBe(true);
    expect(isIntroBot(AWS_CHROME)).toBe(false);
    expect(isIntroBot(NAVERWORKS_IPAD)).toBe(false);
  });
  it('국내 검색 로봇(이름에 bot 없음) · 빈 값 · 카카오톡 안', () => {
    expect(isIntroBot('Mozilla/5.0 (compatible; Yeti/1.1; +http://naver.me/spd)')).toBe(true);
    expect(isIntroBot('Mozilla/5.0 (compatible; Daum/4.1; +http://cs.daum.net/faq/15/4118.html?faqId=28966) Daumoa')).toBe(true);
    expect(isIntroBot('')).toBe(false);
    expect(isIntroBot(null)).toBe(false);
    expect(isIntroBot('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.8.0')).toBe(false);
  });
  it('집계 SQL 이 같은 글자로 가른다(JS 판정과 두 벌이 아니다) · 방문 숫자는 로봇 제외', () => {
    const src = back('utils/intro-leads.ts');
    expect(src).toContain("COALESCE(user_agent, '') ~* $3 AS bot");
    expect(src).toContain('[INTRO_ACTIONS.view, INTRO_ACTIONS.request, INTRO_BOT_UA_PATTERN]');
    expect(src).toMatch(/AND NOT bot AND created_at >= date_trunc\('day'/);
    expect(src).toContain("AND NOT bot AND created_at >= NOW() - INTERVAL '7 days')::int AS week");
    expect(INTRO_BOT_UA_PATTERN).toMatch(/^[a-z|]+$/); // PostgreSQL ~* 와 JS RegExp 공통 문법만
  });
  it('화면: 구분 칸 = 검색 로봇 · 아이패드 분리 · 네이버웍스 안 · 7일 카드에 제외 건수', () => {
    const tab = front('src/components/admin/IntroLeadsTab.tsx');
    expect(tab).toContain("r.isBot ? '검색 로봇' : '방문'");
    expect(tab).toContain("/iPad/i.test(ua) ? 'iPad'");
    expect(tab).toContain("'네이버웍스 안'");
    expect(tab).toContain('검색 로봇 ${s.bots7d.toLocaleString()}건 제외');
  });
});
