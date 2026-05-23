/**
 * ★ CT-37: 회사별 메모리 누적 컨트롤타워 — D181 (2026-05-19)
 *
 * 🎯 목적
 *   비전 v0.4 § 9 영구 원칙 #6 — "회사별 메모리 + 학습 — 시간 지날수록 정확도↑".
 *   D162-5 AI 4 결합 #4 박은 영역 — 회사별 메모리 누적 (Anthropic Memory tool 패턴 박음 + 자체 DB 박음).
 *
 * 📊 메모리 타입 매트릭스
 *   - success_pattern: 성공 캠페인 패턴 ("VIP 화·목 알림톡 → 클릭률 18%")
 *   - customer_insight: 고객 인사이트 ("3개월 휴면 고객은 무료 혜택 메시지에 강한 반응")
 *   - brand_tone_evolution: 브랜드 톤 진화 ("이모지 박지 X 톤 정합")
 *   - channel_performance: 채널 성과 ("LMS > SMS 클릭률 5%p+")
 *   - compliance_learning: 컴플라이언스 학습 ("'특가' 단어 광고 차단 6건 박음 — '한정 혜택'으로 정정")
 *
 * 🔐 사용 흐름
 *   1. ai-orchestrator buildCompanyMemoryContext 박은 영역에서 buildMemoryPromptContext 박음 (system prompt 박음)
 *   2. 캠페인 발송 완료 박은 후 recordCampaignLearning 박음 (자동 메모리 박음)
 *   3. 회사 admin이 직접 박음 (UI 박은 영역 박음 — 메모리 박음/검토/삭제)
 *   4. Prompt Caching 박은 영역에 박음 (1h TTL ephemeral, 90% 비용 절감)
 *
 * ⛔ 영구 원칙 정합
 *   - 회사 격리 — 회사별 메모리 박음, 다른 회사 박지 X
 *   - 사용자 신뢰 #4 — 회사 admin이 메모리 박은 영역 검토 + 삭제 박을 수 있음
 *   - 모델 분리 #3 — AI Operator 영역만 박음 (Sonnet 4.6 흐름 영향 0건)
 */

import { query } from '../config/database';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export type MemoryType =
  | 'success_pattern'
  | 'customer_insight'
  | 'brand_tone_evolution'
  | 'channel_performance'
  | 'compliance_learning';

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
  options: { memoryType?: MemoryType; limit?: number; minImportance?: number } = {}
): Promise<MemoryEntry[]> {
  const limit = Math.min(options.limit || 100, 500);
  const minImportance = options.minImportance || 1;
  const where: string[] = ['company_id = $1::uuid', 'importance >= $2'];
  const params: any[] = [companyId, minImportance];
  if (options.memoryType) {
    where.push(`memory_type = $${params.length + 1}`);
    params.push(options.memoryType);
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
// AI 호출 박을 영역 — system prompt 박음
// ════════════════════════════════════════════════════════════════════

/**
 * AI 호출 시점에 system prompt 박는 영역 박음.
 * - 중요도 + 최근 접근 순 박음 (top N)
 * - 박은 영역 박은 후 last_accessed_at 갱신 박음
 * - Prompt Caching 박은 영역과 결합 박음 (1h TTL ephemeral)
 */
export async function buildMemoryPromptContext(companyId: string, maxEntries: number = 30): Promise<string> {
  const memories = await listMemories(companyId, { limit: maxEntries, minImportance: 3 });
  if (memories.length === 0) {
    return '';
  }

  // last_accessed_at + usage_count 영역 갱신 (best-effort)
  // ★ D210+ Phase 3 B-7 (2026-05-23 Harold 명시): usage_count 자동 증가 — 영향도 시각화 매트릭스 정합
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
  };

  const sections: string[] = [];
  for (const type of Object.keys(typeLabels) as MemoryType[]) {
    const arr = byType.get(type) || [];
    if (arr.length === 0) continue;
    const lines = arr.map((m, i) => `${i + 1}. [중요도 ${m.importance}] ${m.memoryKey} — ${m.memoryValue}`);
    sections.push(`### ${typeLabels[type]} (${arr.length}건)\n${lines.join('\n')}`);
  }

  if (sections.length === 0) return '';

  return `## Company Memory (회사별 누적 학습 — 시간 지날수록 정확도↑)

${sections.join('\n\n')}

위 메모리는 본 회사의 운영 누적 학습 결과입니다. 본 메모리에 정합된 패턴을 우선 적용 + 모순 영역은 제외하고 분석해주세요.
`;
}

// ════════════════════════════════════════════════════════════════════
// 캠페인 결과 박은 후 자동 메모리 박음
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
  isAd: boolean;
}

/**
 * 캠페인 결과 박은 후 성과 박은 영역 박은 메모리 박음.
 * - 클릭률 10%+ → success_pattern 박음
 * - 클릭률 2% 미만 → 메모리 박지 X (저성과는 박지 X — 노이즈 박음 차단)
 * - 채널/시점/타겟 박은 영역 박음
 */
export async function recordCampaignLearning(input: CampaignLearningInput): Promise<void> {
  if (input.sentCount < 10) return; // 표본 부족 — 박지 X
  const clickRate = input.clickCount / input.sentCount;
  const conversionRate = input.sentCount > 0 ? input.conversionCount / input.sentCount : 0;

  // 성공 패턴 박음 (클릭률 10%+)
  if (clickRate >= 0.1) {
    await addMemory({
      companyId: input.companyId,
      memoryType: 'success_pattern',
      memoryKey: `${input.channel}/${input.campaignName}`,
      memoryValue: `${input.channel} 채널 + "${input.campaignName}" 캠페인 발송 결과 → 클릭률 ${(clickRate * 100).toFixed(1)}% / 전환율 ${(conversionRate * 100).toFixed(2)}% (${input.sentCount}명 발송)`,
      importance: Math.min(10, Math.floor(clickRate * 50)),
      source: 'campaign_result',
      metadata: {
        campaign_id: input.campaignId,
        click_rate: clickRate,
        conversion_rate: conversionRate,
        sent_count: input.sentCount,
        is_ad: input.isAd,
      },
    });
  }

  // 채널 성과 박음 (집계 메모리 박음)
  const channelKey = `channel_${input.channel}`;
  await addMemory({
    companyId: input.companyId,
    memoryType: 'channel_performance',
    memoryKey: channelKey,
    memoryValue: `${input.channel} 채널 최근 캠페인 성과 — 클릭률 ${(clickRate * 100).toFixed(1)}% / 전환율 ${(conversionRate * 100).toFixed(2)}%`,
    importance: 6,
    source: 'campaign_result',
    metadata: {
      last_click_rate: clickRate,
      last_conversion_rate: conversionRate,
    },
  });
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
// ★ D210+ Phase 3 B-7 (2026-05-23 Harold 명시): 자동 갱신 영역 — deprecate
//   importance < minImportance + olderThanDays 영역 안 미사용 영역 DELETE
//   본질: 오래된 + 저영향도 메모리 자동 정리 (회사 admin 명시 호출 의무 — cron worker X)
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
