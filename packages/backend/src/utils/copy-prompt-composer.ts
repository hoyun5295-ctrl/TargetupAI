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
import type { CopyExample } from './copy-rag-retriever';
import { retrieveCopyExamples } from './copy-rag-retriever';
import { buildTemporalContext, buildIndustryEvents, renderContextForPrompt } from './copy-context';
import { getBrandGuideline } from './brand-voice-prompt';

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
}

/** 순수 합성 — 예시·맥락·키트 → 프롬프트 suffix 문자열 (전부 비면 '') */
export function buildCopyBrainPrompt(opts: {
  examples: CopyExample[];
  contextLine: string;
  kit: BrandKit;
  channel: string;
}): string {
  const { examples, contextLine, kit } = opts;
  const parts: string[] = [];

  if (contextLine && contextLine.trim()) {
    parts.push(`## 발송 맥락\n${contextLine.trim()}\n위 맥락이 자연스럽게 어울리면 반영하되, 억지로 끼워넣지 마세요.`);
  }

  const company = examples.filter((e) => e.source === 'company');
  const industry = examples.filter((e) => e.source === 'industry');

  if (company.length > 0) {
    const list = company.map((e, i) => `${i + 1}. ${e.text}`).join('\n');
    parts.push(`## 우리 회사에서 반응이 좋았던 문안 (톤·구조 참고용 — 본문을 그대로 베끼지 말 것)\n${list}`);
  }

  if (industry.length > 0) {
    const list = industry.map((e, i) => `${i + 1}. ${e.text}`).join('\n');
    parts.push(
      `## 같은 업종에서 잘 먹힌 문안의 패턴 (구조·길이·흐름만 참고)\n${list}\n` +
      '⚠️ 위 타사 예시의 고유 표현·문구·슬로건을 그대로 복제하지 마세요. 우리 브랜드 보이스로 완전히 새로 작성하세요.',
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

  let examples: CopyExample[] = [];
  try {
    const res = await retrieveCopyExamples({
      companyId: input.companyId,
      industryCode,
      channels: input.channels,
      isAd: input.isAd,
    });
    examples = res.examples;
  } catch (err) {
    console.warn('[copy-brain] 성과 문안 검색 실패 — 예시 없이 진행:', (err as Error)?.message);
  }

  const contextLine = renderContextForPrompt({
    temporal: buildTemporalContext(now),
    industryEvents: buildIndustryEvents(industryCode, now),
  });

  let kit: BrandKit = {};
  try {
    const g = await getBrandGuideline(input.companyId);
    if (g) {
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

  const channel = input.channels[0] || 'EMAIL';
  const promptSuffix = buildCopyBrainPrompt({ examples, contextLine, kit, channel });
  return { promptSuffix, examples };
}
