"use strict";
/**
 * ★ D98 CT-14: 수신자 중복제거 컨트롤타워
 *
 * 직접발송(직접입력/파일업로드/주소록) 경로에서 수신자 중복을 제거하는 유일한 진입점.
 * phone 기준으로 중복 판정, 첫 번째 등장 항목만 유지.
 *
 * 사용처: campaigns.ts direct-send
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.deduplicateByPhone = deduplicateByPhone;
const normalize_1 = require("./normalize");
/**
 * 수신자 배열에서 phone 기준으로 중복을 제거한다.
 * - normalizePhone으로 하이픈/공백 제거 후 비교
 * - 첫 번째 등장 항목만 유지
 *
 * @param recipients - 수신자 배열 (phone 필드 필수)
 * @returns DeduplicateResult — unique(중복 제거 결과), duplicateCount(제거 건수)
 */
function deduplicateByPhone(recipients) {
    if (!recipients || recipients.length === 0) {
        return { unique: [], duplicateCount: 0, originalCount: 0 };
    }
    const seen = new Set();
    const unique = [];
    for (const r of recipients) {
        const normalized = (0, normalize_1.normalizePhone)(r.phone) || r.phone?.replace(/\D/g, '');
        if (!normalized)
            continue; // 전화번호 없는 항목 스킵
        if (seen.has(normalized))
            continue; // 중복 스킵
        seen.add(normalized);
        unique.push(r);
    }
    return {
        unique,
        duplicateCount: recipients.length - unique.length,
        originalCount: recipients.length,
    };
}
//# sourceMappingURL=deduplicate.js.map