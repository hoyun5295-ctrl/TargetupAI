/**
 * 차수 3 ① 발송·돈 (★ 2026-09-27 한줄로 V2)
 *
 * m093 여정 문자 적재 행 유형 칸에 'SMS'·'LMS'·'MMS' 원문 → QTmsg 코드(toQtmsgType) · 단문 제목 비움(subjectForMsgType).
 * R103 웹 푸시 재클릭 = 중복 발송 → 회사 단위 잠금 안에서 발송 중·같은 내용 최근 발송 거절(409).
 * R247 플래너 인앱이 AI 조건을 버려 모든 페이지 로드에 노출 → 조건 전달 + 생성 CT가 trigger_conditions.event를 트리거 기본값으로.
 * R258 A/B 승자 선언이 부모를 정지 → 서빙 입구가 꺼져 전부 노출 중단 → 부모는 정지 대신 가중치 0(가중치 0을 100으로 읽던 것도 정정).
 * R257 변형의 변형(노출 불가)에 3크레딧 → AI 호출 전에 거절 · 변형 생성 CT도 거절.
 * R246 인앱 AI 파싱 실패인데 차감·캐시 → 성공 뒤 차감(묶음 실행 · 캐시 안 함 · 바깥 묶음이면 바깥이 차감).
 * R082 AI 근거 질의 = 없는 칸 조회로 늘 500 · 고치면 한도·과금 없이 고급 모델 → 칸 정정 + 한도·크레딧(단가표 5 · R1-20 선례).
 * R197 운영자 일·월 예산 창 = UTC → KST.  R198 수동 승인 발송도 실측 수량·비용 기록.  m107 자율 발송 패스를 제안 생성보다 먼저.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const between = (s: string, a: string, b: string) => {
  const i = s.indexOf(a);
  if (i < 0) throw new Error(`못 찾음: ${a}`);
  const j = s.indexOf(b, i + a.length);
  return s.slice(i, j < 0 ? undefined : j);
};

describe('m093 여정 문자 유형 칸 = QTmsg 코드', () => {
  it('toQtmsgType · subjectForMsgType', () => {
    const x = src('journey-executor.ts');
    const b = between(x, '// SMS/LMS/MMS 영역 — bulkInsertSmsQueue 정합.', 'const loaded = await bulkInsertSmsQueue(');
    expect(b).toContain('toQtmsgType(msgType),');
    expect(b).toContain('subjectForMsgType(msgType, subject),');
    expect(x).toContain("import { toQtmsgType, subjectForMsgType } from './qtmsg-type';");
    // MMS 첨부 = 절대경로(직접발송과 같은 CT · Codex 1R)
    expect(b).toContain("normalizeMmsImagePaths(step.mms_image_paths)[i] || ''");
    expect(x).not.toContain('function extractBasename(');
  });
});

describe('R103 웹 푸시 중복 발송 차단', () => {
  it('회사 단위 잠금 · 발송 중 · 같은 내용 최근 발송', () => {
    const w = src('web-push.ts');
    expect(w).toContain("return withKeyedLock('web-push', companyId, async () => {");
    expect(w).toContain("AND status = 'sending' AND created_at > NOW() - INTERVAL '30 minutes'");
    expect(w).toContain("AND title = $2 AND body = $3 AND COALESCE(url, '') = COALESCE($4, '')");
    expect(w).toContain('export class PushDuplicateError extends Error');
    const r = src('..', 'routes', 'cdp.ts');
    expect(between(r, "router.post('/push/send'", '\nrouter.')).toContain('if (err instanceof PushDuplicateError) return res.status(409)');
  });
});

describe('R247 인앱 트리거 = AI 조건', () => {
  it('생성 CT 기본값 · 플래너 전달', () => {
    const m = src('inapp-message.ts');
    expect(m).toContain("input.triggerEvent || (typeof (input.trigger_conditions as any)?.event === 'string' ? (input.trigger_conditions as any).event : '') || 'page_load'");
    const p = src('planner-production.ts');
    const b = between(p, 'const created = await createInAppMessage(tp.companyId, userId, {', '});');
    for (const k of ['trigger_conditions: m.trigger_conditions', 'segment_conditions: m.segment_conditions', 'personalization_vars: m.personalization_vars', 'displayFrequency: m.display_frequency']) {
      expect(b, k).toContain(k);
    }
  });
});

describe('R258 · R257 인앱 변형', () => {
  it('승자 선언: 부모는 정지하지 않고 가중치 0 · 가중치 0을 그대로 읽는다', () => {
    const v = src('inapp-variant-optimizer.ts');
    const b = between(v, 'export async function declareWinnerIfReady(', '\nexport ');
    expect(b).toContain('const losersIds = others.filter((s) => s.messageId !== parentMessageId).map((s) => s.messageId);');
    expect(b).toContain('SET variant_weight = 0, updated_at = NOW()');
    expect(v).toContain('variantWeight: Number(row.variant_weight ?? 100),');
    expect(v).not.toContain('Number(row.variant_weight || 100)');
  });
  it('변형의 변형 거절(AI 호출 전 · 변형 생성 CT)', () => {
    const q = src('inapp-quick-action.ts');
    const b = between(q, '// 부모 메시지 조회', '// AI 호출');
    expect(b).toContain('parent_message_id');
    expect(b).toContain('throw new VariantOfVariantError()');
    const v = src('inapp-variant-optimizer.ts');
    expect(between(v, 'export async function createVariant(', '\nexport ')).toContain('if (parent.parent_message_id) throw new VariantOfVariantError();');
    expect(between(src('..', 'routes', 'cdp.ts'), "router.post('/inapp/quick-action'", '\nrouter.')).toContain('if (err instanceof VariantOfVariantError) return res.status(400)');
  });
});

describe('R246 인앱 AI = 성공 뒤 차감', () => {
  it('잔액 확인 → 묶음 실행(캐시 안 함) → 파싱·조립 성공 뒤 1회 차감 · 바깥 묶음이면 0', () => {
    const g = src('inapp-ai-generator.ts');
    expect(g).toContain("const inappCost = isInCreditBundle() ? 0 : getCreditCost('inapp-ai-generator');");
    expect(g).toContain('if (inappCost > 0) await checkCredit(input.companyId, inappCost);');
    expect(g).toContain('const aiResult = await runInCreditBundle(() => callAIWithFallback({');
    expect(g).toContain('noCache: true,');
    const parseAt = g.indexOf('AI 응답 JSON 파싱 실패');
    const deductAt = g.indexOf("source: 'inapp-ai-generator', idempotencyKey: `inapp-ai:${randomUUID()}`");
    expect(deductAt).toBeGreaterThan(parseAt);
    const svc = src('..', 'services', 'ai.ts');
    expect(svc).toContain('const skipCache = hasImages || params.noCache === true;');
  });
});

describe('R082 AI 근거 질의', () => {
  it('실존 칸으로 조회', () => {
    const c = src('citations.ts');
    expect(c).not.toContain('status_code IN');
    expect(c).toContain('SELECT campaign_name AS name, message_content, sent_at, COALESCE(success_count, 0) AS success_count');
  });
  it('월 호출 한도 · 크레딧 확인 뒤 호출 · 성공 뒤 차감(단가표)', () => {
    expect(src('ai-credit-calc.ts')).toContain("'ai-operator-explain': 5,");
    const a = src('..', 'routes', 'ai.ts');
    const b = between(a, "router.post('/operator/explain'", '\nrouter.');
    expect(b).toContain('await checkAiRateLimit(companyId);');
    expect(b).toContain("const explainCost = getCreditCost('ai-operator-explain');");
    expect(b.indexOf('await checkCredit(companyId, explainCost);')).toBeLessThan(b.indexOf('await callAIWithCitations('));
    expect(b.indexOf('await callAIWithCitations(')).toBeLessThan(b.indexOf("source: 'ai-operator-explain'"));
    expect(b).toContain("await recordAiCall({ companyId, source: 'ai-operator-explain', modelType: 'opus', success: true });");
  });
});

describe('R197 · R198 · m107 운영자', () => {
  it('예산 창 = KST(오늘 5 · 이번 달 5)', () => {
    const o = src('continuous-operator.ts');
    expect(o).not.toContain('created_at >= CURRENT_DATE');
    expect(o).not.toContain("date_trunc('month', NOW())");
    expect((o.match(/\$\{KST_TODAY_START_SQL\}/g) || []).length).toBe(5);
    expect((o.match(/\$\{KST_MONTH_START_SQL\}/g) || []).length).toBe(5);
    expect(src('stats-aggregation.ts')).toContain("export const KST_MONTH_START_SQL = `(date_trunc('month', NOW() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')`;");
  });
  it('수동 승인 발송도 실측 수량·비용 기록', () => {
    const o = src('continuous-operator.ts');
    expect(o).toContain('} else if (!autoPath && recipientTotal > 0) {');
    expect(o).toContain('// ★ 2026-09-27 한줄로 V2 R198');
  });
  it('자율 발송 패스가 제안 생성보다 먼저', () => {
    const o = src('continuous-operator.ts');
    const b = between(o, 'export async function runOperatorWorker(', '\nexport ');
    expect(b.indexOf('await runAutoSendPass()')).toBeGreaterThan(0);
    expect(b.indexOf('await runAutoSendPass()')).toBeLessThan(b.indexOf('await generateProposalForOperator(row.id);'));
  });
});
