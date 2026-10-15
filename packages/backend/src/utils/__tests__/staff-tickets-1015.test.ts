/**
 * ★2026-10-15 B-1015-1 남지현 접수 「AI 오퍼레이션 전체 고객 추출 불가」 고정
 *   - 빈 조건 `{}` 를 세 경로가 다르게 읽었다: 제안 카드(countFilteredCustomers) = 전원 · 리스트(compile) = 거절 · 발송(preview-recipients) = 거절.
 *   - 08-18 에 「조건 못 옮김 = {} 」 을 막으면서 「전체 고객 = {} 」 신호를 만들지 않아 허브 전체 발송이 끊겼다(첫 시도 10-07).
 *   - 수정 = 전체 고객 신호 하나(utils/all-customers-signal): AI 가 `all_customers` 로 전체를 명시하거나 입력 문장이 조건 없는 전체 요청일 때만
 *     제안에 `target.allCustomers` 가 남고, 화면이 그 값을 리스트·발송 요청에 넘기며, 라우트는 그 값이 있을 때만 빈 조건을 전원으로 연다.
 *     신호 없는 `{}` 는 제안 카드부터 같은 문장(HUB_TARGET_EMPTY_MESSAGE)으로 멈춘다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  isPlainAllCustomersRequest, isEmptyFilters, isUnresolvedEmptyTarget, isEmptyAutoSendFilter, HUB_TARGET_EMPTY_MESSAGE, HubTargetEmptyError,
} from '../all-customers-signal';
import { isPlainAllCustomersRequest as fromSegmentGenerator } from '../ai-segment-generator';

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const svc = read('backend/src/services/ai.ts');
const orch = read('backend/src/services/ai-orchestrator.ts');
const routes = read('backend/src/routes/ai.ts');
const page = read('frontend/src/pages/AiOperatorPage.tsx');
const autosend = read('frontend/src/components/AutoSendFormModal.tsx');
const between = (s: string, from: string, to: string) => s.slice(s.indexOf(from), s.indexOf(to, s.indexOf(from)));

describe('전체 고객 신호 CT (all-customers-signal)', () => {
  it('조건 없는 전체 문장만 참 · 조건이 섞이면 거짓(09-26 허용 목록 그대로 · 이동 전 import 경로도 같은 함수)', () => {
    for (const t of ['전체 고객', '전체고객에게 가을 신상품 입고 문자 보내줘'.replace('가을 신상품 입고 문자 ', ''), '모든 고객에게 보내줘', '고객 전체', '전체 고객 대상으로 발송']) {
      expect(isPlainAllCustomersRequest(t)).toBe(true);
    }
    for (const t of ['전체고객에게 가을 신상품 입고 문자 보내줘', '서울 지역 모든 고객', '전 제품 30% 할인행사하자', 'VIP 전체', '']) {
      expect(isPlainAllCustomersRequest(t)).toBe(false);
    }
    expect(fromSegmentGenerator).toBe(isPlainAllCustomersRequest);
  });

  it('빈 조건 판정 · 전체 선언 없는 빈 조건 = 못 옮김', () => {
    expect(isEmptyFilters({})).toBe(true);
    expect(isEmptyFilters(null)).toBe(true);
    expect(isEmptyFilters(undefined)).toBe(true);
    // 객체가 아닌 값(조건이 든 문자열 · 배열)은 "빈 조건"이 아니다 — 전체 선언이 붙으면 전원으로 샌다(Codex 1R)
    expect(isEmptyFilters('{"grade":"VIP"}')).toBe(false);
    expect(isEmptyFilters([])).toBe(false);
    expect(isEmptyFilters({ grade: { operator: 'eq', value: 'VIP' } })).toBe(false);
    expect(isUnresolvedEmptyTarget({ filters: {}, all_customers: false })).toBe(true);
    expect(isUnresolvedEmptyTarget({ filters: {} })).toBe(true);
    expect(isUnresolvedEmptyTarget(null)).toBe(true);
    expect(isUnresolvedEmptyTarget({ filters: {}, all_customers: true })).toBe(false);
    expect(isUnresolvedEmptyTarget({ filters: { grade: { operator: 'eq', value: 'VIP' } }, all_customers: false })).toBe(false);
    // 키는 있는데 WHERE 가 안 붙는 형태(08-18 원칙 · 빌더 결과로 판정) — 전체 선언이 있어도 키가 있으면 전체가 아니다 → 못 옮김
    expect(isUnresolvedEmptyTarget({ filters: { grade: null }, all_customers: false })).toBe(true);
    expect(isUnresolvedEmptyTarget({ filters: { grade: { operator: 'eq', value: '' } }, all_customers: true })).toBe(true);
    // 객체가 아닌 filters(조건이 든 문자열)는 전체 선언이 있어도 못 옮김(Codex 1R)
    expect(isUnresolvedEmptyTarget({ filters: '{"grade":"VIP"}' as any, all_customers: true })).toBe(true);
    const e = new HubTargetEmptyError();
    expect(e.code).toBe('TARGET_FILTER_EMPTY');
    expect(e.message).toBe(HUB_TARGET_EMPTY_MESSAGE);
    expect(HUB_TARGET_EMPTY_MESSAGE).not.toContain('—');
  });
});

describe('AI 타겟 추천(recommendTarget) = 전체 고객을 명시한다', () => {
  const fn = between(svc, 'export async function recommendTarget(', 'export interface FilterCountResult');
  it('프롬프트에 전체 고객 판단 규칙 + 출력 필드 all_customers · 조건을 못 옮겼다고 전체로 넓히지 않는다', () => {
    expect(fn).toContain('## 전체 고객 판단');
    expect(fn).toContain('"all_customers": true 또는 false,');
    expect(fn).toContain('조건을 옮기지 못했다고 전체 고객으로 넓히지 마세요');
  });
  it('반환 = filters 가 비었을 때만 전체 선언(AI 명시 또는 조건 없는 전체 문장) · 조건이 있으면 조건이 이긴다 · 실패 폴백은 false', () => {
    // Codex 1R(1015): 객체가 아닌 filters(조건이 든 문자열 등)는 {} 로 버린 뒤 전체로 승격하지 않는다 — 전체 선언은 진짜 빈 객체(또는 키 없음)에만
    expect(fn).toContain("const filtersIsObject = rawFilters !== null && typeof rawFilters === 'object' && !Array.isArray(rawFilters);");
    expect(fn).toContain('const filtersOut: Record<string, any> = filtersIsObject ? rawFilters : {};');
    expect(fn).toContain('const allCustomers = (rawFilters == null || (filtersIsObject && Object.keys(filtersOut).length === 0))');
    expect(fn).toContain('&& (result.all_customers === true || isPlainAllCustomersRequest(cleanObjective));');
    expect(fn).toContain('all_customers: allCustomers,');
    expect((fn.match(/all_customers: false,/g) || []).length).toBe(2);   // API 키 없음 · 호출 실패
  });
});

describe('세 경로가 빈 조건을 같은 판정으로 읽는다', () => {
  it('제안 카드(orchestrate 허브 분기): 전체 선언 없는 {} 는 세지 않고 HubTargetEmptyError → count 0 + 카드 사유 · 전체면 allCustomers', () => {
    const impl = between(orch, 'async function _orchestrateImpl(', 'export async function orchestrateWithAI(');
    expect(impl).toContain('if (isUnresolvedEmptyTarget(targetResult)) throw new HubTargetEmptyError();');
    expect(impl).toContain('criteria: contractCriteria || (!isOperatorScope && countError ? countError : targetResult.reasoning),');
    expect(impl).toContain("allCustomers: !isOperatorScope && !rawSegmentKey && targetResult.all_customers === true && Object.keys(targetResult.filters || {}).length === 0,");
    // 자동 마케팅 분기(계약 축 · 고정 칸 조건)는 그대로
    expect(impl).toContain('else if (isOperatorScope) targetResult.filters = ctx.audienceFilters || {};');
  });
  it('제안 카드(orchestrateWithAI 허브 분기): 같은 판정 · 같은 문장', () => {
    const ai = orch.slice(orch.indexOf('export async function orchestrateWithAI('));
    expect(ai).toContain("hubTargetEmpty = ctx.audienceScope !== 'operator' && isUnresolvedEmptyTarget(targetResult);");
    expect(ai).toContain(': hubTargetEmpty ? 0');
    expect(ai).toContain('criteria: hubTargetEmpty ? HUB_TARGET_EMPTY_MESSAGE : (targetResult.reasoning || \'\'),');
    expect(ai).toContain("allCustomers: ctx.audienceScope !== 'operator' && targetResult.all_customers === true && Object.keys(targetResult.filters || {}).length === 0,");
  });
  it('발송(preview-recipients): allCustomers 가 참일 때만 빈 WHERE 를 연다 · 문장은 CT 하나', () => {
    const r = between(routes, "router.post('/operator/preview-recipients'", "router.get('/operator/segments'");
    expect(r).toContain('const { filters, allCustomers } = req.body;');
    expect(r).toContain("if (!filterWhere.trim() && allCustomers !== true) {");
    expect(r).toContain('error: HUB_TARGET_EMPTY_MESSAGE,');
    expect(r).not.toContain('AI가 이 목표를 조건으로 옮기지 못했습니다');
  });
  it('리스트(target-recipients): 계약 축 없음 + allCustomers + 빈 조건일 때만 컴파일을 건너뛴다 · 그 밖은 컴파일(빈 조건 = 거절)', () => {
    const r = between(routes, "router.post('/operator/target-recipients'", "router.post('/operator/next-action'");
    expect(r).toContain('const { filters, segment_key, segment_params, operator_id, allCustomers } = req.body;');
    expect(r).toContain("const compiled = (!hasSegment && allCustomers === true && isEmptyFilters(filters))");
    expect(r).toContain("? { filterWhere: '', filterParams: [] as any[], segmentKey: null as string | null, basis: 'legacy_filters' as const }");
    expect(r).toContain(': await compileOperatorAudience({');
    expect(r).toContain('error: HUB_TARGET_EMPTY_MESSAGE,');
    expect(r).not.toContain('AI가 이 목표를 조건으로 옮기지 못했습니다');
  });
  it('컴파일(operator-audience)의 빈 조건 거절은 그대로(자동 마케팅 · 플래그 없는 허브 요청)', () => {
    const aud = read('backend/src/utils/operator-audience.ts');
    expect(aud).toContain('if (!compiled.sql.trim()) throw new AudienceEmptyError();');
  });
  it('자동발송 추천(/recommend-target): 전체 선언 없는 {} 는 전원이 아니라 0 · 화면은 전체 선언도 받지 않는다(저장 검증과 같은 규칙)', () => {
    const r = between(routes, "router.post('/recommend-target'", "router.post('/recommend-next-campaign'");
    expect(r).toContain('const filterResult: FilterCountResult = isUnresolvedEmptyTarget(result)');
    expect(r).toContain('? { count: 0, unsubscribeCount: 0 }');
    expect(autosend).toContain("? '자동발송은 전체 고객 발송을 받지 않습니다. 발송 대상 조건을 적어주세요.'");
    expect(autosend).toContain("if (!targetFilter || Object.keys(targetFilter).length === 0) { setError(");
  });
  it('화면(AiOperatorPage): 제안의 allCustomers 를 리스트·발송 요청에 그대로 넘긴다', () => {
    expect(page).toContain('allCustomers?: boolean;');
    expect((page.match(/allCustomers: proposal\.target\.allCustomers === true/g) || []).length).toBe(2);
  });
});

describe('같은 뿌리 · 자동발송(auto_campaigns)은 조건 없는 전체 발송을 받지 않는다', () => {
  const ac = read('backend/src/routes/auto-campaigns.ts');
  const worker = read('backend/src/utils/auto-campaign-worker.ts');
  it('저장 판정 = 실행 워커와 같은 빌더: 브랜드 단독 조건 {store_code} 은 빈 조건이 아니다(Codex 3R) · {} · 값 빈 조건 · 객체 아님은 빈 조건', () => {
    const CO = '00000000-0000-4000-8000-000000000001';
    expect(isEmptyAutoSendFilter({ store_code: 'BRAND_A' }, CO)).toBe(false);
    expect(isEmptyAutoSendFilter({ grade: { operator: 'eq', value: 'VIP' } }, CO)).toBe(false);
    expect(isEmptyAutoSendFilter({}, CO)).toBe(true);
    expect(isEmptyAutoSendFilter({ grade: { operator: 'eq', value: '' } }, CO)).toBe(true);
    expect(isEmptyAutoSendFilter({ grade: null }, CO)).toBe(true);
    expect(isEmptyAutoSendFilter('{"grade":"VIP"}', CO)).toBe(true);
    expect(isEmptyAutoSendFilter(null, CO)).toBe(true);
  });
  it('저장(생성·수정): WHERE 를 만들지 못하는 조건은 400 TARGET_FILTER_EMPTY(화면 검증은 빈 객체만 봤다)', () => {
    expect(ac).toContain("if (isEmptyAutoSendFilter(target_filter, companyId)) {");
    expect(ac).toContain("&& (typeof target_filter !== 'object' || isEmptyAutoSendFilter(target_filter, companyId))) {");
    expect((ac.match(/error: EMPTY_TARGET_FILTER_MESSAGE, code: 'TARGET_FILTER_EMPTY'/g) || []).length).toBe(2);
  });
  it('워커: 발송 경로는 빈 WHERE 면 보내지 않고 실패로 남긴다 · D-1 통지 인원과 카운트도 전원이 아니라 0', () => {
    const send = worker.slice(worker.indexOf('// ★ customer-filter로 타겟 필터링'));
    expect(send).toContain("if (!filterResult.where.trim()) {");
    expect(send).toContain("await markFailed(ac, '발송 대상 조건이 비어 있어 보내지 않았습니다 (조건 없는 전체 발송 차단). 자동발송을 열어 대상 조건을 다시 설정해주세요.');");
    expect((worker.match(/throw new Error\('발송 대상 조건이 비어 있음 \(조건 없는 전체 발송 차단\)'\);/g) || []).length).toBe(2);
    // 가드가 SELECT 보다 앞이다
    expect(send.indexOf('if (!filterResult.where.trim()) {')).toBeLessThan(send.indexOf('const customersResult = await query('));
  });
});
