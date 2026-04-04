/**
 * ★ CT: 저장 세그먼트 (Saved Segments) 컨트롤타워
 *
 * 사용자가 AI 한줄로/맞춤한줄 발송 설정을 저장하고 재활용하는 기능.
 * company_id + user_id 기반 멀티테넌트 격리.
 * 사용자당 최대 20개 제한.
 */
import { query } from '../config/database';

const MAX_SEGMENTS_PER_USER = 20;

export interface SaveSegmentData {
  name: string;
  emoji?: string;
  segmentType: 'hanjullo' | 'custom';
  // AI 한줄로용
  prompt?: string;
  autoRelax?: boolean;
  // AI 맞춤한줄용
  selectedFields?: string[];
  briefing?: string;
  url?: string;
  channel?: string;
  isAd?: boolean;
}

export interface SavedSegment {
  id: string;
  company_id: string;
  user_id: string;
  name: string;
  emoji: string;
  segment_type: 'hanjullo' | 'custom';
  prompt: string | null;
  auto_relax: boolean;
  selected_fields: string[] | null;
  briefing: string | null;
  url: string | null;
  channel: string | null;
  is_ad: boolean;
  last_used_at: string | null;
  created_at: string;
}

/**
 * 세그먼트 저장 (INSERT + 20개 제한)
 */
export async function saveSegment(
  companyId: string,
  userId: string,
  data: SaveSegmentData
): Promise<SavedSegment> {
  // 개수 제한 체크
  const countResult = await query(
    'SELECT COUNT(*)::int as cnt FROM saved_segments WHERE company_id = $1 AND user_id = $2',
    [companyId, userId]
  );
  if (countResult.rows[0].cnt >= MAX_SEGMENTS_PER_USER) {
    throw new Error(`저장 세그먼트는 최대 ${MAX_SEGMENTS_PER_USER}개까지 가능합니다.`);
  }

  const result = await query(
    `INSERT INTO saved_segments (
      id, company_id, user_id, name, emoji, segment_type,
      prompt, auto_relax, selected_fields, briefing, url, channel, is_ad,
      created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1, $2, $3, $4, $5,
      $6, $7, $8, $9, $10, $11, $12,
      NOW(), NOW()
    ) RETURNING *`,
    [
      companyId,
      userId,
      data.name,
      data.emoji || '📋',
      data.segmentType,
      data.prompt || null,
      data.autoRelax || false,
      data.selectedFields || null,
      data.briefing || null,
      data.url || null,
      data.channel || null,
      data.isAd || false,
    ]
  );

  return result.rows[0];
}

/**
 * 세그먼트 목록 조회 (최근 사용순)
 */
export async function getSegments(
  companyId: string,
  userId: string
): Promise<SavedSegment[]> {
  const result = await query(
    `SELECT * FROM saved_segments
     WHERE company_id = $1 AND user_id = $2
     ORDER BY COALESCE(last_used_at, created_at) DESC
     LIMIT $3`,
    [companyId, userId, MAX_SEGMENTS_PER_USER]
  );
  return result.rows;
}

/**
 * 세그먼트 삭제 (소유자 확인)
 */
export async function deleteSegment(
  segmentId: string,
  companyId: string,
  userId: string
): Promise<boolean> {
  const result = await query(
    'DELETE FROM saved_segments WHERE id = $1 AND company_id = $2 AND user_id = $3 RETURNING id',
    [segmentId, companyId, userId]
  );
  return result.rows.length > 0;
}

/**
 * 세그먼트 사용 시각 갱신 (fire-and-forget)
 */
export async function touchSegment(segmentId: string): Promise<void> {
  await query(
    'UPDATE saved_segments SET last_used_at = NOW() WHERE id = $1',
    [segmentId]
  );
}
