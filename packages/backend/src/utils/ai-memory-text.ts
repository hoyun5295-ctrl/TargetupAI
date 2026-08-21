/**
 * ai-memory-text — 캠페인 학습 메모리 문구 생성 + 기록 게이트 (순수 함수, DB import 0)
 *
 * Phase A 정직성 수정(2026-06-13):
 *   - 전환 데이터가 없으면 memory_value에서 "전환율" 절을 빼서 가짜 "전환율 0.00%" 노출을 막는다.
 *   - 클릭 실측이 0이면(CDP 미연동 또는 진짜 0) 학습 기록을 보류해 가짜 "클릭률 0.0%" 채널 성과 누적을 막는다.
 *   - company-memory recordCampaignLearning이 import해 사용. 순수 검증 = __tests__/ai-memory-text.verify.ts.
 */

export interface CampaignLearningTextInput {
  kind: 'success_pattern' | 'channel_performance';
  channel: string;
  campaignName?: string;
  sentCount: number;
  clickRate: number;        // 0..1
  hasConversionData: boolean;
  conversionRate: number;   // 0..1 — hasConversionData=true일 때만 의미
}

/** memory_value 문구 생성 — 전환 데이터가 없으면 전환율 절을 생략한다. */
export function composeCampaignLearningText(input: CampaignLearningTextInput): string {
  const clickPct = (input.clickRate * 100).toFixed(1);
  const conversionClause = input.hasConversionData
    ? ` / 전환율 ${(input.conversionRate * 100).toFixed(2)}%`
    : '';
  if (input.kind === 'success_pattern') {
    const name = input.campaignName || '캠페인';
    return `${input.channel} 채널 + "${name}" 캠페인 발송 결과 → 클릭률 ${clickPct}%${conversionClause} (${input.sentCount}명 발송)`;
  }
  return `${input.channel} 채널 최근 캠페인 성과: 클릭률 ${clickPct}%${conversionClause}`;
}

/**
 * 학습 기록 게이트 — 클릭 실측 표본이 있어야만 기록한다.
 * sentCount<10 = 표본 부족 / clickCount<=0 = 클릭 데이터 없음(가짜 0% 방지).
 */
export function shouldRecordCampaignLearning(input: { sentCount: number; clickCount: number }): boolean {
  if (input.sentCount < 10) return false;
  if (input.clickCount <= 0) return false;
  return true;
}

// ════════════════════════════════════════════════════════════════════
// ★ 2026-07-02(5) DM·이메일 참여 학습 문구 (실측 서술만 — 임의 상수·추정 0)
// ════════════════════════════════════════════════════════════════════

export interface DmEngagementTextInput {
  dmTitle: string;
  sentCount: number;
  viewedCount: number;
  completedCount: number;
  clickedCount: number;      // 클릭 1회 이상 수신자 수
  respondedCount: number;    // 응모/투표/쿠폰 등 액션 수신자 수
  topSectionLabel?: string;  // 최다 클릭 섹션 (실측 있을 때만)
}

/** DM 참여 실측 서술 — 발송·열람·완독·클릭·액션 사실만. */
export function composeDmEngagementText(input: DmEngagementTextInput): string {
  const pct = (n: number) => input.sentCount > 0 ? `${((n / input.sentCount) * 100).toFixed(0)}%` : '0%';
  const parts = [
    `발송 ${input.sentCount}명`,
    `열람 ${input.viewedCount}명(${pct(input.viewedCount)})`,
    `완독 ${input.completedCount}명`,
    `클릭 ${input.clickedCount}명`,
  ];
  if (input.respondedCount > 0) parts.push(`응모·액션 ${input.respondedCount}명`);
  const top = input.topSectionLabel ? ` / 최다 반응 섹션: ${input.topSectionLabel}` : '';
  return `모바일DM "${input.dmTitle}" 결과: ${parts.join('·')}${top} (실측)`;
}

/**
 * DM 참여 학습 게이트 — 열람 실측 표본이 있어야만 기록(가짜 0% 차단, 기존 캠페인 게이트와 동일 원칙).
 */
export function shouldRecordDmEngagement(input: { sentCount: number; viewedCount: number }): boolean {
  if (input.sentCount < 10) return false;
  if (input.viewedCount <= 0) return false;
  return true;
}

export interface EmailEngagementTextInput {
  name: string;
  sentCount: number;
  openCount: number;
  clickCount: number;
}

/** 이메일 성과 실측 서술 — 오픈·클릭 사실만(클릭 0이면 절 생략, 가짜 0% 문구 차단). */
export function composeEmailEngagementText(input: EmailEngagementTextInput): string {
  const openPct = input.sentCount > 0 ? ((input.openCount / input.sentCount) * 100).toFixed(1) : '0.0';
  const clickClause = input.clickCount > 0 && input.sentCount > 0
    ? ` / 클릭률 ${((input.clickCount / input.sentCount) * 100).toFixed(1)}%`
    : '';
  return `이메일 "${input.name}": ${input.sentCount}명 발송·오픈율 ${openPct}%${clickClause} (실측)`;
}

/** 이메일 학습 게이트 — 오픈 실측 표본이 있어야만 기록. */
export function shouldRecordEmailEngagement(input: { sentCount: number; openCount: number }): boolean {
  if (input.sentCount < 10) return false;
  if (input.openCount <= 0) return false;
  return true;
}

// ════════════════════════════════════════════════════════════════════
// Brand Voice 가이드라인 변화 감지 (brand_tone_evolution writer 순수 코어)
// ════════════════════════════════════════════════════════════════════

export interface GuidelineSnapshot {
  tone_signature: string;
  avg_length_chars: number;
  cta_patterns: string[];
  emoji_whitelist: string[];
  greeting_pattern: string;
  ad_prefix_position: string;
  reject_position: string;
}

export interface ToneChange {
  summary: string;
  changedFields: string[];
}

function sameSet(a: string[], b: string[]): boolean {
  const sa = [...new Set(a)].sort();
  const sb = [...new Set(b)].sort();
  return sa.length === sb.length && sa.every((v, i) => v === sb[i]);
}

/**
 * Brand Voice 가이드라인 변화 감지 — 첫 등록(prev 없음)·무변화는 null.
 * 트리거: tone_signature / 인사말 / 광고·수신거부 위치 / CTA 집합 / 이모지 집합 변화.
 * 평균 길이는 단독 트리거가 아니라 요약 맥락으로만 포함(임의 임계 회피).
 */
export function diffGuideline(prev: GuidelineSnapshot | null, next: GuidelineSnapshot): ToneChange | null {
  if (!prev) return null;
  const changedFields: string[] = [];
  const parts: string[] = [];

  if (prev.tone_signature !== next.tone_signature) {
    changedFields.push('tone_signature');
    parts.push(`톤이 '${prev.tone_signature}' → '${next.tone_signature}'`);
  }
  if (prev.greeting_pattern !== next.greeting_pattern) {
    changedFields.push('greeting_pattern');
    parts.push('인사말 패턴 변화');
  }
  if (prev.ad_prefix_position !== next.ad_prefix_position) {
    changedFields.push('ad_prefix_position');
    parts.push(`광고 표기 위치 ${prev.ad_prefix_position}→${next.ad_prefix_position}`);
  }
  if (prev.reject_position !== next.reject_position) {
    changedFields.push('reject_position');
    parts.push(`수신거부 위치 ${prev.reject_position}→${next.reject_position}`);
  }
  if (!sameSet(prev.cta_patterns || [], next.cta_patterns || [])) {
    changedFields.push('cta_patterns');
    parts.push('CTA 패턴 변화');
  }
  if (!sameSet(prev.emoji_whitelist || [], next.emoji_whitelist || [])) {
    changedFields.push('emoji_whitelist');
    parts.push('이모지 사용 변화');
  }

  if (changedFields.length === 0) return null;

  if (prev.avg_length_chars !== next.avg_length_chars) {
    parts.push(`평균 길이 ${prev.avg_length_chars}→${next.avg_length_chars}자`);
  }

  return { summary: `브랜드 톤 변화: ${parts.join(', ')}`, changedFields };
}

// ════════════════════════════════════════════════════════════════════
// 메모리 수명관리 — 타입별 상한 초과분 삭제 후보 선정 (순수 코어)
// ════════════════════════════════════════════════════════════════════

export interface PrunableMemory {
  id: string;
  memoryType: string;
  importance: number;
  usageCount: number;
  lastAccessedAt: number; // epoch ms
}

/**
 * 타입별 상한을 넘긴 만큼만 삭제 후보 id를 고른다 — 저신호 우선
 * (낮은 importance → 오래된 last_accessed → 낮은 usage_count). 상한 없는 타입은 보존.
 */
export function pickMemoriesToPrune(
  memories: PrunableMemory[],
  caps: Record<string, number>,
): string[] {
  const byType = new Map<string, PrunableMemory[]>();
  for (const m of memories) {
    const arr = byType.get(m.memoryType) || [];
    arr.push(m);
    byType.set(m.memoryType, arr);
  }
  const toDelete: string[] = [];
  for (const [type, arr] of byType) {
    const cap = caps[type];
    if (cap == null || arr.length <= cap) continue;
    const sorted = [...arr].sort((a, b) =>
      a.importance - b.importance
      || a.lastAccessedAt - b.lastAccessedAt
      || a.usageCount - b.usageCount);
    const excess = arr.length - cap;
    for (let i = 0; i < excess; i++) toDelete.push(sorted[i].id);
  }
  return toDelete;
}
