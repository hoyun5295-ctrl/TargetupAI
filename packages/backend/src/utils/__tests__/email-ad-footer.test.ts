/**
 * 광고성 이메일 법정 footer (정보통신망법 §50④) — 문구·이스케이프·발신자 우선순위.
 *
 * ★ 2026-09-16 신설. 편집기의 "수신거부 링크 표시" 토글이 이메일에서 반영되지 않는다는 접수
 *   (임은지 `cmu3m2hey03nsjnludt2b1zv6`)의 처방이 **미리보기에 실제로 붙을 문구를 보여주는 것**이라,
 *   발송 엔진 안에만 있던 문자열이 두 경로에서 쓰이게 됐다. 갈리면 "미리보기와 실제 메일이 다르다"가 된다.
 *
 * Codex 적대 검토 1R이 이 자리에서 둘을 짚었고 둘 다 수용해 여기서 잠근다.
 *   [high]   발신자 값이 이스케이프 없이 보간됐다(사람이 적는 값 · 편집 미리보기는 srcDoc으로 그려진다).
 *   [medium] 미리보기가 회사 SMTP 설정만 봐서, 캠페인별 발신자를 지정했거나 설정을 나중에 바꾼 회사는
 *            **확인한 전송자와 수신함 전송자가 갈렸다.**
 */
import { describe, it, expect, vi } from 'vitest';

// ★ 2026-09-27 한줄로 V2 R226 — 미리보기도 발송과 같은 발신자 CT(resolveEmailSender)를 쓴다: 이름 = 캠페인 → SMTP 설정 → 회사 이름 · 주소 = 실제 SMTP 주소
const smtpState = { fromName: '회사설정이름' as string | null, fromEmail: 'send@acme.test' };
vi.mock('../company-smtp-client', () => ({
  sendEmail: vi.fn(), isSmtpConfigured: vi.fn(),
  getSmtpConfigPublic: vi.fn(async () => smtpState),
}));
vi.mock('../../config/database', () => ({
  default: { query: vi.fn() },
  query: vi.fn(async (sql: string) => (String(sql).includes('SELECT company_name FROM companies') ? { rows: [{ company_name: '에이크미' }] } : { rows: [] })),
}));

import { buildEmailAdFooter, withEmailPreviewAdFooter } from '../email-channel';
import { EMAIL_FOOTER_SLOT } from '../email/email-section-renderer';

const UNSUB_MARKER = '{{__hanjul_unsub_url__}}';

describe('법정 footer 문구', () => {
  it('전송자 명칭·연락처·수신거부 링크 셋이 모두 들어간다(§50④ 요건)', () => {
    const html = buildEmailAdFooter('인비토', 'shop@invito.example', UNSUB_MARKER);
    expect(html).toContain('인비토');
    expect(html).toContain('shop@invito.example');
    expect(html).toContain('수신거부');
    expect(html).toContain(UNSUB_MARKER);
  });

  it('발신자 이름·주소를 이스케이프한다 — 둘 다 사람이 적는 값이고 저장 제한이 없다', () => {
    const html = buildEmailAdFooter('<img src=x onerror=alert(1)>', '"><script>alert(2)</script>', UNSUB_MARKER);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;img');
  });

  it('수신거부 href는 호출부가 정한다(발송 = 마커 · 미리보기 = 자리 표시)', () => {
    expect(buildEmailAdFooter('브랜드', 'a@b.com', '#')).toContain('href="#"');
  });
});

describe('편집 미리보기 footer 치환', () => {
  const shell = `<html><body>본문${EMAIL_FOOTER_SLOT}</body></html>`;

  it('광고성이면 슬롯 자리에 실제 문구가 들어간다', async () => {
    const out = await withEmailPreviewAdFooter(shell, 'company-1', true, { fromName: '인비토', fromEmail: 'a@b.com' });
    expect(out).not.toContain(EMAIL_FOOTER_SLOT);
    expect(out).toContain('인비토');
    expect(out).toContain('수신거부');
  });

  it('⛔ 미리보기에는 수신거부 마커를 넣지 않는다 — 넣으면 실제 발송에서 법정 footer가 통째로 생략된다', async () => {
    const out = await withEmailPreviewAdFooter(shell, 'company-1', true, { fromName: '인비토', fromEmail: 'a@b.com' });
    expect(out, 'hasUnsubLink 판정이 참이 되면 전송자 명칭·연락처까지 사라진다').not.toContain(UNSUB_MARKER);
    expect(out).not.toContain('/api/email/u/');
  });

  it('광고성이 아니면 슬롯만 지운다(실제 발송에도 안 붙는다)', async () => {
    const out = await withEmailPreviewAdFooter(shell, 'company-1', false, null);
    expect(out).not.toContain(EMAIL_FOOTER_SLOT);
    expect(out).not.toContain('수신거부');
  });

  it('저장된 캠페인의 발신자 이름이 회사 설정보다 앞선다 · 주소는 실제로 보내는 SMTP 주소(From과 같다 · R226)', async () => {
    const out = await withEmailPreviewAdFooter(shell, 'company-1', true, { fromName: '캠페인 발신자', fromEmail: 'camp@b.com' });
    expect(out).toContain('캠페인 발신자');
    expect(out).toContain('send@acme.test');
    expect(out, '실제 From은 설정 주소다 — 캠페인 주소를 쓰면 표기와 실제 발신자가 갈린다').not.toContain('camp@b.com');
  });

  it('이름이 비면 회사 설정 이름 → 회사 이름 · 한줄로AI는 쓰지 않는다(R223)', async () => {
    let out = await withEmailPreviewAdFooter(shell, 'company-1', true, { fromName: '', fromEmail: 'camp@b.com' });
    expect(out).toContain('회사설정이름');
    smtpState.fromName = null;
    out = await withEmailPreviewAdFooter(shell, 'company-1', true, { fromName: '', fromEmail: '' });
    expect(out).toContain('에이크미');
    expect(out).not.toContain('한줄로AI');
    smtpState.fromName = '회사설정이름';
  });

  it('슬롯이 없는 HTML은 그대로 돌려준다(수동 작성·과거 저장분 무회귀)', async () => {
    const plain = '<html><body>본문</body></html>';
    expect(await withEmailPreviewAdFooter(plain, 'company-1', true, null)).toBe(plain);
  });
});
