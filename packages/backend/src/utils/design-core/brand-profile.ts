/**
 * ★ CT design-core/brand-profile.ts — 브랜드 정의 단일 조회 (디자인 4.0, 2026-07-14 Harold 지시)
 *
 * "브랜드를 한 번 학습시키면 세 채널이 전부 거기서 뽑아 쓴다"의 조회 축.
 * 새 저장소를 만들지 않는다 — 검증된 두 저장소를 한 번에 묶어 돌려줄 뿐 (이중 진실 차단, DDL 0):
 *   - companies.brand_kit JSONB (dm-brand-kit CT — 로고·색·서체·톤·고객센터·SNS·아트디렉션)
 *   - Brand Voice (brand-voice-prompt CT-99 — 톤 가이드라인·대표 문안·브랜드 링크, 5분 TTL 캐시)
 *
 * 소비처: 3채널 생성기(문안·디자인 추천)·브랜드 학습 UI. 쓰기는 기존 CT(updateCompanyBrandKit ·
 * Brand Voice API)를 그대로 사용 — 이 파일은 읽기 전용 집계만 담당한다.
 */
import { getCompanyBrandKit, getCompanyBrandKitRaw } from '../dm/dm-brand-kit';
import type { DmBrandKit } from '../dm/dm-tokens';
import { getBrandGuideline, type BrandGuideline } from '../brand-voice-prompt';

export interface BrandProfile {
  /** 기본값 병합된 브랜드 킷 (렌더·디자인 소비용) */
  kit: DmBrandKit;
  /** 회사가 실제 저장한 원본 (설정 여부 판정용 — 미설정 = null) */
  kitRaw: Partial<DmBrandKit> | null;
  /** 고객센터 — kit.contact 승격 (전화/이메일/웹) */
  contact: { phone?: string; email?: string; website?: string };
  /** 회사가 브랜드 색을 명시 설정했는가 */
  hasBrandColors: boolean;
  /** Brand Voice 톤 요약 (미학습 = null) — 프롬프트 주입은 buildSystemPromptWithBrandVoice가 담당 */
  voice: {
    toneSignature: string;
    customerAddress?: string;
    endingStyle?: string;
    hasGuideline: true;
  } | null;
}

export async function resolveBrandProfile(companyId: string): Promise<BrandProfile> {
  const [kit, kitRaw, guideline] = await Promise.all([
    getCompanyBrandKit(companyId),
    getCompanyBrandKitRaw(companyId),
    getBrandGuideline(companyId).catch(() => null as BrandGuideline | null),
  ]);
  return {
    kit,
    kitRaw,
    contact: {
      ...(kit.contact?.phone ? { phone: kit.contact.phone } : {}),
      ...(kit.contact?.email ? { email: kit.contact.email } : {}),
      ...(kit.contact?.website ? { website: kit.contact.website } : {}),
    },
    hasBrandColors: !!(kitRaw?.primary_color || kitRaw?.accent_color),
    voice: guideline
      ? {
          toneSignature: guideline.tone_signature,
          ...(guideline.customer_address ? { customerAddress: guideline.customer_address } : {}),
          ...(guideline.sentence_ending_style ? { endingStyle: guideline.sentence_ending_style } : {}),
          hasGuideline: true,
        }
      : null,
  };
}
