/**
 * 광고 메일 법정 표기 (★ 2026-09-27 한줄로 V2 차수 1 MAIL-LAW — R223 · R226 · R227)
 *
 * R223 발신자 이름이 비면 법정 footer의 전송자 명칭이 '한줄로AI'로 찍혔다(보내는 회사가 아니다).
 * R226 법정 footer는 캠페인에 저장된 발신자 이름·주소로, 실제 From은 회사 SMTP 설정 값으로 찍혀 둘이 갈릴 수 있었다.
 * R227 텍스트 본문(text/plain)이 원문 그대로 붙었다 — 이름 치환·남은 {{…}} 제거·(광고)·수신거부 안내가 없었다.
 * → 실제 발신자 CT(resolveEmailSender): 이름 = 캠페인 → SMTP 설정 → 회사 이름 · 주소 = 실제로 보내는 SMTP 주소.
 *   From 헤더·법정 footer·미리보기가 모두 이 값을 쓴다. 텍스트 본문은 HTML과 같은 치환을 받고, 광고면 (광고)와 수신거부 주소를 붙인다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const state = { smtp: { fromName: 'SMTP이름', fromEmail: 'send@acme.test' } as any, companyName: '에이크미' as any };
vi.mock('../../config/database', () => ({
  default: { query: vi.fn() },
  query: vi.fn(async (sql: string) => (String(sql).includes('SELECT company_name FROM companies') ? { rows: state.companyName === null ? [] : [{ company_name: state.companyName }] } : { rows: [] })),
}));
vi.mock('../company-smtp-client', () => ({
  sendEmail: vi.fn(), isSmtpConfigured: vi.fn(),
  getSmtpConfigPublic: vi.fn(async () => state.smtp),
}));

import { resolveEmailSender, buildEmailAdFooterText } from '../email-channel';

beforeEach(() => { state.smtp = { fromName: 'SMTP이름', fromEmail: 'send@acme.test' }; state.companyName = '에이크미'; });

describe('실제 발신자 CT', () => {
  it('이름 = 캠페인 → SMTP 설정 → 회사 이름 · 주소 = 실제로 보내는 SMTP 주소(캠페인 주소가 달라도)', async () => {
    expect(await resolveEmailSender('c1', { fromName: '캠페인이름', fromEmail: 'other@x.test' })).toEqual({ name: '캠페인이름', email: 'send@acme.test' });
    expect(await resolveEmailSender('c1', { fromName: '', fromEmail: '' })).toEqual({ name: 'SMTP이름', email: 'send@acme.test' });
    state.smtp = { fromName: null, fromEmail: 'send@acme.test' };
    expect(await resolveEmailSender('c1', null)).toEqual({ name: '에이크미', email: 'send@acme.test' });
  });
  it('어디에도 이름이 없으면 한줄로AI가 아니라 빈 이름(발송이 막히는 쪽은 호출부 판단)', async () => {
    state.smtp = { fromName: '', fromEmail: 'send@acme.test' }; state.companyName = null;
    const r = await resolveEmailSender('c1', null);
    expect(r.name).toBe('');
    expect(r.name).not.toBe('한줄로AI');
  });
});

describe('텍스트 본문 광고 표기', () => {
  it('전송자·연락처·수신거부 주소를 싣는다(HTML footer와 같은 문장)', () => {
    const t = buildEmailAdFooterText('에이크미', 'send@acme.test', 'https://x.test/api/email/u/abc');
    expect(t).toContain('본 메일은 에이크미(send@acme.test)의 광고 정보입니다.');
    expect(t).toContain('https://x.test/api/email/u/abc');
  });
});

describe('배선', () => {
  const ch = readFileSync(join(__dirname, '..', 'email-channel.ts'), 'utf8');
  const smtp = readFileSync(join(__dirname, '..', 'company-smtp-client.ts'), 'utf8');
  it('발송: 법정 footer와 From이 같은 발신자 · 텍스트 본문은 수신자별로 만든다', () => {
    expect(ch).toContain('const sender = await resolveEmailSender(campaign.companyId, campaign);');
    expect(ch).toContain('const adFooter = buildEmailAdFooter(sender.name, sender.email, UNSUB_URL_MARKER);');
    expect(ch).toContain('fromName: sender.name,');
    expect(ch).toContain('textBody: personalizedText,');
    expect(ch).not.toContain('textBody: campaign.textBody || undefined,');
  });
  it('SMTP 발송은 넘겨받은 이름을 From 이름으로 쓰고 주소는 설정 주소 그대로', () => {
    expect(smtp).toMatch(/const fromNameUsed = input\.fromName \|\| config\.fromName;/);
    expect(smtp).toContain('`"${fromNameUsed}" <${config.fromEmail}>`');
  });
  it("'한줄로AI' 기본값이 남지 않는다(생성·미리보기)", () => {
    expect(ch).not.toContain("|| '한줄로AI'");
  });
});

/**
 * R391 일일 인사이트 메일 — 대상은 (회사, 사용자)로 뽑는데 메일은 회사 단위(회사 인사이트 · 회사 수신 주소 하나)라,
 *      같은 회사 사용자 둘이 켜면 같은 메일이 같은 날 두 번 갔다. 수신 거부 안내 '대시보드 → 설정 → 알림 메뉴'는 없는 경로였다.
 *      실제로 끄는 곳 = AI 오퍼레이션 시작 안내 7단계 '매일 9시 인사이트 메일'(완료 뒤 재진입도 7단계 · /onboarding?step=7 지원).
 */
describe('R391 일일 인사이트 메일', () => {
  const m = readFileSync(join(__dirname, '..', 'daily-insight-mailer.ts'), 'utf8');
  it('대상은 회사 단위로 뽑는다', () => {
    expect(m).toContain('SELECT DISTINCT ows.company_id\n');
    expect(m).not.toContain('SELECT DISTINCT ows.company_id, ows.user_id');
  });
  it('수신 거부 안내는 실제 경로', () => {
    expect(m).not.toContain('대시보드 → 설정 → 알림 메뉴');
    expect(m).toContain('https://hanjul.ai/onboarding?step=7');
    expect(m).toContain('매일 9시 인사이트 메일');
  });
});
