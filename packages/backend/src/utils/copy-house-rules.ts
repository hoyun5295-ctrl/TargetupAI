/**
 * 문자 집 규칙 CT (★ 2026-10-28 AI 메모리 설계 K2 · K3-2 · I1 · I9 · I15 · docs/2026-10-28-ai-memory-brand-voice-design.md)
 *
 * 규칙 세 벌 = 법 · 발송 · 스타일. 법 · 발송 줄은 이 CT 가 건드리지 않는다(목소리 증거로 끄지 않는다 · I1).
 * 스타일 줄만 목소리 회사에서(I9):
 *   - 같은 성격 사람 표본 3건 이상에서 잰 값이 있으면 그 값의 규칙으로 바꾼다.
 *   - 그렇지 않고 사람 표본(대표 문안 풀)에 반대 증거가 1건이라도 있으면 그 줄을 뺀다.
 *   - 대응 칸이 없는 줄(사용 시나리오 · 감각 언어 · 업종 킬 포인트 · 계절감)은 목소리 회사에서 뺀다.
 *   - 3안 전략 = 목소리 회사 전략(우리 문자처럼 · 혜택 먼저 · 짧게 · K3-2).
 * 목소리 없는 회사 = 받은 글자 그대로(I15 · 스냅숏 시험).
 * 줄 자리는 지시문 원문의 시작 · 끝 글자(앵커)로 찾는다 · 앵커가 원문에 정확히 한 번 있는지는 계약 시험이 지킨다.
 */
import type { CompanyShape } from './copy-shape';

export interface HouseVoiceInput {
  shape: CompanyShape | null;
  lengthRange?: { min_chars: number; max_chars: number } | null;
  /** 같은 성격 사람 표본 원문(반대 증거 판정에만 · 프롬프트에 싣지 않는다) */
  samples: ReadonlyArray<string>;
}

interface Segment { id: string; start: string; end: string }

/** 원문 줄 자리(시작 글자 · 다음 줄의 시작 글자) */
export const HOUSE_SEGMENTS = {
  line17: { id: 'line17', start: '- ⚠️ 한 줄은 반드시 한글 기준 최대 17자', end: '- ⚠️ LMS는 충분히 풍성하게!' },
  lmsBytes: { id: 'lmsBytes', start: '- ⚠️ LMS는 충분히 풍성하게!', end: '- 긴 문장은 반드시 줄바꿈으로' },
  shortLines: { id: 'shortLines', start: '- 긴 문장은 반드시 줄바꿈으로', end: '- 줄바꿈과 특수문자로 가독성 높게' },
  divider: { id: 'divider', start: '### ⛔ 구분선 절대 금지!', end: '### ⛔ 줄바꿈 균형 규칙' },
  blankOne: { id: 'blankOne', start: '- **단락 구분은 빈 줄 1개로**', end: '- **3줄 연속 빈 줄' },
  blankThree: { id: 'blankThree', start: '- **3줄 연속 빈 줄', end: '- **★ 전송자 명칭' },
  exclaim: { id: 'exclaim', start: '- ⚠️ 느낌표(!)는 문안 전체에서 최대 2~3개', end: '- ⚠️ 과장 형용사' },
  scenario: { id: 'scenario', start: '### 2. 사용 시나리오', end: '### 3. 감각 언어' },
  sensory: { id: 'sensory', start: '### 3. 감각 언어', end: '### 4. 개인화 변수 고도 활용' },
  subjectStyles: { id: 'subjectStyles', start: '- 감성형: 감성+브랜드', end: '### 7. CTA' },
  paragraphs: { id: 'paragraphs', start: '### 9. LMS 문단 구성', end: '### 10. 업종별 킬 포인트' },
  killPoint: { id: 'killPoint', start: '### 10. 업종별 킬 포인트', end: '## 3가지 variant 전략' },
  strategy: { id: 'strategy', start: '## 3가지 variant 전략', end: '### 계절감/시기 반영' },
  season: { id: 'season', start: '### 계절감/시기 반영', end: '## 출력 형식' },
} as const satisfies Record<string, Segment>;

/** 뻔한 표현 금지 줄 = 줄마다 사람 표본에 그 말이 있으면 뺀다 */
export const CLICHE_LINES: ReadonlyArray<{ id: string; start: string; evidence: RegExp }> = [
  { id: 'clicheHello', start: '- "안녕하세요, 고객님"', evidence: /안녕하세요/ },
  { id: 'clicheSpecial', start: '- "특별한 혜택/소식/선물"', evidence: /특별한\s*(혜택|소식|선물)/ },
  { id: 'clichePrepared', start: '- "준비했어요/준비했습니다"', evidence: /준비했/ },
  { id: 'clicheCheck', start: '- "확인하세요/만나보세요"', evidence: /확인하세요|만나\s?보세요/ },
  { id: 'clichePrecious', start: '- "소중한 고객님"', evidence: /소중한\s*고객님/ },
  { id: 'clicheVarious', start: '- "다양한 혜택"', evidence: /다양한\s*혜택/ },
  { id: 'clicheInterest', start: '- "많은 관심 부탁드립니다"', evidence: /많은\s*관심/ },
];

/** 목소리 회사 3안 이름(키 A/B/C · emo/benefit/mz · 과금 · 원장 칸은 그대로 · K3-1) */
export const VOICE_VARIANT_NAMES = ['우리 문자처럼', '혜택 먼저', '짧게'] as const;

const VOICE_STRATEGY = `## 3가지 안 전략 (세 안 모두 이 회사 목소리 · 다른 점 = 후크 · 혜택 위치 · 길이)

**우리 문자처럼(A)**
- 이 회사 대표 문안의 짜임(첫 줄 · 문단 순서 · 맺음)을 그대로 따른 가장 회사다운 안

**혜택 먼저(B)**
- 첫 줄 또는 첫 문단에 이번 요청의 혜택을 먼저 · 요청에 혜택이 없으면 핵심 소식을 먼저

**짧게(C)**
- LMS 도 4줄 안 · SMS 는 압축 · 같은 목소리로 핵심만

`;

function sliceOf(base: string, seg: Segment): { from: number; to: number } | null {
  const from = base.indexOf(seg.start);
  if (from < 0) return null;
  const to = base.indexOf(seg.end, from + seg.start.length);
  return to < 0 ? null : { from, to };
}

function lineSliceOf(base: string, start: string): { from: number; to: number } | null {
  const from = base.indexOf(start);
  if (from < 0) return null;
  const nl = base.indexOf('\n', from);
  return { from, to: nl < 0 ? base.length : nl + 1 };
}

/** (순수) 문자 생성 지시문(BRAND_SYSTEM_PROMPT · C안 교체 뒤)에 목소리 판정을 건다 · voice = null 이면 그대로 */
export function buildHouseRules(base: string, voice: HouseVoiceInput | null): { system: string; applied: string[] } {
  if (!voice) return { system: base, applied: [] };
  const shape = voice.shape;
  const ev = shape?.evidence;
  const samples = voice.samples;
  const edits: Array<{ from: number; to: number; text: string; id: string }> = [];
  const put = (seg: Segment, text: string) => { const s = sliceOf(base, seg); if (s) edits.push({ ...s, text, id: seg.id }); };
  const S = HOUSE_SEGMENTS;

  // 한 줄 길이 · 짧은 줄
  if (shape?.lineLenP90 != null) put(S.line17, `- 한 줄은 이 회사 문자처럼 보통 ${shape.lineLenP50}자 · 길어도 ${shape.lineLenP90}자 안팎\n`);
  else if (ev?.lineOver17) put(S.line17, '');
  if (ev?.lineOver17) put(S.shortLines, '');
  // LMS 길이
  const lr = voice.lengthRange;
  const lmsLens = samples.map((t) => Array.from(t).length);
  if (lr && lr.min_chars > 0 && lr.max_chars >= lr.min_chars && (shape?.n ?? 0) >= 3) put(S.lmsBytes, `- LMS 본문 길이는 이 회사 문자처럼 ${lr.min_chars}~${lr.max_chars}자 안팎\n`);
  else if (lmsLens.some((n) => n < 150 || n > 600)) put(S.lmsBytes, '');
  // 구분선
  if (ev?.divider) put(S.divider, '### 구분선\n이 회사 대표 문안처럼 구분선을 써도 됩니다.\n\n');
  // 빈 줄
  if (shape?.maxBlankRun != null && ev?.blankRunOver1) put(S.blankOne, `- **단락 구분**: 이 회사 문자처럼 단락 사이 빈 줄 최대 ${shape.maxBlankRun}줄.\n`);
  else if (ev?.blankRunOver1) put(S.blankOne, '');
  if (ev?.blankRunOver1) put(S.blankThree, '');
  // 느낌표
  if (shape?.exclaimMax != null && ev?.exclaimOver3) put(S.exclaim, `- 느낌표(!)는 이 회사 문자처럼 최대 ${shape.exclaimMax}개\n`);
  else if (ev?.exclaimOver3) put(S.exclaim, '');
  // 문단 구성
  if (shape?.paragraphs) put(S.paragraphs, `### 9. LMS 문단 구성\n이 회사 문자처럼 ${shape.paragraphs.min}~${shape.paragraphs.max}개 문단 · 각 문단은 빈 줄로 구분\n\n`);
  else if (ev?.paragraphsUnder5) put(S.paragraphs, '');
  // 대응 칸이 없는 스타일 = 목소리 회사에서 끔
  put(S.scenario, '');
  put(S.sensory, '');
  put(S.killPoint, '');
  put(S.season, '');
  // 3안 전략 · 제목 꼴
  put(S.strategy, VOICE_STRATEGY);
  put(S.subjectStyles, '- 세 안의 제목도 이 회사 문자 제목 꼴로 서로 다르게\n\n');
  // 뻔한 표현 금지 줄 = 사람 표본에 그 말이 있으면 뺀다
  for (const c of CLICHE_LINES) {
    if (samples.some((t) => c.evidence.test(t))) {
      const s = lineSliceOf(base, c.start);
      if (s) edits.push({ ...s, text: '', id: c.id });
    }
  }

  edits.sort((a, b) => b.from - a.from);
  let out = base;
  for (const e of edits) out = out.slice(0, e.from) + e.text + out.slice(e.to);
  // 출력 형식의 안 이름(감성형 · 혜택강조형 · C 이름) = 목소리 이름
  out = out
    .replace('"variant_name": "감성형"', `"variant_name": "${VOICE_VARIANT_NAMES[0]}"`)
    .replace('"variant_name": "혜택강조형"', `"variant_name": "${VOICE_VARIANT_NAMES[1]}"`)
    .replace(/"variant_name": "(MZ감성형|짧고 강한형)"/, `"variant_name": "${VOICE_VARIANT_NAMES[2]}"`);
  return { system: out, applied: edits.map((e) => e.id).reverse() };
}

/** 3안 이름(서버가 정해 응답에 싣는다 · 화면은 그린다 · K3-2) */
export function variantNamesFor(voiceMode: boolean, cName: string): [string, string, string] {
  return voiceMode ? [...VOICE_VARIANT_NAMES] : ['감성형', '혜택강조형', cName];
}
