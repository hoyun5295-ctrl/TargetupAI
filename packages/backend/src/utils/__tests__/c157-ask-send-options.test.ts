/**
 * C157 한 줄로 묻기 — 보내는 방법 넓히기(★ 2026-11-22 · 설계서 docs/2026-11-22-c157-ask-send-options-design.md §5)
 *   기대값 = 설계서의 표 · 손으로 적은 예(코드가 만드는 방식으로 다시 만들지 않는다).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { STEP0_VAR_NAMES, sendBodyVars } from '../var-tokens';
import { lineSendChannel, lineBodySendChannel } from '../../services/ai-line';
import { directSendSpanOf, sendSpanOf } from '../ad-send-gate';
import {
  ASK_CHANNELS, ASK_STEP0_VAR_NAMES, askBusyGate, askComposeBlock, askInputFp, askSendChannel, askSendFp, askSplitError, askStageLines,
  type AskPlan,
} from '../../../../frontend/src/utils/ai-ask';
import { SPLIT_COUNT_RANGE, SPLIT_INTERVAL_RANGE } from '../../../../frontend/src/utils/split-send';
import { SPLIT_LIMITS } from '../send-time-util';

const back = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
/** 주석을 지운 소스 */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

type Ch = 'SMS' | 'LMS' | 'MMS';
/** 그 회사 변수 매핑의 이름들(시험용) */
const NAMES = ['고객명', '등급', '최근구매일', '안내문구'];

describe('S1 나가는 문자 종류의 규칙(설계서 S4-b)', () => {
  it('규칙 함수 = 생성기의 옛 식과 같은 값(종류 셋 × 칼럼 · 링크 유무 열두 갈래)', () => {
    const table: Array<[Ch, boolean, boolean, Ch]> = [
      ['SMS', false, false, 'SMS'], ['SMS', true, false, 'LMS'], ['SMS', false, true, 'LMS'], ['SMS', true, true, 'LMS'],
      ['LMS', false, false, 'LMS'], ['LMS', true, false, 'LMS'], ['LMS', false, true, 'LMS'], ['LMS', true, true, 'LMS'],
      ['MMS', false, false, 'MMS'], ['MMS', true, false, 'MMS'], ['MMS', false, true, 'MMS'], ['MMS', true, true, 'MMS'],
    ];
    for (const [ch, vars, link, want] of table) expect(lineSendChannel(ch, vars, link), `${ch} ${vars} ${link}`).toBe(want);
    // 생성기가 이 함수를 부른다(식을 따로 갖지 않는다)
    const svc = code(back('services/ai-line.ts'));
    expect(svc).toContain("const keyChannel: 'SMS' | 'LMS' | 'MMS' = lineSendChannel(input.channel, input.vars.length > 0, false);");
    expect(svc).toContain("const channel: 'SMS' | 'LMS' | 'MMS' = lineSendChannel(input.channel, input.vars.length > 0, !!humanLink);");
    expect(svc.match(/=== 'SMS' \? 'LMS'/g)?.length).toBe(1);   // 올리는 식은 규칙 함수 안의 하나뿐
  });

  it('본문으로 정하기 — 치환이 바꿀 변수나 주소가 든 SMS = LMS · 퍼센트 기호만 있는 글 = SMS', () => {
    const lms = [
      '%이름%님 안녕하세요', '%고객명%님', '%성함%님', '%등급% 고객님께', '%기타1% 안내', '회신 %회신번호%', '{{ customer.name }}님', '{% if x %}a{% endif %}',
      '혜택 보기 https://shop.example/event', 'http://a.co/x 에서 확인',
      // 숫자 바로 뒤여도 치환은 글자 그대로 바꾼다(설계 Codex 4R 반례)
      '초대코드: 2026%이름%', '7%등급%', '1%기타1%',
      // 매핑에 없는 이름이라도 조각 꼴이면 남은 변수 지우기가 지운다 = 본문이 바뀐다
      '%없는칸% 안내',
    ];
    for (const body of lms) expect(lineBodySendChannel('SMS', body, NAMES), body).toBe('LMS');
    const sms = ['10% 할인 + 5% 적립', '30%할인+10%적립', '오늘만 반값이에요', '', '50%', '문의 02-000-0000'];
    for (const body of sms) expect(lineBodySendChannel('SMS', body, NAMES), body).toBe('SMS');
    for (const body of [...lms, ...sms]) {
      expect(lineBodySendChannel('LMS', body, NAMES)).toBe('LMS');
      expect(lineBodySendChannel('MMS', body, NAMES)).toBe('MMS');
    }
    // 매핑 이름이 있을 때만 걸리는 꼴(숫자 뒤 · 조각 판정은 건너뛴다) — 이름이 없으면 SMS 그대로
    expect(lineBodySendChannel('SMS', '1%안내문구%', NAMES)).toBe('LMS');
    expect(lineBodySendChannel('SMS', '1%안내문구%', ['등급'])).toBe('SMS');
  });

  it('고객 원장을 찾아야 채워지는 변수가 있는가(D12) — 이름 · 주소록 칸만 = 아니오 · 매핑 이름 · Liquid = 예', () => {
    expect(sendBodyVars('%이름%님 %기타1% %회신번호%', NAMES)).toEqual({ any: true, needsCustomer: false });
    expect(sendBodyVars('%고객명%님', NAMES)).toEqual({ any: true, needsCustomer: false });   // 매핑에도 있지만 0단계 이름 = 적재 줄의 이름으로 채워진다
    expect(sendBodyVars('%등급% 고객님', NAMES)).toEqual({ any: true, needsCustomer: true });
    expect(sendBodyVars('7%최근구매일%', NAMES)).toEqual({ any: true, needsCustomer: true });
    expect(sendBodyVars('{{ customer.grade }}', NAMES)).toEqual({ any: true, needsCustomer: true });
    expect(sendBodyVars('%없는칸%', NAMES)).toEqual({ any: true, needsCustomer: false });   // 지워질 조각 = 본문은 바뀌지만 원장은 필요 없다
    expect(sendBodyVars('10% 할인', NAMES)).toEqual({ any: false, needsCustomer: false });
    expect(sendBodyVars('', NAMES)).toEqual({ any: false, needsCustomer: false });
    expect(sendBodyVars(null, NAMES)).toEqual({ any: false, needsCustomer: false });
  });

  it('(기계 추출) 0단계 이름 목록 = 치환 코드의 0단계 리터럴과 같은 집합 · 2단계는 매핑 이름의 글자 그대로를 바꾼다', () => {
    const mu = back('utils/messageUtils.ts');
    const fn = mu.slice(mu.indexOf('export function replaceVariables('), mu.indexOf('export function bulkReplaceVariables('));
    const step0 = code(fn.slice(fn.indexOf('// 0단계'), fn.indexOf('// Step 1: Liquid 렌더링')));
    const literals = new Set([...step0.matchAll(/\/%([^%/]+)%\/g/g)].map((m) => m[1]));
    expect([...literals].sort()).toEqual([...STEP0_VAR_NAMES].sort());
    // 0단계 밖(2단계 앞)에는 리터럴 정규식 치환이 없다 · 2단계 = 매핑 이름마다 `%이름%` 글자 그대로
    const rest = code(fn.slice(fn.indexOf('// Step 1: Liquid 렌더링')));
    expect(rest.match(/\/%[^%/]+%\/g/g)).toBeNull();
    expect(rest).toContain('const pattern = `%${varName}%`;');
    // ★ 2026-11-22 C160 S1 ② — 글자 그대로 바꾸기는 그대로 · 주소의 인코딩 자리에서 시작하는 일치만 건너뛴다(replaceLiteralVar = 그 밖은 split · join 과 같은 결과)
    expect(rest).toContain('result = replaceLiteralVar(result, pattern, displayValue);');
    expect(rest).toContain('result = cleanLeftoverVars(result);');
  });
});

describe('S2 광고 관문의 기간 = 확정과 같은 함수(설계서 S1 · D7)', () => {
  it('나눔이 없으면 예약 시각의 그날 = AI 한줄로가 넘기던 값과 같다 · 나눔이 있으면 마지막 나눔 날까지', () => {
    const at = '2031-03-04T03:00:00.000Z';   // KST 3월 4일 12시
    expect(directSendSpanOf({ scheduled: true, scheduledAt: at }, 0)).toEqual(sendSpanOf(at));
    expect(directSendSpanOf({ scheduled: true, scheduledAt: at, splitEnabled: false }, 99999)).toEqual(sendSpanOf(at));
    expect(directSendSpanOf({ scheduled: false, scheduledAt: at }, 5)).toEqual(sendSpanOf(null));
    // 100건씩 60분 간격(허용 최대 간격) · 5,000명 = 쉰 묶음 = 49시간 뒤까지 → 끝 날짜가 시작 날짜보다 뒤
    const span = directSendSpanOf({ scheduled: true, scheduledAt: at, splitEnabled: true, splitCount: 100, splitIntervalMinutes: 60 }, 5000);
    expect(span.from).toBe('2031-03-04');
    expect(span.to > span.from).toBe(true);   // 며칠 뒤인지는 발송 가능 시간대 규칙(splitSendTime)이 정한다 — 여기서는 「첫날보다 뒤」만 본다
    // 두 묶음 · 한 시간 간격 = 같은 날
    expect(directSendSpanOf({ scheduled: true, scheduledAt: at, splitEnabled: true, splitCount: 100, splitIntervalMinutes: 60 }, 200)).toEqual({ from: '2031-03-04', to: '2031-03-04' });
  });
  it('마감 CT 가 그 함수로 기간을 낸다 · 나눔이 있을 때만 관문 전 인원을 센다(확정과 같은 세기)', () => {
    const ct = code(back('utils/operator-recipients.ts'));
    const seal = ct.slice(ct.indexOf('export async function sealServerStaging('));
    expect(seal).toContain('span: directSendSpanOf(i.sendPlan, preGate),');
    expect(seal).toContain('const split = parseSplitSetting(i.sendPlan.splitEnabled, i.sendPlan.splitCount, i.sendPlan.splitIntervalMinutes);');
    expect(seal).toContain('(await countStagingFiltered(i.stagingId, i.companyId, unsubUserId, true, true, true)).sendCount');
    // AI 한줄로 = 예약 값만 넘긴다(나눔 없음 = 옮기기 전과 같은 기간)
    const ai = code(back('routes/ai.ts'));
    expect(ai).toContain("sendPlan: { scheduled: req.body?.scheduled, scheduledAt: req.body?.scheduledAt }, branch: branchOfDirect('operator'),");
  });
});

// ── 화면(★ 설계서 §3 · S4-b 「화면(거울 · 상태 아님)」 · 「보내기 앞의 잠금 · 확정 건의 묶음」) ──
const front = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'frontend', 'src', rel), 'utf8');
const page = code(front('pages/AiAskPage.tsx'));
const between = (src: string, from: string, to: string) => {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + 1);
  expect(a, from).toBeGreaterThan(-1);
  expect(b, to).toBeGreaterThan(a);
  return src.slice(a, b);
};
const inOrder = (src: string, ...parts: string[]) => {
  let at = -1;
  for (const p of parts) {
    const i = src.indexOf(p, at + 1);
    expect(i, p).toBeGreaterThan(at);
    at = i;
  }
};

describe('S3 화면의 거울 — 나가는 문자 종류(주인은 서버 적재)', () => {
  // 손으로 적은 표(서버 시험 S1 과 같은 글 · 기대값을 여기서 다시 적는다)
  const LMS_BODIES = [
    '%이름%님 안녕하세요', '%고객명%님', '%성함%님', '%등급% 고객님께', '%기타1% 안내', '회신 %회신번호%', '{{ customer.name }}님', '{% if x %}a{% endif %}',
    '혜택 보기 https://shop.example/event', 'http://a.co/x 에서 확인', '초대코드: 2026%이름%', '7%등급%', '1%기타1%', '%없는칸% 안내', '1%안내문구%',
  ];
  const SMS_BODIES = ['10% 할인 + 5% 적립', '30%할인+10%적립', '오늘만 반값이에요', '', '50%', '문의 02-000-0000'];

  it('같은 본문 표에서 화면 함수 = 손으로 적은 기대값 = 서버 함수(줄마다)', () => {
    for (const body of LMS_BODIES) {
      expect(askSendChannel('SMS', body, NAMES), body).toBe('LMS');
      expect(lineBodySendChannel('SMS', body, NAMES), body).toBe('LMS');
    }
    for (const body of SMS_BODIES) {
      expect(askSendChannel('SMS', body, NAMES), body).toBe('SMS');
      expect(lineBodySendChannel('SMS', body, NAMES), body).toBe('SMS');
    }
    for (const body of [...LMS_BODIES, ...SMS_BODIES]) {
      expect(askSendChannel('LMS', body, NAMES)).toBe('LMS');
      expect(askSendChannel('MMS', body, NAMES)).toBe('MMS');
    }
    // 매핑 이름이 없으면 숫자 뒤 조각은 퍼센트 글자 = 단문 그대로(서버와 같다)
    expect(askSendChannel('SMS', '1%안내문구%', ['등급'])).toBe('SMS');
    expect(askSendChannel('SMS', '1%안내문구%', [])).toBe(lineBodySendChannel('SMS', '1%안내문구%', []));
  });

  it('주소록 칸 이름 일곱 = 서버 상수와 같은 값 · 종류 셋 = 서버와 같은 차례', () => {
    expect([...ASK_STEP0_VAR_NAMES]).toEqual([...STEP0_VAR_NAMES]);
    expect([...ASK_CHANNELS]).toEqual(['SMS', 'LMS', 'MMS']);
    expect(code(back('utils/ask-segments.ts'))).toContain("export const ASK_CHANNELS: readonly AskChannel[] = ['SMS', 'LMS', 'MMS'];");
  });

  it('화면은 나가는 종류를 상태로 쥐지 않는다 — 고른 종류와 지금 본문에서 매번 계산 · 세기는 그 값 · 입력 지문 · 문안 만들기 · 적재 요청은 고른 값', () => {
    expect(page).toContain("const channelAt = (t: AiLineType): AskChannel => askSendChannel(channel, bodyAt(t), seg?.varNames ?? []);");
    expect(page).toContain('const sendChannel = pickedType ? channelAt(pickedType) : channel;');
    expect(page).not.toMatch(/setSendChannel|useState<[^>]*>\([^)]*sendChannel/);
    expect(page).toContain("const plan: AskPlan = useMemo(() => (channel === 'LMS' ? basePlan : { ...basePlan, channel }), [basePlan, channel]);");
    expect(page).toContain("const countPlan: AskPlan = useMemo(() => (sendChannel === 'LMS' ? basePlan : { ...basePlan, channel: sendChannel }), [basePlan, sendChannel]);");
    expect(page).toContain('const planKey = JSON.stringify(countPlan);');
    expect(page).toContain('const c = await aiLineApi.askCount(countPlan);');
    expect(page).not.toContain('aiLineApi.askCount(plan)');
    expect(page).toContain('const nowFp = askInputFp({ line: what, groups: groupsInOrder, mode: benefitMode, benefit, place, link, types, channel });');
    // 문안 만들기 = 고른 종류의 계획
    expect(between(page, 'const compose = async', 'const cardSubject')).toContain("line: what.trim(), plan, benefitMode,");
    // 카드 부품 = 나가는 종류 · 그 실행의 칼럼 · 꾸미기
    const cards = between(page, '<LineResultCards', '/>');
    for (const x of ['channel={sendChannel} channelAt={channelAt} isAd callback={callback} columns={audienceOf(run).columns} stack', 'onDecorate={decorate}']) expect(cards).toContain(x);
    // 단문으로 나가면 제목이 없다(검사 지문 · 확정 본문이 같은 값)
    expect(page).toContain("const subjectAt = (t: AiLineType) => (run && channelAt(t) !== 'SMS' ? subjectOf(run, t) : '');");
  });

  it('도착 확인 = 카드마다 자기 종류(고른 카드의 종류가 다른 카드의 검사 · 요금을 바꾸지 않는다) · 이어 읽기 = 그 검사를 건 때의 종류(구현 Codex 1R)', () => {
    const cards = code(front('components/ai-line/LineResultCards.tsx'));
    // 종류를 정하는 자리 하나 — 카드마다 정하는 화면은 channelAt · 아니면 channel 하나(AI 한줄로 그대로)
    expect(cards).toContain("export const cardChannel = (p: Pick<LineResultCardsProps, 'channel' | 'channelAt'>, t: AiLineType): AiLineChannel => (p.channelAt ? p.channelAt(t) : p.channel);");
    expect(cards).toContain('const fpOf = (t: AiLineType) => spamFp(p.bodyAt(t), p.subjectAt(t), cardChannel(p, t), p.isAd, p.callback);');
    inOrder(cards,
      'const ch = cardChannel(cur, t);',
      'const fp = spamFp(cur.bodyAt(t), cur.subjectAt(t), ch, cur.isAd, cur.callback);',
      'body: cur.bodyAt(t), subject: cur.subjectAt(t), channel: ch, isAd: cur.isAd, callback: cur.callback,',
      // ★ 구현 Codex 2R — 칩의 「어느 검사인가」 넷(검사 번호 · 지문 · 종류 · 늦은 보고)은 같이 움직인다: busy = 넷 다 앞 검사의 것 · 새 검사 = 넷 다 새 것
      "const test = out.state === 'busy'",
      '? { testId: prev?.testId, fp: prev?.fp, channel: prev?.channel, lateOpen: prev?.lateOpen }',
      ': { testId: out.testId, fp, channel: ch, lateOpen: out.lateOpen === true };',
      'state: out.state, message: out.message, ...test,');
    // 검사 번호와 지문을 따로 고르는 옛 꼴이 남지 않았다
    expect(cards).not.toMatch(/testId: out\.state === 'busy' \? prev\?\.testId : out\.testId, fp,/);
    expect(cards).toContain('aiLineApi.spamRead(testId, chip.channel ?? cardChannel(latest.current, t))');
    // 부품 안에 「지금의 한 종류」를 바로 읽는 자리가 남지 않았다(종류는 cardChannel 을 지난다)
    expect(cards).not.toMatch(/cur\.channel\b|latest\.current\.channel\b|p\.channel,/);
    expect(code(front('utils/ai-line.ts'))).toMatch(/fp\?: string;\s+channel\?: AiLineChannel;/);
    // AI 한줄로는 channelAt 을 넘기지 않는다 = 종류 하나 그대로
    expect(front('pages/AiLinePage.tsx')).not.toContain('channelAt=');
  });

  it('입력 지문 = 사람이 고른 종류가 든다(없으면 LMS) · 문안 만들기 잠금 = MMS 는 이미지 먼저', () => {
    const base = { line: '겨울 니트 입고', groups: ['leave'] as const, mode: 'none' as const, benefit: '' };
    expect(askInputFp({ ...base })).toBe(askInputFp({ ...base, channel: 'LMS' }));
    expect(askInputFp({ ...base, channel: 'SMS' })).not.toBe(askInputFp({ ...base, channel: 'LMS' }));
    expect(askInputFp({ ...base, channel: 'MMS' })).not.toBe(askInputFp({ ...base, channel: 'SMS' }));
    expect(askComposeBlock({ line: '겨울 니트 입고', types: ['emo'], planned: 3, needImage: true })).toBe('image');
    expect(askComposeBlock({ line: '겨울 니트 입고', types: ['emo'], planned: 3, needImage: false })).toBeNull();
    expect(askComposeBlock({ line: '짧다', types: ['emo'], planned: 3, needImage: true })).toBe('line');
  });

  it('표본 고객 · 칼럼 목록 = 문안 실행에 묶는다(D13 · 문안 응답에서 온다 · 세기 응답이 아니다)', () => {
    const compose = between(page, 'const compose = async', 'const cardSubject');
    expect(compose).toContain('audience: { count: out.count, conditions: [], untranslated: [], top: out.sample ?? null, sampleCustomer: null, columns: out.columns ?? [] },');
    expect(page).not.toMatch(/top: count[.?]/);
    const route = between(code(back('routes/ai-line.ts')), "router.post('/ask/compose'", "router.post('/ask/stage'");
    expect(route).toContain('sample: detail.top ? { id: detail.top.id, name: detail.top.name } : null, columns: detail.columns,');
  });
});

describe('S4 화면 — 보내기 앞의 잠금 · 확정 건의 묶음', () => {
  const plan: AskPlan = { groups: ['leave', 'rest'], mode: 'budget', budget: 30000, order: 'recent' };
  const base = {
    body: '겨울 니트가 들어왔어요', subject: '입고 소식', channel: 'LMS' as const, plan, callback: '0212345678',
    when: 'later' as const, laterAt: '2026-12-01T10:00', splitOn: true, splitCount: 1000, splitGap: 10, images: ['a.jpg'],
  };

  it('발송 지문 = 칸 하나만 바뀌어도 다른 값 · 쓰지 않는 칸(지금 보내기의 예약 시각 · 끈 나눔의 값)은 지문 밖', () => {
    const fp = askSendFp(base);
    expect(askSendFp({ ...base, plan: { ...plan } })).toBe(fp);
    const changed = [
      { ...base, body: `${base.body} ` }, { ...base, subject: '다른 제목' }, { ...base, channel: 'MMS' as const },
      { ...base, plan: { ...plan, groups: ['leave'] as AskPlan['groups'] } }, { ...base, plan: { ...plan, mode: 'all' as const } },
      { ...base, plan: { ...plan, budget: 50000 } }, { ...base, plan: { ...plan, order: 'count' as const } },
      { ...base, callback: '__individual__' }, { ...base, when: 'now' as const }, { ...base, laterAt: '2026-12-01T10:01' },
      { ...base, splitOn: false }, { ...base, splitCount: 999 }, { ...base, splitGap: 11 }, { ...base, images: [] }, { ...base, images: ['a.jpg', 'b.jpg'] },
    ];
    for (const c of changed) expect(askSendFp(c), JSON.stringify(c)).not.toBe(fp);
    expect(new Set(changed.map(askSendFp)).size).toBe(changed.length);
    expect(askSendFp({ ...base, when: 'now', laterAt: 'x' })).toBe(askSendFp({ ...base, when: 'now', laterAt: 'y' }));
    expect(askSendFp({ ...base, splitOn: false, splitCount: 1, splitGap: 2 })).toBe(askSendFp({ ...base, splitOn: false, splitCount: 3, splitGap: 4 }));
  });

  it('나눠 보내기 값 = 서버와 같은 범위(1 ~ 9,999건 · 1 ~ 60분) · 끔이면 검사하지 않는다', () => {
    expect([SPLIT_COUNT_RANGE.min, SPLIT_COUNT_RANGE.max, SPLIT_INTERVAL_RANGE.min, SPLIT_INTERVAL_RANGE.max]).toEqual([1, 9999, 1, 60]);
    expect([SPLIT_LIMITS.countMin, SPLIT_LIMITS.countMax, SPLIT_LIMITS.intervalMin, SPLIT_LIMITS.intervalMax]).toEqual([1, 9999, 1, 60]);
    expect(askSplitError(false, 0, 0)).toBeNull();
    for (const [n, g] of [[1, 1], [1000, 10], [9999, 60]]) expect(askSplitError(true, n, g), `${n} ${g}`).toBeNull();
    for (const [n, g] of [[0, 10], [10000, 10], [1.5, 10], [Number.NaN, 10]]) expect(askSplitError(true, n, g), `${n} ${g}`).toContain('건');
    for (const [n, g] of [[1000, 0], [1000, 61], [1000, 2.5], [1000, Number.NaN]]) expect(askSplitError(true, n, g), `${n} ${g}`).toContain('분');
  });

  it('확인 창의 뺀 분 줄 = 서버 적재 응답에서 · 0 인 갈래는 적지 않는다', () => {
    expect(askStageLines({ excluded: { duplicates: 0, callback: 0, unfillable: 0 } })).toEqual([]);
    expect(askStageLines({ excluded: { duplicates: 0, callback: 0, unfillable: 3 } })).toEqual(['번호에 숫자가 아닌 글자가 있어 칼럼 값을 넣을 수 없는 3명은 뺐어요.']);
    expect(askStageLines({ excluded: { duplicates: 2, callback: 1234, unfillable: 0 }, adGateNotice: '광고 제한으로 5명을 뺐어요.' })).toEqual([
      '매장 번호가 없거나 등록되지 않은 1,234명은 뺐어요.', '번호가 겹치는 2명에게는 한 번만 보내요.', '광고 제한으로 5명을 뺐어요.',
    ]);
  });

  it('명단은 서버가 싣는다 — 화면은 명단 주소 · 직접발송 적재 · 집계를 부르지 않는다 · 적재 요청에 확정과 같은 예약 · 나눔 값', () => {
    for (const gone of ['/ask/audience', '/direct-send/stage', '/direct-send/count', 'STAGE_CHUNK', 'recipients']) expect(page, gone).not.toContain(gone);
    const send = between(page, 'const prepareSend = async', 'const bodyRef = useRef');
    inOrder(send,
      'const fp = sendFp;',
      'const split = { splitEnabled: splitOn, splitCount: splitOn ? splitCount : null, splitIntervalMinutes: splitOn ? splitGap : null };',
      "await sendCall('POST', '/api/ai-line/ask/stage', token, { plan, message: body, individualCallback: individual, scheduled, scheduledAt, ...split });",
      'const st = sr.data as AskStage;',
      'if (st.channel !== sendChannel) {',
      'token, shown: sendCount, fp,',
      'stagingId: String(st.stagingId), signature: String(st.signature),',
      "msgType: st.channel, sendChannel: 'sms', subject, message: body,",
      'callback: individual ? undefined : cbChoice, useIndividualCallback: individual,',
      'adEnabled: true, scheduled, scheduledAt, ...split,',
      "mmsImagePaths: st.channel === 'MMS' ? images : [],",
      'setConfirm(');
    // 확정 종류 = 적재 응답의 값(화면이 계산한 값을 싣지 않는다) · 금액 · 뺀 분도 응답에서
    expect(send).not.toMatch(/msgType: (sendChannel|channel)\b/);
    expect(send).toContain('`${st.channel} 1통 ${priceWon(Number(st.unitPrice?.lms) || 0)} · 예상 ${won(Number(st.amount) || 0)}`,');
    expect(send).toContain('...askStageLines(st),');
    // 서버가 정한 종류가 화면이 본 것과 다르면 그 준비분으로 보내지 않는다(묶음 정보를 다시 읽고 멈춘다 · 같은 문 sendCall)
    const diff = between(send, 'if (st.channel !== sendChannel) {', 'const names =');
    inOrder(diff, "sendCall('GET', '/api/ai-line/ask/segments', token)", 'throw new Error(');
  });

  it('확인 창의 보내기 = 발송 지문 대조 뒤에만 확정한다 · 확인 창은 확정을 직접 부르지 않는다', () => {
    const confirm = between(page, 'const confirmSend = (job: SendJob) => {', 'const prepareSend = async');
    inOrder(confirm, 'if (sendFpRef.current !== job.fp) { setSendError(SEND_CHANGED); return; }', 'void commitSend(job);');
    expect(page).toContain('sendFpRef.current = sendFp;');
    const fp = between(page, 'const sendFp = askSendFp({', '});');
    for (const x of ['body: pickedBody', 'subject: pickedSubject', 'channel, plan', 'callback: cbChoice', 'when, laterAt', 'splitOn, splitCount, splitGap', 'images: images.map((x) => x.path)']) expect(fp, x).toContain(x);
    const send = between(page, 'const prepareSend = async', 'const bodyRef = useRef');
    expect(send).not.toContain('commitSend(');
    expect((send.match(/onConfirm: \(\) => \{ confirmSend\(job\); \}/g) || []).length).toBe(2);
  });

  it('칼럼을 넣는 동안 = 다음 · 보내기 · 이전 · 편집 칸이 잠긴다 · 응답은 보낸 때의 실행 · 카드 · 본문이 같을 때만 쓴다', () => {
    const deco = between(page, 'const decorate = async (t: AiLineType, vars: string[]) => {', 'const [splitOn, setSplitOn]');
    inOrder(deco,
      'const at = runRef.current;', 'if (!at || decorating) return;', 'const runId = at.runId;', 'const reqBody = bodyOf(at, t);', 'setDecorating(true);',
      'await aiLineApi.decorate({ body: reqBody, vars,', 'if (!out.changed) return;', 'const cur = runRef.current;',
      'if (!cur || cur.runId !== runId || bodyOf(cur, t) !== reqBody) throw new Error(', 'setRun((r) => (r && r.runId === runId ? setBody(r, t, out.body) : r));', 'setDecorating(false);');
    expect(page).toContain('runRef.current = run;');
    expect(page).toContain(': step === 3 ? !!block || countBusy || !pickedType || sendLocked || needSubject');
    // 장문 · MMS 로 나가는데 제목이 비었으면 3단계에서 잠근다(보내기에서 되돌려 보내지 않는다)
    expect(page).toContain("const needSubject = !!pickedType && !!made && !stale && sendChannel !== 'SMS' && !pickedSubject.trim();");
    expect(page).toContain(": step === 4 ? sending || countBusy || !cbChoice || (!unknown && !!block) || modalOpen || sendLocked");
    // ★ 구현 Codex 1R — 이미지 올리는 동안에도 같은 잠금(창을 닫아도 · 올리는 중의 옛 이미지 목록으로 적재되지 않는다) · 발송 준비 함수도 그 문을 본다
    //   ★ 구현 Codex 2R — 올리기만이 아니라 첨부를 바꾸는 손잡이 전부(지우기 · 자리 바꾸기 · 가져오기)를 한 문(attach)으로 감싸 떠 있는 수를 센다
    expect(page).toContain('const sendLocked = decorating || attachBusy > 0;');
    const modal = between(page, '<MmsUploadModal', '/>');
    const handles = [...modal.matchAll(/(handleMms\w+)=\{([^}]*)\}/g)].map((m) => [m[1], m[2]]);
    expect(handles.map((h) => h[0]).sort()).toEqual(['handleMmsFromAsset', 'handleMmsImageRemove', 'handleMmsImageSwap', 'handleMmsMultiUpload', 'handleMmsSlotUpload']);
    for (const [name, value] of handles) expect(value, name).toBe(`attach(mms.${name})`);
    // 창이 받는 손잡이 가운데 이 화면이 넘기지 않은 것이 없다(새 손잡이가 생기면 여기서 빨개진다 = 문 밖으로 새지 않는다)
    const modalProps = [...front('components/MmsUploadModal.tsx').matchAll(/^\s+(handleMms\w+)\??:/gm)].map((m) => m[1]).sort();
    expect(modalProps).toEqual(['handleMmsFromAsset', 'handleMmsImageRemove', 'handleMmsImageSwap', 'handleMmsMultiUpload', 'handleMmsSlotUpload']);
    // ★ 구현 Codex 3R — 문 = 순수 함수 하나(아래 「떠 있는 작업 수를 세는 문」 시험이 동작을 잰다) · 화면은 올림 · 내림만 넘긴다
    expect(page).toContain('const attach = askBusyGate(() => setAttachBusy((n) => n + 1), () => setAttachBusy((n) => Math.max(0, n - 1)));');
    expect(page).not.toMatch(/Promise\.resolve\(\)\.then\(\(\) => fn\(/);
    expect(between(page, 'const prepareSend = async', 'const body = askSendBody(pickedBody);')).toContain('if (block || !pickedType || !count || sendLocked) return;');
    expect(page).toContain('disabled={answering || making || sending || !!unknown || sendLocked} onClick');
    expect(page).toContain('disabled={making || sending || !!unknown || sendLocked} onClick={() => go((step - 1) as Step)}');
    expect(page).toContain('<textarea ref={bodyRef} value={pickedBody} disabled={decorating} onChange=');
    expect(page).toContain('<input value={pickedSubject} disabled={decorating} onChange=');   // ★ C167-A 잠긴 (광고) 머리와 한 줄
  });

  it('보내기 앞 검사 = 나가는 종류로(단문은 제목 없음 · 한도 90바이트 · MMS 는 이미지) · 고객별 매장 번호 · 나눠 보내기 값', () => {
    const send = between(page, 'const prepareSend = async', 'const bodyRef = useRef');
    inOrder(send,
      'const subject = askSendSubject(sendChannel, pickedSubject);',   // ★ C167-A 보낼 제목 한 함수(SMS = 빈 글 · trim 뒤 40자)
      "sendChannel !== 'SMS' && !subject ?",
      'sendBytes(body, sendChannel, opt080.forBytes) > maxBytesOf(sendChannel) ?',
      "sendChannel === 'MMS' && images.length === 0 ?",
      ': splitErr || we;');
    expect(page).toContain("const maxBytesOf = (ch: AskChannel) => (ch === 'SMS' ? SMS_MAX_BYTES : LMS_MAX_BYTES);");
    expect(page).toMatch(/const LMS_MAX_BYTES = 2000;\s+const SMS_MAX_BYTES = 90;/);
    expect(page).toContain("const individual = cbChoice === INDIVIDUAL_CB;");
    expect(page).toContain('<option value={INDIVIDUAL_CB}>고객별 매장 번호</option>');
    expect(page).toContain("const images = useMemo(() => (channel === 'MMS' ? toMmsImagePaths(mms.mmsUploadedImages) : []), [channel, mms.mmsUploadedImages]);");
  });
});

describe('S5 서버 적재 주소(POST /ask/stage) — 판정 자리의 차례', () => {
  const routes = code(back('routes/ai-line.ts'));
  const stage = between(routes, "router.post('/ask/stage'", "router.get('/ask/sent/:stagingId'");

  it('차례 = 관문 → 계획 → 본문 → 나눔 값 → 매핑 이름 → 나가는 종류(본문으로) → 그 종류의 단가 → 적재 → 마감(CT) → 응답', () => {
    inOrder(stage,
      'const v = await lineGate(req, res);', 'const plan = readAskPlan(b.plan);', "code: 'MESSAGE_REQUIRED'",
      'const split = parseSplitSetting(b.splitEnabled, b.splitCount, b.splitIntervalMinutes);',
      'const names = Object.keys(await prepareFieldMappings(v.companyId));',
      'const channel = lineBodySendChannel(askChannelOf(plan), message, names);',
      'const price = await readAskPrice(v.companyId, channel);',
      'await stageAskAudience(v.companyId, v.userId, plan, price, {',
      'plainOnly: sendBodyVars(message, names).needsCustomer,',
      'const sealed = await sealServerStaging({',
      'splitEnabled: b.splitEnabled, splitCount: b.splitCount, splitIntervalMinutes: b.splitIntervalMinutes,',
      "branch: branchOfDirect('operator'),",
      'success: true, stagingId, signature: sealed.signature, total: sealed.total,',
      'channel, unitPrice: price, amount: askAmount(sealed.total, price),',
      'excluded: { ...sealed.excluded, unfillable: put.unfillable },');
    // 고른 종류로 세지 않는다(본문을 본 종류의 단가)
    expect(stage).not.toContain('readAskPrice(v.companyId, askChannelOf(plan))');
    expect(stage).toContain('adEnabled: true, individualCallback: individual,');
  });

  it('0명 · 실패 = 실은 묶음을 지운다(서명을 주지 않은 명단을 남기지 않는다)', () => {
    expect((stage.match(/await dropAskStaging\(v\.companyId, stagingId\);/g) || []).length).toBe(2);
    expect(stage).toContain('if (staged && companyId) await dropAskStaging(companyId, staged).catch(() => undefined);');
    expect((stage.match(/code: 'NO_RECIPIENTS'/g) || []).length).toBe(2);
  });

  it('마감(중복 제거 → 회신번호 제외 → 광고 관문 → 서명)은 CT 한 곳 — 두 주소에 낱개 호출 0 · 옛 명단 주소는 남아 있다(옛 화면 번들 · D14)', () => {
    for (const f of ['routes/ai-line.ts', 'routes/ai.ts']) {
      const src = code(back(f));
      expect(src, f).toContain('sealServerStaging({');
      for (const low of ['dedupStagingRows(', 'planIndividualCallbackExclusion(', 'gateStaging(', 'stagingSendSignature(']) expect(src, `${f} ${low}`).not.toContain(low);
    }
    expect(routes).toContain("router.post('/ask/audience'");
    // 묶음 응답 = 종류 셋의 단가 · 발송 치환이 쓰는 칼럼 이름들(화면 거울의 입력)
    expect(between(routes, "router.get('/ask/segments'", "router.post('/ask/count'")).toContain('unitPrices: prices, varNames: Object.keys(mappings),');
  });
});


describe('떠 있는 작업 수를 세는 문(askBusyGate · 구현 Codex 3R)', () => {
  const gate = () => {
    let n = 0;
    return { wrap: askBusyGate(() => { n += 1; }, () => { n -= 1; }), count: () => n };
  };
  it('손잡이는 불린 그 틱에 실행된다 — 부른 직후 비워지는 파일 목록을 손잡이가 먼저 읽는다(이미지 창의 차례 그대로)', () => {
    const g = gate();
    const files = ['a.jpg', 'b.jpg', 'c.jpg'];   // 이미지 창이 넘기는 목록(넘긴 직후 입력 칸을 비우면 같이 비워진다)
    let seen: string[] = [];
    const handle = g.wrap((list: string[]) => { seen = Array.from(list); return new Promise<void>(() => undefined); });
    handle(files);
    files.length = 0;                             // 이미지 창이 입력 칸을 비운다
    expect(seen).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    expect(g.count()).toBe(1);                    // 일이 끝나지 않았다 = 잠금 그대로
  });
  it('수 = 일이 끝날 때 내린다(끝남 · 거절 · 던짐 모두) · 겹친 일은 겹친 만큼 센다', async () => {
    const g = gate();
    let release!: () => void;
    const slow = g.wrap(() => new Promise<void>((r) => { release = r; }));
    const fails = g.wrap(() => Promise.reject(new Error('x')));
    const throws = g.wrap(() => { throw new Error('y'); });
    const plain = g.wrap(() => 1);
    slow();
    expect(g.count()).toBe(1);
    fails(); throws(); plain();
    expect(g.count()).toBe(3);                    // 던진 것은 그 자리에서 내렸다 · 나머지 둘은 약속이 끝나야 내린다
    await new Promise((r) => setTimeout(r, 0));
    expect(g.count()).toBe(1);                    // 거절 · 값 반환은 내렸고 느린 일만 남았다
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(g.count()).toBe(0);
  });
});
