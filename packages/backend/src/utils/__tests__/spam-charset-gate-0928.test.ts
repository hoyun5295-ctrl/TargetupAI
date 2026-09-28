/**
 * 스팸 검사 글자 검사 (★2026-09-28 · 실측 = 폭 없는 공백 U+200B 15곳 문안이 4번 모두 게이트웨이 9401 반려)
 *
 * 스팸 검사 시작(routes/spam-filter.ts POST /test)은 글자 검사 없이 문안을 테스트 라인에 적재했다.
 * 게이트웨이가 CP949에 없는 글자를 9401로 되돌려 3사 모두 '전달 실패'가 떴고, 체험 검사는 횟수까지 빠졌다.
 * 발송 버튼(DirectSendPanel)은 같은 글자를 막는데 검사 입구만 비어 있었다.
 *
 * 못 박는 것
 *   1. 서버 판정 CT(sms-charset)가 여러 문장에서 보낼 수 없는 글자를 코드값으로 모은다(중복 1번 · CP949 글자는 통과).
 *   2. 검사 입구는 실제로 나갈 본문·제목을 한 번 만들고 그 값으로 판정한다. 막히면 검사 행·체험 횟수·차감 전에 400.
 *   3. 적재 반복은 판정한 그 값을 그대로 보낸다(검사한 글 = 보내는 글 · 반복 안에서 다시 만들지 않는다).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { unsupportedSmsCharCodes } from '../sms-charset';

const route = readFileSync(join(__dirname, '..', '..', 'routes', 'spam-filter.ts'), 'utf8');

describe('unsupportedSmsCharCodes — 보낼 수 없는 글자 코드값', () => {
  it('폭 없는 공백은 여러 곳이어도 한 번만 · 코드값으로 돌려준다', () => {
    expect(unsupportedSmsCharCodes('안내​\n\n​그동안​')).toEqual(['U+200B']);
  });

  it('CP949에 있는 글자(☏ ▶ ※ ★)와 한글·ASCII·줄바꿈은 통과한다', () => {
    expect(unsupportedSmsCharCodes('☏문의 : 02-2163-1164\r\n▶ 혜택 ※ ★ (광고) https://bit.ly/3T6nPe0')).toEqual([]);
  });

  it('이모지는 한 글자로 센다 · 제목과 본문을 함께 본다 · 빈 값은 건너뛴다', () => {
    expect(unsupportedSmsCharCodes('본문 🎉', null, undefined, '', '제목 –')).toEqual(['U+1F389', 'U+2013']);
  });
});

describe('스팸 검사 입구 — 글자 검사 위치', () => {
  const handler = route.slice(route.indexOf("router.post('/test'"), route.indexOf('// 7) 15초 폴링'));

  it('나갈 본문·제목을 한 번 만들고 그 값으로 판정해 400을 돌려준다', () => {
    expect(handler).toContain('const outgoing = messageTypes.map((msgType) => {');
    expect(handler).toContain('unsupportedSmsCharCodes(...outgoing.flatMap((o) => [o.content, o.titleStr]))');
    expect(handler).toMatch(/return res\.status\(400\)\.json\(\{[^}]*code: 'SMS_UNSUPPORTED_CHARS'/);
  });

  it('판정은 검사 행 INSERT · 체험 횟수 · 선불 차감보다 앞이다', () => {
    const gate = handler.indexOf("code: 'SMS_UNSUPPORTED_CHARS'");
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(handler.indexOf('INSERT INTO spam_filter_tests'));
    expect(gate).toBeLessThan(handler.indexOf('countSpamTrialsInTx('));
    expect(gate).toBeLessThan(handler.indexOf('prepaidDeduct('));
  });

  it('적재 반복은 판정한 값을 그대로 보낸다 · 반복 안에서 치환·제목을 다시 만들지 않는다', () => {
    const loop = handler.slice(handler.indexOf('for (const device of devices.rows) {'), handler.indexOf('} catch (sendErr) {'));
    expect(loop).toContain('for (const { msgType, content, titleStr } of outgoing) {');
    expect(loop).not.toContain('replaceVariables(');
    expect(loop).not.toContain('buildAdSubject(');
    expect(handler.match(/replaceVariables\(rawContent/g)?.length).toBe(1);
  });
});
