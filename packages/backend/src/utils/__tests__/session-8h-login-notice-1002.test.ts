/**
 * 고객사 세션 기본 8시간 · 헤더 타이머 제거 · 로그인 화면 사전 고지 (★ 2026-10-02 Harold 확정)
 *
 * 경위: 다중인증이 로그인마다 붙으면서(1001 회의) 30분 자동 로그아웃이 하루에 여러 번 인증번호를 다시 받게 만들었다.
 *   가이드라인에는 로그인 세션 시간 규정이 없다. 자동 차단 자체는 개인정보 안전성 확보조치 기준 제6조 4항 때문에 남긴다.
 *
 * 못 박는 것
 *   1. 기본값 480분은 상수 하나(`TIMEOUTS.companySessionDefaultMinutes`)이고 로그인·활동 갱신·연장 세 곳이 그것을 본다.
 *      한 곳이라도 옛 30이 남으면 "화면은 8시간인데 서버가 30분에 끊는다"가 된다(0927 S2-04와 같은 사고).
 *   2. 화면 기본값은 서버 상수와 같다.
 *   3. 「접속 중」 판정의 유휴 30분은 따라 올리지 않는다(올리면 자기 유령 세션에 8시간 막힌다).
 *   4. 고객사 헤더에는 남은 시간 표시가 없다. 자동 로그아웃과 만료 전 안내 창은 그대로다. 슈퍼관리자 화면은 타이머 유지.
 *   5. 로그인 화면 고지 창 = 옛 9/1 팝업 대체 · 슈퍼관리자 화면 제외 · 문구의 유지 시간은 코드 값과 같다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { TIMEOUTS } from '../../config/defaults';

const be = (...p: string[]) => readFileSync(join(__dirname, '..', '..', ...p), 'utf8');
const fe = (...p: string[]) => readFileSync(join(__dirname, '..', '..', '..', '..', 'frontend', 'src', ...p), 'utf8');

describe('고객사 세션 기본 8시간', () => {
  it('기본값은 480분이고 0(무제한)이 아니다', () => {
    expect(TIMEOUTS.companySessionDefaultMinutes).toBe(480);
  });

  it('로그인 · 활동 갱신 · 연장이 같은 상수를 본다(옛 30이 남지 않았다)', () => {
    const login = be('utils', 'login-issue.ts');
    expect(login).toContain('session_timeout_minutes || TIMEOUTS.companySessionDefaultMinutes');
    expect(login).not.toMatch(/session_timeout_minutes \|\| 30\b/);

    const mw = be('middlewares', 'auth.ts');
    expect(mw).toContain('NULLIF(c.session_timeout_minutes, 0)');
    expect(mw).toContain('), $3::int)');
    expect(mw).toContain('[decoded.sessionId, decoded.userId, TIMEOUTS.companySessionDefaultMinutes]');
    expect(mw).not.toContain('), 30)');

    const route = be('routes', 'auth.ts');
    const extend = route.slice(route.indexOf("router.post('/extend-session'"), route.indexOf("router.get('/session-check'"));
    expect(extend).toContain('session_timeout_minutes || TIMEOUTS.companySessionDefaultMinutes');
    expect(extend).not.toMatch(/\|\| 30\b/);
    // 슈퍼관리자는 종전 그대로(30분 · ENV)
    expect(extend).toContain('minutes = TIMEOUTS.superAdminSessionMinutes;');
  });

  it('화면 기본값 = 서버 상수', () => {
    const hook = fe('hooks', 'useSessionTimeout.ts');
    const m = hook.match(/export const DEFAULT_SESSION_TIMEOUT_MINUTES = (\d+);/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(TIMEOUTS.companySessionDefaultMinutes);
    expect(hook).not.toContain('return 30;');
    expect(hook).not.toContain('useRef<number>(30)');
    expect(fe('pages', 'LoginPage.tsx')).toContain('String(sessionTimeoutMinutes || DEFAULT_SESSION_TIMEOUT_MINUTES)');
  });

  it('「접속 중」 판정의 유휴 임계는 30분 그대로다', () => {
    expect(be('utils', 'session-manager.ts')).toContain('const IDLE_THRESHOLD_MINUTES = 30;');
  });

  it('고객사 헤더에 남은 시간 표시가 없다 — 자동 로그아웃과 만료 전 안내 창은 남는다', () => {
    const header = fe('components', 'DashboardHeader.tsx');
    expect(header).not.toContain('<SessionTimer');
    expect(header).not.toContain("from './SessionTimer'");
    const app = fe('App.tsx');
    expect(app).toContain('useSessionTimeout({ onLogout: handleSessionLogout })');
    expect(app).toContain('<SessionTimeoutModal');
    // 슈퍼관리자 화면은 세션이 30분이라 타이머를 그대로 둔다
    expect(fe('pages', 'AdminDashboard.tsx')).toContain('<SessionTimer />');
  });
});

describe('로그인 화면 사전 고지 창', () => {
  const login = fe('pages', 'LoginPage.tsx');
  const modal = fe('components', 'LoginPolicyNoticeModal.tsx');

  it('옛 9/1 팝업은 없고, 고객사 로그인 화면에만 새 창이 뜬다', () => {
    expect(login).not.toContain('securityNotice20260901');
    expect(login).not.toContain('2026년 9월 1일 시행');
    expect(login).toContain('useState(() => !isSuperAdminOnly && shouldShowLoginPolicyNotice())');
    expect(login).toContain('{showPolicyNotice && <LoginPolicyNoticeModal onClose={() => setShowPolicyNotice(false)} />}');
  });

  it('숨김은 「오늘 하루」뿐이다 — 확인을 눌러도 다음 방문에 다시 뜬다', () => {
    expect(modal).toContain('return localStorage.getItem(HIDE_KEY) !== todayInSeoul();');
    expect(modal).toContain("toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })");
    // 확인 버튼은 닫기만 한다(저장하지 않는다)
    const confirm = modal.slice(modal.indexOf('ref={confirmRef}'), modal.indexOf('확인했습니다'));
    expect(confirm).toContain('onClick={onClose}');
    expect(confirm).not.toContain('hideToday');
  });

  it('시행일 = 10월 26일(한국 시각) · 원문은 방송미디어통신위원회 누리집', () => {
    expect(modal).toContain("new Date('2026-10-26T00:00:00+09:00')");
    expect(modal).toContain("const ENFORCE_DATE_TEXT = '10월 26일';");
    const urls = modal.match(/https:\/\/[^\s']+/g) || [];
    expect(urls.length).toBe(2);
    for (const u of urls) expect(u.startsWith('https://www.kmcc.go.kr/')).toBe(true);
    expect(modal).toContain('rel="noopener noreferrer"');
  });

  it('문구의 유지 시간 = 발신 인증 코드 값', () => {
    const hours = be('utils', 'sender-auth.ts').match(/export const SENDER_AUTH_TRUST_HOURS = (\d+);/);
    expect(hours).not.toBeNull();
    expect(modal).toContain(`인증하면 ${hours![1]}시간 유지됩니다`);
    expect(modal).not.toContain('24시간');
  });

  it('고객에게 보이는 글에 줄표와 모델명이 없다', () => {
    const visible = modal.slice(modal.indexOf('const CHANGES'));
    const text = visible.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(text).not.toContain('—');
    expect(text).not.toMatch(/Claude|GPT|Anthropic|Opus|Sonnet|Haiku/i);
  });
});
