// replaces: none
/**
 * C160 가 묶음 ② 없는 변수 · 주소 인코딩 조각(★ 2026-11-22 · 설계서 docs/2026-11-22-c160-unknown-variable-design.md)
 *   S1 ① 완성된 UTF-8 인코딩 묶음은 조각이 아니다(백 · 프론트 같은 표) · 숫자 규칙은 묶음 끝 숫자에 걸리지 않는다
 *      ② 2단계 글자 대조(매핑 이름마다 %이름%)도 인코딩 자리를 건너뛴다 ③ Liquid 태그는 없는 변수 판정에서만 뺀다(조각 판정 · 대행 칸은 그대로)
 *      ④ 변수 조각 + 인코딩 바이트가 함께 든 SMS 글은 하한을 내지 않는다
 *   S2 길목 판정 한 함수(채울 자리 → 없는 변수) · 새 코드 소비처(확실히 안 나감 · 사유 · 알림)
 *   S3 옛 함수의 밖 호출 = 둘뿐 · S4 확정 때 커스텀 칼럼 매핑 싣기 · 일꾼이 덮기
 * 기대값 = 서버 흔적의 꼴(`B1-15g-x-30`) · 손으로 센 값 · 설계 단계 시제품 실행 값.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { stripComments } from './helpers/producer-scan';
import { findVarTokens, unknownVarNames, replaceLiteralVar, hasLiteralVar, sendBodyVars } from '../var-tokens';
import { replaceVariables, cleanLeftoverVars, pickCustomVarMappings, mergeStoredVarMappings } from '../messageUtils';
import { smsMinBytes } from '../sms-length';
import { findSendCopyIssue, knownSendVarNames, unknownVarMessage, journeyCopyIssue } from '../send-placeholder-gate';
import { LINK_PLACEHOLDER } from '../brand-link-core';
import { buildSlotPlan } from '../agency-send-vars';
import { splitVariantIssue } from '../campaign-split-rules';
import { sendRejectReason } from '../planner-reasons';
import { DEFINITE_NO_COMMIT } from '../planner-executor';
import { buildSpamTestResultNotifyMessage } from '../auto-notify-message';
import { eucKrByteLength } from '../message-byte';
import type { VarCatalogEntry } from '../../services/ai';
// 테스트 전용 import — 화면 미러의 실제 값을 비교한다
import * as front from '../../../../frontend/src/utils/formatDate';
import * as frontAsk from '../../../../frontend/src/utils/ai-ask';

const BE = join(__dirname, '..', '..');
const FE = join(__dirname, '..', '..', '..', '..', 'frontend', 'src');
const read = (p: string) => stripComments(readFileSync(p, 'utf8').replace(/\r\n/g, '\n'));
const be = (rel: string) => read(join(BE, rel));
const fe = (rel: string) => read(join(FE, rel));
const count = (src: string, needle: string) => src.split(needle).length - 1;

const custom = (column: string): VarCatalogEntry => ({ column, type: 'string', description: '', sample: '', storageType: 'custom_fields' });
const names = (t: string) => findVarTokens(t).map((x) => x.name);
const frontNames = (t: string) => front.findVarTokens(t).map((x) => x.name);

// ── S1 ① 조각 판정(백 · 프론트 같은 값) ──────────────────────────
const TOKEN_TABLE: Array<[string, string[]]> = [
  ['https://shop.example/p/%EC%9D%B4%EB%A6%84-15g-x-30', []],
  ['https://shop.example/p/%ED%8B%B1-15g-x-30%EC%9D%B4', []],   // 서버 흔적 B1-15g-x-30 의 꼴(B1 = 묶음의 셋째 바이트)
  ['https://x.example/%C2%AB%CD_COMPANY%', ['CD_COMPANY']],      // 묶음 뒤 진짜 변수(설계 Codex 1R #2)
  ['%ec%9d%b4%이름%', ['이름']],                                  // 소문자 · 묶음 끝 4 가 숫자 규칙에 걸리지 않음
  ['%EC%9D%B4%없는%', ['없는']],
  ['%EC%9D%B4%CD_A%', ['CD_A']],
  ['%20%이름%', []],                                              // 묶음이 아닌 %XX 뒤 = 지금 그대로(숫자 규칙)
  ['30%EC%9D%B4', []],
  ['%C7%D1%B1%DB', ['C7']],                                       // EUC-KR = 묶음 꼴이 아닌 부분만 조각(§8-9)
  ['A %EB%B8%94%EB%A3%A8 B', []],
  ['https://ko.wikipedia.org/wiki/%EB%8C%80%ED%95%9C%EB%AF%BC%EA%B5%AD', []],
  ['😀 %F0%9F%98%80 %E2%80%99', []],                              // 4바이트 · 3바이트 기호
  ['최대 30%+5% 쿠폰', []],
  ['~44%↓', []],
  ['%이름%님 %CD_COMPANY% %기타1%', ['이름', 'CD_COMPANY', '기타1']],
  ['https://x.example/c/%기타1%?n=%EC%9D%B4', ['기타1']],
  ['10%할인%이름%', ['이름']],
  ['%C2%AB_X%', []],                                              // 정한 한계(못 채운 첫 바이트 뒤 A0 ~ BF 로 시작하는 이름)
  ['안내 {%쿠폰%}', ['쿠폰']],                                    // 조각 판정은 Liquid 를 가르지 않는다(대행 칸)
  ['{%else%}', ['else']],
];

describe('S1 ① 인코딩 묶음은 조각이 아니다', () => {
  it.each(TOKEN_TABLE)('백엔드 %s', (text, want) => { expect(names(text)).toEqual(want); });
  it.each(TOKEN_TABLE)('화면 미러 %s', (text, want) => { expect(frontNames(text)).toEqual(want); });

  it('발송 3단계가 인코딩 주소를 지우지 않는다(지금 = …/9DEB84-15g-x-30)', () => {
    const url = 'https://shop.example/p/%EC%9D%B4%EB%A6%84-15g-x-30';
    expect(cleanLeftoverVars(`링크 ${url} %오타%`)).toBe(`링크 ${url} `);
    expect(replaceVariables(`링크 ${url}`, null, {})).toBe(`링크 ${url}`);
    expect(front.cleanLeftoverVars(`링크 ${url} %오타%`)).toBe(`링크 ${url} `);
  });

  it('대행 칸 = 한글 인코딩 주소에 칸을 주지 않는다 · 중괄호 변수는 지금처럼 칸', () => {
    expect(buildSlotPlan('https://x.test/%EC%9D%B4%EB%A6%84 %쿠폰%').order).toEqual(['쿠폰']);
    expect(buildSlotPlan('안내 {%쿠폰%}').slotContent).toBe('안내 {%이름%}');   // 설계 Codex 2R #1
  });

  it('나눠 보내기 = 인코딩 주소의 거짓 VAR_IN_LINK 가 풀리고 진짜 변수는 그대로 막힌다', () => {
    expect(splitVariantIssue({ text: '링크 https://x.example/p/%ED%8B%B1-15g-x-30%EC%9D%B4' }, 'SMS')).toBeNull();
    expect(splitVariantIssue({ text: '링크 https://x.example/%C2%AB%CD_COMPANY%' }, 'SMS')?.code).toBe('VAR_IN_LINK');
  });

  it('치환이 바꿀 것이 있는가 = 인코딩 주소만 든 글은 없음', () => {
    expect(sendBodyVars('안내 %EC%9D%B4%EB%A6%84', ['EC']).any).toBe(false);
    expect(frontAsk.askSendChannel('SMS', '안내 %EC%9D%B4%EB%A6%84', ['EC'])).toBe('SMS');
    expect(sendBodyVars('%EC% 쿠폰', ['EC']).any).toBe(true);
    expect(frontAsk.askSendChannel('SMS', '%EC% 쿠폰', ['EC'])).toBe('LMS');
  });
});

// ── S1 ② 2단계 글자 대조 ───────────────────────────────────────
const LITERAL_TABLE: Array<[string, string, string, string]> = [
  ['a %EC%9D%B4 b %EC% c', '%EC%', 'x', 'a %EC%9D%B4 b x c'],
  ['%금액%원 %금액%', '%금액%', '5,000', '5,000원 5,000'],
  ['%A%%A%', '%A%', '1', '11'],
  ['값 $&', '%없음%', 'x', '값 $&'],
];

describe('S1 ② 매핑 이름 글자 대조도 인코딩 자리를 건너뛴다', () => {
  it.each(LITERAL_TABLE)('백엔드 %s', (text, token, value, want) => {
    expect(replaceLiteralVar(text, token, value)).toBe(want);
  });
  it.each(LITERAL_TABLE)('화면 미러 %s', (text, token, value, want) => { expect(front.replaceLiteralVar(text, token, value)).toBe(want); });

  it('없는 글자는 바꾸지 않고 · 인코딩 자리만 있으면 없음', () => {
    expect(hasLiteralVar('https://x.test/%EC%9D%B4', '%EC%')).toBe(false);
    expect(hasLiteralVar('%EC% 안내', '%EC%')).toBe(true);
    expect(front.hasLiteralVar('https://x.test/%EC%9D%B4', '%EC%')).toBe(false);
  });

  it('발송 치환 전체 = 16진수 두 글자 매핑이 있어도 주소 그대로 · 홀로 선 변수는 채운다', () => {
    const map = { EC: custom('custom_1') };
    const out = replaceVariables('a https://x.test/%EC%9D%B4 b %EC% c', { custom_fields: { custom_1: 'x' } }, map);
    expect(out).toBe('a https://x.test/%EC%9D%B4 b x c');
  });

  it('직접발송 미리보기(replaceVarsByFieldMeta) = 백엔드와 같은 값(설계 Codex 3R #2)', () => {
    const out = front.replaceVarsByFieldMeta('https://x.test/%EC%9D%B4', { custom_1: 'x' }, [{ field_key: 'custom_1', variable: '%EC%', display_name: 'EC' } as any]);
    expect(out).toBe('https://x.test/%EC%9D%B4');
    expect(front.replaceVarsByFieldMeta('%EC%님', { custom_1: 'x' }, [{ field_key: 'custom_1', variable: '%EC%', display_name: 'EC' } as any])).toBe('x님');
  });
});

// ── S1 ③ Liquid 태그 · ④ SMS 하한 ───────────────────────────────
describe('S1 ③ 없는 변수 판정만 Liquid 태그를 뺀다', () => {
  it('공백 없는 태그 · 주석은 없는 변수가 아니다 · 진짜 없는 변수는 잡는다', () => {
    const none = new Set<string>();
    expect(unknownVarNames('{% if customer.name %}안녕{%else%}반가워{%endif%} %없음%', none)).toEqual(['없음']);
    expect(unknownVarNames('{%comment%}x{%endcomment%}', none)).toEqual([]);
    expect(unknownVarNames('%EC%9D%B4%없는%', none)).toEqual(['없는']);
    expect(unknownVarNames('https://x.test/%EC%9D%B4%EB%A6%84', none)).toEqual([]);
  });
});

describe('S1 ④ SMS 하한', () => {
  const base = { isAd: false, opt080: '', sanitize: false };
  it('변수 없는 인코딩 주소 = 실제 길이(91 · exact) · 발송 치환 결과와 같다(설계 Codex 2R #2)', () => {
    const t = `${'a'.repeat(82)}%EC%9D%B4`;
    expect(smsMinBytes({ template: t, ...base })).toEqual({ bytes: 91, exact: true, hasVars: false });
    expect(eucKrByteLength(replaceVariables(t, { custom_fields: { custom_1: 'x' } }, { EC: custom('custom_1') }))).toBe(91);
  });
  it('변수 조각 + 인코딩 바이트 = 하한을 내지 않는다(3R #1 · 4R #2)', () => {
    expect(smsMinBytes({ template: `${'a'.repeat(82)}%X%EC%9D%B4%`, ...base })).toBeNull();
    expect(smsMinBytes({ template: `${'a'.repeat(82)}%EC%X%%9D%B4`, ...base })).toBeNull();
  });
  it('인코딩 없는 변수 글 = 지금 값 그대로(4R #1)', () => {
    expect(smsMinBytes({ template: `${'a'.repeat(80)}%회원등급정보%기타1%`, ...base })).toEqual({ bytes: 86, exact: false, hasVars: true });
    expect(smsMinBytes({ template: '%이름%님 안녕', ...base })?.hasVars).toBe(true);
    expect(smsMinBytes({ template: '안녕하세요', ...base })).toEqual({ bytes: 10, exact: true, hasVars: false });
  });
});

// ── 구현 Codex 1R ───────────────────────────────────────────────
describe('구현 1R #2 Liquid 주석 안의 조각은 없는 변수가 아니다(렌더가 통째로 버린다)', () => {
  it('주석 안 = 통과 · 주석 밖 = 잡는다 · 공백 없는 주석 태그도', () => {
    const none = new Set<string>();
    expect(unknownVarNames('안내{% comment %}%폐기된항목%{% endcomment %}', none)).toEqual([]);
    expect(unknownVarNames('{%comment%}%x%{%endcomment%} %없음%', none)).toEqual(['없음']);
    expect(replaceVariables('안내{% comment %}%폐기된항목%{% endcomment %}', null, {})).toBe('안내');
    expect(findSendCopyIssue({ bodies: ['안내{% comment %}%폐기된항목%{% endcomment %}'] }, knownSendVarNames([], true))).toBeNull();
  });
  it('구현 2R — 렌더 파서와 같은 경계(endcomment-note 는 닫는 태그가 아니다) · 파싱이 실패하면 주석 안 조각도 닿는다', () => {
    const none = new Set<string>();
    const ok = '{% comment %}{% endcomment-note %}%폐기된항목%{% endcomment %}안내';
    expect(unknownVarNames(ok, none)).toEqual([]);
    expect(replaceVariables(ok, null, {})).toBe('안내');
    const broken = '{% comment %}보유 %금액%원{% endcomment %}{% comment %}';
    expect(unknownVarNames(broken, none)).toEqual(['금액']);
    expect(replaceVariables(broken, null, {})).toBe('보유 원');
  });
  it('구현 4R — default 대체 글자의 없는 변수를 잡는다 · 아는 이름은 통과', () => {
    const t = `{{ customer.name | default: '%닉네임%' }}님, 안내드립니다.`;
    expect(unknownVarNames(t, new Set(['이름']))).toEqual(['닉네임']);
    expect(replaceVariables(t, { name: '' }, { 이름: { column: 'name', type: 'string', description: '', sample: '' } })).toBe('님, 안내드립니다.');
    expect(unknownVarNames(`{{ customer.name | default: "%이름%" }}님`, new Set(['이름']))).toEqual([]);
    expect(findSendCopyIssue({ bodies: [t] }, knownSendVarNames(['이름'], false))?.code).toBe('UNKNOWN_VARIABLE');
  });
  it('구현 5R — 이스케이프 따옴표 뒤 · 글자 출력식도 평가기가 내는 글 그대로', () => {
    const none = new Set<string>();
    const esc = `{{ customer.name | default: 'O\\'Reilly %닉네임%' }}`;
    expect(unknownVarNames(esc, none)).toEqual(['닉네임']);
    expect(replaceVariables(esc, { name: '' }, {})).not.toContain('%닉네임%');
    expect(unknownVarNames(`보유 {{ '%금액%' }}원`, none)).toEqual(['금액']);
    expect(unknownVarNames(`{{ customer.name | default: '%닉네임%' | upcase }}`, none)).toEqual(['닉네임']);
  });
  it('판정 경계(구현 7R 뒤) — 출력식 하나를 변수가 빈 채로 평가 · assign 흐름은 따라가지 않는다(§8-13)', () => {
    const none = new Set<string>();
    // 실행되지 않는 갈래의 assign 이 뒤 default 를 가리지 않는다(7R #1)
    expect(unknownVarNames(`{% if customer.vip %}{% assign f = '고객' %}{% endif %}{{ f | default: '%금액%' }}님`, none)).toEqual(['금액']);
    // 반복 안 assign 이 밖으로 새어 정상 문안을 막지 않는다(7R #2)
    expect(unknownVarNames(`{% assign f = '고객' %}{% for f in customer.items %}{% assign f = '%없음%' %}{% endfor %}{{ f }}님`, none)).toEqual([]);
    // assign 을 거친 대체 문구 = 판정 밖(Liquid 자기 판정 · 정한 한계)
    expect(unknownVarNames(`보유 {% assign fallback = '%금액%' %}{{ customer.balance | default: fallback }}원`, none)).toEqual([]);
  });
});

describe('구현 1R #1 치환 값은 글자 그대로(값 안의 $ 문법을 읽지 않는다 · 백 0단계 = 화면 미리보기 · 길이 계산)', () => {
  const tpl = `%이름% ${'a'.repeat(46)}`;
  it.each([`$'`, '$&', '$$', '$`'])('이름 값 %s', (name) => {
    const want = `${name} ${'a'.repeat(46)}`;
    expect(replaceVariables(tpl, null, {}, { name } as any)).toBe(want);
    expect(front.replaceDirectVars(tpl, { name })).toBe(want);
    expect(front.getMaxByteMessage(tpl, [{ name }], { '%이름%': 'name' })).toBe(want);
  });
  it('기타 · 회신번호 칸도', () => {
    expect(replaceVariables('%기타1%/%회신번호%', null, {}, { extra1: '$&', callback: "$'" } as any)).toBe(`$&/$'`);
  });
});

// ── S2 길목 판정 ────────────────────────────────────────────────
describe('S2 findSendCopyIssue', () => {
  const MSG = '고객 정보에 없는 변수(%금액%)는 보낼 때 빈칸이 돼요. 있는 항목으로 바꾸거나 지워 주세요.';
  it('문장 = 여정과 한 곳', () => {
    expect(unknownVarMessage(['금액'])).toBe(MSG);
    expect(journeyCopyIssue({ bodies: ['%금액%'], subjects: [] }, { knownVarNames: new Set(), cartJourney: false })?.message).toBe(MSG);
  });
  it('채울 자리가 먼저 · 그다음 없는 변수', () => {
    expect(findSendCopyIssue({ bodies: [`${LINK_PLACEHOLDER} %금액%`] }, knownSendVarNames([], false))?.code).toBe('LINK_PLACEHOLDER_UNEDITED');
    expect(findSendCopyIssue({ bodies: ['보유 %금액%원'] }, knownSendVarNames(['이름'], false))).toEqual({ code: 'UNKNOWN_VARIABLE', error: MSG });
  });
  it('주소록 길 = 주소록 칸 통과 · 고객 DB 길 = 걸림', () => {
    expect(findSendCopyIssue({ bodies: ['%기타1%님'] }, knownSendVarNames([], true))).toBeNull();
    expect(findSendCopyIssue({ bodies: ['%기타1%님'] }, knownSendVarNames([], false))?.code).toBe('UNKNOWN_VARIABLE');
  });
  it('그 밖 글(제목)은 채울 자리만 · 인코딩 주소 · Liquid 태그 · 대행 칸 글은 통과', () => {
    const known = knownSendVarNames(['이름'], true);
    expect(findSendCopyIssue({ bodies: ['안녕'], others: ['%없음%'] }, known)).toBeNull();
    expect(findSendCopyIssue({ bodies: ['https://x.test/%EC%9D%B4%EB%A6%84-15g'] }, known)).toBeNull();
    expect(findSendCopyIssue({ bodies: ['{% if customer.name %}a{%else%}b{%endif%}'] }, known)).toBeNull();
    expect(findSendCopyIssue({ bodies: [buildSlotPlan('%쿠폰%님 %등급% 안내').slotContent] }, knownSendVarNames([], true))).toBeNull();
  });
});

describe('S2 새 코드 소비처', () => {
  const MSG = unknownVarMessage(['금액']);
  it('확실히 안 나감 목록 · 플래너 사유 = 받은 문장', () => {
    expect(DEFINITE_NO_COMMIT.has('UNKNOWN_VARIABLE')).toBe(true);
    expect(sendRejectReason('UNKNOWN_VARIABLE', MSG)).toBe(MSG);
  });
  it('자동발송 2시간 전 알림 = 사유가 있을 때만 두 줄', () => {
    const ctx = { campaignName: '가을 안내', scheduledTimeStr: '10:00', spamResultLabel: '통과', spamBlocked: false, messageContent: '보유 %금액%원' };
    const plain = buildSpamTestResultNotifyMessage(ctx);
    expect(plain).not.toContain('[확인 필요]');
    const withIssue = buildSpamTestResultNotifyMessage({ ...ctx, copyIssue: MSG });
    expect(withIssue).toBe(`${plain}\n\n[확인 필요] ${MSG}\n고치지 않으면 이번 회차는 보내지 않아요.`);
  });
  it('자동마케팅 검토 사유 = 문장 끝 마침표만 뺀다(카드가 「. 문안을 확인하고」를 붙인다)', () => {
    const src = be('utils/continuous-operator.ts');
    expect(src).toContain(`e.code === 'UNKNOWN_VARIABLE'`);
    expect(src).toMatch(/auto_execute_reason = \$2/);
  });
});

// ── S4 매핑 싣기 ────────────────────────────────────────────────
describe('S4 확정 때 커스텀 칼럼 매핑', () => {
  const mappings: Record<string, VarCatalogEntry> = {
    이름: { column: 'name', type: 'string', description: '', sample: '', storageType: 'column' },
    등급: custom('custom_3'),
    지역: custom('custom_4'),
  };
  it('싣는 것 = 글에 든 커스텀 칼럼 이름만 · 없으면 undefined', () => {
    expect(pickCustomVarMappings(mappings, ['%이름%님 %등급%', null])).toEqual({ 등급: custom('custom_3') });
    expect(pickCustomVarMappings(mappings, ['%이름%님'])).toBeUndefined();
    expect(pickCustomVarMappings({ EC: custom('custom_1') }, ['https://x.test/%EC%9D%B4'])).toBeUndefined();
  });
  it('일꾼이 그때 매핑 위에 덮는다 · 꼴이 틀린 실린 값은 버린다', () => {
    const now = { 이름: mappings.이름, 등급: custom('custom_9') };
    const merged = mergeStoredVarMappings(now, { 등급: custom('custom_3'), 옛이름: custom('custom_5'), 나쁨: { column: 'name', storageType: 'column' }, 빈것: null });
    expect(merged.등급).toEqual(custom('custom_3'));
    expect(merged.옛이름).toEqual(custom('custom_5'));
    expect(merged.나쁨).toBeUndefined();
    expect(merged.이름).toEqual(mappings.이름);
    expect(mergeStoredVarMappings(now, undefined)).toEqual(now);
    expect(mergeStoredVarMappings(now, 'x' as any)).toEqual(now);
  });
  it('이름을 바꾼 뒤 이어 받아도 옛 이름이 채워진다(치환 끝까지)', () => {
    const merged = mergeStoredVarMappings({ 이름: mappings.이름 }, { 금액: custom('custom_2') });
    expect(replaceVariables('보유 %금액%원', { custom_fields: { custom_2: '5,000' } }, merged)).toBe('보유 5,000원');
  });
});

// ── 계약(소스에서 뽑음) ─────────────────────────────────────────
describe('계약 — 길목 · 미러 · 일꾼 배선', () => {
  it('S3 옛 함수의 밖 호출 = AI 한줄로 카드 표시 · 브랜드메시지 둘뿐', () => {
    expect(count(be('routes/ai-line.ts'), 'findUneditedSendPlaceholder(')).toBe(1);
    expect(count(be('routes/campaigns.ts'), 'findUneditedSendPlaceholder(')).toBe(1);
    expect(count(be('utils/direct-send-core.ts'), 'findUneditedSendPlaceholder(')).toBe(0);
    expect(count(be('utils/auto-campaign-worker.ts'), 'findUneditedSendPlaceholder(')).toBe(0);
  });
  it('길목 = findSendCopyIssue(파일마다 호출 수)', () => {
    expect(count(be('routes/campaigns.ts'), 'findSendCopyIssue(')).toBe(4);       // 생성 · 발송 · 동기 직접발송 · 예약 수정
    expect(count(be('utils/direct-send-core.ts'), 'findSendCopyIssue(')).toBe(1); // 공용 발송 길
    expect(count(be('utils/auto-campaign-worker.ts'), 'findSendCopyIssue(')).toBe(2); // 실행 · 2시간 전 검사
    expect(count(be('routes/auto-campaigns.ts'), 'findSendCopyIssue(')).toBe(3);  // 만들기 · 고치기 · 만든 글 고치기
  });
  it('캠페인 발송의 「경고만 찍고 발송」이 없다', () => {
    expect(be('routes/campaigns.ts')).not.toContain('validatePersonalizationVars(');
  });
  it('2단계 글자 대조 = replaceLiteralVar 하나(백 · 미리보기 여섯 · has 둘)', () => {
    const mu = be('utils/messageUtils.ts');
    expect(mu).not.toContain('.split(pattern).join(');
    expect(mu).toContain('replaceLiteralVar(result, pattern, displayValue)');
    const fd = fe('utils/formatDate.ts');
    expect(fd).not.toMatch(/new RegExp\(`%\$\{escapeRegex\(/);
    expect(fd).not.toContain('new RegExp(escapeRegex(fm.variable)');
    expect(fd).not.toContain("new RegExp(variable.replace(/%/g, '%'), 'g'), maxValue");
    expect(count(fd, 'replaceLiteralVar(')).toBeGreaterThanOrEqual(7);   // 정의 1 + 641 · 648 · 715 · 771 · 781 · 1027
    expect(be('utils/var-tokens.ts')).toContain('hasLiteralVar(t, `%${name}%`)');
    expect(fe('utils/ai-ask.ts')).toContain('hasLiteralVar(t, `%${name}%`)');
  });
  it('S4 배선 = 공용 길이 싣고 · 일꾼이 덮는다 · 예약 수정 적재 전 갈래가 다시 만든다', () => {
    expect(be('utils/direct-send-core.ts')).toContain('pickCustomVarMappings(');
    expect(be('utils/direct-send-spec.ts')).toContain('varMappings');
    expect(be('utils/direct-send-worker.ts')).toContain('mergeStoredVarMappings(await prepareFieldMappings(companyId), cfg.varMappings)');
    expect(be('routes/campaigns.ts')).toContain('pickCustomVarMappings(');
  });
  it('치환 호출이 든 발송 파일 = 분류표와 같다(새 파일은 길목 분류 없이 실패)', () => {
    const CLASSIFIED: Record<string, string> = {
      'routes/campaigns.ts': '자체 길목(findSendCopyIssue)',
      'routes/spam-filter.ts': '검사 · 발송 아님',
      'services/ai-line-spam.ts': '검사 · 발송 아님',
      'utils/agency-send-preview.ts': '대행 미리보기 · 발송은 공용 길',
      'utils/auto-campaign-worker.ts': '자체 길목(findSendCopyIssue)',
      'utils/copy-exit-guards.ts': 'AI 문안 출구 · 발송 아님',
      'utils/direct-send-processor.ts': '공용 발송 길 적재(direct-send-core 길목 뒤)',
      'utils/dm/dm-alert-msg-type.ts': '바이트 판정 · 발송은 공용 길',
      'utils/dm/dm-variable-resolver.ts': 'DM 페이지 · 문자 아님',
      'utils/journey-message-render.ts': '여정(journeyCopyIssue)',
      'utils/spam-test-queue.ts': '검사 · 발송 아님',
    };
    const files = Object.keys(CLASSIFIED);
    const re = /\b(replaceVariables|prepareSendMessage|bulkReplaceVariables|cleanLeftoverVars)\(/;
    for (const f of files) expect(re.test(be(f)), f).toBe(true);
    // 분류표 밖에서 치환을 부르는 파일이 생기면 실패(길목을 정하고 표에 더한다)
    const all = (readdirSync(BE, { recursive: true }) as string[]).map((x) => String(x).replace(/\\/g, '/'))
      .filter((x) => /\.ts$/.test(x) && !/(^|\/)__tests__\//.test(x) && !/\.test\.ts$/.test(x) && x !== 'utils/messageUtils.ts');
    const callers = all.filter((x) => re.test(be(x)));
    expect(callers.sort()).toEqual(files.sort());
  });
});
