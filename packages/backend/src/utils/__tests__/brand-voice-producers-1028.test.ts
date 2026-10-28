/**
 * R24 고객 글 생산자 = 목소리 CT 도달 (★ 2026-10-28 AI 메모리 설계 I2 · K15-2 · docs/2026-10-28-ai-memory-brand-voice-design.md · 뿌리 대장 R24)
 *
 * 뿌리: 회사 목소리가 생산자마다 따로 붙거나(톤 칸 · 최근 발송 문안 · 집 예시) 아예 안 붙어, 같은 회사인데 경로마다 말투가 달랐다.
 * 판정: 고객 글을 만드는 AI 단위(= R13 이 효능 거름에 닿는다고 판정한 단위) = 목소리 CT(composeVoicePrompt)에 닿는다
 *       (그 단위 · 아래로 · 부르는 쪽 · R13 과 같은 도달 규칙).
 * 대상은 소스에서 기계로 뽑는다(손 등재 표 금지) · 면제 = 이유 필수 · 낡은 면제 = 실패 · 미이관 래칫 = 옛 껍데기 이름이 다시 생기면 실패(묶음 B 끝 = 0).
 */
import { describe, it, expect } from 'vitest';
import { scanSources, wrappersOf, unclassifiedAiUnits } from './helpers/producer-scan';

const VOICE_CT = ['composeVoicePrompt'];

/** 고객 글이지만 회사 목소리를 싣지 않는 자리(이유 필수 · 늘리면 이유를 적는다) */
const R24_EXEMPT: Record<string, string> = {
  'utils/crm-agency-proposal.ts#generateAgencyProposal': '한줄로가 대행 고객에게 내는 제안서(한줄로 자기 문서 · 고객사 목소리 아님)',
  'utils/event-image-extract.ts#extractEventTextFromImages': '행사 이미지 글 읽기(원문 전사 · 새 글을 쓰지 않는다)',
  'utils/sales-outreach-jobs.ts#runProductionMetered': 'AI 영업 = 한줄로 자기 목소리(고객사 목소리 아님)',
  'utils/sales-outreach-produce.ts#judgeOutreachTemplates': 'AI 영업 템플릿 고르기(판정 · 한줄로 자기 목소리)',
  'utils/sales-outreach-produce.ts#generateSections': 'AI 영업 = 한줄로 자기 목소리(고객사 목소리 아님)',
  'utils/sales-outreach-produce.ts#outreachTemplateOf': 'AI 영업 = 한줄로 자기 목소리(고객사 목소리 아님)',
  'utils/sales-outreach-produce.ts#generateSubjectIntro': 'AI 영업 = 한줄로 자기 목소리(고객사 목소리 아님)',
  'utils/one-line-ct/ai.ts#judgeLineWithAi': '한 줄 판단(구성 · 흐름 판정 · 문구는 writeLineRichCopy 가 목소리 CT 로 쓴다)',
};

/** 미이관 래칫 — 옛 껍데기 이름을 부르는 단위(묶음 B 끝 = 0 · 껍데기 삭제 · 다시 생기면 실패) */
const UNMIGRATED_MAX = 0;

describe('R24 고객 글 생산자 = 목소리 CT 도달', () => {
  const { units: allUnits, imports } = scanSources();
  const units = allUnits.filter((u) => u.file !== 'utils/brand-voice-prompt.ts' && u.file !== 'utils/copy-benefit-detector.ts');
  const wrappers = wrappersOf(allUnits);
  const eff = unclassifiedAiUnits(units, allUnits, wrappers, imports);
  const copyProducers = eff.ai.map((u) => u.key).filter((k) => !eff.unclassified.includes(k));

  it('바닥값 — 뽑기가 깨져 0개로 초록 통과하지 않게', () => {
    expect(copyProducers.length).toBeGreaterThanOrEqual(30);
  });

  it('고객 글 생산자는 목소리 CT 에 닿는다(면제 = 이유 · 낡은 면제 = 실패)', () => {
    const voice = unclassifiedAiUnits(units, allUnits, wrappers, imports, VOICE_CT);
    const missing = Array.from(new Set(copyProducers.filter((k) => voice.unclassified.includes(k))));
    expect(missing.filter((k) => !(k in R24_EXEMPT))).toEqual([]);
    expect(Object.keys(R24_EXEMPT).filter((k) => !missing.includes(k)), '낡은 면제').toEqual([]);
  });

  it('미이관 래칫 · 성격 리터럴 금지', () => {
    const legacy = allUnits.filter((u) => /\bbuildSystemPromptWithBrandVoice\(/.test(u.body)).map((u) => u.key);
    expect(legacy.length, legacy.join('\n')).toBeLessThanOrEqual(UNMIGRATED_MAX);
    // 성격을 해석하지 않고 「마케팅」으로 박아 넘기지 않는다(I4 · 종류 판정 순서를 지난다)
    const literal = allUnits.filter((u) => /composeVoicePrompt\(\{[^}]*\bkind:\s*'(marketing|notice)'/.test(u.body)).map((u) => u.key);
    expect(literal).toEqual([]);
  });
});
