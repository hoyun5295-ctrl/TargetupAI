/**
 * 이메일 보내기 창 「회사 메일 연결하기」 무반응 (★2026-10-03 남지현 접수 `cmuqkqs2k0c3ijjnn4osoyb3h6`)
 *
 * 옛: 버튼이 navigate('/email-campaigns?smtp=1') 만 했다. 이 창이 뜨는 대표 경로(이메일 수정 화면 · 목록 상세)는
 *   이미 /email-campaigns 안이라 페이지가 다시 열리지 않고, ?smtp=1 은 처음 열릴 때 한 번만 읽혀 아무 일도 없었다.
 *   또 보내기 창은 연결 여부를 관리자 전용 조회(GET /api/email/smtp-config)로 판정해 담당자 계정은 회사 메일이
 *   연결돼 있어도 「연결 필요」로 막혔다(실제 발송 관문은 담당자도 통과하는 isSmtpConfigured).
 * 처방: 연결 창을 공용 컴포넌트로 옮겨 보내기 창 안에서 바로 띄운다 · 연결 판정은 발송 관문과 같은 GET /api/email/status
 *   (보내는 주소 · 관리 권한을 함께 싣는다) · 저장은 관리자만이라 담당자에게는 요청 안내를 보인다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';

const back = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');
const FRONT = resolve(__dirname, '../../../../frontend/src');
const front = (rel: string) => readFileSync(join(FRONT, rel), 'utf8');

describe('GET /api/email/status = 보내기 창의 연결 판정 원천', () => {
  it('연결 여부 · 공개 발신 주소 · 관리 권한을 함께 싣는다(비밀번호·계정은 싣지 않는다)', () => {
    const src = back('routes/email.ts');
    const at = src.indexOf("router.get('/status'");
    const body = src.slice(at, src.indexOf("router.get('/smtp-config'", at));
    expect(body).toContain('smtp_configured');
    expect(body).toContain('from_email');
    expect(body).toContain('from_name');
    expect(body).toContain('can_manage');
    expect(body).not.toContain('password');
    expect(body).not.toContain('smtp_user');
  });
});

describe('공용 연결 창', () => {
  it('components/email/SmtpConnectModal.tsx 가 창 · 프리셋 · 저장을 소유한다', () => {
    expect(existsSync(join(FRONT, 'components/email/SmtpConnectModal.tsx'))).toBe(true);
    const src = front('components/email/SmtpConnectModal.tsx');
    expect(src).toContain('export const SMTP_PRESETS');
    expect(src).toContain('export function SmtpFormModal');
    expect(src).toContain('export default function SmtpConnectModal');
    expect(src).toContain("method: 'PUT'");
    expect(src).toContain("'/api/email/smtp-config'");
  });

  it('이메일 화면은 공용 창을 쓰고 자기 사본을 두지 않는다', () => {
    const page = front('pages/EmailCampaignsPage.tsx');
    expect(page).toContain("from '../components/email/SmtpConnectModal'");
    expect(page).not.toContain('function SmtpFormModal(');
    expect(page).not.toContain('const SMTP_PRESETS');
    expect(page).not.toContain("searchParams.get('smtp')");
  });
});

describe('보내기 창 이메일 카드', () => {
  const src = front('components/make/MakeSendModal.tsx');

  it('페이지 이동이 아니라 창 안에서 연결 창을 연다', () => {
    expect(src).not.toContain("navigate('/email-campaigns?smtp=1')");
    expect(src).toContain('<SmtpConnectModal');
  });

  it('연결 판정은 발송 관문과 같은 /api/email/status 다(관리자 전용 조회를 쓰지 않는다)', () => {
    expect(src).not.toContain("fetch('/api/email/smtp-config'");
    expect(src).toContain("fetch('/api/email/status'");
    expect(src).toContain('smtp_configured');
  });

  it('관리 권한이 없으면 버튼 대신 회사 관리자에게 요청하라고 안내한다', () => {
    expect(src).toContain('can_manage');
    expect(src).toContain('회사 관리자에게');
  });

  it('연결을 저장하면 카드와 페이지가 다시 읽는다', () => {
    expect(src).toContain('onSmtpChanged');
    expect(front('components/make/EmailEditScreen.tsx')).toContain('onSmtpChanged=');
    expect(front('pages/EmailCampaignsPage.tsx')).toContain('onSmtpChanged=');
  });
});
