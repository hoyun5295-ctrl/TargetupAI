/**
 * 여정 발송은 문자로 보낼 수 있는 글자를 바꾸지 않는다 (★ 2026-09-26 한줄로 V2 m068 · B-0910-5)
 *
 * 여정 실행기가 발송 직전 CT-46 `sanitizeForSms`를 돌려, 사람이 쓴 문안의 `★ ♥ ☎`을 지우고
 * `▶→>` `※→*` `“”→"`로 바꾸고 연속 공백을 줄였다. 이 글자들은 게이트웨이 CP949 표에 있어 그대로 보낼 수 있다.
 * 같은 부류(발송 경로 무동의 치환)가 B-0910-4 시세이도 클레임이다.
 *
 * 이 파일이 잠그는 것:
 *   ① 보낼 수 있는 글자(ASCII · 한글 음절 · CP949 표)는 한 글자도 바꾸지 않는다 · 공백도 그대로
 *   ② 보낼 수 없는 글자에는 종전 CT-46 규칙 그대로(이모지 제거 · 표의 글자 바꿈) — 기존 동작 유지
 *   ③ 서버 글자표 = 화면 글자표(= 게이트웨이 인코더 표) — 글자 단위로 같다
 *   ④ 실행기 배선: 문자 단계는 새 함수를 부른다(옛 함수 호출 0)
 *   ⑤ 여정 화면 경고는 같은 판정(보낼 수 있는 기호를 경고하지 않는다)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { sanitizeUnsendableForSms, sanitizeForSms } from '../message-sanitizer';
import { isSmsEncodableChar } from '../sms-charset';
import { CP949_NON_HANGUL_CHARS as BACK_CHARS } from '../cp949-chars';
import { CP949_NON_HANGUL_CHARS as FRONT_CHARS } from '../../../../frontend/src/utils/cp949Chars';

describe('보낼 수 있는 글자는 그대로', () => {
  it('특수문자함 기호·따옴표·화살표를 바꾸지 않는다', () => {
    const text = '★오늘만☆ ♥감사♡ ☎문의 ▶바로가기 ※유의 “특가” ◆■●';
    const r = sanitizeUnsendableForSms(text);
    expect(r.sanitized).toBe(text);
    expect(r.hadChanges).toBe(false);
  });

  it('공백·줄바꿈을 줄이지 않는다', () => {
    const text = '안녕하세요    고객님\n\n\n\n\n감사합니다';
    expect(sanitizeUnsendableForSms(text).sanitized).toBe(text);
  });

  it('%변수%·한글·영문·숫자는 그대로', () => {
    const text = '%이름%님 30%할인 VIP 10,000원';
    expect(sanitizeUnsendableForSms(text).sanitized).toBe(text);
  });
});

describe('보낼 수 없는 글자는 종전 규칙', () => {
  it('이모지는 지운다', () => {
    expect(sanitizeUnsendableForSms('🎉축하합니다🎂').sanitized).toBe('축하합니다');
  });

  it('CT-46 표의 글자 중 CP949에 없는 것은 종전대로 바꾼다', () => {
    // en dash(U+2013)는 CP949에 없다 → 종전 CT-46 '-'
    expect(isSmsEncodableChar('–')).toBe(false);
    expect(sanitizeUnsendableForSms('A–B').sanitized).toBe(sanitizeForSms('A–B').sanitized);
  });

  it('보이지 않는 글자는 지운다', () => {
    expect(sanitizeUnsendableForSms('가​나﻿다').sanitized).toBe('가나다');
  });
});

describe('서버 글자표 = 화면 글자표', () => {
  it('글자 단위로 같다', () => {
    expect(BACK_CHARS).toBe(FRONT_CHARS);
  });
  it('판정 기준: ASCII · 한글 음절 · 표', () => {
    expect(isSmsEncodableChar('A')).toBe(true);
    expect(isSmsEncodableChar('똠')).toBe(true);
    expect(isSmsEncodableChar('★')).toBe(true);
    expect(isSmsEncodableChar('🎉')).toBe(false);
  });
});

describe('배선', () => {
  const executor = readFileSync(resolve(__dirname, '../journey-executor.ts'), 'utf8');
  it('여정 실행기 문자 단계는 새 함수를 부른다', () => {
    expect(executor).toContain('sanitizeUnsendableForSms(step.message_template');
    expect(executor).toContain('sanitizeUnsendableForSms(step.subject');
    expect(executor).not.toMatch(/sanitizeForSms\(step\./);
  });

  const page = readFileSync(resolve(__dirname, '../../../../frontend/src/pages/JourneysPage.tsx'), 'utf8');
  it('여정 화면 경고는 화면 글자표 판정을 쓴다', () => {
    expect(page).toContain('findUnsupportedSmsChars');
    expect(page).not.toContain('UNSAFE_SPECIAL_FE');
  });
});
