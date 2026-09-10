/**
 * 대행발송 화면의 (광고) 표시 = 실제 발송과 같은 규칙 (★2026-09-10 남지현 접수 cmtuvzmoy0crqjnotnndf6p25)
 *
 * 기원
 *   담당자 링크 승인 화면이 광고 건이면 제목 앞에 "(광고) "를 조건 없이 붙였다.
 *   요청서 제목에 이미 (광고)를 적은 건이 "(광고) (광고)[금강제화]…"로 보였다.
 *   스팸 검사·담당자 테스트 문자·본 발송은 buildAdSubject(이미 붙어 있으면 안 붙임)를 지나 한 번만 붙는다.
 *   화면 접수 미리보기(AgencySendComposer)도 같은 모양이었다(제목 · SMS 본문 앞).
 *
 * 못 박는 것
 *   1. 프론트 판정(buildAdSubjectFront · startsWithAdMark)이 백엔드 발송 규칙과 같은 답을 낸다.
 *   2. 두 화면이 그 CT를 쓰고, 조건 없는 "(광고) " 부착으로 되돌아가지 않는다.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { buildAdSubject } from '../messageUtils';
import { buildAdSubjectFront, startsWithAdMark } from '../../../../frontend/src/utils/formatDate';

const FRONT = path.resolve(__dirname, '../../../../frontend/src');
const read = (p: string) => fs.readFileSync(path.join(FRONT, p), 'utf8');

const SAMPLES = [
  '(광고)[금강제화] 추석맞이 주말 단독 기획, 특별 SALE',
  '(광고) 가을 신상',
  '  (광고)앞 공백',
  '（광고） 전각 괄호',
  '( 광고 ) 괄호 안 공백',
  '[금강제화] (광고) 가운데에 있는 표기',
  '광고 없는 제목',
  '',
];

describe('대행발송 (광고) 판정 = 발송 규칙', () => {
  it('제목: 화면 표시와 실제 발송이 같은 문장이다(이미 붙은 제목에 다시 붙이지 않는다)', () => {
    for (const s of SAMPLES) {
      for (const type of ['LMS', 'MMS']) {
        expect(buildAdSubjectFront(s, type, true), `"${s}" ${type}`).toBe(buildAdSubject(s, type, true));
      }
    }
    // 접수 실물 그대로
    expect(buildAdSubjectFront('(광고)[금강제화] 추석맞이 주말 단독 기획, 특별 SALE', 'LMS', true))
      .toBe('(광고)[금강제화] 추석맞이 주말 단독 기획, 특별 SALE');
  });

  it('startsWithAdMark: 발송 CT가 "이미 붙어 있다"고 보는 문장만 참이다', () => {
    for (const s of SAMPLES) {
      const sentAsIs = s !== '' && buildAdSubject(s, 'LMS', true) === s;
      expect(startsWithAdMark(s), `"${s}"`).toBe(sentAsIs);
    }
  });
});

describe('대행발송 화면이 그 판정을 쓴다', () => {
  it('담당자 링크 승인 화면: 제목은 buildAdSubjectFront 한 벌로 그린다', () => {
    const src = read('pages/AgencyApprovePage.tsx');
    expect(src).toMatch(/buildAdSubjectFront\(r\.subject \|\| '', r\.messageType, r\.isAd\)/);
    expect(src, '조건 없이 "(광고) "를 붙이던 형태가 되살아났다').not.toMatch(/isAd \? '\(광고\) ' : ''/);
  });

  it('화면 접수 미리보기: 제목은 CT로, SMS 본문 앞 표기는 이미 붙어 있으면 안 그린다', () => {
    const src = read('components/agency/AgencySendComposer.tsx');
    expect(src).toMatch(/buildAdSubjectFront\(subject \|\| '제목', messageType, isAd\)/);
    expect(src).toMatch(/messageType === 'SMS' && isAd && !startsWithAdMark\(content\) &&/);
    expect(src, '조건 없이 "(광고) "를 붙이던 형태가 되살아났다').not.toMatch(/isAd \? '\(광고\) ' : ''/);
  });

  it('대행발송 화면 어디에도 조건 없는 "(광고) " 삼항 부착이 없다', () => {
    const files = [
      'pages/AgencyApprovePage.tsx',
      'pages/AgencySendPage.tsx',
      'components/admin/AgencySendLedgerPanel.tsx',
      ...fs.readdirSync(path.join(FRONT, 'components/agency'))
        .filter((f) => f.endsWith('.tsx'))
        .map((f) => `components/agency/${f}`),
    ];
    for (const f of files) {
      expect(read(f), f).not.toMatch(/\? '\(광고\) ' : ''/);
    }
  });
});
