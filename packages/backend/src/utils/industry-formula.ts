// industry-formula.ts — 업종 승리 공식 증류 + 스타일 예시 재창작 CT (2026-07-04)
//   specs/2026-07-04-best-copy-evolution-design.md §3·§4.
//   입력 = 승인 시드(원문, 내부 전용) → 출력 = 공식 JSON(구조·톤·후킹) + AI 재창작 예시(사용자 노출용).
//   원문의 벽: 예시는 유사도 가드(jaccard3 < 0.35) 통과분만 저장 — 시드 원문·조각의 사용자 노출 0.
//   구체 혜택 금지 — 예시의 혜택 자리는 "[직접 작성해주세요]" placeholder(영구 룰).
import { callAIWithFallback } from '../services/ai';
import { listCuratedSeeds } from './copy-seed-curator';
import {
  saveIndustryFormula, replaceStyleExamples, jaccard3, EXAMPLE_SIMILARITY_MAX,
  type IndustryFormulaMeta,
} from './best-copy-assets';
import { industryLabel } from './industry-codes';

const MIN_SEEDS = 3;         // 공식 증류 최소 시드 수 (미만 = insufficient 정직 반환)
const EXAMPLE_COUNT = 3;     // 재창작 예시 목표 수

export type DistillResult =
  | { ok: true; formula: IndustryFormulaMeta; exampleCount: number; discardedBySimilarity: number }
  | { ok: false; reason: 'insufficient_seeds' | 'ai_parse_failed' | 'table_missing' };

function extractJson(raw: string): any | null {
  const m = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

/** 공식 요약 렌더 — 관리자 패널·프롬프트 블록 공용 사람 가독 문자열. */
export function renderFormulaSummary(meta: IndustryFormulaMeta): string {
  const lines: string[] = [];
  if (meta.hooks?.length) lines.push(`후킹: ${meta.hooks.join(' / ')}`);
  if (meta.structure) lines.push(`구성: ${meta.structure}`);
  if (meta.tone) lines.push(`톤: ${meta.tone}`);
  if (meta.cta) lines.push(`행동 유도: ${meta.cta}`);
  if (meta.length_hint) lines.push(`길이: ${meta.length_hint}`);
  if (meta.donts?.length) lines.push(`피할 것: ${meta.donts.join(' / ')}`);
  return lines.join('\n');
}

/** 조립기 주입용 블록 — Track B 프롬프트에 붙는 지침(원문 아님). */
export function renderFormulaBlock(meta: IndustryFormulaMeta): string {
  return (
    '## 업종 승리 공식 (같은 업종 검증 문안들의 구조 지침 — 원문 아님)\n'
    + renderFormulaSummary(meta)
    + '\n위 공식은 구조 지침일 뿐입니다. 문안은 우리 브랜드 상황에 맞게 완전히 새로 작성하세요.'
  );
}

/** 업종 공식 증류 + 스타일 예시 재창작 — 채굴 승인 직후 자동 / 관리자 버튼 수동 호출. */
export async function distillIndustryFormula(industryCode: string): Promise<DistillResult> {
  const seeds = await listCuratedSeeds(industryCode);
  if (seeds.length < MIN_SEEDS) return { ok: false, reason: 'insufficient_seeds' };

  const label = industryLabel(industryCode);
  const seedList = seeds.slice(0, 40).map((s, i) => `${i + 1}. [${s.messageType}] ${s.text.replace(/\n/g, ' / ')}`).join('\n');

  // 1) 공식 증류 — 원문에서 구조·톤·후킹만 추출(JSON)
  const formulaRaw = await callAIWithFallback({
    system:
      '너는 문자(SMS/LMS) 마케팅 카피 분석가다. 아래 같은 업종의 검증된 문안들에서 공통 승리 패턴만 추출한다. '
      + '특정 문안의 문장·고유 표현을 결과에 옮기지 마라(구조·유형만). 반드시 JSON만 출력: '
      + '{"hooks":["후킹 유형 2~4개"],"structure":"구성 흐름 한 줄","tone":"톤 한 줄","cta":"행동 유도 방식 한 줄","length_hint":"권장 길이 한 줄","donts":["피할 것 1~3개"]}',
    userMessage: `업종: ${label}\n\n${seedList}`,
    maxTokens: 800,
    temperature: 0.2,
    model: 'sonnet',
    creditCost: 0, // 내부 관리자 도구
  });
  const parsed = extractJson(formulaRaw);
  if (!parsed || !parsed.structure) return { ok: false, reason: 'ai_parse_failed' };
  const meta: IndustryFormulaMeta = {
    hooks: Array.isArray(parsed.hooks) ? parsed.hooks.map(String).slice(0, 4) : [],
    structure: String(parsed.structure || ''),
    tone: String(parsed.tone || ''),
    cta: String(parsed.cta || ''),
    length_hint: String(parsed.length_hint || ''),
    donts: Array.isArray(parsed.donts) ? parsed.donts.map(String).slice(0, 3) : [],
  };

  const savedFormula = await saveIndustryFormula(industryCode, renderFormulaSummary(meta), meta);
  if (!savedFormula) return { ok: false, reason: 'table_missing' };

  // 2) 스타일 예시 재창작 — 사용자 노출용(가상 상호·혜택 placeholder·원문 비인용)
  const exampleRaw = await callAIWithFallback({
    system:
      '너는 문자(LMS) 마케팅 카피라이터다. 아래 업종 공식만 참고해 서로 다른 스타일의 예시 문안을 새로 작성한다. '
      + '규칙: (1) 실제 업체명 금지 — 가상 상호(예: "OO뷰티") 사용. (2) 구체 혜택(%·원·쿠폰 금액) 금지 — 혜택 자리는 반드시 "[직접 작성해주세요]" 그대로. '
      + '(3) 전화번호·URL 금지. (4) 각 300자 이내. 반드시 JSON 배열만 출력: '
      + `[{"text":"예시 문안","tags":["후킹유형","톤"]}] — 정확히 ${EXAMPLE_COUNT}개.`,
    userMessage: `업종: ${label}\n\n공식:\n${renderFormulaSummary(meta)}`,
    maxTokens: 1500,
    temperature: 0.7,
    model: 'sonnet',
    creditCost: 0,
  });
  const exArr = extractJson(exampleRaw);
  let discarded = 0;
  const examples: { text: string; tags: string[] }[] = [];
  if (Array.isArray(exArr)) {
    for (const e of exArr.slice(0, EXAMPLE_COUNT)) {
      const text = String(e?.text || '').trim();
      if (!text || text.length < 20) continue;
      // 유사도 가드 — 어떤 시드와도 과유사하면 폐기(원문의 벽)
      const tooSimilar = seeds.some((s) => jaccard3(text, s.text) >= EXAMPLE_SIMILARITY_MAX);
      if (tooSimilar) { discarded++; continue; }
      examples.push({ text, tags: Array.isArray(e?.tags) ? e.tags.map(String).slice(0, 3) : [] });
    }
  }
  await replaceStyleExamples(industryCode, examples);

  return { ok: true, formula: meta, exampleCount: examples.length, discardedBySimilarity: discarded };
}
