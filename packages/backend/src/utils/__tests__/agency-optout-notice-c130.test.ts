// replaces: none
/**
 * ★ 2026-11-13 C130 — 대행발송 「수신거부 줄 겹침」 안내(설계서 docs/2026-11-13-c130-agency-optout-notice-reply-body-design.md §2 · §5 T1-1 ~ T1-5)
 *
 * 접수 = 서수란 cmwd36hnr1corjnscq7xlnim1 — 금강제화 11-12 광고 문안 끝 「※ 수신거부 : 080-644-9247」(「무료」 없음) →
 *   buildAdMessage 가 「무료수신거부 080-644-9247」을 한 줄 더 붙였다(의도된 법정 규칙). 발송 글은 그대로 · 확인 자리에서 알린다.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { buildAdMessage, adRejectFooterText, findNonLegalOptOutLines } from '../messageUtils';
import { agencyOptOutNotice, agencyOptOutSmsLine, AGENCY_OPT_OUT_SMS_LINE } from '../agency-send-optout';

const OPT = '080-644-9247';
const KUMKANG = '(광고)[금강제화] 겨울 신발을 더 저렴하게 득템할 기회!\n본문\n※ 수신거부 : 080-644-9247';

describe('T1-1 판정 = 변수 조각을 뺀 글 기준 · 값 범위 표', () => {
  it.each<[string, string, string[]]>([
    ['금강제화 접수 문안(무료 없음)', KUMKANG, ['※ 수신거부 : 080-644-9247']],
    ['무료수신거부(붙여 씀) = 겹침 없음', '본문\n※ 무료수신거부 : 080-644-9247', []],
    ['무료 수신거부(띄어 씀) = 겹침 없음', '본문\n무료 수신거부:080-644-9247', []],
    ['무료거부(SMS) = 겹침 없음', '본문\n무료거부0806449247', []],
    ['법정 문구가 다른 줄에 있으면 모든 수신거부 줄이 겹침 아님', '수신거부 080-1\n무료수신거부 080-2', []],
    ['수신거부 없음', '본문만', []],
    ['빈 글', '', []],
    ['여러 줄 = 순서대로 원문 줄', '  수신거부 080-111  \n가운데\n수신 거부: 080-222', ['수신거부 080-111', '수신 거부: 080-222']],
    ['이름 안 법정 문구는 억제 근거가 아니다', '%무료수신거부번호%\n수신거부:080-1234-5678', ['수신거부:080-1234-5678']],
    ['이름 안에만 수신거부 = 낱말 없음', '안내 %수신거부번호%', []],
    ['조각을 지워 양옆이 합쳐져도 법정 문구가 생기지 않는다(무료%고객명%수신거부)', '무료%고객명%수신거부:080-1', ['무료%고객명%수신거부:080-1']],
    ['조각이 「수신 · 거부」 사이에 끼면 수신거부 낱말이 아니다', '수신%고객명%거부 080-1', []],
    ['숫자 뒤 퍼센트는 변수 아님(그 글자 그대로 판정)', '30%무료수신거부%할인', []],
    ['CRLF 줄바꿈', '본문\r\n수신거부 080-1', ['수신거부 080-1']],
  ])('%s', (_label, text, expected) => {
    expect(findNonLegalOptOutLines(text)).toEqual(expected);
  });

  it('null · undefined = []', () => {
    expect(findNonLegalOptOutLines(null)).toEqual([]);
    expect(findNonLegalOptOutLines(undefined)).toEqual([]);
  });

  it('판정과 발송이 같은 쪽을 본다 — 겹침이라 하면 buildAdMessage 가 실제로 꼬리를 붙이고, 겹침 아니라 하면 수신거부 줄이 하나다', () => {
    for (const text of [KUMKANG, '본문\n※ 무료수신거부 : 080-644-9247', '본문만', '수신거부 080-1\n무료수신거부 080-2']) {
      const out = buildAdMessage(text, 'LMS', true, OPT);
      const dup = findNonLegalOptOutLines(text).length > 0;
      expect(out.endsWith(`\n무료수신거부 ${OPT}`) && /수신\s*거부/.test(text)).toBe(dup);
    }
  });
});

describe('T1-2 꼬리 글 = buildAdMessage 결과의 꼬리와 같은 글', () => {
  it.each([['LMS', OPT], ['MMS', OPT], ['SMS', OPT], ['LMS', ''], ['MMS', ''], ['SMS', '']])('%s · 080=%s', (type, opt) => {
    const out = buildAdMessage('본문', type, true, opt);
    expect(out.endsWith(`\n${adRejectFooterText(type, opt)}`)).toBe(true);
  });
});

describe('T1-3 발송 경로 무변경', () => {
  it('buildAdMessage 결과 스냅숏(대표 입력 12종 · 글자 그대로)', () => {
    const inputs: Array<[string, string, boolean, string]> = [
      ['본문', 'LMS', true, OPT], ['본문', 'SMS', true, OPT], ['본문', 'MMS', true, OPT],
      ['본문', 'LMS', false, OPT], ['본문\n\n', 'LMS', true, OPT], ['(광고) 본문', 'LMS', true, OPT],
      ['（광고）본문', 'SMS', true, OPT], [KUMKANG, 'LMS', true, OPT], ['본문\n무료 수신거부 : 080-1', 'LMS', true, OPT],
      ['본문', 'LMS', true, ''], ['본문', 'SMS', true, ''], ['본문\n무료거부0801', 'SMS', true, OPT],
    ];
    expect(inputs.map((i) => buildAdMessage(...i))).toEqual([
      '(광고) 본문\n무료수신거부 080-644-9247',
      '(광고)본문\n무료거부0806449247',
      '(광고) 본문\n무료수신거부 080-644-9247',
      '본문',
      '(광고) 본문\n\n무료수신거부 080-644-9247',
      '(광고) 본문\n무료수신거부 080-644-9247',
      '（광고）본문\n무료거부0806449247',
      `${KUMKANG}\n무료수신거부 080-644-9247`,
      '(광고) 본문\n무료 수신거부 : 080-1',
      '(광고) 본문\n무료수신거부',
      '(광고)본문\n무료거부',
      '(광고)본문\n무료거부0801',
    ]);
  });

  it('findNonLegalOptOutLines 를 부르는 곳 = agency-send-optout.ts 하나(발송 · 적재 · 미리보기 경로는 부르지 않는다)', () => {
    const root = path.resolve(__dirname, '..', '..');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') walk(p); continue; }
        if (!/\.ts$/.test(e.name)) continue;
        const src = fs.readFileSync(p, 'utf8');
        if (/findNonLegalOptOutLines\s*\(/.test(src)) hits.push(path.relative(root, p).replace(/\\/g, '/'));
      }
    };
    walk(root);
    expect(hits.sort()).toEqual(['utils/agency-send-optout.ts', 'utils/messageUtils.ts']);
  });
});

describe('T1-5 · T1-6 문구', () => {
  it('금강제화 문안 = 세 줄(원문 줄 · 실제 붙는 꼬리 · 고치는 길)', () => {
    const lines = agencyOptOutNotice({ content: KUMKANG, isAd: true, messageType: 'LMS', opt080: OPT, how: 'mail' });
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('「※ 수신거부 : 080-644-9247」');
    expect(lines[1]).toContain('「무료수신거부 080-644-9247」');
    expect(lines[2]).toContain('진행 상황 주소');
  });

  it('SMS 꼬리 · 080 없음 · 비광고 · 겹침 없음', () => {
    expect(agencyOptOutNotice({ content: KUMKANG, isAd: true, messageType: 'SMS', opt080: OPT, how: 'edit' })[1]).toContain('「무료거부0806449247」');
    expect(agencyOptOutNotice({ content: KUMKANG, isAd: true, messageType: 'LMS', opt080: '', how: 'edit' })[1]).toContain('「무료수신거부」');
    expect(agencyOptOutNotice({ content: KUMKANG, isAd: false, messageType: 'LMS', opt080: OPT, how: 'edit' })).toEqual([]);
    expect(agencyOptOutNotice({ content: '본문\n무료수신거부 080-1', isAd: true, messageType: 'LMS', opt080: OPT, how: 'edit' })).toEqual([]);
  });

  it('여러 줄 = 셋까지 · 넘으면 「외 N줄」 · 긴 줄 = 80자 + …', () => {
    const many = ['수신거부 1', '수신거부 2', '수신거부 3', '수신거부 4', `수신거부 ${'가'.repeat(100)}`].join('\n');
    const first = agencyOptOutNotice({ content: many, isAd: true, messageType: 'LMS', opt080: OPT, how: 'staff' })[0];
    expect(first).toContain('「수신거부 1」, 「수신거부 2」, 「수신거부 3」 외 2줄');
    const long = agencyOptOutNotice({ content: `수신거부 ${'가'.repeat(100)}`, isAd: true, messageType: 'LMS', opt080: OPT, how: 'staff' })[0];
    expect(long).toContain(`「수신거부 ${'가'.repeat(75)}…」`);
  });

  it('바깥 문장 = 줄표 · 가운뎃점 0 · 담당자 문자 줄 70자 이하', () => {
    const all = [
      ...(['mail', 'upload', 'edit', 'staff'] as const).flatMap((how) => agencyOptOutNotice({ content: KUMKANG, isAd: true, messageType: 'LMS', opt080: OPT, how })),
      AGENCY_OPT_OUT_SMS_LINE,
    ];
    for (const l of all) expect(l).not.toMatch(/[—–·]/);
    expect(AGENCY_OPT_OUT_SMS_LINE.length).toBeLessThanOrEqual(70);
    expect(agencyOptOutSmsLine({ content: KUMKANG, isAd: true })).toBe(AGENCY_OPT_OUT_SMS_LINE);
    expect(agencyOptOutSmsLine({ content: KUMKANG, isAd: false })).toBe('');
    expect(agencyOptOutSmsLine({ content: '무료수신거부 080-1', isAd: true })).toBe('');
  });
});
