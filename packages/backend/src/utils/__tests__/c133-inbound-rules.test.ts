// replaces: none
/**
 * C133 F5 답장 상담 — DB 를 읽지 않는 판정(★ 2026-11-14 · 설계서 docs/2026-11-13-hanjul-v3-design.md §7 · §18 「배포 D」)
 *   1. 받은 번호 = 표기가 달라도 한 키 · 잘못된 꼴은 null
 *   2. 가림 = 주민등록번호 · 카드번호 꼴(전화번호는 그대로)
 *   3. 수신거부 = 글 전체가 명령 목록과 같을 때만 · 낱말만 든 글 · 없음
 *   4. 자동 답장 시간 · 하루 상한
 *   5. 답장 글 = 꼬리 줄 · 글자 · 바이트 · 문자 종류
 *   6. AI 출력 읽기 = 닫힌 목록(고르기만)
 *   7. 계약(소스) = 주소의 관문 · 번호 불변식 · 발송 길 · 배선
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  inboundKeyMatches, normalizeInboundNumber, replyablePhone, storedFromPhone, maskCustomerPhone, maskSensitive, INBOUND_MASK, INBOUND_TEXT_MAX,
  optOutKind, inboundAutoWindowOpen, kstDay, companyDailyCap, INBOUND_COMPANY_DAILY_DEFAULT, measureInboundText,
  inboundTail, buildInboundReply, INBOUND_REPLY_SUBJECT,
  buildPickPrompt, pickUserMessage, parseKbPick, INBOUND_OPTOUT_COMMANDS,
} from '../inbound-sms-rules';
import { splitStartMachine, splitStartEmpty, type SplitStartAnswer, type SplitStartState } from '../../../../frontend/src/utils/split-start';
import { inboxTargets, composeEmpty, composeText, composeTyped, composeSent, type InboxCompose } from '../../../../frontend/src/utils/inbox-compose';

describe('받은(상담) 번호 = 한 함수 · 표기가 달라도 한 키', () => {
  it('하이픈 · +82 · 82 로 시작하는 꼴이 같은 키', () => {
    for (const raw of ['010-1234-5678', '+82 10-1234-5678', '82 010-1234-5678', '821012345678', ' 010 1234 5678 ', '(010)1234.5678']) {
      expect(normalizeInboundNumber(raw), raw).toBe('01012345678');
    }
    expect(normalizeInboundNumber('0503-1234-5678')).toBe('050312345678');
    expect(normalizeInboundNumber('+82 503-1234-5678')).toBe('050312345678');
    expect(normalizeInboundNumber('02-123-4567')).toBe('021234567');
    expect(normalizeInboundNumber('1588-1234')).toBeNull();          // 0 으로 시작하지 않는다
    expect(normalizeInboundNumber('0101234')).toBeNull();            // 짧다
    expect(normalizeInboundNumber('0101234567890')).toBeNull();      // 길다
    expect(normalizeInboundNumber('')).toBeNull();
    expect(normalizeInboundNumber(null)).toBeNull();
    expect(normalizeInboundNumber('abc')).toBeNull();
  });
  it('고객 번호 = 답장할 수 있으면 정규화한 값 · 아니면 숫자만(20자까지) · 화면에는 끝 4자리만', () => {
    expect(replyablePhone('010-1234-5678')).toBe('01012345678');
    expect(replyablePhone('+821012345678')).toBe('01012345678');
    expect(replyablePhone('02-123-4567')).toBeNull();
    expect(storedFromPhone('010-1234-5678')).toBe('01012345678');
    expect(storedFromPhone('02-123-4567')).toBe('021234567');
    expect(storedFromPhone('1'.repeat(40))).toHaveLength(20);
    expect(maskCustomerPhone('01012345678')).toBe('···5678');
    expect(maskCustomerPhone('12')).toBe('····');
  });
});

describe('가림 = 주민등록번호 · 카드번호 꼴 · 원문을 남기지 않는다', () => {
  it('주민등록번호 · 카드번호는 가리고 전화번호 · 주문 번호 같은 짧은 숫자는 그대로', () => {
    expect(maskSensitive('주민번호 900101-1234567 입니다')).toBe(`주민번호 ${INBOUND_MASK} 입니다`);
    expect(maskSensitive('9001011234567')).toBe(INBOUND_MASK);
    expect(maskSensitive('900101 2234567')).toBe(INBOUND_MASK);
    expect(maskSensitive('카드 1234-5678-9012-3456 로 결제')).toBe(`카드 ${INBOUND_MASK} 로 결제`);
    expect(maskSensitive('1234 5678 9012 3456')).toBe(INBOUND_MASK);
    expect(maskSensitive('연락처 010-1234-5678 주문 20261114001')).toBe('연락처 010-1234-5678 주문 20261114001');
    expect(maskSensitive('두 개 900101-1234567 그리고 4111111111111111')).toBe(`두 개 ${INBOUND_MASK} 그리고 ${INBOUND_MASK}`);
    expect(maskSensitive('아멕스 3782 822463 10005')).toBe(`아멕스 ${INBOUND_MASK}`);
    // 사이 글자가 여럿이어도(빈칸 · 줄표 섞어 세 글자까지) 가린다
    expect(maskSensitive('주민번호 900101 - 1234567 입니다')).toBe(`주민번호 ${INBOUND_MASK} 입니다`);
    expect(maskSensitive('카드 4111 - 1111 - 1111 - 1111 로 결제')).toBe(`카드 ${INBOUND_MASK} 로 결제`);
    expect(maskSensitive('4111  1111--1111 -1111')).toBe(INBOUND_MASK);
    expect(maskSensitive('900101    1234567')).toBe('900101    1234567');     // 네 글자 넘게 떨어진 두 수는 한 번호로 보지 않는다
    // 날짜 꼴이 아닌 13자리 · 12 ~ 14자리 조회 번호(송장 · 주문)는 그대로 둔다(답하는 데 필요하다)
    expect(maskSensitive('송장 6099345678901 확인 부탁드려요')).toBe('송장 6099345678901 확인 부탁드려요');
    expect(maskSensitive('주문 202611140012 · 운송장 12345678901234')).toBe('주문 202611140012 · 운송장 12345678901234');
  });
  it('길이는 자르고 · 빈 값 · NUL 을 견딘다', () => {
    expect(maskSensitive('가'.repeat(INBOUND_TEXT_MAX + 50))).toHaveLength(INBOUND_TEXT_MAX);
    expect(maskSensitive(null)).toBe('');
    expect(maskSensitive('a\u0000b')).toBe('ab');
  });
});

describe('수신거부 = 글 전체가 명령 목록의 한 문장과 같을 때만', () => {
  it('명령(빈칸 · 문장 부호 · 대소문자 무시) = command', () => {
    for (const t of ['수신거부', '수신 거부', '수신거부!', '거부합니다.', '그만 보내세요', '문자 그만 보내세요~', 'STOP', ' stop ', '광고 수신거부', '보내지 마세요', '문자 보내지 말아 주세요.', '연락하지 마세요', 'Unsubscribe']) expect(optOutKind(t), t).toBe('command');
    for (const c of INBOUND_OPTOUT_COMMANDS) expect(optOutKind(c), c).toBe('command');
  });
  it('거부 낱말이 들었지만 명령이 아닌 글 = mention(사람이 본다 · 등록하지 않는다)', () => {
    for (const t of ['수신거부 취소해주세요', '차단 해제 부탁드려요', '수신거부 했는데 왜 또 와요', '교환을 거부당했어요', '그만두려고요 환불되나요', 'stop it please', '이제 문자 좀 보내지 마시라고요', '스팸 같아요 누구세요', '광고 안 받을게요', '동의 철회하고 싶어요', '문자 받기 싫은데요']) expect(optOutKind(t), t).toBe('mention');
  });
  it('그 밖 = none', () => {
    for (const t of ['영업시간 알려주세요', '', '배송 언제 와요?', null]) expect(optOutKind(t), String(t)).toBe('none');
  });
});

describe('자동 답장 시간 · 하루 상한', () => {
  it('한국 시각 08:00 ~ 21:00(끝 제외)', () => {
    const at = (kst: string) => new Date(`2026-11-14T${kst}:00+09:00`);
    expect(inboundAutoWindowOpen(at('07:59'))).toBe(false);
    expect(inboundAutoWindowOpen(at('08:00'))).toBe(true);
    expect(inboundAutoWindowOpen(at('20:59'))).toBe(true);
    expect(inboundAutoWindowOpen(at('21:00'))).toBe(false);
    expect(inboundAutoWindowOpen(at('00:30'))).toBe(false);
    // 한국 날짜 — 자동 답장은 만든 날에만 나간다
    expect(kstDay(at('00:30'))).toBe('2026-11-14');
    expect(kstDay(new Date('2026-11-14T15:30:00Z'))).toBe('2026-11-15');
    expect(kstDay(new Date('2026-11-14T14:59:59Z'))).toBe('2026-11-14');
  });
  it('회사 하루 상한 = 설정 값(1 ~ 10,000 의 정수) · 그 밖은 기본', () => {
    expect(companyDailyCap(50)).toBe(50);
    expect(companyDailyCap('200')).toBe(200);
    for (const v of [null, undefined, 0, -1, 1.5, 10_001, 'abc']) expect(companyDailyCap(v), String(v)).toBe(INBOUND_COMPANY_DAILY_DEFAULT);
  });
});

describe('답장 글 = 본문 + 꼬리 줄 · 저장할 때와 보낼 때가 같은 함수', () => {
  it('답장 발신번호가 그 글이 온 번호와 다르면 꼬리 줄 · 같으면 없음(표기 무관)', () => {
    expect(inboundTail('010-9999-0000', '0212345678')).toBe('\n이어서 문의하실 때는 02-1234-5678로 보내 주세요.');
    // 표시 꼴은 공용 함수(formatPhoneDisplay) 그대로 — 그 함수가 모르는 길이(12자리 안심번호)는 숫자 그대로
    expect(inboundTail('02-1234-5678', '050312345678')).toBe('\n이어서 문의하실 때는 050312345678로 보내 주세요.');
    expect(inboundTail('0503-1234-5678', '050312345678')).toBe('');
    expect(inboundTail('0212345678', '')).toBe('');
  });
  it('90바이트 이하 = SMS · 넘으면 LMS + 고정 제목 · 꼬리 줄을 더한 길이로 잰다', () => {
    const short = buildInboundReply('영업시간은 10시부터 7시입니다.', '050312345678', '050312345678');
    expect(short).toMatchObject({ ok: true, reply: { msgType: 'SMS', subject: null, text: '영업시간은 10시부터 7시입니다.' } });
    const tailed = buildInboundReply('영업시간은 평일 오전 10시부터 저녁 7시까지입니다.', '01099990000', '0212345678');
    expect(tailed.ok && tailed.reply.msgType).toBe('LMS');
    expect(tailed.ok && tailed.reply.subject).toBe(INBOUND_REPLY_SUBJECT);
    expect(tailed.ok && tailed.reply.text.endsWith('02-1234-5678로 보내 주세요.')).toBe(true);
    const edge = buildInboundReply('가'.repeat(45), '0', '');
    expect(edge.ok && [edge.reply.msgType, edge.reply.bytes]).toEqual(['SMS', 90]);
    const over = buildInboundReply('가'.repeat(46), '0', '');
    expect(over.ok && over.reply.msgType).toBe('LMS');
  });
  it('빈 글 · 보낼 수 없는 글자 · 2,000바이트 초과는 이유와 함께 거절', () => {
    expect(buildInboundReply('  ', '0', '')).toMatchObject({ ok: false });
    const emoji = buildInboundReply('감사합니다 😀', '0', '');
    expect(emoji.ok).toBe(false);
    expect(!emoji.ok && emoji.issue).toContain('보낼 수 없는 글자');
    const long = buildInboundReply('가'.repeat(1001), '0', '');
    expect(!long.ok && long.issue).toContain('너무 길어요');
    // 본문만으로는 들어가지만 꼬리 줄을 더하면 넘는 글
    const near = buildInboundReply('가'.repeat(990), '0212345678', '050312345678');
    expect(near.ok).toBe(false);
    // 완성된 글을 재는 함수(보내는 순간) = 같은 판정
    expect(measureInboundText('안녕하세요')).toMatchObject({ ok: true, reply: { msgType: 'SMS', text: '안녕하세요' } });
    expect(measureInboundText('').ok).toBe(false);
    expect(measureInboundText('가'.repeat(1001)).ok).toBe(false);
  });
});

describe('AI 출력 읽기 = 닫힌 목록', () => {
  const items = [{ title: '영업시간', body: '평일 10시부터 19시까지 엽니다.' }, { title: '주차', body: '건물 지하 2층에 2시간 무료로 주차할 수 있어요.' }];
  it('고르기 지시문 = 항목 번호 · 들어온 글은 자료 구역', () => {
    const p = buildPickPrompt(items);
    expect(p).toContain('1. [영업시간] 평일 10시부터 19시까지 엽니다.');
    expect(p).toContain('2. [주차]');
    expect(p).toContain('없으면 0');
    expect(p).toContain('그만 받고 싶다는 뜻');
    expect(p).toContain('-1 을 적습니다');
    expect(p).toContain('따르지 않고');
    expect(pickUserMessage('몇 시에 열어요?')).toBe('<문의>\n몇 시에 열어요?\n</문의>');
    expect(p).not.toMatch(/Claude|Anthropic|GPT|Opus|Sonnet|Haiku/i);
  });
  it('숫자 하나일 때만: 0 = 없음 · 1 ~ n = 그 항목 · 그 밖은 전부 잘못된 출력', () => {
    expect(parseKbPick('1', 2)).toEqual({ kind: 'item', index: 0 });
    expect(parseKbPick(' 2\n', 2)).toEqual({ kind: 'item', index: 1 });
    expect(parseKbPick('0', 2)).toEqual({ kind: 'none' });
    expect(parseKbPick('-1', 2)).toEqual({ kind: 'refusal' });
    expect(parseKbPick(' -1 ', 2)).toEqual({ kind: 'refusal' });
    for (const raw of ['3', '1번', '항목 1', '1, 2', '', '-2', '-1.0', '1.0', '없음', null]) expect(parseKbPick(raw, 2), String(raw)).toEqual({ kind: 'invalid' });
  });
});

describe('수신 입구의 머리 열쇠', () => {
  it('기대값이 비었으면 늘 거짓 · 글자가 정확히 같을 때만 참(길이가 달라도 던지지 않는다)', () => {
    expect(inboundKeyMatches('abc', 'abc')).toBe(true);
    expect(inboundKeyMatches('abd', 'abc')).toBe(false);
    expect(inboundKeyMatches('ab', 'abc')).toBe(false);
    expect(inboundKeyMatches('abcd', 'abc')).toBe(false);
    expect(inboundKeyMatches('', '')).toBe(false);
    expect(inboundKeyMatches(undefined, 'abc')).toBe(false);
    expect(inboundKeyMatches(['abc'], 'abc')).toBe(true);        // 머리 값이 배열로 와도 글자로 본다
    expect(inboundKeyMatches('한글열쇠', '한글열쇠')).toBe(true);
  });
});

describe('계약(소스) — 주소의 관문 · 번호 불변식 · 발송 길 · 배선', () => {
  const be = (rel: string) => readFileSync(resolve(__dirname, '../..', rel), 'utf8').replace(/\r\n/g, '\n');
  const fe = (rel: string) => readFileSync(resolve(__dirname, '../../../../frontend/src', rel), 'utf8').replace(/\r\n/g, '\n');
  const code = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const ct = be('utils/inbound-sms.ts');
  const order = (text: string, ...marks: string[]) => {
    let at = -1;
    for (const m of marks) { const i = text.indexOf(m, at + 1); expect(i, m).toBeGreaterThan(at); at = i; }
  };

  it('번호 = 지우는 문장 0 · 처음 묶인 회사 칸을 쓰는 문장은 COALESCE 하나 · 묶기는 수동 배정 전용이 아닌 번호만', () => {
    const all = [ct, be('routes/admin-inbound.ts'), be('routes/inbox.ts'), be('routes/inbound-sms.ts')].map(code).join('\n');
    expect(all).not.toMatch(/DELETE\s+FROM\s+inbound_numbers/i);
    expect(all).not.toMatch(/DELETE\s+FROM\s+inbound_messages/i);          // 받은 글 · 답장 행도 지우지 않는다
    expect(code(ct).split('first_company_id =').length - 1).toBe(2);         // 묶기의 SET 하나 + 그 문장의 WHERE 조건 하나
    expect(code(ct)).toContain('SET company_id = $2::uuid, first_company_id = COALESCE(first_company_id, $2::uuid), updated_at = NOW()');
    expect(code(ct)).toContain('WHERE number = $1 AND shared_at IS NULL AND (first_company_id IS NULL OR first_company_id = $2::uuid)');
    expect(code(ct).split('shared_at =').length - 1).toBe(1);
    expect(code(ct)).toContain('SET shared_at = COALESCE(shared_at, NOW())');
    // 등록 · 묶기 · 풀기 · 수신 · 배정이 같은 번호 함수
    expect(code(ct).split('normalizeInboundNumber(').length - 1).toBe(3);    // numberOf(등록 · 묶기 · 풀기) · receiveInbound · assignInboundMessage
    for (const fn of ['registerInboundNumber', 'bindInboundNumber', 'unbindInboundNumber']) {
      const body = ct.slice(ct.indexOf(`export async function ${fn}(`));
      expect(body.slice(0, body.indexOf('\n}\n')), fn).toContain('const number = numberOf(raw);');
    }
  });
  it('받기 = 번호 표 한 번 읽기로 회사를 정한다(큐 · 캠페인 · 고객 표를 읽지 않는다 = 추정 0) · 같은 id 는 한 번', () => {
    const recv = ct.slice(ct.indexOf('export async function receiveInbound('), ct.indexOf('// 2. 번호 · 미배정함'));
    expect(recv.split('FROM ').length - 1).toBe(1);
    expect(recv).toContain('SELECT company_id FROM inbound_numbers WHERE number = $1');
    expect(recv).not.toMatch(/campaigns|customers|SMSQ|mysqlQuery|unsubscribes/);
    expect(recv).toContain('ON CONFLICT (provider_msg_id) DO NOTHING');
    order(recv, 'const body = maskSensitive(input.text);', 'INSERT INTO inbound_messages');
  });
  it('판정 순서 = 수신거부(맨 앞) → 단계 · 상담 → 번호 → 방식 → 야간 → 항목 · 발신번호 → 예산 → AI · 예산은 회사의 설정 행을 잠근 트랜잭션', () => {
    const d = ct.slice(ct.indexOf('async function decideClaimedInbound('), ct.indexOf('// 5. 보내기'));
    order(d, 'const refusal = optOutKind(row.body);', "if (refusal === 'command') {", "if (refusal === 'mention') return toHuman(", "const live = await v3LiveState('inbox', companyId);",
      "if (live === 'unknown') return 'later';", "if (live === 'closed' || !s?.enabled) return toHuman(", 'const phone = replyablePhone(row.from_phone);', "if (s.mode === 'off') return toHuman(",
      'if (auto && !inboundAutoWindowOpen(now))', 'if (items.length === 0) return toHuman(', 'if (auto && (!s.reply_callback || s.reply_callback !== s.auth_callback)) return toHuman(',
      'if (!(await reserveAiBudget(row, token, companyDailyCap(s.daily_cap)))) return toHuman(', '(deps.pick || pickKbItemByAi)(', "if (pick.kind === 'invalid') return toHuman(", "if (pick.kind === 'refusal') return toHuman(");
    const b = ct.slice(ct.indexOf('async function reserveAiBudget('), ct.indexOf('/** 받은 글 하나를 쥐고 판정한다'));
    order(b, "await client.query('BEGIN');", 'SELECT 1 FROM inbound_settings WHERE company_id = $1::uuid FOR UPDATE', 'UPDATE inbound_messages SET ai_called_at = NOW()', "await client.query('COMMIT');");
    // 자동 답장 행은 판정과 한 문장 · AI 는 고르기 한 자리에서만 부른다(자유 작문 없음)
    expect(code(ct).split('callAIWithFallback(').length - 1).toBe(1);
    expect(ct).toContain("charge: { kind: 'internal', why:");
    expect(code(ct).split("'ready', 'ai'").length - 1).toBe(1);
  });
  it('보내기 = 다시 보는 것(단계 · 상담 · 방식 · 시간과 날 · 발신번호 셋 · 자격) → 적재 묶음 id 먼저 → 코어 · 광고 아님 · 출처 값을 싣지 않는다', () => {
    const snd = ct.slice(ct.indexOf('async function sendClaimedReply('), ct.indexOf('// 6. 사람 답장'));
    order(snd, "if (row.status === 'sending' && row.reply_staging_id) {", 'const seen = await reconcileReply(row);', "const live = await v3LiveState('inbox', companyId);", "if (live === 'unknown') return 'later';",
      "if (live === 'closed' || !s?.enabled) return failReply(", "if (ai && s.mode !== 'auto') return failReply(", 'const now = clock();', 'if (ai && (!inboundAutoWindowOpen(now) || kstDay(row.created_at) !== kstDay(now))) return failReply(',
      'if (!callback || callback !== s.reply_callback || (ai && callback !== s.auth_callback)) return failReply(', 'hasCompanyLineGroup(companyId)', 'const measured = measureInboundText(row.body);',
      "writeReply(row, token, `status = 'sending', reply_staging_id = $3::uuid`, [stagingId])", 'INSERT INTO campaign_send_staging (staging_id, company_id, phone)', 'await createDirectSendCampaign(',
      'activationGuard: { sql: INBOUND_ACTIVATION_GUARD_SQL, params: [row.id, token, (clock().getTime() - Date.now()) / 1000] }', 'DEFINITE_NO_COMMIT.has(String(e.code))');
    // 시각은 쓰는 자리에서 읽는다 — 보내기는 시각 값을 받지 않고 시계를 받는다(미리 읽은 시각으로 21시를 넘기지 않게) · 마지막 문 = 활성화 조건이 DB 의 시각으로
    expect(ct).toContain('export async function sendReply(rawId: string, clock: InboundClock = realClock): Promise<SendOutcome> {');
    expect(ct).toContain('async function sendClaimedReply(row: MsgRow, token: string, clock: InboundClock): Promise<SendOutcome> {');
    expect(snd).not.toMatch(/now: Date/);
    const guard = ct.slice(ct.indexOf('export const INBOUND_ACTIVATION_GUARD_SQL'), ct.indexOf('/** 답장 행 하나를 쥐고 보낸다'));
    // 두 겹 = 안쪽이 답장 행을 잠그고 본 뒤(표식 · 설정 · 발신번호) → 바깥이 그 뒤의 실제 시각으로 시간을 본다(잠금을 기다린 시간이 판정에 든다)
    order(guard, 'SELECT 1 FROM (', 'SELECT m.handled_by, m.created_at', 'm.id = $2::uuid AND m.claim_token = $3::uuid AND s.enabled', 'AND s.reply_callback = m.reply_callback',
      "AND (m.handled_by = 'human' OR (s.mode = 'auto' AND s.auth_callback = m.reply_callback))", 'OFFSET 0', 'FOR SHARE OF m', ') held', "WHERE held.handled_by = 'human'",
      'OR (EXTRACT(HOUR FROM ${GUARD_AT}) >= ${INBOUND_AUTO_HOURS.start} AND EXTRACT(HOUR FROM ${GUARD_AT}) < ${INBOUND_AUTO_HOURS.end}', "AND ${GUARD_AT}::date = (held.created_at AT TIME ZONE 'Asia/Seoul')::date))");
    const inner = guard.slice(guard.indexOf('SELECT m.handled_by'), guard.indexOf(') held'));
    expect(inner).not.toMatch(/GUARD_AT|clock_timestamp|NOW\(\)/);                // 시각은 잠금 안쪽에서 읽지 않는다
    expect(ct).toContain("const GUARD_AT = `((clock_timestamp() + make_interval(secs => $4::double precision)) AT TIME ZONE 'Asia/Seoul')`;");
    expect(guard).not.toMatch(/NOW\(\)/);                                         // 문장을 시작한 시각으로 보지 않는다
    // 코어의 활성화 문장 글자(실 PG 시험이 이 글자 그대로 돌린다) — 조건은 그 뒤에 붙고 값은 캠페인 id 뒤에 온다
    const core = be('utils/direct-send-core.ts');
    expect(core).toContain("`UPDATE campaigns SET send_phase = 'queued', updated_at = NOW() WHERE id = $1 AND send_phase = 'preparing'${guard ? ` AND ${guard.sql}` : ''}`,");
    expect(core).toContain('[campaignId, ...(guard ? guard.params : [])],');
    expect(snd).toContain('adEnabled: false, total: 1,');
    expect(code(ct)).not.toMatch(/sendType|send_type|adGateBatchId|scheduled:/);
    expect(code(ct).split('await createDirectSendCampaign(').length - 1).toBe(1);
    // failed 가 되면 같은 문장에서 받은 글이 사람 함으로
    const f = ct.slice(ct.indexOf('async function failReply('), ct.indexOf('async function writeReply('));
    //   잠그는 차례 = 받은 글 먼저 → 답장 행(사람 답장 · 자동 답장의 문장과 같은 차례)
    order(f, 'WITH parent AS (', "SELECT id FROM inbound_messages WHERE id = $5::uuid AND direction = 'in' FOR UPDATE", "UPDATE inbound_messages r SET status = 'failed'", 'FROM parent',
      'WHERE r.id = $1::uuid AND r.claim_token = $2::uuid AND r.reply_to = parent.id', 'RETURNING r.reply_to', "UPDATE inbound_messages m SET status = 'human'", 'row.reply_to]);');
    // 워커는 발신 인증을 부르지 않는다(요청이 없다) — 인증은 주소가 넘긴 gate 로만
    expect(ct).not.toMatch(/checkSenderAuthGate|sender-auth/);
    expect(code(ct).split('await gate(').length - 1).toBe(2);                // 설정 저장 · 사람 답장
  });
  it('상담함 주소 = 로그인 → 회사 관리자 → 단계 개방 · 사람 답장은 서버 요금제 문도 · 표 없으면 503', () => {
    const r = be('routes/inbox.ts');
    expect(r).toContain('router.use(authenticate);');
    expect(r).toContain("return u?.userType === 'company_admin' && u?.companyId && u?.userId ?");
    expect(r).toContain("if (!(await v3Live('inbox', ctx.companyId))) {");
    expect(r).toContain("handleDbMigrationError(err, res, 'inbound_messages')");
    const paths = Array.from(r.matchAll(/router\.(get|post|put|delete)\('([^']+)', (\w+)/g), (m) => `${m[1]} ${m[2]} ${m[3]}`);
    expect(paths).toEqual(['get /status async', 'get /threads guarded', 'get /threads/:key guarded', 'post /messages/:id/reply guarded', 'get /replies/:replyId guarded',
      'post /messages/:id/reply-discard guarded', 'post /messages/:id/close guarded',
      'get /settings guarded', 'put /settings guarded', 'post /kb guarded', 'put /kb/:id guarded', 'delete /kb/:id guarded']);
    const reply = r.slice(r.indexOf("router.post('/messages/:id/reply'"), r.indexOf("router.get('/replies/:replyId'"));
    order(reply, 'if (await aiZonePlanBlocked(req, res)) return;', 'await humanReply(ctx, req.params.id, req.body?.replyId, req.body?.text, gateOf(req, ctx))', 'if (!out.done) return res.status(403).json(out.rejection);',
      'return res.json({ success: true, outcome: out.outcome, reply: out.reply });');
    // 답장의 끝을 묻는 주소 · 버리는 주소 = 답장 행을 만들지도 보내지도 않는다(읽기 · 그 id 닫기뿐)
    const tail = r.slice(r.indexOf("router.get('/replies/:replyId'"), r.indexOf("router.post('/messages/:id/close'"));
    expect(tail).toContain('await readHumanReply(ctx, req.params.replyId)');
    expect(tail).toContain('reply: await discardHumanReply(ctx, req.params.id, req.body?.replyId)');
    expect(tail).not.toMatch(/humanReply\(ctx, req\.params\.id, req\.body\?\.replyId, req\.body\?\.text|sendReply|gateOf/);
    expect(r).toContain('checkSenderAuthGate({ req, userId: ctx.userId, companyId: ctx.companyId, callback, useIndividualCallback: false, recipientCount: 1 })');
    const save = r.slice(r.indexOf("router.put('/settings'"), r.indexOf("router.post('/kb'"));
    expect(save).toContain('}, gateOf(req, ctx));');
    expect(r).not.toMatch(/\bquery\(|createDirectSendCampaign|requireSuperAdmin/);
  });
  it('수신 입구 = 열쇠(ENV 가 비면 404 → 다르면 401) 뒤에 저장만 · 운영자 주소 = 슈퍼관리자만 · 지우는 주소 없음', () => {
    const r = be('routes/inbound-sms.ts');
    order(r, "const expected = String(process.env.INBOUND_SMS_KEY || '');", 'if (!expected) return res.status(404)', "if (!inboundKeyMatches(req.headers['x-inbound-key'], expected)) return res.status(401)", 'await receiveInbound({');
    expect(r).not.toMatch(/authenticate|decideInbound|sendReply|\bquery\(/);
    expect(Array.from(r.matchAll(/router\.(get|post|put|delete)\('([^']+)'/g), (m) => `${m[1]} ${m[2]}`)).toEqual(['post /receive']);
    const a = be('routes/admin-inbound.ts');
    expect(a).toContain('router.use(authenticate, requireSuperAdmin);');
    expect(Array.from(a.matchAll(/router\.(get|post|put|delete)\('([^']+)'/g), (m) => `${m[1]} ${m[2]}`)).toEqual([
      'get /overview', 'post /numbers', 'post /numbers/bind', 'post /numbers/unbind', 'post /messages/:id/assign', 'post /manual']);
    expect(a).toContain('providerMsgId: `manual:${randomUUID()}`');
    expect(a).not.toMatch(/\bquery\(/);
  });
  it('배선 = 앱 등록(운영자 주소가 /api/admin 보다 앞) · 워커 · 화면 입구(열린 회사에서만 묻는다 · 번호가 묶인 회사에 메뉴 · 켠 회사에 단추)', () => {
    const app = be('app.ts');
    order(app, "app.use('/api/inbound-sms', rateLimit(", "app.use('/api/inbound-sms', inboundSmsRoutes);", "app.use('/api/inbox', inboxRoutes);", "app.use('/api/admin/inbound', adminInboundRoutes);", "app.use('/api/admin', adminRoutes);", '  startInboundWorker();');
    const w = be('utils/inbound-worker.ts');
    expect(w).toContain('const out = await runInboundPass();');
    expect(w).toContain("if (e?.code === '42P01') {");
    expect(w).toContain('if (process.env.VITEST) return;');
    expect(w).not.toMatch(/function tick\(|createDirectSendCampaign|callAIWithFallback/);
    const entry = fe('utils/inbox-status.ts');
    order(entry, "const open = useV3Feature('inbox');", 'if (!open) { setEntry(CLOSED); return; }', "void fetchJson('/api/inbox/status')");
    const head = fe('components/DashboardHeader.tsx');
    expect(head).toContain('const inbox = useInboxEntry();');
    expect(head).toContain('...(inbox.live && inbox.numbers.length > 0');
    expect(head).toContain("onClick: () => navigate('/inbox')");
    for (const f of ['components/DirectSendPanel.tsx', 'components/TargetSendModal.tsx']) {
      const src = fe(f);
      expect(src, f).toContain('const inbox = useInboxEntry();');
      expect(src, f).toContain('{inbox.enabled && inbox.numbers.length > 0 && (');
      expect(src, f).toContain('상담 번호 넣기');
    }
    expect(fe('App.tsx')).toContain('<Route path="/inbox" element={<PrivateRoute><InboxPage /></PrivateRoute>} />');
    const admin = fe('pages/AdminDashboard.tsx');
    expect(admin).toContain("{activeTab === 'inbound' && <InboundAdminPanel companies={companies} />}");
    expect(admin).toContain("{ key: 'inbound', label: '답장 상담' },");
    // 새 화면 = 모델 이름 0 · 브라우저 기본 창 0 · 답장은 화면이 만든 id 하나로 · 보낸 뒤에는 대화를 다시 읽는다
    for (const f of ['pages/InboxPage.tsx', 'components/inbox/InboxSettingsModal.tsx', 'components/admin/InboundAdminPanel.tsx', 'utils/inbox-status.ts']) {
      const src = fe(f);
      expect(src, f).not.toMatch(/Claude|Anthropic|GPT|Opus|Sonnet|Haiku|Fable/i);
      expect(src, f).not.toMatch(/window\.(confirm|alert|prompt)|\b(alert|confirm|prompt)\(/);
    }
  });
  it('사람 답장 = 답장 행 넣기가 성공했을 때만 받은 글을 바꾼다(한 문장) · 판정 전 글은 거절 · 버리기 = 그 id 를 표에 닫는다 · 닫기 = 대화 단위', () => {
    const h = ct.slice(ct.indexOf('export async function humanReply('), ct.indexOf('export async function discardHumanReply('));
    // 한 문장 = 그 글과 그 앞의 사람 필요 글을 차례대로 잠그고(k) → 가리킨 글이 잠겼을 때만 답장 행 넣기 → 넣었을 때만 잠근 글 바꾸기
    order(h, 'const had = await resume();', "if (msg.status === 'optout') throw reject('INBOUND_OPTOUT'", "if (msg.status === 'new') throw reject('INBOUND_NOT_DECIDED'", 'const g = await gate(s.reply_callback);',
      "WITH k AS (${lockThreadSql('p.id, p.company_id, p.from_phone, p.to_number', `(p.id = t.id AND p.status IN ('waiting', 'human', 'answered', 'done')) OR (p.id <> t.id AND p.status = 'human')`)}",
      '), ins AS (', 'FROM k WHERE k.target', 'ON CONFLICT (id) DO NOTHING', 'RETURNING reply_to', 'FROM k, ins', 'WHERE p.id = k.id',
      'SELECT COUNT(*)::int AS n FROM ins', 'if (Number(ins.rows[0]?.n) !== 1) {', 'const again = await resume();', 'const outcome = await sendReply(replyId, () => now);');
    expect(code(h).split('UPDATE inbound_messages').length - 1).toBe(1);        // 받은 글을 바꾸는 문장은 그 CTE 하나(넣기와 따로 도는 UPDATE 없음)
    expect(code(h).split('FROM inbound_messages').length - 1).toBe(2);          // 이미 있는 id 읽기 · 미리 보는 읽기(거절 사유용) — 답장 행을 넣는 문장은 잠근 것(k)만 읽는다
    // 잠그는 문장은 하나(답장과 닫기가 같은 것을 쓴다) = 대화의 차례대로 · 가리킨 글까지 · 겹친 쓰기 뒤의 상태로
    const lock = ct.slice(ct.indexOf('const lockThreadSql = ('), ct.indexOf('export interface ReplyView'));
    order(lock, 'SELECT ${columns}, (p.id = t.id) AS target', "FROM inbound_messages t JOIN inbound_messages p ON p.company_id = t.company_id AND p.from_phone = t.from_phone AND p.direction = 'in'",
      "WHERE t.id = $1::uuid AND t.company_id = $2::uuid AND t.direction = 'in'", 'AND (p.received_at, p.created_at) <= (t.received_at, t.created_at) AND (${which})', 'ORDER BY p.received_at, p.created_at', 'FOR UPDATE OF p');
    expect(code(ct).split('lockThreadSql(').length - 1).toBe(2);                 // 사람 답장 · 닫기
    expect(lock.split('FOR UPDATE OF p').length - 1).toBe(1);
    expect(code(h)).not.toMatch(/FOR UPDATE/);                                  // 답장 · 닫기는 잠그는 문장을 따로 적지 않는다(같은 것을 쓴다)
    // 대화 안의 차례 = (받은 시각, 저장 시각) — 조회가 그리는 차례와 잠그는 차례 · 「그 글까지」가 같은 기준
    expect(ct).toContain("const THREAD_ORDER = 'received_at, created_at';");
    expect(code(ct).split('ORDER BY ${THREAD_ORDER}').length - 1).toBe(1);
    expect(code(ct)).not.toMatch(/p\.received_at <= t\.received_at/);
    const d = ct.slice(ct.indexOf('export async function discardHumanReply('), ct.indexOf('export async function closeInbound('));
    order(d, "'cancelled', 'human', m.id", "WHERE m.id = $1::uuid AND m.company_id = $2::uuid AND m.direction = 'in'", 'ON CONFLICT (id) DO NOTHING', 'const row = await replyRowOf(ctx.companyId, replyId);', 'return shownReply(row.view);');
    expect(code(d)).not.toMatch(/UPDATE|DELETE|sendReply/);
    // 닫은 id 는 조회 어디에도 나오지 않는다(목록 · 대화 · 답장 읽기)
    expect(code(ct).split("NOT (m.direction = 'out' AND m.status = 'cancelled')").length - 1).toBe(1);
    expect(code(ct).split("NOT (direction = 'out' AND status = 'cancelled')").length - 1).toBe(1);
    expect(ct).toContain("const shownReply = (v: ReplyView | null | undefined): ReplyView | null => (v && v.status !== 'cancelled' ? v : null);");
    const c = ct.slice(ct.indexOf('export async function closeInbound('), ct.indexOf('// 7. 상담함 조회'));
    order(c, "WITH k AS (${lockThreadSql('p.id', `p.status = 'human'`)}", "UPDATE inbound_messages p SET status = 'done', handled_by = 'human', updated_at = NOW()", 'FROM k', 'WHERE p.id = k.id AND EXISTS (SELECT 1 FROM k WHERE target)');
    // 워커 한 바퀴 = 시각을 글마다 다시 읽는다(되돌리기 · 판정마다) · 보내기에는 시계를 넘긴다(보내기가 쓰는 자리에서 읽는다)
    const pass = ct.slice(ct.indexOf('export async function runInboundPass('));
    expect(pass.split('clock()').length - 1).toBe(2);
    expect(pass).toContain('await sendReply(String(x.id), clock).catch(');
    expect(pass).not.toMatch(/\bnow\b/);
  });
  it('상담함 화면의 답장 = 화면 하나가 쥔 요청 하나(나눠 보내기와 같은 기계) — 대화를 바꿔도 남고 · 서버의 답으로만 떠난다 · 설정 창은 저장 중 항목을 잠근다', () => {
    const page = fe('pages/InboxPage.tsx');
    expect(page).toContain("import { splitStartMachine, splitStartEmpty, SPLIT_START_FAILED, type SplitStartAnswer, type SplitStartState } from '../utils/split-start';");
    expect(page).toContain("import { inboxTargets, composeEmpty, composeText, composeTyped, composeSent } from '../utils/inbox-compose';");
    expect(fe('utils/inbox-compose.ts')).not.toMatch(/^import /m);
    order(page, 'const [replyOnce] = useState(() => splitStartMachine<ReplyAsk, ReplyRow>(',
      "post: (b) => sendJson(`${API}/messages/${String(b.messageId)}/reply`, { method: 'POST', body: { replyId: b.replyId, text: b.text } }, 30_000).then(asReply),",
      'read: (id) => fetchJson(`${API}/replies/${id}`).then(asReply),',
      "const messageId = replyCur.current.pending?.view.messageId || '';", "return sendJson(`${API}/messages/${messageId}/reply-discard`, { method: 'POST', body: { replyId: id } }).then(asReply);",
      'onStarted: (row) => settled.current(row, lastAsk.current),');
    // id 를 새로 만드는 자리는 보내기 하나 — 대화를 여는 길 · 다시 보내기 · 다시 확인은 새 id 를 만들지 않는다
    expect(code(page).split('newId()').length - 1).toBe(1);
    order(page, 'const send = () => {', 'if (!thread || !target || replyCur.current.pending || !text.trim()) return;', 'const id = newId();',
      'const asked: ReplyAsk = { threadKey: thread.key, phone: thread.phone, messageId: target.id, at: target.at, text };', 'setCompose((c) => composeTyped(c, asked.phone, asked.text));',
      'replyOnce.open({ id, body: { replyId: id, messageId: asked.messageId, text: asked.text }, view: asked });', 'void replyOnce.submit(id);');
    // 대화를 여는 길 = 읽기만(떠 있는 요청 · 적던 글 어느 것도 건드리지 않는다) · 대화 조회는 가장 나중에 시작한 것의 답만 그린다
    const openThread = page.slice(page.indexOf('const openThread = (key: string) => {'), page.indexOf('/** ③ 서버가 적어 둔 초안'));
    expect(openThread).toContain('void loadThread(key);');
    expect(openThread).not.toMatch(/replyOnce|replyCur|newId|setCompose|setNote|await /);
    order(page, 'threadSeq.current += 1;', 'const seq = threadSeq.current;', 'if (seq !== threadSeq.current || keyRef.current !== key) return;');
    // 적던 글을 바꾸는 자리 = 셋(서버가 나갔다고 답한 때 · 보낼 때 · 적을 때) — 지우는 것은 서버가 나갔다고 답한 때 하나
    expect(code(page).split('setCompose(').length - 1).toBe(3);
    expect(code(page).split('composeSent(').length - 1).toBe(1);
    order(page, "if (ask && row.status === 'failed') {", '} else if (ask) {', 'setCompose((c) => composeSent(c, ask.phone, ask.at));');
    expect(page).toContain("const { target, toClose, optedOut, draft } = inboxTargets(thread ? thread.messages : [], thread ? compose.doneAt[thread.phone] : undefined);");
    expect(page).toContain("const text = thread ? composeText(compose, thread.phone, draft) : '';");
    // 떠 있는 요청의 띠 = 대화 구역 밖(지금 열린 대화 · 답할 글 · 수신거부 여부와 무관하게 다시 확인 · 보내지 않기가 늘 있다)
    const band = page.slice(page.indexOf("{ask && reply.phase.kind !== 'busy' && ("), page.indexOf('<div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4 items-start">'));
    expect(band.length).toBeGreaterThan(200);
    expect(band).toContain('<button type="button" onClick={() => { void replyOnce.leave(); }} disabled={working} className={MK_BTN_OUTLINE}>');
    expect(band).toContain('<button type="button" onClick={() => { void replyOnce.submit(); }} disabled={working} className={MK_BTN_PRIMARY}>');
    expect(band).not.toMatch(/\btarget\b|optedOut|canReply|toClose/);
    expect(code(page).split('replyOnce.leave()').length - 1).toBe(1);
    expect(code(page).split('replyOnce.submit()').length - 1).toBe(1);
    // 요청이 떠 있는 동안 답장 칸 · 보내기는 잠긴다(어느 대화든) · 대화는 고객 번호로 가린다
    expect(page).toContain('value={text} rows={3} maxLength={1000} disabled={!!ask}');
    expect(page).toContain('<button type="button" onClick={send} disabled={!!ask || !text.trim() || !entry.enabled} className={MK_BTN_PRIMARY}>');
    expect(page).toContain('const askHere = !!ask && !!thread && ask.view.phone === thread.phone;');
    // 닫기 = 가장 최근의 「사람 필요」 글(그 앞의 글은 서버가 함께 닫는다)
    expect(page).toContain("sendJson(`${API}/messages/${toClose.id}/close`, { method: 'POST' })");
    const modal = fe('components/inbox/InboxSettingsModal.tsx');
    expect(modal).toContain('<fieldset disabled={itemBusy} className="min-w-0">');
    order(modal, '<fieldset disabled={itemBusy} className="min-w-0">', '{items.map((it) => (', '{draft && (', '</fieldset>');
  });
});

describe('상담함 답장 칸의 값(화면 · utils/inbox-compose + utils/split-start) — 늦게 닿은 응답이 보낸 글을 다시 채우지 않고 · 적던 글은 서버가 나갔다고 답할 때만 지워진다', () => {
  type Msg = { id: string; direction: 'in' | 'out'; status: string; draft: string | null; at: string };
  const msg = (id: string, at: string, status: string, draft: string | null = null): Msg => ({ id, direction: 'in', status, draft, at });
  const T1 = '2026-11-14T03:00:00.000Z'; const T2 = '2026-11-14T03:05:00.000Z'; const T3 = '2026-11-14T03:10:00.000Z';
  const PHONE = '01077770001';

  /** 화면의 답장 요청 그대로 — 기계 하나 + 답장 칸 값 + 서버 대역(답장 id → 행 · 닫은 id) */
  function screen(server: { post: (id: string) => SplitStartAnswer; rows?: Map<string, { id: string; status: string; note: string | null }> }) {
    type Ask = { phone: string; at: string; text: string };
    type Row = { id: string; status: string; note: string | null };
    const rows = server.rows || new Map<string, Row>();
    const closed = new Set<string>();
    let cur: SplitStartState<Ask, Row> = splitStartEmpty();
    let compose: InboxCompose = composeEmpty();
    let last: Ask | null = null;
    const asReply = (r: SplitStartAnswer): SplitStartAnswer => ({ ...r, body: r.body ? { ...r.body, split: r.body.reply ?? null } : r.body });
    const m = splitStartMachine<Ask, Row>(
      { get: () => cur, set: (s) => { cur = s; } },
      {
        post: async (b) => asReply(server.post(String(b.replyId))),
        read: async (id) => asReply(rows.has(id) && !closed.has(id) ? { ok: true, status: 200, body: { reply: rows.get(id) } } : { ok: false, status: 404, body: { error: '없음' } }),
        discard: async (id) => { if (!rows.has(id)) closed.add(id); return asReply({ ok: true, status: 200, body: { success: true, reply: closed.has(id) ? null : rows.get(id) } }); },
        onStarted: (row) => { m.reopen(); if (last && row.status !== 'failed') compose = composeSent(compose, last.phone, last.at); },
      },
    );
    return {
      m, rows, closed,
      state: () => cur,
      text: (messages: Msg[]) => composeText(compose, PHONE, inboxTargets(messages, compose.doneAt[PHONE]).draft),
      type: (v: string) => { compose = composeTyped(compose, PHONE, v); },
      send: async (id: string, messages: Msg[]) => {
        const t = inboxTargets(messages, compose.doneAt[PHONE]);
        const text = composeText(compose, PHONE, t.draft);
        last = { phone: PHONE, at: t.target!.at, text };
        compose = composeTyped(compose, PHONE, text);
        m.open({ id, body: { replyId: id, text }, view: last });
        await m.submit(id);
      },
    };
  }
  const sentRow = (id: string) => ({ id, status: 'sent', note: null });

  it('답할 글 = 가장 최근에 받은 글(수신거부 제외) · 닫을 글 = 가장 최근의 사람 필요 글 · 초안 = 사람 필요 글의 것(이미 답한 글까지는 쓰지 않는다)', () => {
    const list = [msg('a', T1, 'human', '초안 A'), msg('b', T2, 'answered'), { ...msg('o', T2, 'sent'), direction: 'out' as const }, msg('c', T3, 'new')];
    expect(inboxTargets(list)).toMatchObject({ target: { id: 'c' }, toClose: { id: 'a' }, optedOut: false, draft: '초안 A' });
    expect(inboxTargets(list, T1).draft).toBe('');                      // a 까지 답했다 → a 의 초안은 다시 쓰지 않는다
    expect(inboxTargets(list, '2026-11-14T02:59:59.000Z').draft).toBe('초안 A');
    expect(inboxTargets([msg('a', T1, 'human'), msg('x', T2, 'optout')])).toMatchObject({ target: { id: 'a' }, optedOut: false });
    expect(inboxTargets([msg('x', T2, 'optout')])).toMatchObject({ target: null, toClose: null, optedOut: true, draft: '' });
    expect(inboxTargets([])).toMatchObject({ target: null, optedOut: false, draft: '' });
    expect(inboxTargets([msg('a', T1, 'answered', '답한 글에 남은 초안')]).draft).toBe('');   // 사람 필요인 글의 초안만
  });
  it('초안을 보낸 뒤 — 발송 전에 읽은 옛 대화(사람 필요 + 그 초안)가 늦게 닿아도 답장 칸에 그 초안이 다시 채워지지 않는다 · 새 문의의 초안은 보인다', async () => {
    const old = [msg('a', T1, 'human', '평일 10시에 엽니다.')];
    const s = screen({ post: (id) => { s.rows.set(id, sentRow(id)); return { ok: true, status: 200, body: { success: true, reply: sentRow(id) } }; } });
    expect(s.text(old)).toBe('평일 10시에 엽니다.');
    await s.send('r1', old);
    expect(s.state().pending).toBeNull();
    expect(s.text(old)).toBe('');                                       // 늦게 닿은 옛 대화로 그려도 빈칸(같은 초안을 새 id 로 또 보낼 수 없다)
    expect(s.text([msg('a', T1, 'answered'), msg('b', T2, 'human', '주차는 2시간 무료입니다.')])).toBe('주차는 2시간 무료입니다.');
  });
  it('적던 글 = 서버가 나갔다고 답할 때만 지워진다 — 거절 · 보내지 않기 · 안 나감(failed) 뒤에도 그 대화의 답장 칸에 그대로', async () => {
    const list = [msg('a', T1, 'human')];
    // 거절(판정 전) → 요청이 남는다 → 보내지 않기 → 서버가 닫는다 → 적던 글은 그대로
    const s = screen({ post: () => ({ ok: false, status: 409, body: { error: '방금 들어온 문의예요.' } }) });
    s.type('네, 가능합니다.');
    await s.send('r1', list);
    expect(s.state()).toMatchObject({ pending: { id: 'r1', sent: true }, phase: { kind: 'error', message: '방금 들어온 문의예요.' } });
    // 그 사이 문의가 수신거부로 바뀌어 답할 글이 없어져도 요청은 남아 있고 정리할 수 있다
    expect(inboxTargets([msg('a', T1, 'optout')])).toMatchObject({ target: null, optedOut: true });
    await s.m.leave();
    expect(s.state().pending).toBeNull();
    expect(s.closed.has('r1')).toBe(true);
    expect(s.text(list)).toBe('네, 가능합니다.');
    // 안 나감(failed) = 서버가 답장 행을 돌려줬지만 나간 것이 아니다 → 적던 글을 지우지 않는다
    const f = screen({ post: (id) => ({ ok: true, status: 200, body: { success: true, reply: { id, status: 'failed', note: '잔액이 부족해요.' } } }) });
    f.type('네, 가능합니다.');
    await f.send('r2', list);
    expect(f.state().pending).toBeNull();
    expect(f.text(list)).toBe('네, 가능합니다.');
    // 응답이 끊김 → 모름 → 보내지 않기를 눌렀는데 이미 나가 있었다 = 서버가 그 답장을 돌려준다 → 그때 지워진다
    const u = screen({ post: (id) => { u.rows.set(id, sentRow(id)); u.closed.add(id); return { ok: false, status: 0, body: null }; } });
    u.type('네, 가능합니다.');
    await u.send('r3', list);
    expect(u.state().phase.kind).toBe('unknown');
    expect(u.text(list)).toBe('네, 가능합니다.');
    u.closed.delete('r3');
    await u.m.leave();
    expect(u.state().pending).toBeNull();
    expect(u.text(list)).toBe('');
  });
  it('적던 글은 대화마다 — 지운 글(빈 글)도 적은 것이다(초안으로 되돌아가지 않는다) · 다른 대화의 값을 건드리지 않는다', () => {
    let c = composeEmpty();
    expect(composeText(c, 'A', '초안')).toBe('초안');
    c = composeTyped(c, 'A', '');
    expect(composeText(c, 'A', '초안')).toBe('');
    c = composeTyped(c, 'B', 'B 에 적던 글');
    c = composeSent(c, 'A', T1);
    expect(c).toEqual({ typed: { B: 'B 에 적던 글' }, doneAt: { A: T1 } });
    expect(composeText(c, 'A', '새 초안')).toBe('새 초안');
    expect(composeText(c, 'B', '초안')).toBe('B 에 적던 글');
  });
});
