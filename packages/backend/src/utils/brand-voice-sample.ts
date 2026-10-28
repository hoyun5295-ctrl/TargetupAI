/**
 * 브랜드 보이스 견본 생성 (★ 2026-10-28 AI 메모리 설계 K9 · docs/2026-10-28-ai-memory-brand-voice-design.md)
 *
 * 확인된 묶음으로 「이번 주 신상품 안내」(행사 줄) · 「고객님께 감사 인사」(안부 줄) 두 문안을 한 호출로 만든다.
 * 목소리 CT(composeVoicePrompt · write) → 공용 출구 CT(applyCopyExitGuards)를 그대로 지난다(법 출구 · 칸 잔존 판정 그대로).
 * 정산 · 세대 판정은 라우트(상태 행 잠금 트랜잭션)가 한다. 이 함수는 AI 결과만 낸다(실패 = throw).
 */
import { callAIWithFallback } from '../services/ai';
import { composeVoicePrompt, getBrandVoiceSnapshot, getBrandLinks, voiceLearnedOf, type BrandVoiceKind } from './brand-voice-prompt';
import { applyCopyExitGuards } from './copy-exit-guards';
import { extractJsonFromAiText, aiStr } from './ai-json';
import { measureText } from './copy-shape';
import { AI_FILL_DIRECT_PATTERN } from './copy-benefit-detector';
import { query } from '../config/database';

/** 고정 근거 글(혜택 · 계절 · 날짜 없음 · K9-2) */
export const SAMPLE_GROUND: Record<BrandVoiceKind, string> = {
  marketing: '이번 주 신상품 안내',
  notice: '고객님께 감사 인사',
};

export interface BrandVoiceSampleItem {
  kind: BrandVoiceKind;
  ground: string;
  channel: 'LMS';
  isAd: boolean;
  subject: string;
  message: string;
  shape: { lines: number; paragraphs: number; maxLineLen: number; symbols: string[] };
}

const SAMPLE_BASE = `당신은 이 회사 담당자가 직접 쓰는 것처럼 문자를 쓰는 카피라이터입니다.

## 법 규칙(목소리보다 먼저)
- (광고) · 무료수신거부 · 080 번호는 쓰지 않는다(시스템이 붙인다).
- 근거 글에 없는 혜택 · 할인율 · 가격 · 날짜 · 기간 · 효능을 만들지 않는다.
- 이모지 금지. 한국 휴대폰에서 깨지지 않는 기호만.
- 광고 문자는 본문 첫 줄 또는 제목에 브랜드명.`;

/**
 * (순수) 견본에 쓸 글이 있는가 = 직접 채울 칸 · 회사 이름이 덮는 구간을 전부 표시한 뒤(공백 무시 · 겹침 허용) 덮이지 않은 글자(한글 · 영문 · 숫자)가 있는가.
 *   이름 · 칸만 든 결과에 5 를 걷지 않는다(Codex 구현 1R · 2R · 3R · 지우는 순서가 다른 이름의 일치를 깨지 않게 지우지 않고 표시만 한다).
 */
export function sampleHasBody(text: string, names: ReadonlyArray<string | null | undefined>): boolean {
  const s = String(text || '').replace(/\s+/g, '');
  const covered = new Array<boolean>(s.length).fill(false);
  const cover = (from: number, len: number) => { for (let i = from; i < from + len; i++) covered[i] = true; };
  for (const m of s.matchAll(new RegExp(AI_FILL_DIRECT_PATTERN.source, 'g'))) cover(m.index ?? 0, m[0].length);
  for (const n of names) {
    const k = String(n || '').replace(/\s+/g, '');
    if (!k) continue;
    for (let i = s.indexOf(k); i >= 0; i = s.indexOf(k, i + 1)) cover(i, k.length);
  }
  for (let i = 0; i < s.length; i++) if (!covered[i] && /[가-힣A-Za-z0-9]/.test(s[i])) return true;
  return false;
}

export async function generateBrandVoiceSamples(companyId: string): Promise<BrandVoiceSampleItem[]> {
  const snap = await getBrandVoiceSnapshot(companyId);
  const kinds = (['marketing', 'notice'] as const).filter((k) => voiceLearnedOf(snap, k));
  if (kinds.length === 0) throw new Error('VOICE_NOT_LEARNED');
  const nameRow = await query(`SELECT brand_name, company_name FROM companies WHERE id = $1::uuid`, [companyId]);
  const names = [nameRow.rows[0]?.brand_name, nameRow.rows[0]?.company_name];
  const links = await getBrandLinks(companyId).catch(() => []);

  // 성격마다 그 성격 목소리로 한 편(한 성격만 배운 회사 = 한 편) · 성격별 목소리 블록이 달라 성격마다 호출 · 동시에(60초 한도 안)
  return Promise.all(kinds.map(async (kind): Promise<BrandVoiceSampleItem> => {
    const isAd = kind === 'marketing';
    const ground = SAMPLE_GROUND[kind];
    const composed = await composeVoicePrompt({
      companyId, producer: 'brand-voice-sample', mode: 'write', kind, channel: 'LMS', isAd,
      basePrompt: SAMPLE_BASE,
      outputFormat: '## 출력 형식\n코드펜스 없이 JSON 하나: { "subject": "LMS 제목(20자 안)", "message_text": "본문" }',
    });
    const raw = await callAIWithFallback({
      system: composed.system,
      userMessage: `근거 글: ${ground}\n\n이 근거 글만으로 이 회사 목소리의 LMS 한 편을 쓰세요. 근거에 없는 사실의 칸은 그 칸이 든 문장을 쓰지 않습니다.`,
      maxTokens: 1200,
      temperature: 0.6,
      companyId,
      source: 'brand-voice-sample',
      creditCost: 0,
      noCache: true,
    });
    const parsed: any = extractJsonFromAiText(raw);
    const exit = applyCopyExitGuards({ message_text: aiStr(parsed?.message_text), subject: aiStr(parsed?.subject) }, {
      channel: 'LMS', isAd, bannedWords: composed.guideline?.banned_words || [], benefitGround: ground, baseDate: new Date(),
      validationVars: [], stripAllVars: true, brandLinks: links, senderNames: names,
      style: composed.shape ? { keepDividers: composed.shape.evidence.divider, maxBlankRun: composed.shape.maxBlankRun } : undefined,
    });
    if (!sampleHasBody(exit.message_text, names)) throw new Error('SAMPLE_EMPTY');
    const m = measureText(exit.message_text);
    return {
      kind, ground, channel: 'LMS', isAd, subject: exit.subject || '', message: exit.message_text,
      shape: { lines: m.lines, paragraphs: m.paragraphs, maxLineLen: m.maxLineLen, symbols: Object.keys(m.symbols) },
    };
  }));
}
