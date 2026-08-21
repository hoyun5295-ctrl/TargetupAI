/**
 * ★ CT-37: 회사별 메모리 누적 컨트롤타워 — D181 (2026-05-19)
 *
 * 🎯 목적
 *   비전 v0.4 § 9 영구 원칙 #6 — "회사별 메모리 + 학습 — 시간이 지날수록 정확도↑".
 *   회사별 학습 메모리를 자체 DB(ai_company_memory)에 누적한다.
 *
 * 📊 메모리 타입
 *   - success_pattern: 성공 캠페인 패턴 ("VIP 화·목 알림톡 → 클릭률 18%")
 *   - customer_insight: 고객 인사이트 (등급별 구매·LTV 집계에서 자동)
 *   - brand_tone_evolution: 브랜드 톤 변화 (Brand Voice 가이드라인 변경 추적)
 *   - channel_performance: 채널 성과 ("LMS > SMS 클릭률 5%p+")
 *   - compliance_learning: 컴플라이언스 학습 (광고 차단·반려 단어 → 안전 대체)
 *
 * 🔐 사용 흐름
 *   1. AI 호출 시 buildMemoryPromptContext로 system prompt에 포함
 *   2. 캠페인 발송 완료 후 recordCampaignLearning으로 자동 누적
 *   3. 회사 admin이 UI에서 직접 입력·검토·삭제
 *   4. Prompt Caching과 결합 (1h TTL ephemeral, 비용 절감)
 *
 * ⛔ 영구 원칙
 *   - 회사 격리 — 전 쿼리 company_id 필터
 *   - 회사 admin이 메모리를 직접 검토·삭제 가능
 *   - 모델 분리 — AI Operator 주입 전용 (기존 한줄로AI 흐름 영향 0)
 */

import { query } from '../config/database';
import {
  composeCampaignLearningText, shouldRecordCampaignLearning,
  composeDmEngagementText, shouldRecordDmEngagement,
  composeEmailEngagementText, shouldRecordEmailEngagement,
} from './ai-memory-text';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export type MemoryType =
  | 'success_pattern'
  | 'customer_insight'
  | 'brand_tone_evolution'
  | 'channel_performance'
  | 'compliance_learning'
  // ★ D225+ (2026-05-28 Harold 명시): Brand Voice Learning — 회사별 LMS 대표 문안 5건 학습
  | 'representative_message'   // 회사 admin 수동 등록 (5건 — 5 row)
  | 'brand_guideline';         // 자동 추출 가이드라인 9 항목 (1건 — 1 row, JSON)

/**
 * ★ 2026-07-12 학습 5종 단일 정의 — 주입(buildMemoryPromptContext)·화면 집계(overview/top-impact/분석)·
 * 관련 학습 표시가 전부 이 화이트리스트를 공유한다.
 * 같은 테이블의 비학습 타입(brand_guideline 10·representative_message 8·brand_link 7)이 높은 중요도로
 * 슬롯을 잠식해 문안 생성(6슬롯)의 학습 주입이 0이 되던 결함의 단일 정답.
 * (Brand Voice 2종 = buildSystemPromptWithBrandVoice 별도 주입 / brand_link = 링크 칩·{{LINK}} 치환 별도 소비)
 */
export const LEARNING_MEMORY_TYPES: MemoryType[] = [
  'success_pattern', 'customer_insight', 'brand_tone_evolution', 'channel_performance', 'compliance_learning',
];

export interface MemoryEntry {
  id: string;
  companyId: string;
  memoryType: MemoryType;
  memoryKey: string;
  memoryValue: string;
  importance: number;
  source: string;
  metadata: Record<string, unknown>;
  lastAccessedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  // ★ D210+ Phase 3 B-7 (2026-05-23 Harold 명시): 사용 횟수 영역 (영향도 시각화)
  usageCount: number;
}

export interface AddMemoryInput {
  companyId: string;
  memoryType: MemoryType;
  memoryKey: string;
  memoryValue: string;
  importance?: number;
  source?: string;
  metadata?: Record<string, unknown>;
}

// ════════════════════════════════════════════════════════════════════
// CRUD
// ════════════════════════════════════════════════════════════════════

export async function addMemory(input: AddMemoryInput): Promise<MemoryEntry> {
  const importance = Math.max(1, Math.min(10, input.importance ?? 5));
  const result = await query(
    `INSERT INTO ai_company_memory (
      id, company_id, memory_type, memory_key, memory_value,
      importance, source, metadata, last_accessed_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, $2, $3, $4,
      $5, $6, $7::jsonb, NOW(), NOW(), NOW()
    )
    ON CONFLICT (company_id, memory_type, memory_key) DO UPDATE SET
      memory_value = EXCLUDED.memory_value,
      importance = GREATEST(ai_company_memory.importance, EXCLUDED.importance),
      metadata = ai_company_memory.metadata || EXCLUDED.metadata,
      updated_at = NOW(),
      last_accessed_at = NOW()
    RETURNING *`,
    [
      input.companyId,
      input.memoryType,
      input.memoryKey.slice(0, 200),
      input.memoryValue,
      importance,
      input.source || 'ai_auto',
      JSON.stringify(input.metadata || {}),
    ]
  );
  return mapRow(result.rows[0]);
}

export async function listMemories(
  companyId: string,
  options: { memoryType?: MemoryType; memoryTypes?: MemoryType[]; limit?: number; minImportance?: number } = {}
): Promise<MemoryEntry[]> {
  // ★ Codex 1R — 빈 화이트리스트 = "허용 타입 없음" = 0건 (무필터 전 타입 조회로 되돌아가는 폴백 차단)
  if (Array.isArray(options.memoryTypes) && options.memoryTypes.length === 0) return [];
  const limit = Math.min(options.limit || 100, 500);
  const minImportance = options.minImportance || 1;
  const where: string[] = ['company_id = $1::uuid', 'importance >= $2'];
  const params: any[] = [companyId, minImportance];
  if (options.memoryType) {
    where.push(`memory_type = $${params.length + 1}`);
    params.push(options.memoryType);
  } else if (Array.isArray(options.memoryTypes) && options.memoryTypes.length > 0) {
    // ★ 2026-07-12 — 타입 화이트리스트 (학습 5종 한정 조회 등)
    where.push(`memory_type = ANY($${params.length + 1}::text[])`);
    params.push(options.memoryTypes);
  }
  params.push(limit);
  const result = await query(
    `SELECT * FROM ai_company_memory
     WHERE ${where.join(' AND ')}
     ORDER BY importance DESC, last_accessed_at DESC
     LIMIT $${params.length}`,
    params
  );
  return result.rows.map(mapRow);
}

export async function deleteMemory(companyId: string, memoryId: string): Promise<boolean> {
  const result = await query(
    `DELETE FROM ai_company_memory WHERE id = $1::uuid AND company_id = $2::uuid RETURNING id`,
    [memoryId, companyId]
  );
  return result.rows.length > 0;
}

// ════════════════════════════════════════════════════════════════════
// AI 호출 — system prompt 주입
// ════════════════════════════════════════════════════════════════════

/**
 * AI 호출 시점에 system prompt에 회사 메모리를 주입한다.
 * - 중요도 + 최근 접근 순으로 상위 N건 선택
 * - 선택분의 last_accessed_at + usage_count 갱신
 * - Prompt Caching과 결합 (1h TTL ephemeral)
 */
export async function buildMemoryPromptContext(companyId: string, maxEntries: number = 30): Promise<string> {
  // ★ 2026-07-12 — 학습 5종만 조회. 타입 무필터 조회는 brand_guideline(10)·대표문안(8)·brand_link(7)가
  //   중요도 상위 슬롯을 잠식해, 문안 생성(6슬롯)에서 실제 학습 주입이 0이 되던 결함(렌더는 원래 5종만).
  //   usage_count 갱신도 이제 실제 렌더 대상 행에만 닿는다(top-impact "AI 참고 횟수" 거짓 집계 종식).
  const memories = await listMemories(companyId, { limit: maxEntries, minImportance: 3, memoryTypes: LEARNING_MEMORY_TYPES });
  if (memories.length === 0) {
    return '';
  }

  // last_accessed_at + usage_count 영역 갱신 (best-effort)
  // usage_count 자동 증가 — 영향도 시각화 근거
  const memoryIds = memories.map((m) => m.id);
  query(
    `UPDATE ai_company_memory
     SET last_accessed_at = NOW(),
         usage_count = COALESCE(usage_count, 0) + 1
     WHERE id = ANY($1::uuid[])`,
    [memoryIds]
  ).catch(() => {});

  // 타입별 그룹화
  const byType = new Map<MemoryType, MemoryEntry[]>();
  for (const m of memories) {
    const arr = byType.get(m.memoryType) || [];
    arr.push(m);
    byType.set(m.memoryType, arr);
  }

  const typeLabels: Record<MemoryType, string> = {
    success_pattern: '성공 패턴',
    customer_insight: '고객 인사이트',
    brand_tone_evolution: '브랜드 톤 진화',
    channel_performance: '채널 성과',
    compliance_learning: '컴플라이언스 학습',
    // ★ D225+ Brand Voice Learning — AI Operator 호출 영역 분리 (별도 buildSystemPromptWithBrandVoice 헬퍼 활용)
    representative_message: '대표 문안',
    brand_guideline: 'Brand Voice 가이드라인',
  };

  // AI Operator 호출 = 5 학습 타입 한정 (Brand Voice 2 타입은 buildSystemPromptWithBrandVoice로 별도 주입)
  const sections: string[] = [];
  for (const type of LEARNING_MEMORY_TYPES) {
    const arr = byType.get(type) || [];
    if (arr.length === 0) continue;
    const lines = arr.map((m, i) => `${i + 1}. [중요도 ${m.importance}] ${m.memoryKey}: ${m.memoryValue}`);
    sections.push(`### ${typeLabels[type]} (${arr.length}건)\n${lines.join('\n')}`);
  }

  if (sections.length === 0) return '';

  return `## Company Memory (회사별 누적 학습, 시간 지날수록 정확도↑)

${sections.join('\n\n')}

위 메모리는 본 회사의 누적 학습 결과입니다. 여기 담긴 패턴을 우선 적용하고, 모순되는 부분은 제외하고 분석해주세요.
`;
}

// ════════════════════════════════════════════════════════════════════
// 캠페인 결과로 자동 메모리 누적
// ════════════════════════════════════════════════════════════════════

export interface CampaignLearningInput {
  companyId: string;
  campaignId: string;
  campaignName: string;
  channel: string;
  targetCriteria?: string;
  messageBody: string;
  sentCount: number;
  clickCount: number;
  conversionCount: number;
  hasConversionData: boolean;
  isAd: boolean;
}

/**
 * 캠페인 결과로 회사 메모리를 자동 누적한다.
 * - 클릭 실측 표본이 있을 때만 기록(가짜 0% 차단 — shouldRecordCampaignLearning).
 * - 클릭률 10%+ → success_pattern.
 * - 채널 성과는 매 캠페인 1건당 1회 누적.
 * - 전환 데이터가 없으면 문구에 전환율을 넣지 않는다(composeCampaignLearningText).
 */
export async function recordCampaignLearning(input: CampaignLearningInput): Promise<void> {
  // 클릭 실측 표본이 있어야만 학습한다(표본 부족·클릭 0 = 보류, 가짜 0% 차단).
  if (!shouldRecordCampaignLearning({ sentCount: input.sentCount, clickCount: input.clickCount })) return;
  const clickRate = input.clickCount / input.sentCount;
  const conversionRate = input.hasConversionData && input.sentCount > 0
    ? input.conversionCount / input.sentCount
    : 0;

  // 성공 패턴 (클릭률 10%+)
  if (clickRate >= 0.1) {
    await addMemory({
      companyId: input.companyId,
      memoryType: 'success_pattern',
      memoryKey: `${input.channel}/${input.campaignName}`,
      memoryValue: composeCampaignLearningText({
        kind: 'success_pattern',
        channel: input.channel,
        campaignName: input.campaignName,
        sentCount: input.sentCount,
        clickRate,
        hasConversionData: input.hasConversionData,
        conversionRate,
      }),
      importance: Math.min(10, Math.floor(clickRate * 50)),
      source: 'campaign_result',
      metadata: {
        campaign_id: input.campaignId,
        click_rate: clickRate,
        ...(input.hasConversionData ? { conversion_rate: conversionRate } : {}),
        sent_count: input.sentCount,
        is_ad: input.isAd,
      },
    });
  }

  // 채널 성과 누적 — metadata.last_campaign_id로 캠페인 1건당 1회만 학습되게 중복 차단(sweeper NOT EXISTS 매칭).
  const channelKey = `channel_${input.channel}`;
  await addMemory({
    companyId: input.companyId,
    memoryType: 'channel_performance',
    memoryKey: channelKey,
    memoryValue: composeCampaignLearningText({
      kind: 'channel_performance',
      channel: input.channel,
      sentCount: input.sentCount,
      clickRate,
      hasConversionData: input.hasConversionData,
      conversionRate,
    }),
    importance: 6,
    source: 'campaign_result',
    metadata: {
      last_campaign_id: input.campaignId,
      last_click_rate: clickRate,
      ...(input.hasConversionData ? { last_conversion_rate: conversionRate } : {}),
    },
  });
}

// ════════════════════════════════════════════════════════════════════
// ★ 2026-07-02(5) DM·이메일 참여 자동 학습 (Harold 지시 — 추적 데이터 → 회사 AI 메모리)
//   원칙: 실측만 서술(임의 상수 0) / 표본·실측 게이트(가짜 0% 차단) / 회사 격리 /
//   success_pattern·클릭률 축은 기존 recordCampaignLearning CT 재사용(게이트·문구·중요도 동일).
// ════════════════════════════════════════════════════════════════════

export interface DmEngagementLearningInput {
  companyId: string;
  dmId: string;
  dmTitle: string;
  sentCount: number;
  viewedCount: number;
  completedCount: number;
  clickedCount: number;      // 클릭 1회 이상 수신자 수
  respondedCount: number;    // 응모/투표/쿠폰 등 액션 수신자 수
  topSectionLabel?: string;  // 최다 클릭 섹션 (실측 있을 때만)
}

export async function recordDmEngagementLearning(input: DmEngagementLearningInput): Promise<boolean> {
  if (!shouldRecordDmEngagement({ sentCount: input.sentCount, viewedCount: input.viewedCount })) return false;

  // 클릭률 기반 success_pattern은 기존 캠페인 학습 흐름 그대로 (클릭 실측 없으면 내부 게이트가 보류)
  await recordCampaignLearning({
    companyId: input.companyId,
    campaignId: input.dmId,
    campaignName: input.dmTitle,
    channel: 'dm',
    messageBody: '',
    sentCount: input.sentCount,
    clickCount: input.clickedCount,
    conversionCount: 0,
    hasConversionData: false,
    isAd: false,
  });

  // 채널 성과는 열람·완독·액션·최다 반응 섹션까지 담은 실측 서술로 최종 기록
  // (같은 key UPSERT — 위 호출이 남긴 클릭률 단문을 풍부한 서술로 덮는다)
  await addMemory({
    companyId: input.companyId,
    memoryType: 'channel_performance',
    memoryKey: 'channel_dm',
    memoryValue: composeDmEngagementText(input),
    importance: 6,
    source: 'dm_engagement',
    metadata: {
      last_dm_id: input.dmId,
      sent: input.sentCount,
      viewed: input.viewedCount,
      completed: input.completedCount,
      clicked: input.clickedCount,
      responded: input.respondedCount,
    },
  });
  return true;
}

export interface EmailEngagementLearningInput {
  companyId: string;
  campaignId: string;
  name: string;
  sentCount: number;
  openCount: number;
  clickCount: number;
}

export async function recordEmailEngagementLearning(input: EmailEngagementLearningInput): Promise<boolean> {
  if (!shouldRecordEmailEngagement({ sentCount: input.sentCount, openCount: input.openCount })) return false;

  await recordCampaignLearning({
    companyId: input.companyId,
    campaignId: input.campaignId,
    campaignName: input.name,
    channel: 'email',
    messageBody: '',
    sentCount: input.sentCount,
    clickCount: input.clickCount,
    conversionCount: 0,
    hasConversionData: false,
    isAd: false,
  });

  await addMemory({
    companyId: input.companyId,
    memoryType: 'channel_performance',
    memoryKey: 'channel_email',
    memoryValue: composeEmailEngagementText(input),
    importance: 6,
    source: 'email_engagement',
    metadata: {
      last_campaign_id: input.campaignId,
      sent: input.sentCount,
      open: input.openCount,
      click: input.clickCount,
    },
  });
  return true;
}

// ════════════════════════════════════════════════════════════════════
// 헬퍼
// ════════════════════════════════════════════════════════════════════

function mapRow(row: any): MemoryEntry {
  return {
    id: row.id,
    companyId: row.company_id,
    memoryType: row.memory_type,
    memoryKey: row.memory_key,
    memoryValue: row.memory_value,
    importance: row.importance || 5,
    source: row.source || 'ai_auto',
    metadata: row.metadata || {},
    lastAccessedAt: new Date(row.last_accessed_at),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    // ★ D210+ Phase 3 B-7 (2026-05-23 Harold 명시): usage_count 영역 매핑
    usageCount: Number(row.usage_count) || 0,
  };
}

// ════════════════════════════════════════════════════════════════════
// 오래된 저영향 메모리 정리 (cleanup)
//   importance < minImportance + olderThanDays 미사용 행 DELETE.
//   accumulator 워커(1일 1회)와 회사 admin 수동 호출 모두 사용.
// ════════════════════════════════════════════════════════════════════

export async function cleanupDeprecatedMemories(
  companyId: string,
  options: { olderThanDays?: number; minImportance?: number } = {},
): Promise<{ deletedCount: number }> {
  const olderThanDays = Math.max(7, Math.min(365, options.olderThanDays || 90));
  const minImportance = Math.max(1, Math.min(10, options.minImportance || 3));

  const r = await query(
    `DELETE FROM ai_company_memory
     WHERE company_id = $1::uuid
       AND importance < $2
       AND last_accessed_at < NOW() - ($3 * INTERVAL '1 day')
     RETURNING id`,
    [companyId, minImportance, olderThanDays]
  );
  return { deletedCount: r.rows.length };
}
