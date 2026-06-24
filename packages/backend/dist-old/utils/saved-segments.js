"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveSegment = saveSegment;
exports.getSegments = getSegments;
exports.deleteSegment = deleteSegment;
exports.updateSegment = updateSegment;
exports.touchSegment = touchSegment;
/**
 * ★ CT: 저장 세그먼트 (Saved Segments) 컨트롤타워
 *
 * 사용자가 AI 한줄로/맞춤한줄 발송 설정을 저장하고 재활용하는 기능.
 * company_id + user_id 기반 멀티테넌트 격리.
 * 사용자당 최대 20개 제한.
 */
const database_1 = require("../config/database");
const MAX_SEGMENTS_PER_USER = 20;
/**
 * 세그먼트 저장 (INSERT + 20개 제한)
 */
async function saveSegment(companyId, userId, data) {
    // 개수 제한 체크
    const countResult = await (0, database_1.query)('SELECT COUNT(*)::int as cnt FROM saved_segments WHERE company_id = $1 AND user_id = $2', [companyId, userId]);
    if (countResult.rows[0].cnt >= MAX_SEGMENTS_PER_USER) {
        throw new Error(`저장 세그먼트는 최대 ${MAX_SEGMENTS_PER_USER}개까지 가능합니다.`);
    }
    const result = await (0, database_1.query)(`INSERT INTO saved_segments (
      id, company_id, user_id, name, emoji, segment_type,
      prompt, auto_relax, selected_fields, briefing, url, channel, is_ad,
      created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1, $2, $3, $4, $5,
      $6, $7, $8, $9, $10, $11, $12,
      NOW(), NOW()
    ) RETURNING *`, [
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
    ]);
    return result.rows[0];
}
/**
 * 세그먼트 목록 조회 (최근 사용순)
 */
async function getSegments(companyId, userId) {
    const result = await (0, database_1.query)(`SELECT * FROM saved_segments
     WHERE company_id = $1 AND user_id = $2
     ORDER BY COALESCE(last_used_at, created_at) DESC
     LIMIT $3`, [companyId, userId, MAX_SEGMENTS_PER_USER]);
    return result.rows;
}
/**
 * 세그먼트 삭제 (소유자 확인)
 */
async function deleteSegment(segmentId, companyId, userId) {
    const result = await (0, database_1.query)('DELETE FROM saved_segments WHERE id = $1 AND company_id = $2 AND user_id = $3 RETURNING id', [segmentId, companyId, userId]);
    return result.rows.length > 0;
}
/**
 * 세그먼트 수정 (소유자 확인)
 */
async function updateSegment(segmentId, companyId, userId, data) {
    const result = await (0, database_1.query)(`UPDATE saved_segments SET
      name = COALESCE($4, name),
      emoji = COALESCE($5, emoji),
      segment_type = COALESCE($6, segment_type),
      prompt = COALESCE($7, prompt),
      auto_relax = COALESCE($8, auto_relax),
      selected_fields = COALESCE($9, selected_fields),
      briefing = COALESCE($10, briefing),
      url = COALESCE($11, url),
      channel = COALESCE($12, channel),
      is_ad = COALESCE($13, is_ad),
      updated_at = NOW()
    WHERE id = $1 AND company_id = $2 AND user_id = $3
    RETURNING *`, [
        segmentId, companyId, userId,
        data.name ?? null,
        data.emoji ?? null,
        data.segmentType ?? null,
        data.prompt ?? null,
        data.autoRelax ?? null,
        data.selectedFields ?? null,
        data.briefing ?? null,
        data.url ?? null,
        data.channel ?? null,
        data.isAd ?? null,
    ]);
    return result.rows[0] || null;
}
/**
 * 세그먼트 사용 시각 갱신 (fire-and-forget)
 */
async function touchSegment(segmentId) {
    await (0, database_1.query)('UPDATE saved_segments SET last_used_at = NOW() WHERE id = $1', [segmentId]);
}
//# sourceMappingURL=saved-segments.js.map