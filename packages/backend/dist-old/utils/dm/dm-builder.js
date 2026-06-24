"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractFlatSectionsFromDm = extractFlatSectionsFromDm;
exports.extractPagesFromDm = extractPagesFromDm;
exports.createDm = createDm;
exports.updateDm = updateDm;
exports.saveDmVersion = saveDmVersion;
exports.listDmVersions = listDmVersions;
exports.restoreDmVersion = restoreDmVersion;
exports.setApprovalStatus = setApprovalStatus;
exports.deleteDm = deleteDm;
exports.getDmList = getDmList;
exports.getDmDetail = getDmDetail;
exports.getDmByCode = getDmByCode;
exports.publishDm = publishDm;
exports.trackDmView = trackDmView;
exports.getDmStats = getDmStats;
/**
 * dm-builder.ts — 모바일 DM 빌더 컨트롤타워
 *
 * 한줄로 AI 프로 요금제 이상 기능.
 * CRUD + 단축URL 발행 + 열람 추적 + 통계 집계.
 */
const crypto_1 = __importDefault(require("crypto"));
const database_1 = require("../../config/database");
/**
 * DM 저장된 구조(pages/sections)에서 전체 섹션을 flat 배열로 추출.
 * - pages가 D128 새 구조면 pages.flatMap(p => p.sections)
 * - 아니면 sections 필드 그대로
 * - 둘 다 없으면 []
 * 검수/AI 개선/테스트 발송 등 섹션 단위 작업에 사용.
 */
function extractFlatSectionsFromDm(dm) {
    let rawPages = dm?.pages;
    if (typeof rawPages === 'string') {
        try {
            rawPages = JSON.parse(rawPages);
        }
        catch {
            rawPages = null;
        }
    }
    if (Array.isArray(rawPages) && rawPages.length > 0 && rawPages[0] && Array.isArray(rawPages[0].sections)) {
        return rawPages.flatMap((p) => Array.isArray(p.sections) ? p.sections : []);
    }
    let rawSections = dm?.sections;
    if (typeof rawSections === 'string') {
        try {
            rawSections = JSON.parse(rawSections);
        }
        catch {
            rawSections = null;
        }
    }
    if (Array.isArray(rawSections))
        return rawSections;
    return [];
}
/**
 * DM에서 페이지 구조(DmPageGroup[]) 추출.
 * 없으면 sections를 단일 페이지로 감싸서 반환.
 */
function extractPagesFromDm(dm) {
    let rawPages = dm?.pages;
    if (typeof rawPages === 'string') {
        try {
            rawPages = JSON.parse(rawPages);
        }
        catch {
            rawPages = null;
        }
    }
    if (Array.isArray(rawPages) && rawPages.length > 0 && rawPages[0] && Array.isArray(rawPages[0].sections)) {
        return rawPages.map((p, i) => ({
            id: p.id || `p-${i}`,
            name: p.name,
            sections: Array.isArray(p.sections) ? p.sections : [],
        }));
    }
    const flat = extractFlatSectionsFromDm(dm);
    if (flat.length > 0)
        return [{ id: 'p-legacy', sections: flat }];
    return [];
}
// ────────────────── CRUD ──────────────────
async function createDm(companyId, userId, data) {
    const layoutMode = data.layout_mode || (Array.isArray(data.sections) && data.sections.length > 0 ? 'scroll' : 'slides');
    const result = await (0, database_1.query)(`INSERT INTO dm_pages (
       company_id, created_by, title, store_name,
       header_template, footer_template, header_data, footer_data,
       pages, settings,
       layout_mode, sections, brand_kit, template_id, ai_prompt, approval_status
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING *`, [
        companyId, userId, data.title, data.store_name || null,
        data.header_template || 'default', data.footer_template || 'default',
        JSON.stringify(data.header_data || {}), JSON.stringify(data.footer_data || {}),
        JSON.stringify(data.pages || []), JSON.stringify(data.settings || {}),
        layoutMode,
        data.sections ? JSON.stringify(data.sections) : null,
        data.brand_kit ? JSON.stringify(data.brand_kit) : null,
        data.template_id || null,
        data.ai_prompt || null,
        data.approval_status || 'draft',
    ]);
    return result.rows[0];
}
async function updateDm(id, companyId, data) {
    const sets = [];
    const params = [];
    let idx = 1;
    if (data.title !== undefined) {
        sets.push(`title = $${idx++}`);
        params.push(data.title);
    }
    if (data.store_name !== undefined) {
        sets.push(`store_name = $${idx++}`);
        params.push(data.store_name);
    }
    if (data.header_template !== undefined) {
        sets.push(`header_template = $${idx++}`);
        params.push(data.header_template);
    }
    if (data.footer_template !== undefined) {
        sets.push(`footer_template = $${idx++}`);
        params.push(data.footer_template);
    }
    if (data.header_data !== undefined) {
        sets.push(`header_data = $${idx++}`);
        params.push(JSON.stringify(data.header_data));
    }
    if (data.footer_data !== undefined) {
        sets.push(`footer_data = $${idx++}`);
        params.push(JSON.stringify(data.footer_data));
    }
    if (data.pages !== undefined) {
        sets.push(`pages = $${idx++}`);
        params.push(JSON.stringify(data.pages));
    }
    if (data.settings !== undefined) {
        sets.push(`settings = $${idx++}`);
        params.push(JSON.stringify(data.settings));
    }
    // D125
    if (data.layout_mode !== undefined) {
        sets.push(`layout_mode = $${idx++}`);
        params.push(data.layout_mode);
    }
    if (data.sections !== undefined) {
        sets.push(`sections = $${idx++}`);
        params.push(JSON.stringify(data.sections));
    }
    if (data.brand_kit !== undefined) {
        sets.push(`brand_kit = $${idx++}`);
        params.push(JSON.stringify(data.brand_kit));
    }
    if (data.template_id !== undefined) {
        sets.push(`template_id = $${idx++}`);
        params.push(data.template_id);
    }
    if (data.ai_prompt !== undefined) {
        sets.push(`ai_prompt = $${idx++}`);
        params.push(data.ai_prompt);
    }
    if (data.approval_status !== undefined) {
        sets.push(`approval_status = $${idx++}`);
        params.push(data.approval_status);
    }
    if (sets.length === 0)
        return null;
    sets.push(`updated_at = NOW()`);
    params.push(id, companyId);
    const result = await (0, database_1.query)(`UPDATE dm_pages SET ${sets.join(', ')} WHERE id = $${idx++} AND company_id = $${idx} RETURNING *`, params);
    return result.rows[0] || null;
}
// ────────────────── 버전 관리 (D125 §13) ──────────────────
async function saveDmVersion(dmId, label, sections, brandKit, note, userId) {
    const res = await (0, database_1.query)(`SELECT COALESCE(MAX(version_number), 0) + 1 AS next FROM dm_versions WHERE dm_id = $1`, [dmId]);
    const versionNumber = res.rows[0]?.next || 1;
    const ins = await (0, database_1.query)(`INSERT INTO dm_versions (dm_id, version_label, version_number, sections, brand_kit, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`, [dmId, label, versionNumber, JSON.stringify(sections), JSON.stringify(brandKit || {}), note, userId]);
    return ins.rows[0];
}
async function listDmVersions(dmId, companyId) {
    // company_id 소속 확인
    const own = await (0, database_1.query)(`SELECT id FROM dm_pages WHERE id = $1 AND company_id = $2`, [dmId, companyId]);
    if (own.rows.length === 0)
        return [];
    const res = await (0, database_1.query)(`SELECT id, version_label, version_number, note, created_by, created_at,
            sections, brand_kit
     FROM dm_versions WHERE dm_id = $1 ORDER BY version_number DESC
     LIMIT 50`, [dmId]);
    return res.rows;
}
async function restoreDmVersion(dmId, versionId, companyId) {
    const own = await (0, database_1.query)(`SELECT id FROM dm_pages WHERE id = $1 AND company_id = $2`, [dmId, companyId]);
    if (own.rows.length === 0)
        return null;
    const vRes = await (0, database_1.query)(`SELECT sections, brand_kit FROM dm_versions WHERE id = $1 AND dm_id = $2`, [versionId, dmId]);
    if (vRes.rows.length === 0)
        return null;
    const v = vRes.rows[0];
    const upd = await (0, database_1.query)(`UPDATE dm_pages SET sections = $1, brand_kit = $2, updated_at = NOW()
     WHERE id = $3 AND company_id = $4 RETURNING *`, [v.sections, v.brand_kit, dmId, companyId]);
    return upd.rows[0] || null;
}
// ────────────────── 승인 플로우 (D125 §13-3) ──────────────────
async function setApprovalStatus(dmId, companyId, status) {
    const res = await (0, database_1.query)(`UPDATE dm_pages SET approval_status = $1, updated_at = NOW()
     WHERE id = $2 AND company_id = $3 RETURNING *`, [status, dmId, companyId]);
    return res.rows[0] || null;
}
async function deleteDm(id, companyId) {
    // dm_views ON DELETE CASCADE로 자동 삭제
    const result = await (0, database_1.query)(`DELETE FROM dm_pages WHERE id = $1 AND company_id = $2 RETURNING id`, [id, companyId]);
    return (result.rowCount ?? 0) > 0;
}
async function getDmList(companyId) {
    const result = await (0, database_1.query)(`SELECT id, title, store_name, status, short_code, view_count,
            COALESCE(jsonb_array_length(pages), 0) as page_count,
            created_at, updated_at
     FROM dm_pages WHERE company_id = $1
     ORDER BY updated_at DESC`, [companyId]);
    return result.rows;
}
async function getDmDetail(id, companyId) {
    const result = await (0, database_1.query)(`SELECT * FROM dm_pages WHERE id = $1 AND company_id = $2`, [id, companyId]);
    return result.rows[0] || null;
}
async function getDmByCode(code) {
    const result = await (0, database_1.query)(`SELECT * FROM dm_pages WHERE short_code = $1 AND status = 'published'`, [code]);
    return result.rows[0] || null;
}
// ────────────────── 단축URL 발행 ──────────────────
function generateShortCode(length = 7) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = crypto_1.default.randomBytes(length);
    let code = '';
    for (let i = 0; i < length; i++) {
        code += chars[bytes[i] % chars.length];
    }
    return code;
}
async function publishDm(id, companyId) {
    // 기존 short_code 확인
    const existing = await (0, database_1.query)(`SELECT short_code FROM dm_pages WHERE id = $1 AND company_id = $2`, [id, companyId]);
    if (!existing.rows[0])
        return null;
    if (existing.rows[0].short_code) {
        return { short_code: existing.rows[0].short_code };
    }
    // 새 코드 생성 (충돌 시 재시도)
    let code = '';
    let attempts = 0;
    do {
        code = generateShortCode();
        const dup = await (0, database_1.query)(`SELECT id FROM dm_pages WHERE short_code = $1`, [code]);
        if (dup.rows.length === 0)
            break;
        attempts++;
    } while (attempts < 10);
    const result = await (0, database_1.query)(`UPDATE dm_pages SET short_code = $1, status = 'published', updated_at = NOW()
     WHERE id = $2 AND company_id = $3 RETURNING short_code`, [code, id, companyId]);
    return result.rows[0] || null;
}
// ────────────────── 열람 추적 ──────────────────
async function trackDmView(dmId, companyId, phone, pageReached, totalPages, duration, ip, userAgent) {
    if (phone) {
        // 같은 phone + dm_id 조합이면 page_reached/duration 갱신 (UPSERT)
        const existing = await (0, database_1.query)(`SELECT id, page_reached FROM dm_views WHERE dm_id = $1 AND phone = $2 ORDER BY viewed_at DESC LIMIT 1`, [dmId, phone]);
        if (existing.rows[0]) {
            const newReached = Math.max(existing.rows[0].page_reached, pageReached);
            await (0, database_1.query)(`UPDATE dm_views SET page_reached = $1, duration_seconds = duration_seconds + $2, last_active_at = NOW()
         WHERE id = $3`, [newReached, Math.max(0, duration), existing.rows[0].id]);
        }
        else {
            await (0, database_1.query)(`INSERT INTO dm_views (dm_id, company_id, phone, page_reached, total_pages, duration_seconds, ip, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [dmId, companyId, phone, pageReached, totalPages, duration, ip, userAgent]);
        }
    }
    else {
        // phone 없으면 익명 조회수만 카운트
        await (0, database_1.query)(`INSERT INTO dm_views (dm_id, company_id, phone, page_reached, total_pages, ip, user_agent)
       VALUES ($1, $2, NULL, $3, $4, $5, $6)`, [dmId, companyId, pageReached, totalPages, ip, userAgent]);
    }
    // 총 조회수 증가
    await (0, database_1.query)(`UPDATE dm_pages SET view_count = view_count + 1 WHERE id = $1`, [dmId]);
}
// ────────────────── 통계 ──────────────────
async function getDmStats(id, companyId) {
    // 전체 요약
    const summary = await (0, database_1.query)(`SELECT COUNT(*) as total_views,
            COUNT(DISTINCT phone) FILTER (WHERE phone IS NOT NULL) as unique_viewers,
            AVG(page_reached)::numeric(5,1) as avg_page_reached,
            AVG(duration_seconds)::numeric(10,0) as avg_duration,
            COUNT(*) FILTER (WHERE page_reached >= total_pages AND total_pages > 0) as completed_views
     FROM dm_views WHERE dm_id = $1 AND company_id = $2`, [id, companyId]);
    // 전화번호별 상세
    const byPhone = await (0, database_1.query)(`SELECT phone, MAX(page_reached) as max_page, MAX(total_pages) as total_pages,
            SUM(duration_seconds) as total_duration, MIN(viewed_at) as first_view, MAX(last_active_at) as last_view
     FROM dm_views WHERE dm_id = $1 AND company_id = $2 AND phone IS NOT NULL
     GROUP BY phone ORDER BY first_view DESC LIMIT 200`, [id, companyId]);
    return {
        summary: summary.rows[0],
        viewers: byPhone.rows,
    };
}
//# sourceMappingURL=dm-builder.js.map