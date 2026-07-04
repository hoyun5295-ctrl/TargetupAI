/**
 * copy-prompt-composer.ts — 문안 두뇌 ③ 프롬프트 조립기
 *
 * RAG 성과 예시(①) + 시의성 컨텍스트(②) + 브랜드 키트(시그니처/슬로건/금지어)를 하나의
 * 시스템 프롬프트 suffix로 합성한다. 이메일·캠페인 SMS 생성기가 이 suffix를 기존 system 뒤에 붙인다.
 *
 * 시그니처 보호: 회사 예시는 "참고", 업종(타사 비식별) 예시는 "표현 복제 금지 — 새로 작성" 지시.
 * 자사 시그니처(signature_locked)는 명시적으로 조합하라고 지시(타사 자리를 자사로 채움).
 */

import pool from '../config/database';
import type { CopyExample, IndustryFeatureSummary } from './copy-rag-retriever';
import { retrieveCopyExamples } from './copy-rag-retriever';
import { buildTemporalContext, buildIndustryEvents, renderContextForPrompt } from './copy-context';
import { getBrandGuideline } from './brand-voice-prompt';
import { hasIdentifierLeak } from './copy-deidentify';
// ★ 2026-07-04 진화(specs/2026-07-04-best-copy-evolution-design.md): 시드 사용 기록 + 업종 승리 공식 주입
import { recordSeedUsage, getIndustryFormula } from './best-copy-assets';
import { renderFormulaBlock } from './industry-formula';

export interface BrandKit {
  signatureLocked?: string;
  signatureMode?: 'append' | 'ai_blend';
  slogans?: string[];
  requiredWords?: string[];
  bannedWords?: string[];
}

export interface ComposeInput {
  companyId: string;
  channels: string[]; // 우선 채널 (예: ['EMAIL'] 또는 ['SMS','LMS','MMS'])
  isAd: boolean;
  now?: Date;
}

/** 회사 업종 코드 조회 (companies.industry_code — 미설정 시 null, 실패해도 null) */
async function resolveCompanyIndustry(companyId: string): Promise<string | null> {
  try {
    const r = await pool.query('SELECT industry_code FROM companies WHERE id = $1', [companyId]);
    const code = r.rows[0]?.industry_code;
    return code && String(code).trim() ? String(code).trim() : null;
  } catch (err) {
    console.warn('[copy-brain] 업종 조회 실패 — null로 진행:', (err as Error)?.message);
    return null;
  }
}

export interface ComposeResult {
  promptSuffix: string;
  examples: CopyExample[];
  bannedWords: string[]; // ★ ② 출력 금지어 가드용 (브랜드 키트 banned_words)
}

/** 순수 합성 — 예시·맥락·키트 → 프롬프트 suffix 문자열 (전부 비면 '') */
export function buildCopyBrainPrompt(opts: {
  examples: CopyExample[];
  industryFeatures?: IndustryFeatureSummary | null;
  contextLine: string;
  kit: BrandKit;
  channel: string;
  formulaBlock?: string; // ★ 2026-07-04: 업종 승리 공식 지침(Track B만, 원문 아님)
}): string {
  const { examples, industryFeatures, contextLine, kit } = opts;
  const parts: string[] = [];

  if (contextLine && contextLine.trim()) {
    parts.push(`## 발송 맥락\n${contextLine.trim()}\n위 맥락이 자연스럽게 어울리면 반영하되, 억지로 끼워넣지 마세요.`);
  }

  const company = examples.filter((e) => e.source === 'company');

  if (company.length > 0) {
    const list = company.map((e, i) => `${i + 1}. ${e.text}`).join('\n');
    parts.push(`## 우리 회사에서 반응이 좋았던 문안 (톤·구조 참고용 — 본문을 그대로 베끼지 말 것)\n${list}`);
  }

  // ★ 2026-07-04 같은 업종 베스트(탈색·검수된 큐레이션 시드)를 참고 원문으로 렌더. 식별자 잔존 행은 방어적으로 제외.
  const industry = examples.filter((e) => e.source === 'industry' && !hasIdentifierLeak(e.text));
  if (industry.length > 0) {
    const list = industry.map((e, i) => `${i + 1}. ${e.text}`).join('\n');
    parts.push(`## 같은 업종에서 검증된 문안 (탈색됨 — 구조·표현만 참고, 회사 식별정보 제거 / 그대로 베끼지 말 것)\n${list}`);
  }

  // ★ 2026-07-04: 업종 승리 공식(증류 지침 — 원문 아님). 시드 원문 블록과 공존.
  if (opts.formulaBlock && opts.formulaBlock.trim()) {
    parts.push(opts.formulaBlock.trim());
  }

  // ★ A6 (2026-06-30): 같은 업종은 원문이 아니라 구조·통계만 (타사 시그니처 누출 0)
  if (industryFeatures && industryFeatures.sampleCount > 0) {
    const f = industryFeatures;
    parts.push(
      `## 같은 업종 ${f.sampleCount}건의 구조 통계 (참고만 — 타사 문장·표현은 주어지지 않습니다)\n` +
      `- 평균 길이: 약 ${f.avgLengthChars}자\n` +
      `- 평균 문장 수: 약 ${f.avgSentenceCount}개\n` +
      `- 행동 유도(CTA) 포함 비율: ${Math.round(f.hasCtaRatio * 100)}%\n` +
      '위는 같은 업종이 통하는 길이·구조의 통계일 뿐입니다. 이 통계를 참고하되 문안은 우리 브랜드 보이스로 완전히 새로 작성하세요.',
    );
  }

  if (kit.signatureLocked && kit.signatureLocked.trim()) {
    const sig = kit.signatureLocked.trim();
    if (kit.signatureMode === 'ai_blend') {
      parts.push(`## 브랜드 시그니처\n다음 시그니처의 느낌을 문안 톤에 자연스럽게 녹이세요: "${sig}"`);
    } else {
      parts.push(
        `## 브랜드 시그니처 (맺음)\n문안 마지막에 다음 시그니처를 자연스럽게 포함하세요: "${sig}"\n` +
        '(단, SMS 등 글자 수가 빠듯하면 생략 가능)',
      );
    }
  }

  if (kit.slogans && kit.slogans.length > 0) {
    parts.push(`## 활용 가능 슬로건 (문맥에 맞을 때만)\n${kit.slogans.join(' / ')}`);
  }

  if (kit.requiredWords && kit.requiredWords.length > 0) {
    parts.push(`## 가능하면 포함할 표현\n${kit.requiredWords.join(' / ')}`);
  }

  if (kit.bannedWords && kit.bannedWords.length > 0) {
    parts.push(`## 절대 사용 금지 단어\n${kit.bannedWords.join(' / ')} — 이 단어들은 쓰지 마세요.`);
  }

  if (parts.length === 0) return '';
  return `\n\n${parts.join('\n\n')}`;
}

/** DB 조합 — 검색기 + 컨텍스트 + 브랜드 키트 → suffix. 실패해도 빈 suffix로 안전 degrade. */
export async function composeCopyBrain(input: ComposeInput): Promise<ComposeResult> {
  const now = input.now || new Date();
  const industryCode = await resolveCompanyIndustry(input.companyId);

  // ★ A6: 브랜드 키트 + 등록 여부 먼저 (등록 회사면 업종 폴백 OFF — 자기것만)
  let kit: BrandKit = {};
  let brandVoiceRegistered = false;
  try {
    const g = await getBrandGuideline(input.companyId);
    if (g) {
      brandVoiceRegistered = true;
      kit = {
        signatureLocked: g.signature_locked,
        signatureMode: g.signature_mode,
        slogans: g.slogans,
        requiredWords: g.required_words,
        bannedWords: g.banned_words,
      };
    }
  } catch (err) {
    console.warn('[copy-brain] 브랜드 키트 조회 실패 — 키트 없이 진행:', (err as Error)?.message);
  }

  let examples: CopyExample[] = [];
  let industryFeatures: IndustryFeatureSummary | null = null;
  try {
    const res = await retrieveCopyExamples({
      companyId: input.companyId,
      industryCode,
      channels: input.channels,
      isAd: input.isAd,
      brandVoiceRegistered,
    });
    examples = res.examples;
    industryFeatures = res.industryFeatures;
  } catch (err) {
    console.warn('[copy-brain] 성과 문안 검색 실패 — 예시 없이 진행:', (err as Error)?.message);
  }

  const contextLine = renderContextForPrompt({
    temporal: buildTemporalContext(now),
    industryEvents: buildIndustryEvents(industryCode, now),
  });

  const channel = input.channels[0] || 'EMAIL';

  // ★ 2026-07-04 성과 환류: Track B에 업종 시드가 서빙되면 사용 기록(fire-and-forget — 실패해도 생성 무영향)
  const servedSeedIds = examples.filter((e) => e.source === 'industry' && e.seedId).map((e) => e.seedId as string);
  if (!brandVoiceRegistered && servedSeedIds.length > 0) {
    void recordSeedUsage(input.companyId, servedSeedIds, channel).catch(() => {});
  }

  // ★ 2026-07-04 공식 주입: Track B(브랜드보이스 미등록)만 — 등록 회사는 자기 보이스 우선(주입 X)
  let formulaBlock = '';
  if (!brandVoiceRegistered && industryCode) {
    try {
      const f = await getIndustryFormula(industryCode);
      if (f) formulaBlock = renderFormulaBlock(f.meta);
    } catch (err) {
      console.warn('[copy-brain] 업종 공식 조회 실패 — 공식 없이 진행:', (err as Error)?.message);
    }
  }

  const promptSuffix = buildCopyBrainPrompt({ examples, industryFeatures, contextLine, kit, channel, formulaBlock });
  return { promptSuffix, examples, bannedWords: kit.bannedWords || [] };
}
