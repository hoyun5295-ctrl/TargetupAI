/**
 * one-line-ct/ai.ts — 한줄 CT 의 AI 호출 한 곳(설계서 docs/2026-10-22-oneline-ct-design.md §11-1 · §11-4)
 *
 * 새 CT 코드의 AI 호출은 이 파일에만 둔다(판단 · 문구). 모델 = 기본(지정 없음 · 문안 계열).
 * ⛔ 불변
 *   - AI 는 닫힌 JSON 키만 쓴다. 고르기(구성 5종)는 목록 밖 값 = 규칙 추천으로 바꾼다(허용 목록).
 *   - 원문(한 줄 · 브랜드 · 상품 이름)에 없는 숫자 · 혜택이 생기면 그 칸을 버린다(초안) · 기본 문구로 바꾼다(문구).
 *   - 줄표 · 따옴표 장식 · 이모지 정리. 호출부는 `runInCreditBundle` 안에서 부른다(이 호출 차감 0 · 원장 행은 입구 한 번).
 *   - 실패(응답 없음 · JSON 아님)는 던진다 → 판단 = 규칙 판단(0원) · 문구 = 503(차감 전).
 */
import { callAIWithFallback } from '../../services/ai';
import { composeVoicePrompt } from '../brand-voice-prompt';
import { resolveCopyIntent } from '../copy-content-type';
import { extractJsonFromAiText } from '../ai-json';
import { findNewNumbers, findInventedBenefits, claimsInventedEfficacy, pairClaimsInventedEfficacy } from '../copy-benefit-detector';
import {
  LINE_COMPOSITIONS, isLineCompositionId, type LineComposition, type LineCompositionId, type LineRichCopy, type LineRichCopyKey, type LineRichPoint,
} from '../line-compositions';

/** 판단 초안(구성마다 · 사람이 고치는 초안) */
export type LineCtDrafts = Partial<Record<LineCompositionId, { points?: LineRichPoint[]; steps?: LineRichPoint[] }>>;

export interface LineCtGround {
  line: string;
  brandName: string;
  industry: string | null;
  productNames: string[];
}

/** 근거 글(숫자 · 혜택 판정의 원문) */
export function lineCtGroundText(g: LineCtGround): string {
  return [g.line, g.brandName, ...g.productNames].filter(Boolean).join('\n');
}

/** (순수) 한 칸 정리 — 장식 제거 · 상한 · 숫자 · 혜택 · 효능 단정 검사(걸리면 빈 값 · ★ 1024 효능 = 근거에 없는 단정만 · 문자 문안과 같은 판정) */
export function cleanLineCtText(raw: unknown, max: number, ground: string): string {
  let v = typeof raw === 'string' ? raw : '';
  v = v.replace(/[—–]/g, ' ').replace(/[“”"'`]/g, '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (v.length > max) v = v.slice(0, max).trim();
  if (!v) return '';
  if (findNewNumbers(v, ground).length > 0 || findInventedBenefits(v, ground).length > 0 || claimsInventedEfficacy(v, ground)) return '';
  return v;
}

/** 초안 상한(제목 · 한 줄) */
export const LINE_CT_DRAFT_TITLE_MAX = 14;
export const LINE_CT_DRAFT_BODY_MAX = 40;

function cleanPoints(raw: unknown, n: number, ground: string): LineRichPoint[] {
  if (!Array.isArray(raw)) return [];
  const out: LineRichPoint[] = [];
  for (const r of raw.slice(0, n)) {
    const o = r && typeof r === 'object' ? r as Record<string, unknown> : {};
    // ★ 2026-10-23 AI 초안 = 효능 단정이면 그 칸 전체를 버린다(제목 + 한 줄을 붙여 읽는다 · 한쪽만 지워 빈 단계가 남지 않게) · ★ 1024 판정 = 근거에 없는 단정(copy-benefit-detector)
    // ★ 2026-10-24 ② 두 칸 이어 읽기 = 문장 경계(pairClaimsInventedEfficacy · 세 채널 생산자와 같은 판정)
    if (pairClaimsInventedEfficacy(typeof o.title === 'string' ? o.title : '', typeof o.body === 'string' ? o.body : '', ground)) continue;
    const title = cleanLineCtText(o.title, LINE_CT_DRAFT_TITLE_MAX, ground);
    const body = cleanLineCtText(o.body, LINE_CT_DRAFT_BODY_MAX, ground);
    if (title) out.push({ title, body });
  }
  return out;
}

/** 혜택 · 숫자 말(띠 · 쿠폰 칸이 따로 보여 준다) */
const DRAFT_BENEFIT_RE = /[0-9０-９%]|할인|쿠폰|적립|무료|증정|세일/;

/**
 * (순수) 특징 초안 거르기 — 혜택을 되풀이하거나 제목 낱말이 전부 한 줄에 있는 것(= 한 줄 되풀이)은 버리고 2개 미만이면 비운다
 *   (★ 2026-10-22 시연 판정 「진정 앰플 신제품 · 새롭게 출시되었습니다」 · 비면 재료 판이 특징을 묻는다).
 */
function keepFeaturePoints(points: LineRichPoint[], line: string): LineRichPoint[] {
  const words = (v: string) => v.split(/[\s·,]+/).map((w) => w.trim()).filter((w) => w.length >= 2);
  const lineText = line.replace(/\s+/g, '');
  const kept = points.filter((p) => {
    if (DRAFT_BENEFIT_RE.test(p.title) || DRAFT_BENEFIT_RE.test(p.body)) return false;
    const ws = words(p.title);
    return !(ws.length > 0 && ws.every((w) => lineText.includes(w)));
  });
  return kept.length >= 2 ? kept : [];
}

/** (순수) 판단 응답 정리 — 고르기 = 목록 안만 · 초안 = 구성별 개수 · 이유 40자 */
export function sanitizeLineJudge(raw: unknown, ground: string, line = ''): { pick: LineCompositionId | null; reason: string; drafts: LineCtDrafts } {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const pick = isLineCompositionId(o.pick) ? o.pick : null;
  const reason = cleanLineCtText(o.reason, 40, ground);
  const d = o.drafts && typeof o.drafts === 'object' && !Array.isArray(o.drafts) ? o.drafts as Record<string, any> : {};
  const drafts: LineCtDrafts = {
    spotlight: { points: keepFeaturePoints(cleanPoints(d.spotlight?.points, 3, ground), line), steps: cleanPoints(d.spotlight?.steps, 3, ground) },
    lookbook: { points: cleanPoints(d.lookbook?.points, 2, ground) },
    menu: { points: cleanPoints(d.menu?.points, 3, ground).map((p) => ({ title: p.title, body: '' })) },
    event: { points: cleanPoints(d.event?.points, 3, ground) },
  };
  return { pick, reason, drafts };
}

const JUDGE_SYSTEM = `당신은 한국 브랜드의 마케팅 기획자입니다. 담당자가 쓴 한 줄을 읽고, 정해진 구성 5종 중 하나를 고르고, 구성마다 사람이 고칠 초안을 씁니다.
규칙:
- 반드시 JSON 객체 하나만 출력합니다(코드블록 · 설명 금지).
- pick 은 spotlight · showcase · lookbook · menu · event 중 하나만 씁니다.
- 원문에 없는 숫자 · 할인율 · 금액 · 날짜 · 기간 · 수량 · 혜택(무료 · 증정 · 쿠폰 등)을 절대 만들지 않습니다.
- 상품의 효과 · 성분 · 품질을 단정하지 않습니다(최고 · 1위 · 완벽 같은 과장 금지). 짧고 또렷한 존댓말.
- 특징 초안(spotlight.points)은 한 줄에 이미 쓴 말(상품 이름 · 출시 · 혜택 · 기간)을 되풀이하지 않습니다. 쓸 특징이 없으면 빈 배열로 둡니다.
- 긴 줄표 기호 · 따옴표 장식 · 이모지를 쓰지 않습니다.`;

/** 판단 AI 1회(구성 고르기 + 구성별 초안) — 실패는 던진다(호출부 = 규칙 판단 · 0원) */
export async function judgeLineWithAi(g: LineCtGround, ctx: { companyId: string; userId?: string; source: string }): Promise<{ pick: LineCompositionId | null; reason: string; drafts: LineCtDrafts }> {
  const list = LINE_COMPOSITIONS.map((c) => `- ${c.id} (${c.label}): ${c.desc}`).join('\n');
  const user = [
    `[브랜드] ${g.brandName || '(이름 없음)'}${g.industry ? ` · 업종 ${g.industry}` : ''}`,
    `[담당자가 쓴 한 줄] ${g.line}`,
    g.productNames.length > 0 ? `[상품] ${g.productNames.slice(0, 8).join(', ')}` : '',
    `[구성 5종]\n${list}`,
    '[출력 모양]',
    '{"pick":"구성 id","reason":"왜 이 구성인지 한 문장(40자 이내)","drafts":{',
    '  "spotlight":{"points":[{"title":"특징 이름 14자","body":"한 줄 40자"} x3],"steps":[{"title":"단계 이름","body":"한 줄"} x3]},',
    '  "lookbook":{"points":[{"title":"코디 이름","body":"한 줄"} x2]},',
    '  "menu":{"points":[{"title":"맛 · 재료 꼬리표 8자","body":""} x3]},',
    '  "event":{"points":[{"title":"참여 단계 이름","body":"한 줄"} x3]}}}',
    'JSON 으로만 답하세요.',
  ].filter(Boolean).join('\n');
  const text = await callAIWithFallback({ system: JUDGE_SYSTEM, userMessage: user, maxTokens: 1400, temperature: 0.4, companyId: ctx.companyId, userId: ctx.userId, source: ctx.source, noCache: true });
  const parsed = extractJsonFromAiText<Record<string, unknown>>(text);
  if (!parsed || typeof parsed !== 'object') throw new Error('LINE_JUDGE_EMPTY');
  return sanitizeLineJudge(parsed, lineCtGroundText(g), g.line);
}

/** 붙어서 읽히는 칸(큰 제목 + 받침 · 마무리 제목 + 본문 · 팝업 제목 + 본문 · 메일 제목 + 미리보기) — 둘을 이어 읽어야 단정이 되는 말을 잡는다 */
const COPY_PAIRS: ReadonlyArray<[LineRichCopyKey, LineRichCopyKey]> = [['headline', 'sub'], ['closingHeadline', 'closingBody'], ['inapp_title', 'inapp_body'], ['email_subject', 'email_preheader']];

/** (순수) 문구 응답 정리 — 칸마다 상한 · 검사 · 실패 칸 = 기본 문구 · ★ 1024 붙어서 읽히는 두 칸이 함께 효능 단정이면 둘 다 기본 문구 */
export function sanitizeLineRichCopy(comp: LineComposition, raw: unknown, ground: string): { copy: LineRichCopy; replaced: LineRichCopyKey[] } {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const copy = {} as LineRichCopy;
  const replaced: LineRichCopyKey[] = [];
  const fallbackOf = new Map(comp.copy.map((f) => [f.key, f.fallback]));
  for (const f of comp.copy) {
    const v = cleanLineCtText(o[f.key], f.max, ground);
    if (v) copy[f.key] = v; else { copy[f.key] = f.fallback; replaced.push(f.key); }
  }
  for (const [a, b] of COPY_PAIRS) {
    if (!fallbackOf.has(a) || !fallbackOf.has(b)) continue;
    if (!pairClaimsInventedEfficacy(copy[a], copy[b], ground)) continue;   // ★ 2026-10-24 ② 문장 경계로 이어 읽기(공백 이음 = 제 주어 있는 뒤 칸 오탐)
    for (const k of [a, b]) {
      if (copy[k] !== fallbackOf.get(k)) { copy[k] = fallbackOf.get(k)!; if (!replaced.includes(k)) replaced.push(k); }
    }
  }
  return { copy, replaced };
}

const COPY_SYSTEM = `당신은 한국 브랜드의 마케팅 카피라이터입니다. 정해진 구성의 문구 칸만 채웁니다.
규칙:
- 반드시 JSON 객체 하나만 출력합니다(코드블록 · 설명 금지). 키는 요청한 키만 씁니다.
- 각 칸의 글자 수 상한을 지킵니다(공백 포함). 짧고 또렷하게, 존댓말로 씁니다.
- 원문에 없는 숫자 · 할인율 · 금액 · 날짜 · 기간 · 수량 · 혜택(무료 · 증정 · 쿠폰 등)을 절대 만들지 않습니다. 혜택 · 기간 · 가격은 코드가 따로 싣습니다.
- 상품의 효과 · 성분 · 품질을 단정하지 않습니다(최고 · 1위 · 완벽 같은 과장 금지).
- 긴 줄표 기호와 따옴표 장식을 쓰지 않습니다. 이모지를 쓰지 않습니다.`;

/** 문구 AI 1회 — 실패는 던진다(호출부 503 · 차감 0) */
export async function writeLineRichCopy(comp: LineComposition, g: LineCtGround, ctx: { companyId: string; userId?: string; source: string; exemplars?: string | null }): Promise<{ copy: LineRichCopy; replaced: LineRichCopyKey[] }> {
  const fields = comp.copy.map((f) => `- ${f.key} (${f.max}자 이내): ${f.hint}`).join('\n');
  const user = [
    `[구성] ${comp.label} · ${comp.desc}`,
    `[브랜드] ${g.brandName || '(이름 없음)'}`,
    `[담당자가 쓴 한 줄] ${g.line}`,
    g.productNames.length > 0 ? `[상품] ${g.productNames.slice(0, 8).join(', ')}` : '',
    ctx.exemplars ? `[같은 업종 브랜드가 실제로 보낸 문구 · 문장 리듬 · 길이 · 말투만 참고 · 예시의 숫자 · 혜택 · 상품명 · 브랜드명은 절대 쓰지 않는다]\n${ctx.exemplars.slice(0, 2400)}` : '',
    `[채울 칸]\n${fields}`,
    'JSON 으로만 답하세요.',
  ].filter(Boolean).join('\n');
  // ★ 2026-10-28 AI 메모리 설계 K11-1 · K11-3 — 한줄 CT 문구 = 쓰기 · 말투 · 호칭 · 맺음(목소리 회사 = 다른 브랜드 예시 0)
  const { system: voiceSystem } = await composeVoicePrompt({
    companyId: ctx.companyId, producer: 'one-line-rich-copy', mode: 'write', scope: 'tone', kind: resolveCopyIntent({ isAd: true }).kind, basePrompt: COPY_SYSTEM,
  });
  const text = await callAIWithFallback({ system: voiceSystem, userMessage: user, maxTokens: 1200, temperature: 0.6, companyId: ctx.companyId, userId: ctx.userId, source: ctx.source, noCache: true });
  const parsed = extractJsonFromAiText<Record<string, unknown>>(text);
  if (!parsed || typeof parsed !== 'object') throw new Error('LINE_COPY_EMPTY');
  return sanitizeLineRichCopy(comp, parsed, lineCtGroundText(g));
}
