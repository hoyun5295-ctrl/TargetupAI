/**
 * C167-A(★ 2026-11-27 · 뿌리 R111 · 설계서 docs/2026-11-27-c167-ad-preview-ct-design.md) — 받는 분 화면 = 나가는 글 그대로.
 *   화면 합성(formatDate 의 머리 · 꼬리 · 걷기 · 잠긴 줄)과 서버 합성(messageUtils)이 같은 글을 만드는가 · 한줄로 묻기의 보낼 본문 · 제목 · 080 읽기.
 *   접수 = 임은지 cmwvoybem2neqjnsc8xsmpd66(한줄로 묻기 미리보기에 (광고) · 수신거부 줄이 안 보임 · 간격 조절 불가).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildAdMessage, adRejectFooterText, stripAdPartsDeep, buildAdSubject } from '../messageUtils';
import {
  adPrefixFront, adFooterFront, stripAdPartsDeepFront, buildAdMessageFront, adLockedPartsFront, buildAdSubjectFront,
} from '../../../../frontend/src/utils/formatDate';

const FE = join(__dirname, '..', '..', '..', '..', 'frontend', 'src');
const BE = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

const TYPES = ['SMS', 'LMS', 'MMS'];
const NUMBERS = ['0801234567', '080-123-4567', ''];

describe('C167-A 화면 합성 = 서버 합성(거울)', () => {
  it('머리 · 꼬리 = 서버 buildAdMessage 의 머리 · adRejectFooterText', () => {
    for (const t of TYPES) {
      for (const n of NUMBERS) {
        expect(adFooterFront(t, n), `${t} ${n}`).toBe(adRejectFooterText(t, n));
        expect(buildAdMessage('본문', t, true, n).startsWith(adPrefixFront(t)), `${t}`).toBe(true);
      }
    }
  });

  it('끝 줄바꿈 · 이미 있는 머리 · 꼬리까지 화면 합성 = 서버 합성', () => {
    const bodies = ['안녕하세요', '안녕하세요\n', '안녕하세요\n\n', '(광고) 이미 붙음\n본문', '본문\n무료수신거부 080-111-2222', '첫 줄\n\n둘째 줄\n\n\n'];
    for (const t of TYPES) for (const n of NUMBERS) for (const b of bodies) {
      expect(buildAdMessageFront(b, t, true, n), JSON.stringify([t, n, b])).toBe(buildAdMessage(b, t, true, n));
    }
    for (const t of TYPES) for (const s of ['', '할인 안내', '(광고) 할인']) expect(buildAdSubjectFront(s, t, true)).toBe(buildAdSubject(s, t, true));
  });

  it('광고 표기 걷기 = 서버 stripAdPartsDeep', () => {
    const samples = [
      '(광고) 블랙프라이데이\n혜택 안내\n무료수신거부 080-139-56',
      '본문 중간 무료 수신거부 : 080-111-2222 이어서',
      '（광고）전각 머리\n무료거부0801112222',
      '그냥 글',
      '  앞뒤 공백  \n\n\n\n끝  ',
    ];
    for (const s of samples) expect(stripAdPartsDeepFront(s), s).toBe(stripAdPartsDeep(s));
  });

  it('잠긴 줄 = 합성이 실제로 붙인 것만', () => {
    expect(adLockedPartsFront('본문', 'LMS', true, '0801234567')).toEqual({ head: '(광고) ', footer: '무료수신거부 0801234567', composed: '(광고) 본문\n무료수신거부 0801234567' });
    expect(adLockedPartsFront('(광고) 본문', 'LMS', true, '0801234567').head).toBe('');
    expect(adLockedPartsFront('본문\n무료수신거부 080-1', 'LMS', true, '0801234567').footer).toBe('');
    expect(adLockedPartsFront('본문\n\n', 'SMS', true, '080-123-4567')).toEqual({ head: '(광고)', footer: '무료거부0801234567', composed: '(광고)본문\n\n무료거부0801234567' });
    expect(adLockedPartsFront('본문', 'LMS', false, '0801234567')).toEqual({ head: '', footer: '', composed: '본문' });
  });
});

describe('C167-A 한줄로 묻기 — 보낼 본문 · 제목 · 080 한 곳', () => {
  it('askSendBody = 끝 줄바꿈 보존 · 앞 공백 · 끝 공백 걷음 · 서버 합성과 같은 글', async () => {
    const { askSendBody, askSendSubject, askOpt080Of } = await import('../../../../frontend/src/utils/ai-ask');
    expect(askSendBody('  본문\n\n')).toBe('본문\n\n');
    expect(askSendBody('본문 \t')).toBe('본문');
    expect(askSendBody('본문\n\n  ')).toBe('본문\n\n');
    expect(buildAdMessageFront(askSendBody('본문\n\n'), 'LMS', true, '0801234567')).toBe('(광고) 본문\n\n무료수신거부 0801234567');
    expect(askSendSubject('SMS', '제목')).toBe('');
    expect(askSendSubject('LMS', '  '.concat('가'.repeat(50)))).toBe('가'.repeat(40));
    expect(askOpt080Of({ opt080: '080-123-4567' })).toEqual({ known: true, value: '080-123-4567', forBytes: '080-123-4567' });
    expect(askOpt080Of({ opt080: '' })).toEqual({ known: true, value: '', forBytes: '0800000000' });   // 미등록 = 넉넉히(다른 곳에서 등록하면 발송이 번호를 붙인다 · Codex 구현 1R #1)
    expect(askOpt080Of({})).toEqual({ known: false, value: '', forBytes: '0800000000' });
  });

  it('화면은 가짜 번호 · 따로 trim 을 쓰지 않고 4단계 · 바이트 · 확정이 같은 함수를 지난다', () => {
    const page = read(join(FE, 'pages/AiAskPage.tsx'));
    expect(page).not.toContain("'0800000000'");
    expect(page).not.toContain('pickedBody.trim()');
    expect(page).toContain('buildAdMessageFront(askSendBody(pickedBody), sendChannel, true, opt080.value)');
    expect(page).toMatch(/const body = askSendBody\(pickedBody\);/);
    expect(page).toMatch(/const subject = askSendSubject\(sendChannel, pickedSubject\);/);
    expect(page).toContain('buildAdSubjectFront(askSendSubject(sendChannel, pickedSubject), sendChannel, true)');
  });

  it('서버 /ask/segments 가 확정과 같은 함수로 080 을 싣는다', () => {
    const route = read(join(BE, 'routes/ai-line.ts'));
    const seg = route.slice(route.indexOf("router.get('/ask/segments'"), route.indexOf("router.get('/ask/group-performance'"));
    expect(seg).toContain('getOpt080Number(v.userId || null, v.companyId)');
    expect(seg).toContain("opt080: String(opt080 || '')");
  });
});
