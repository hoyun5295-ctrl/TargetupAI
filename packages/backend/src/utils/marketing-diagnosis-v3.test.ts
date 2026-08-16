/**
 * 마케팅 진단 v3 — 분기형 문진·스토리형 리포트 계약 테스트 (2026-08-16 · v3 설계서 §8)
 *
 * 못 박는 것
 *   1. 분기 스키마 검증(로더 fail-closed): 전방 참조·타 섹션·분기의 분기·게이트 show_when·분기 requires 전부 거절.
 *   2. answers 검증 = 가시 문항 전부 + 비가시 답 거부(고아 답 400) + optionalKeys 완화 경로.
 *   3. 판정 = 관문 사다리(선행 축이 결정 — 총점 없음) · unknown 3개 = 단계 미발행.
 *   4. 쌍둥이 테스트 — 답 1개 차이 = 리포트 문장 실차이(V-4).
 *   5. 홍보 위치 계약 — 서버 문장 전체에 자사명 0(주어는 화면 라벨이 소유 · v8).
 *   6. no_match_kind — 최고가 후보도 수치 미달 = over_range(V-9).
 */
import { describe, it, expect } from 'vitest';
import {
  validateDefinition, validateAnswers, visibleQuestions, recommendPlan,
  type DiagnosisDefinition, type PlanRowLike,
} from './plan-recommend';
import { buildDiagnosisResult, type DiagnosisResultV2 } from './marketing-diagnosis-report';
import {
  GAPS, COVER_GAP, PRAISES, LIST_TOOL_PRAISES, ASSET_PRAISE, COMBO_OBSERVATIONS,
} from './marketing-diagnosis-copy';

/** seed v3와 같은 축·키 구조의 시험용 definition(라벨은 판정에 안 쓰는 곳만 축약). */
const V3DEF: DiagnosisDefinition = {
  version: 'v3t', rule_version: 'r3t',
  meta: {
    est_label: '약 3분 · 답변에 따라 문항이 달라져요',
    sections: [
      { key: 's1', label: '기본 정보' },
      { key: 's2', label: '고객 명단' },
      { key: 's3', label: '보내는 방식' },
      { key: 's4', label: '제작과 성과' },
      { key: 's5', label: '규모 확인' },
    ],
  },
  questions: [
    { key: 'industry', text: '어떤 분야이신가요?', type: 'industry_grid', section: 's1',
      options: [{ key: 'fitness', label: '피트니스' }, { key: 'etc', label: '그 외 분야' }] },
    { key: 'touchpoint', text: '고객을 주로 어디에서 만나시나요?', type: 'single', section: 's1',
      options: [
        { key: 'online', label: '온라인 몰에서만 만나요' }, { key: 'offline', label: '매장이나 현장에서 만나요' },
        { key: 'both', label: '온라인과 매장 둘 다예요' }, { key: 'booking', label: '예약이나 상담을 받아서 만나요' },
        { key: 'platform', label: '배달앱이나 예약 플랫폼 중심이에요' },
      ] },
    { key: 'owner', text: '마케팅은 지금 누가 하고 계신가요?', type: 'single', section: 's1',
      options: [
        { key: 'self', label: '대표가 직접 해요' }, { key: 'staff', label: '직원이 다른 일과 함께 해요' },
        { key: 'dedicated', label: '전담 담당자가 있어요' }, { key: 'agency', label: '외부 대행사에 맡겨요' },
      ] },
    { key: 'agency_scope', text: '대행사는 어디까지 해주나요?', type: 'single', section: 's1',
      show_when: { q: 'owner', in: ['agency'] },
      options: [
        { key: 'make', label: '제작까지요' }, { key: 'send', label: '발송까지요' },
        { key: 'report', label: '보고까지요' }, { key: 'unsure', label: '정확히는 몰라요', unknown: true },
      ] },

    { key: 'list', text: '고객 연락처는 지금 어디에 있나요?', type: 'single', section: 's2', axis: 'list',
      options: [
        { key: 'none', label: '따로 모으고 있지 않아요', level: 0 },
        { key: 'scattered', label: '엑셀이나 장부 여기저기에 있어요', level: 1 },
        { key: 'locked', label: '포스기나 쇼핑몰 안에만 있어요', level: 1 },
        { key: 'unified', label: '한곳에 모아 관리하고 있어요', level: 3 },
      ] },
    { key: 'list_fields', text: '명단에 무엇이 더 있나요?', type: 'single', section: 's2',
      show_when: { q: 'list', in: ['unified'] },
      options: [
        { key: 'contact_only', label: '연락처와 이름 정도예요' }, { key: 'visits', label: '방문 날짜까지요' },
        { key: 'purchase', label: '구매 금액까지요' }, { key: 'interest', label: '관심사까지요' },
      ] },
    { key: 'inflow_capture', text: '광고로 온 고객의 연락처가 남나요?', type: 'single', section: 's2',
      show_when: { q: 'list', in: ['none', 'scattered', 'locked'] },
      options: [
        { key: 'no_capture', label: '남지 않아요' }, { key: 'event_only', label: '이벤트 때만요' },
        { key: 'mostly', label: '대부분 남아요' }, { key: 'unknown', label: '확인해 본 적 없어요', unknown: true },
      ] },
    { key: 'locked_tool', text: '어떤 시스템 안에 있나요?', type: 'single', section: 's2',
      show_when: { q: 'list', in: ['locked'] },
      options: [
        { key: 'pos', label: '포스기예요' }, { key: 'mall', label: '쇼핑몰이에요' },
        { key: 'erp', label: 'ERP나 자체 회원 시스템이에요' }, { key: 'booking_sys', label: '예약 관리 프로그램이에요' },
        { key: 'platform', label: '배달앱이나 예약 플랫폼 안에요' },
      ] },
    { key: 'unified_tool', text: '어디에 모아 두셨나요?', type: 'single', section: 's2',
      show_when: { q: 'list', in: ['unified'] },
      options: [
        { key: 'excel', label: '엑셀 하나로요' }, { key: 'crm', label: 'CRM이에요' },
        { key: 'marketing_tool', label: '다른 마케팅 툴이에요' }, { key: 'erp', label: 'ERP나 자체 시스템이에요' },
        { key: 'chat_tool', label: '채널톡 같은 상담 툴이에요' },
      ] },

    { key: 'targeting', text: '가장 최근 발송은 누구에게 보내셨나요?', type: 'single', section: 's3', axis: 'targeting',
      options: [
        { key: 'never', label: '아직 보낸 적이 없어요', level: 0 },
        { key: 'all', label: '명단 전체에게 보냈어요', level: 0 },
        { key: 'demo', label: '성별이나 나이로 나눠 보냈어요', level: 1 },
        { key: 'behavior', label: '최근 방문이나 구매 여부로 골랐어요', level: 2 },
        { key: 'interest', label: '산 상품이나 관심사까지 보고 골랐어요', level: 3 },
      ] },
    { key: 'optout_check', text: '수신거부를 확인해 보셨나요?', type: 'single', section: 's3',
      show_when: { q: 'targeting', in: ['all'] },
      options: [
        { key: 'not_checked', label: '확인해 보지 않았어요' }, { key: 'few', label: '몇 명 있었어요' },
        { key: 'many', label: '평소보다 많았어요' }, { key: 'unknown_where', label: '어디에 쌓이는지 몰라요', unknown: true },
      ] },
    { key: 'segment_reuse', text: '고르는 조건은 어떻게 관리하세요?', type: 'single', section: 's3',
      show_when: { q: 'targeting', in: ['interest'] },
      options: [
        { key: 'fresh', label: '매번 새로 만들어요' }, { key: 'saved', label: '저장해 두고 써요' },
        { key: 'auto', label: '자동으로 갱신돼요' },
      ] },
    { key: 'sending', text: '지난 한 달 동안 몇 번 보내셨나요?', type: 'single', section: 's3', axis: 'sending',
      options: [
        { key: 'zero', label: '한 번도 안 보냈어요', level: 0 }, { key: 's1_2', label: '1번에서 2번이요', level: 1 },
        { key: 's3_5', label: '3번에서 5번이요', level: 2 }, { key: 's6p', label: '6번 이상이요', level: 3 },
      ] },
    { key: 'no_send_reason', text: '보내지 않은 이유는요?', type: 'single', section: 's3',
      show_when: { q: 'sending', in: ['zero'] },
      options: [
        { key: 'no_list', label: '보낼 명단이 없어서요' }, { key: 'no_copy', label: '무엇을 써야 할지 몰라서요' },
        { key: 'no_time', label: '시간이 나지 않아서요' }, { key: 'no_effect', label: '효과가 없다고 느껴서요' },
      ] },
    { key: 'manual_ratio', text: '직접 골라 보낸 건 몇 번인가요?', type: 'single', section: 's3',
      show_when: { q: 'sending', in: ['s3_5', 's6p'] },
      options: [
        { key: 'all_manual', label: '전부 직접 골랐어요' }, { key: 'half', label: '절반쯤이요' },
        { key: 'few', label: '한두 번이요' }, { key: 'mostly_auto', label: '대부분 자동이에요' },
      ] },
    { key: 'send_tool', text: '보낼 때는 주로 무엇을 쓰세요?', type: 'single', section: 's3',
      show_when: { q: 'sending', in: ['s1_2', 's3_5', 's6p'] },
      options: [
        { key: 'sms_site', label: '문자 발송 사이트요' }, { key: 'builtin', label: '내장 발송 기능이요' },
        { key: 'kakao_agency', label: '카카오 채널이나 대행사요' }, { key: 'email_tool', label: '이메일 마케팅 툴이요' },
        { key: 'mixed', label: '여러 개를 섞어 써요' },
      ] },
    { key: 'repeat', text: '반복해서 나가는 메시지가 있나요?', type: 'single', section: 's3', axis: 'repeat',
      options: [
        { key: 'none', label: '아직 없어요', level: 0 }, { key: 'manual', label: '생각날 때 직접 보내요', level: 1 },
        { key: 'scheduled', label: '날짜를 정해 예약 발송해요', level: 2 }, { key: 'auto', label: '조건이 맞으면 자동으로 나가요', level: 3 },
      ] },
    { key: 'manual_count', text: '지난 한 달에 손으로 챙긴 발송이 몇 번쯤인가요?', type: 'single', section: 's3',
      show_when: { q: 'repeat', in: ['manual', 'scheduled'] },
      options: [
        { key: 'c1_2', label: '1번에서 2번이요' }, { key: 'c3_5', label: '3번에서 5번이요' },
        { key: 'c6_10', label: '6번에서 10번이요' }, { key: 'c10p', label: '10번 넘게요' },
      ] },
    { key: 'auto_count', text: '몇 종류가 자동으로 돌고 있나요?', type: 'single', section: 's3',
      show_when: { q: 'repeat', in: ['auto'] },
      options: [
        { key: 'a1_2', label: '1개에서 2개요' }, { key: 'a3_5', label: '3개에서 5개요' },
        { key: 'a6p', label: '6개 이상이요' }, { key: 'a_unknown', label: '세어 보지 않았어요', unknown: true },
      ] },

    { key: 'production', text: '이미지나 안내 화면은 누가 만드나요?', type: 'single', section: 's4', axis: 'production',
      options: [
        { key: 'none', label: '따로 만들지 않아요', level: 0 }, { key: 'self', label: '담당자가 직접 만들어요', level: 2 },
        { key: 'outsource', label: '외부에 맡겨요', level: 2 }, { key: 'inhouse', label: '사내 디자이너가 만들어요', level: 3 },
      ] },
    { key: 'prod_refit', text: '채널마다 다시 맞추는 일이 있나요?', type: 'single', section: 's4',
      show_when: { q: 'production', in: ['self'] },
      options: [
        { key: 'yes', label: '있어요, 채널마다 다시 만들어요' }, { key: 'rare', label: '크기만 살짝 고치는 정도예요' },
        { key: 'no', label: '한 번 만들면 그대로 써요' },
      ] },
    { key: 'copy_how', text: '그럼 문구는 어떻게 준비하세요?', type: 'single', section: 's4',
      show_when: { q: 'production', in: ['none'] },
      options: [
        { key: 'reuse', label: '예전에 보낸 것을 고쳐 써요' }, { key: 'new', label: '매번 새로 써요' },
        { key: 'given', label: '본사나 거래처가 준 것을 써요' }, { key: 'no_copy', label: '문구 없이 보낼 때도 있어요' },
      ] },
    { key: 'measure', text: '가장 최근 발송의 결과를 어디까지 보셨나요?', type: 'single', section: 's4', axis: 'measure',
      options: [
        { key: 'none', label: '결과를 보지 않았어요', level: 0 }, { key: 'counts', label: '보낸 건수와 실패 건수요', level: 1 },
        { key: 'clicks', label: '링크를 누른 사람까지요', level: 2 }, { key: 'revenue', label: '실제 구매나 방문까지요', level: 3 },
      ] },
    { key: 'measure_reason', text: '결과를 더 보지 않는 이유는요?', type: 'single', section: 's4',
      show_when: { q: 'measure', in: ['none', 'counts'] },
      options: [
        { key: 'dont_know', label: '어디서 보는지 몰라서요' }, { key: 'no_time', label: '볼 시간이 없어서요' },
        { key: 'what_next', label: '봐도 무엇을 바꿀지 몰라서요' }, { key: 'no_need', label: '지금은 굳이 필요 없어서요' },
      ] },
    { key: 'measure_compare', text: '달끼리 무엇으로 비교하세요?', type: 'single', section: 's4',
      show_when: { q: 'measure', in: ['revenue'] },
      options: [
        { key: 'none', label: '따로 비교하지 않아요' }, { key: 'feel', label: '대략 느낌으로요' },
        { key: 'notes', label: '숫자를 적어 두고 봐요' }, { key: 'report', label: '보고서로 정리해요' },
      ] },

    { key: 'scale_customers', text: '관리할 고객 수는 어느 정도인가요?', type: 'single', section: 's5',
      options: [
        { key: 'none', label: '아직 없어요' },
        { key: 'u100k', label: '10만 명 미만', requires: [{ column: 'max_customers', op: 'gte_or_null', value: 100000 }] },
        { key: 'o1m', label: '100만 명 이상', requires: [{ column: 'max_customers', op: 'gte_or_null', value: 3000000 }] },
      ] },
    { key: 'scale_ai', text: 'AI 제작은 한 달에 몇 번쯤 쓰실까요?', type: 'single', section: 's5',
      options: [
        { key: 'none', label: '안 쓸 것 같아요' },
        { key: 'u10', label: '월 10회 이하', requires: [{ column: 'ai_credits_per_month', op: 'gte', value: 50 }] },
      ] },
  ],
};

const PLANS: PlanRowLike[] = [
  { id: 'p1', plan_code: 'STARTER', plan_name: '스타터', monthly_price: 150000, is_active: true, ai_credits_per_month: 300, max_customers: 100000 },
  { id: 'p2', plan_code: 'PRO', plan_name: '프로', monthly_price: 990000, is_active: true, ai_credits_per_month: 2400, max_customers: 1000000 },
];

/** 기준 답변 — 하위 경로(전체 발송·수동 반복·건수만 확인). */
function baseAnswers(overrides: Record<string, string> = {}): Record<string, string> {
  const base: Record<string, string> = {
    industry: 'fitness', touchpoint: 'offline', owner: 'self',
    list: 'unified', list_fields: 'purchase',
    targeting: 'all', optout_check: 'not_checked',
    sending: 's3_5', manual_ratio: 'all_manual',
    repeat: 'manual', manual_count: 'c6_10',
    production: 'none', measure: 'counts', measure_reason: 'no_time',
    scale_customers: 'u100k', scale_ai: 'u10',
  };
  const merged = { ...base, ...overrides };
  // 오버라이드로 닫힌 분기 답 제거(가시 집합 기준 정리 — 프론트 prune과 같은 판정)
  const visible = new Set(visibleQuestions(V3DEF, merged).map((q) => q.key));
  for (const k of Object.keys(merged)) if (!visible.has(k)) delete merged[k];
  // 새로 열린 분기 채우기(첫 보기)
  for (const q of visibleQuestions(V3DEF, merged)) {
    if (merged[q.key] === undefined) merged[q.key] = q.options[0].key;
  }
  return merged;
}

function buildV2(answers: Record<string, string>, extra: Partial<Parameters<typeof buildDiagnosisResult>[0]> = {}) {
  const recommend = recommendPlan(V3DEF, answers, PLANS);
  return buildDiagnosisResult({
    definition: V3DEF, answers, recommend,
    usage: null, brandVoiceMissing: false, grantOutcome: null,
    ...extra,
  }) as DiagnosisResultV2;
}

describe('validateDefinition — v3 분기 스키마(로더 fail-closed)', () => {
  it('시험용 v3 definition은 통과한다', () => {
    const r = validateDefinition(V3DEF);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('전방 참조·타 섹션·분기의 분기·게이트 show_when·분기 requires를 전부 거절한다', () => {
    const clone = () => JSON.parse(JSON.stringify(V3DEF)) as DiagnosisDefinition;

    const forward = clone();
    forward.questions[1].show_when = { q: 'list', in: ['none'] }; // list는 뒤에 정의됨
    expect(validateDefinition(forward).ok).toBe(false);

    const crossSection = clone();
    const lf = forward.questions; void lf;
    const cs = clone();
    (cs.questions.find((q) => q.key === 'list_fields') as any).show_when = { q: 'owner', in: ['self'] }; // s1 참조
    expect(validateDefinition(cs).ok).toBe(false);

    const deep = clone();
    deep.questions.push({
      key: 'deep', text: '분기의 분기', type: 'single', section: 's5',
      show_when: { q: 'scale_customers', in: ['none'] }, options: [{ key: 'a', label: 'a' }],
    });
    (deep.questions.find((q) => q.key === 'scale_customers') as any).show_when = { q: 'scale_ai', in: ['none'] };
    expect(validateDefinition(deep).ok).toBe(false);

    const gateBranch = clone();
    (gateBranch.questions.find((q) => q.key === 'sending') as any).show_when = { q: 'targeting', in: ['all'] };
    expect(validateDefinition(gateBranch).ok).toBe(false);

    const branchReq = clone();
    (branchReq.questions.find((q) => q.key === 'optout_check') as any).options[0].requires =
      [{ column: 'ai_credits_per_month', op: 'gte', value: 50 }];
    expect(validateDefinition(branchReq).ok).toBe(false);

    const badLevel = clone();
    (badLevel.questions.find((q) => q.key === 'list') as any).options[3].level = 0; // 3 뒤에 0 — 역행
    expect(validateDefinition(badLevel).ok).toBe(false);
  });

  it('축 게이트는 전부 아니면 0 — 일부 축만 있는 definition은 거절한다(Codex 2R)', () => {
    const partial = JSON.parse(JSON.stringify(V3DEF)) as DiagnosisDefinition;
    const gate = partial.questions.find((q) => q.key === 'sending') as any;
    delete gate.axis; // 6축 중 하나 제거 → 5축
    expect(validateDefinition(partial).ok).toBe(false);
  });

  it('참조 문항의 options가 손상돼도 예외가 아니라 ok:false다(503 fail-closed 계약 — Codex 1R)', () => {
    const broken = JSON.parse(JSON.stringify(V3DEF)) as DiagnosisDefinition;
    (broken.questions.find((q) => q.key === 'owner') as any).options = 'broken';
    let r: ReturnType<typeof validateDefinition> | null = null;
    expect(() => { r = validateDefinition(broken); }).not.toThrow();
    expect(r!.ok).toBe(false);
  });
});

describe('validateAnswers — 가시성 기반(고아 답 거부·선치환 완화)', () => {
  it('완결 경로는 통과, 비가시 분기 답은 거절, 가시 누락은 거절', () => {
    const ok = baseAnswers();
    expect(validateAnswers(V3DEF, ok).ok).toBe(true);

    const orphan = { ...ok, no_send_reason: 'no_list' }; // sending=s3_5인데 zero 분기 답
    expect(validateAnswers(V3DEF, orphan).ok).toBe(false);

    const missing = { ...ok };
    delete missing.optout_check; // targeting=all이 여는 가시 분기
    expect(validateAnswers(V3DEF, missing).ok).toBe(false);
  });

  it('optionalKeys(실측 선치환 게이트+분기)는 누락·가시성 어긋남을 흡수한다', () => {
    const optional = new Set(['sending', 'no_send_reason', 'manual_ratio', 'send_tool']);
    const a = baseAnswers();
    delete a.sending;
    delete a.manual_ratio;
    expect(validateAnswers(V3DEF, a, { optionalKeys: optional }).ok).toBe(true);
    // 로드 시점 경로의 분기 답이 남아 있어도(서버 실측이 다른 구간을 골랐어도) 거절하지 않는다
    const b = baseAnswers({ sending: 's1_2' });
    (b as any).manual_ratio = 'half';
    expect(validateAnswers(V3DEF, b, { optionalKeys: optional }).ok).toBe(true);
  });
});

describe('recommendPlan — no_match 두 갈래(V-9)', () => {
  it('최고가 후보도 수치 미달 = over_range', () => {
    const a = baseAnswers({ scale_customers: 'o1m' }); // PRO 100만 < 요구 300만
    const r = recommendPlan(V3DEF, a, PLANS);
    expect(r.no_match).toBe(true);
    expect(r.no_match_kind).toBe('over_range');
  });
  it('매치되면 no_match_kind는 null', () => {
    const r = recommendPlan(V3DEF, baseAnswers(), PLANS);
    expect(r.no_match).toBe(false);
    expect(r.no_match_kind).toBeNull();
  });
});

describe('buildDiagnosisResult — v2 스토리형', () => {
  it('관문 사다리 — 선행 축이 단계를 결정한다(총점 없음)', () => {
    expect(buildV2(baseAnswers({ list: 'none' })).stage?.label).toBe('모으기 전');
    expect(buildV2(baseAnswers()).stage?.label).toBe('모으는 중');            // targeting=all(0)
    expect(buildV2(baseAnswers({ targeting: 'behavior' })).stage?.label).toBe('나누는 중'); // repeat=manual(1)
    const run = buildV2(baseAnswers({
      targeting: 'behavior', repeat: 'auto', auto_count: 'a3_5',
      measure: 'revenue', measure_compare: 'notes', production: 'self', prod_refit: 'no', sending: 's6p', manual_ratio: 'half',
    }));
    expect(run.stage?.label).toBe('굴러가는 중');
  });

  it('표지 약점절 = 축 × level — GAPS의 전 조합에 절이 있고, level 1엔 level 1 문구가 나간다(Codex 1R)', () => {
    for (const [axis, byLevel] of Object.entries(GAPS)) {
      for (const level of Object.keys(byLevel ?? {})) {
        expect((COVER_GAP as any)[axis]?.[level], `${axis}.${level} 표지 절 누락`).toBeTruthy();
      }
    }
    // 1순위 병목이 measure level 1(건수까지는 본다) — level 0 문구("결과를 안 보고")가 나가면 표지가 거짓
    const r = buildV2(baseAnswers({
      targeting: 'behavior', production: 'self', prod_time: 'fast', prod_refit: 'no',
    }));
    expect(r.gaps[0]?.axis).toBe('measure');
    expect(r.cover.gap_clause).toBe('반응까지는 못 보는 단계예요');
    expect(r.cover.gap_clause).not.toContain('안 보고');
  });

  it('쌍둥이 테스트(V-4) — targeting all↔behavior 답 하나로 표지·병목·단계가 실제로 달라진다', () => {
    const a = buildV2(baseAnswers());
    const b = buildV2(baseAnswers({ targeting: 'behavior' }));
    expect(a.cover.headline).not.toBe(b.cover.headline);
    expect(a.stage?.label).not.toBe(b.stage?.label);
    expect(a.gaps.map((g) => g.axis)).toContain('targeting');
    expect(b.gaps.map((g) => g.axis)).not.toContain('targeting');
  });

  it('위치 계약(v8) — 서버가 만드는 리포트 문장 전체에 자사명 0(라벨은 화면이 소유)', () => {
    const r = buildV2(baseAnswers());
    // 킥 본문에서도 주어를 뺐다 — 「한줄로에서는」은 렌더 라벨 한 곳에만 있다.
    // 그래서 삭제 테스트(자사 문장을 지워도 문서가 성립)가 구조로 보장된다.
    expect(JSON.stringify(r)).not.toContain('한줄로');
    const kicks = r.gaps.filter((g) => g.fill?.gone);
    expect(kicks.length).toBeGreaterThan(0);
    expect(kicks.length).toBeLessThanOrEqual(3);
  });

  it('킥 — 전 병목에 gone·how 두 줄이 붙고 30일 실행 각주는 폐지됐다', () => {
    const r = buildV2(baseAnswers());
    expect(r.gaps.length).toBeGreaterThan(0);
    for (const g of r.gaps) {
      expect(g.fill?.gone, `${g.axis} gone 누락`).toBeTruthy();
      expect(g.fill?.how, `${g.axis} how 누락`).toBeTruthy();
      // 첫 줄은 없어지는 수고를 지목한다(기능 나열 금지 — 이 문장이 카드의 결론 다음으로 강조된다)
      expect(g.fill.gone, `${g.axis} gone은 수고가 사라진다고 말해야 한다`).toMatch(/없어집니다|사라집니다|줄어듭니다|풀립니다/);
    }
    expect(r.plan30.every((s) => (s as Record<string, unknown>).footnote === undefined)).toBe(true);
  });

  it('킥 변형 — 같은 축이라도 답변이 다르면 킥이 갈린다', () => {
    const fillOf = (r: DiagnosisResultV2, axis: string) => {
      const f = r.gaps.find((g) => g.axis === axis)?.fill;
      return f ? `${f.gone} ${f.how}` : '';
    };
    // 플랫폼에 갇힌 명단 — 플랫폼 종속 전용 킥
    expect(fillOf(buildV2(baseAnswers({ list: 'locked', locked_tool: 'platform' })), 'list'))
      .toContain('플랫폼');
    // 문안을 몰라서 발송 0 — AI 문안 킥
    expect(fillOf(buildV2(baseAnswers({ sending: 'zero', no_send_reason: 'no_copy' })), 'sending'))
      .toContain('문안');
    // 발송 도구 파편화 — 한곳 통합 킥(sending이 병목 3위 안에 들도록 상위 축을 올린다)
    expect(fillOf(buildV2(baseAnswers({
      targeting: 'behavior', production: 'self', sending: 's1_2', send_tool: 'mixed',
    })), 'sending')).toContain('한곳에');
    // 제작 병목의 유일한 분기 = 문구 준비 방식
    expect(fillOf(buildV2(baseAnswers({ production: 'none', copy_how: 'no_copy' })), 'production'))
      .toContain('문구와 이미지');
  });

  it('관찰(답해 주신 것) — 키·값으로 갈라 나온다(화면이 표로 훑게)', () => {
    const r = buildV2(baseAnswers());
    const byKey = new Map(r.observation.items.map((it) => [it.key, it.value]));
    expect(byKey.get('고객 연락처')).toBe('한곳에 모아 관리하고 있어요');
    expect(byKey.get('가장 최근 발송')).toBe('명단 전체에게 보냈어요');
    expect(byKey.get('명단을 모아 둔 곳')).toBeTruthy();     // 도구 축도 같은 표에 실린다
    // 키에 조사가 붙어 있으면 표의 왼쪽 칸이 문장처럼 읽힌다
    for (const it of r.observation.items) {
      expect(it.key, '관찰 키 누락').toBeTruthy();
      expect(it.value, '관찰 값 누락').toBeTruthy();
      expect(it.key!.endsWith('는') || it.key!.endsWith('은')).toBe(false);
      expect(it.text, '구 렌더러용 text 유지').toBeTruthy();
    }
  });

  it('표지 요약 수치 — 잘 되는 축과 걸리는 축을 서버가 센다(화면 재판정 금지)', () => {
    const r = buildV2(baseAnswers());
    const good = r.axes.filter((a) => a.level >= 2).length;
    const gap = r.axes.filter((a) => a.level <= 1).length;
    expect(r.tally).toEqual({ good, gap, total: r.axes.length });
    expect(r.tally.good + r.tally.gap).toBe(r.tally.total);
  });

  it('고도화 경로(병목 0) — plan30에 자사명 0(팔 병목이 없는 회사에는 킥을 넣지 않는다)', () => {
    const r = buildV2(baseAnswers({
      targeting: 'behavior', repeat: 'auto', auto_count: 'a_unknown',
      measure: 'revenue', measure_compare: 'feel',
      production: 'self', prod_refit: 'no', sending: 's6p', manual_ratio: 'all_manual',
    }));
    expect(r.gaps.length).toBe(0);
    expect(r.plan30.length).toBeGreaterThan(0);   // 고도화 제안은 나간다
    expect(JSON.stringify(r.plan30)).not.toContain('한줄로');
  });

  it('삭제 테스트 — 킥·견적 한 줄을 지워도 병목 4박자로 진단이 성립한다', () => {
    const r = buildV2(baseAnswers({ unified_tool: 'crm' }));
    expect(r.pitch_note).toBeTruthy();
    for (const g of r.gaps) {
      const { fill: _fill, ...rest } = g;
      expect(rest.heard).toBeTruthy();
      expect(rest.cause).toBeTruthy();
      expect(rest.effect).toBeTruthy();
      expect(rest.direction).toBeTruthy();
      expect(JSON.stringify(rest)).not.toContain('한줄로');
    }
  });

  it('unknown 3개 이상 = 단계 미발행(M4) · 병목은 그대로 발행', () => {
    const r = buildV2(baseAnswers({
      owner: 'agency', agency_scope: 'unsure',
      list: 'scattered', inflow_capture: 'unknown',
      optout_check: 'unknown_where',
    }));
    expect(r.stage?.issued).toBe(false);
    expect(r.gaps.length).toBeGreaterThan(0);
  });

  it('모순 조합 — 관심사 타게팅 × 연락처뿐 명단 = 강등 없이 소견 승격', () => {
    const r = buildV2(baseAnswers({ targeting: 'interest', segment_reuse: 'fresh', list_fields: 'contact_only' }));
    expect(r.insights.length).toBeGreaterThan(0);
    expect(r.axes.find((x) => x.axis === 'targeting')?.level).toBe(3); // 강등 없음
  });

  it('"굳이 필요 없어서요"에는 measure 처방을 내지 않는다(억지 처방 금지)', () => {
    const r = buildV2(baseAnswers({ measure: 'counts', measure_reason: 'no_need' }));
    expect(r.plan30.some((s) => s.title === '성과 확인')).toBe(false);
  });

  it('「그 외」 업종 = 예시 목업 생략(m2 — 404 iframe 차단)', () => {
    expect(buildV2(baseAnswers({ industry: 'etc' })).examples.industry).toBeNull();
    expect(buildV2(baseAnswers()).examples.industry).toBe('fitness');
  });

  it('V1 호환 — findings에 판매 문구(locked_features) 없음 · 단계와 병목 요약만', () => {
    const r = buildV2(baseAnswers());
    expect(r.findings.some((f) => f.key === 'locked_features')).toBe(false);
    expect(r.findings.some((f) => f.key === 'stage')).toBe(true);
    expect(r.summary).not.toContain('요금제');
  });

  it('v4 도구 스택 — 데이터·발송 분리와 도구 파편화가 짚임으로, 도구 답이 들은 것에 실린다', () => {
    // 데이터는 ERP에, 발송은 문자 사이트로 — 디스커넥트 짚임
    const a = buildV2(baseAnswers({ list: 'locked', locked_tool: 'erp', send_tool: 'sms_site' }));
    expect(a.insights.join(' ')).toContain('데이터가 있는 곳과 발송하는 곳');
    expect(a.observation.items.map((i) => i.text).join(' ')).toContain('발송에 쓰는 도구는');
    // 여러 도구 파편화
    const b = buildV2(baseAnswers({ send_tool: 'mixed' }));
    expect(b.insights.join(' ')).toContain('여러 갈래');
    // 한곳이지만 엑셀 — 자동 갱신 없음
    const c = buildV2(baseAnswers({ list: 'unified', unified_tool: 'excel', list_fields: 'purchase' }));
    expect(c.insights.join(' ')).toContain('엑셀');
    // ERP 명단이 병목이면 처방이 ERP 통로로 갈린다(유입 유실 변형이 앞서지 않는 조합으로)
    const d = buildV2(baseAnswers({ list: 'locked', locked_tool: 'erp', inflow_capture: 'mostly' }));
    const listStep = d.plan30.find((s) => s.title === '고객 명단');
    expect(listStep?.action).toContain('ERP');
  });

  it('v5 — 플랫폼 종속 짚임·전문 툴 칭찬 분화·견적 한 줄이 답에 반응한다', () => {
    // 플랫폼에 갇힘 — 전용 짚임이 나가고 일반 디스커넥트는 중복 발화하지 않는다
    const p = buildV2(baseAnswers({ list: 'locked', locked_tool: 'platform' }));
    expect(p.insights.join(' ')).toContain('플랫폼이 갖고');
    expect(p.insights.join(' ')).not.toContain('데이터가 있는 곳과 발송하는 곳');
    const listStep = p.plan30.find((s) => s.title === '고객 명단');
    expect(listStep?.action).toContain('연락처를 남길 이유');
    // 접점이 플랫폼 중심 + 명단 하위 — 묻지 않아도 같은 짚임
    const p2 = buildV2(baseAnswers({ touchpoint: 'platform', list: 'none' }));
    expect(p2.insights.join(' ')).toContain('플랫폼이 갖고');
    // CRM 사용자 — 명단 칭찬이 전용 문장으로 갈리고 견적 한 줄이 붙는다(자사명 0)
    const c = buildV2(baseAnswers({ unified_tool: 'crm' }));
    expect(c.praises.join(' ')).toContain('CRM으로 고객을 관리');
    expect(c.pitch_note).toBeTruthy();
    expect(c.pitch_note).not.toContain('한줄로');
    // 포스기 갇힘은 전문 툴 사용자가 아니다 — 견적 한 줄 없음
    const np = buildV2(baseAnswers({ list: 'locked', locked_tool: 'pos' }));
    expect(np.pitch_note).toBeUndefined();
  });

  it('퍼널 B(usage null) — 원화 effect 0(manual_count 연환산은 횟수만)', () => {
    const r = buildV2(baseAnswers());
    expect(JSON.stringify(r.effects)).not.toContain('원');
    const anchor = r.effects.find((e) => e.label.includes('반복'));
    expect(anchor?.value).toContain('72번'); // c6_10 하한 6 × 12
  });
});

/**
 * v8 읽힘 재설계 — 화면이 칭찬·짚임의 **첫 문장을 제목으로, 나머지를 설명으로** 가른다.
 * 그 분리가 성립하려면 원장 문장이 항상 2문장 이상이어야 한다. 한 문장짜리가 섞이면
 * 제목만 있고 설명이 빈 칸이 되어 목록의 리듬이 깨진다 — 그래서 원장 성질을 여기서 잠근다.
 */
describe('문구 원장 — 제목·설명 2단 분리 계약', () => {
  const sentences = (t: string) => t.split(/(?<=[.!?])\s+/).filter(Boolean);

  it('칭찬·조합 관찰문은 전부 2문장 이상이다', () => {
    const ledger: Array<[string, string]> = [
      ...Object.entries(PRAISES).map(([k, v]) => [`PRAISES.${k}`, v] as [string, string]),
      ...Object.entries(LIST_TOOL_PRAISES).map(([k, v]) => [`LIST_TOOL_PRAISES.${k}`, v] as [string, string]),
      ...Object.entries(ASSET_PRAISE).map(([k, v]) => [`ASSET_PRAISE.${k}`, v] as [string, string]),
      ...Object.entries(COMBO_OBSERVATIONS).map(([k, v]) => [`COMBO_OBSERVATIONS.${k}`, v] as [string, string]),
    ];
    const single = ledger.filter(([, text]) => sentences(text).length < 2).map(([name]) => name);
    expect(single).toEqual([]);
  });
});
