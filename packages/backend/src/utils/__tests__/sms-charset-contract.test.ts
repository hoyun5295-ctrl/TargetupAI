/**
 * 규격 밖 글자 계약 테스트 (2026-09-10 신설 · 설계 = docs/2026-09-10-unsupported-char-substitution-design.md §3·§7)
 *
 * 1. 한줄로 글자표(`frontend/utils/cp949Chars.ts`) = 게이트웨이 Go `korean.EUCKR`(x/text v0.41.0) 표.
 *    전체 집합의 SHA-256 을 게이트웨이 쪽에서 잰 값과 대조한다. 한 글자라도 다르면 여기서 멈춘다.
 * 2. 대체표 불변식: 원래 글자 ∉ CP949 · 바꿀 글자 ∈ CP949 · 원래 글자 중복 0.
 *    표의 정규 문자열 해시 = 게이트웨이 표와 같은 값(게이트웨이 P3 Go 테스트가 같은 값을 고정한다 · 불변 6).
 * 3. CP949 에 있는 글자는 절대 바꾸지 않는다(불변 2 · 설계 §3-2 불변 목록 · 특수문자함 49자).
 * 4. 표에 없는 글자는 바꾸지 않고 replacement=null 로 남긴다(불변 3).
 * 5. 작성 화면 배선: P2 대상 화면이 `SmsCharsetNotice` 를 부르고, 발송·저장 진입을 막는다(결정 D2).
 *    부르는 곳이 없는 검사는 없는 것보다 나쁘다.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join, relative } from 'path';
import { CP949_NON_HANGUL_CHARS } from '../../../../frontend/src/utils/cp949Chars';
import {
  SMS_CHAR_SUBSTITUTIONS,
  SMS_SAFE_CHARS,
  isSmsEncodableChar,
  findUnsupportedSmsChars,
  substituteSmsChars,
  hasUnsupportedSmsChars,
} from '../../../../frontend/src/utils/smsSafeChars';

const FRONT_SRC = resolve(__dirname, '../../../../frontend/src');

// 게이트웨이 쪽 실측값(2026-09-10): x/text v0.41.0 korean.EUCKR 이 인코딩하는 U+0080~U+FFFF 글자를 코드 순으로 이은 UTF-8 의 SHA-256.
const GATEWAY_CP949_SET_SHA256 = '0a32f153acbbdf7385629ad3d0bfca54944a950d5eef68a265a3e16277d397c8';
const GATEWAY_CP949_SET_SIZE = 17048;
// 대체표 v1 정규 문자열의 SHA-256. 정규 문자열 = 원래 글자 코드 순 정렬, 한 줄에 `원래>바꿀`(코드 4자리 대문자 16진, 바꿀 글자 여럿이면 공백) · 줄바꿈 연결.
const SUBSTITUTION_TABLE_V1_SHA256 = '691a2b98ed174247af5360e025e42393cd8d1a4fa567f31fd9ec380431292d9b';

const hex = (ch: string) => (ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0');
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('글자표 = 게이트웨이 CP949 인코더 표', () => {
  it('한글 음절 전부 + 싣는 표 = 게이트웨이 집합과 글자 단위로 같다', () => {
    const rest = Array.from(CP949_NON_HANGUL_CHARS).map((c) => c.codePointAt(0) ?? 0);
    expect(rest.every((cp) => cp >= 0x80 && cp <= 0xffff && !(cp >= 0xac00 && cp <= 0xd7a3))).toBe(true);
    expect(new Set(rest).size).toBe(rest.length);
    const hangul: number[] = [];
    for (let cp = 0xac00; cp <= 0xd7a3; cp++) hangul.push(cp);
    const full = rest.concat(hangul).sort((a, b) => a - b).map((cp) => String.fromCodePoint(cp)).join('');
    expect(Array.from(full).length).toBe(GATEWAY_CP949_SET_SIZE);
    expect(sha256(full)).toBe(GATEWAY_CP949_SET_SHA256);
  });

  it('판정 함수가 표와 같은 답을 낸다: ASCII 전부 · 확장 한글 · 한자 · 기호', () => {
    for (let cp = 0; cp < 0x80; cp++) expect(isSmsEncodableChar(String.fromCharCode(cp))).toBe(true);
    for (const ch of ['똠', '햏', '뷁', '가', '漢', '€', '®', '―', '·', '√', '♥', '★']) expect(isSmsEncodableChar(ch)).toBe(true);
    for (const ch of ['–', '—', '•', '✓', '❤', '⭐', '\u00A0', '\uFE0F', '🎉']) expect(isSmsEncodableChar(ch)).toBe(false);
  });
});

describe('대체표 v1 불변식', () => {
  it('38행 · 원래 글자는 한 글자이고 CP949 에 없다 · 중복 0', () => {
    expect(SMS_CHAR_SUBSTITUTIONS).toHaveLength(38);
    const froms = SMS_CHAR_SUBSTITUTIONS.map(([f]) => f);
    expect(new Set(froms).size).toBe(38);
    for (const f of froms) {
      expect(Array.from(f)).toHaveLength(1);
      expect(isSmsEncodableChar(f)).toBe(false);
    }
  });

  it('바꿀 글자는 전부 CP949 에 있다(지움 포함)', () => {
    for (const [, t] of SMS_CHAR_SUBSTITUTIONS) {
      expect(Array.from(t).every(isSmsEncodableChar)).toBe(true);
    }
  });

  it('표의 정규 해시 = 게이트웨이와 공유하는 계약값', () => {
    const canonical = [...SMS_CHAR_SUBSTITUTIONS]
      .sort((a, b) => (a[0].codePointAt(0) ?? 0) - (b[0].codePointAt(0) ?? 0))
      .map(([f, t]) => `${hex(f)}>${Array.from(t).map(hex).join(' ')}`)
      .join('\n');
    expect(sha256(canonical)).toBe(SUBSTITUTION_TABLE_V1_SHA256);
  });
});

describe('CP949 에 있는 글자는 바꾸지 않는다', () => {
  it('보낼 수 있는 글자 17,048자 + ASCII 전부 그대로', () => {
    const all = Array.from(CP949_NON_HANGUL_CHARS).join('') + String.fromCharCode(...Array.from({ length: 0x80 }, (_, i) => i));
    expect(substituteSmsChars(all)).toBe(all);
    expect(substituteSmsChars('가나다 똠방각하 햏')).toBe('가나다 똠방각하 햏');
    expect(findUnsupportedSmsChars(all)).toEqual([]);
  });

  it('설계 §3-2 불변 목록 22자와 특수문자함 49자는 보낼 수 있고 그대로 둔다', () => {
    const keep = ['★', '☆', '♥', '♡', '☎', '▶', '◀', '※', '●', '○', '◆', '■', '“', '”', '‘', '’', '…', '·', '→', '√', '×', '―'];
    for (const ch of [...keep, ...SMS_SAFE_CHARS]) {
      expect(isSmsEncodableChar(ch)).toBe(true);
      expect(substituteSmsChars(ch)).toBe(ch);
    }
  });
});

describe('찾기·바꾸기', () => {
  const sample = '[행사] 10% 할인 – 오늘만 ✓ 사랑해요 ❤\uFE0F 🎉 • 끝 – ';

  it('보낼 수 없는 글자를 처음 나온 순서로 모으고 표에 없으면 replacement=null', () => {
    expect(findUnsupportedSmsChars(sample)).toEqual([
      { char: '–', code: 'U+2013', count: 2, replacement: '-' },
      { char: '✓', code: 'U+2713', count: 1, replacement: '√' },
      { char: '❤', code: 'U+2764', count: 1, replacement: '♥' },
      { char: '\uFE0F', code: 'U+FE0F', count: 1, replacement: '' },
      { char: '🎉', code: 'U+1F389', count: 1, replacement: null },
      { char: '•', code: 'U+2022', count: 1, replacement: '·' },
    ]);
  });

  it('표에 있는 글자만 바꾸고 표에 없는 글자는 남긴다 · 다시 바꿔도 같다', () => {
    const once = substituteSmsChars(sample);
    expect(once).toBe('[행사] 10% 할인 - 오늘만 √ 사랑해요 ♥ 🎉 · 끝 - ');
    expect(substituteSmsChars(once)).toBe(once);
    expect(findUnsupportedSmsChars(once)).toEqual([{ char: '🎉', code: 'U+1F389', count: 1, replacement: null }]);
  });

  it('줄 없는 공백·보이지 않는 글자·변형 선택자 처리', () => {
    expect(substituteSmsChars('A\u00A0B\u200BC\uFEFF❤\uFE0F')).toBe('A BC♥');
    expect(substituteSmsChars('')).toBe('');
  });

  it('발송 진입 차단 판정: 하나라도 남으면 true, 비었거나 전부 보낼 수 있으면 false', () => {
    expect(hasUnsupportedSmsChars('가나다 ★ %이름%님', '제목')).toBe(false);
    expect(hasUnsupportedSmsChars('', null, undefined)).toBe(false);
    expect(hasUnsupportedSmsChars('본문', '제목 – 부제')).toBe(true);
    expect(hasUnsupportedSmsChars(substituteSmsChars(sample))).toBe(true); // 🎉 는 표에 없어 남는다
    expect(hasUnsupportedSmsChars(substituteSmsChars('할인 – ✓'))).toBe(false);
  });
});

describe('작성 화면 배선 (P2)', () => {
  // 고객이 문자 문안을 쓰거나 고치는 화면. 여정 3화면은 발송 경로가 CT-46 으로 문안을 다시 바꾸므로 P4(B-0910-5)에서 함께 한다.
  const SCREENS = [
    'components/DirectSendPanel.tsx',
    'components/TargetSendModal.tsx',
    'components/AiCustomSendFlow.tsx',
    'components/AiCampaignResultPopup.tsx',
    'components/AutoSendFormModal.tsx',
    'components/ScheduledCampaignModal.tsx',
    'components/DmSendAndTrackModal.tsx',
    'components/MessageEditorModal.tsx',
    'pages/AiOperatorPage.tsx',
    'components/agency/AgencySendComposer.tsx',
    'components/agency/AgencySendDetail.tsx',
    'components/automarketing/ProposalDecisionCard.tsx',
  ];

  it.each(SCREENS)('%s 가 SmsCharsetNotice 를 부른다', (rel) => {
    const src = readFileSync(join(FRONT_SRC, rel), 'utf8');
    expect(src).toMatch(/import SmsCharsetNotice from '[./]+(components\/)?SmsCharsetNotice'/);
    expect(src).toMatch(/<SmsCharsetNotice\b/);
  });

  // 결정 D2 = 작성 화면에서 막는다. 문안 편집기(MessageEditorModal)는 문안을 돌려줄 뿐 보내지 않으므로 받는 화면(AiOperatorPage)이 막는다.
  it.each(SCREENS.filter((rel) => rel !== 'components/MessageEditorModal.tsx'))('%s 가 발송·저장 진입을 막는다', (rel) => {
    const src = readFileSync(join(FRONT_SRC, rel), 'utf8');
    expect(src).toMatch(/hasUnsupportedSmsChars\(/);
    expect(src).toMatch(/SMS_CHARSET_BLOCK_MESSAGE/);
  });

  it('자동발송은 직접 쓰는 본문과 AI 실패 대비 문안 두 곳 모두', () => {
    const src = readFileSync(join(FRONT_SRC, 'components/AutoSendFormModal.tsx'), 'utf8');
    expect(src.match(/<SmsCharsetNotice\b/g)?.length).toBe(2);
  });

  it('인라인 이모지 판정이 남아 있지 않다(판정은 smsSafeChars.ts 하나)', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!/\.(ts|tsx)$/.test(name)) continue;
        const src = readFileSync(p, 'utf8');
        if (/const hasEmoji\s*=|hasIncompatibleEmoji/.test(src)) offenders.push(relative(FRONT_SRC, p));
      }
    };
    walk(FRONT_SRC);
    expect(offenders).toEqual([]);
  });
});
