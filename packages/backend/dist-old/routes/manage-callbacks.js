"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middlewares/auth");
const database_1 = __importDefault(require("../config/database"));
const permission_helper_1 = require("../utils/permission-helper");
const sender_registration_1 = require("../utils/sender-registration");
const normalize_phone_1 = require("../utils/normalize-phone");
const router = (0, express_1.Router)();
// ============================================================
//  발신번호 관리 API — 공용 (슈퍼관리자 + 고객사관리자)
//  마운트: /api/manage/callbacks
//  슈퍼관리자: 전체 회사 발신번호 관리 (항상 등록/삭제 가능)
//  고객사관리자: 자사 발신번호만 + allow_callback_self_register=true일 때만 등록/삭제
// ============================================================
router.use(auth_1.authenticate, auth_1.requireCompanyAdmin);
// ★ CT-02: getCompanyScope → permission-helper.ts 컨트롤타워로 통합
// 고객사관리자 자체등록 허용 여부 확인
async function checkSelfRegisterAllowed(companyId) {
    const result = await database_1.default.query('SELECT allow_callback_self_register FROM companies WHERE id = $1', [companyId]);
    return result.rows[0]?.allow_callback_self_register === true;
}
// GET / - 발신번호 목록 조회 (+allowSelfRegister 포함)
router.get('/', async (req, res) => {
    try {
        const companyScope = (0, permission_helper_1.getCompanyScope)(req);
        // D87 하위호환: assignment_scope 컬럼 존재 여부 확인
        let hasAssignmentScope = true;
        try {
            await database_1.default.query(`SELECT assignment_scope FROM callback_numbers LIMIT 0`);
        }
        catch {
            hasAssignmentScope = false;
        }
        let sql = `
      SELECT
        cn.id, cn.phone, cn.label, cn.is_default, cn.created_at,
        cn.store_code, cn.store_name,
        ${hasAssignmentScope ? "cn.assignment_scope," : "'all' as assignment_scope,"}
        c.company_name, c.company_code, c.id as company_id
      FROM callback_numbers cn
      LEFT JOIN companies c ON cn.company_id = c.id
    `;
        const params = [];
        if (companyScope) {
            sql += ' WHERE cn.company_id = $1';
            params.push(companyScope);
        }
        sql += ' ORDER BY c.company_name, cn.is_default DESC, cn.created_at DESC';
        const result = await database_1.default.query(sql, params);
        // 고객사관리자: 자체등록 허용 여부 포함
        let allowSelfRegister = true; // 슈퍼관리자는 항상 true
        if (req.user.userType === 'company_admin' && companyScope) {
            allowSelfRegister = await checkSelfRegisterAllowed(companyScope);
        }
        res.json({
            callbackNumbers: result.rows,
            allowSelfRegister,
        });
    }
    catch (error) {
        console.error('발신번호 조회 실패:', error);
        res.status(500).json({ error: '발신번호 조회 실패' });
    }
});
// POST / - 발신번호 등록
router.post('/', async (req, res) => {
    const { userType: callerType, companyId: callerCompanyId } = req.user;
    const { companyId, phone, label, isDefault, storeCode, storeName } = req.body;
    const targetCompanyId = callerType === 'super_admin' ? companyId : callerCompanyId;
    if (!targetCompanyId || !phone) {
        return res.status(400).json({ error: '회사와 발신번호는 필수입니다.' });
    }
    // ★ D142+ (2026-04-29) 0429 PDF B5 — phone 정규화 + 중복 등록 사전 차단
    const normalizedPhone = (0, normalize_phone_1.normalizePhone)(phone);
    if (normalizedPhone.length < 8 || normalizedPhone.length > 11) {
        return res.status(400).json({ error: '유효하지 않은 발신번호 형식입니다.' });
    }
    // 고객사관리자: 자체등록 허용 여부 체크
    if (callerType === 'company_admin') {
        const allowed = await checkSelfRegisterAllowed(callerCompanyId);
        if (!allowed) {
            return res.status(403).json({ error: '발신번호 자체 등록이 허용되지 않은 고객사입니다. 슈퍼관리자에게 문의해주세요.' });
        }
    }
    try {
        // ★ 사전 중복 체크 (정규화된 phone 기준)
        const dupCheck = await database_1.default.query(`SELECT id FROM callback_numbers WHERE company_id = $1 AND regexp_replace(phone, '\\D', '', 'g') = $2`, [targetCompanyId, normalizedPhone]);
        if (dupCheck.rows.length > 0) {
            return res.status(409).json({
                error: '이미 등록된 발신번호입니다. 같은 고객사에 동일한 번호를 중복 등록할 수 없습니다.',
                code: 'DUPLICATE_CALLBACK_NUMBER',
            });
        }
        // 대표번호로 설정 시 기존 대표번호 해제
        if (isDefault) {
            await database_1.default.query('UPDATE callback_numbers SET is_default = false WHERE company_id = $1', [targetCompanyId]);
        }
        // ★ D142+ B5: INSERT는 사용자 입력 phone 그대로 저장 (UI 표시 형식 유지)
        const result = await database_1.default.query(`
      INSERT INTO callback_numbers (company_id, phone, label, is_default, store_code, store_name)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, phone, label, is_default, store_code, store_name
    `, [targetCompanyId, phone, label || null, isDefault || false, storeCode || null, storeName || null]);
        res.json({
            message: '발신번호가 등록되었습니다.',
            callbackNumber: result.rows[0]
        });
    }
    catch (error) {
        if (error?.code === '23505') {
            return res.status(409).json({
                error: '이미 등록된 발신번호입니다. 같은 고객사에 동일한 번호를 중복 등록할 수 없습니다.',
                code: 'DUPLICATE_CALLBACK_NUMBER',
            });
        }
        console.error('발신번호 등록 실패:', error);
        res.status(500).json({ error: '발신번호 등록 실패' });
    }
});
// PUT /:id - 발신번호 수정
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { userType: callerType, companyId: callerCompanyId } = req.user;
    const { phone, label } = req.body;
    try {
        // 고객사관리자: 자사 발신번호만 수정 가능
        if (callerType === 'company_admin') {
            const check = await database_1.default.query('SELECT company_id FROM callback_numbers WHERE id = $1', [id]);
            if (check.rows.length === 0)
                return res.status(404).json({ error: '발신번호를 찾을 수 없습니다.' });
            if (check.rows[0].company_id !== callerCompanyId) {
                return res.status(403).json({ error: '자사 발신번호만 수정할 수 있습니다.' });
            }
        }
        const result = await database_1.default.query(`
      UPDATE callback_numbers 
      SET phone = COALESCE($1, phone),
          label = COALESCE($2, label)
      WHERE id = $3
      RETURNING id, phone, label, is_default
    `, [phone, label, id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: '발신번호를 찾을 수 없습니다.' });
        }
        res.json({ message: '수정되었습니다.', callbackNumber: result.rows[0] });
    }
    catch (error) {
        console.error('발신번호 수정 실패:', error);
        res.status(500).json({ error: '발신번호 수정 실패' });
    }
});
// DELETE /:id - 발신번호 삭제
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    const { userType: callerType, companyId: callerCompanyId } = req.user;
    try {
        // 고객사관리자: 자체등록 허용 + 자사만 삭제
        if (callerType === 'company_admin') {
            const allowed = await checkSelfRegisterAllowed(callerCompanyId);
            if (!allowed) {
                return res.status(403).json({ error: '발신번호 삭제 권한이 없습니다. 슈퍼관리자에게 문의해주세요.' });
            }
            const check = await database_1.default.query('SELECT company_id FROM callback_numbers WHERE id = $1', [id]);
            if (check.rows.length === 0)
                return res.status(404).json({ error: '발신번호를 찾을 수 없습니다.' });
            if (check.rows[0].company_id !== callerCompanyId) {
                return res.status(403).json({ error: '자사 발신번호만 삭제할 수 있습니다.' });
            }
        }
        const result = await database_1.default.query('DELETE FROM callback_numbers WHERE id = $1 RETURNING phone', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: '발신번호를 찾을 수 없습니다.' });
        }
        res.json({ message: '삭제되었습니다.' });
    }
    catch (error) {
        console.error('발신번호 삭제 실패:', error);
        res.status(500).json({ error: '발신번호 삭제 실패' });
    }
});
// PUT /:id/default - 대표번호 설정
router.put('/:id/default', async (req, res) => {
    const { id } = req.params;
    const { userType: callerType, companyId: callerCompanyId } = req.user;
    try {
        const check = await database_1.default.query('SELECT company_id FROM callback_numbers WHERE id = $1', [id]);
        if (check.rows.length === 0) {
            return res.status(404).json({ error: '발신번호를 찾을 수 없습니다.' });
        }
        const targetCompanyId = check.rows[0].company_id;
        // 고객사관리자: 자사만
        if (callerType === 'company_admin' && targetCompanyId !== callerCompanyId) {
            return res.status(403).json({ error: '자사 발신번호만 대표번호로 설정할 수 있습니다.' });
        }
        await database_1.default.query('UPDATE callback_numbers SET is_default = false WHERE company_id = $1', [targetCompanyId]);
        await database_1.default.query('UPDATE callback_numbers SET is_default = true WHERE id = $1', [id]);
        res.json({ message: '대표번호로 설정되었습니다.' });
    }
    catch (error) {
        console.error('대표번호 설정 실패:', error);
        res.status(500).json({ error: '대표번호 설정 실패' });
    }
});
// ============================================================
//  발신번호 배정 관리 (D87)
//  assignment_scope: 'all' | 'assigned'
//  callback_number_assignments 매핑 테이블 CRUD
// ============================================================
// PUT /:id/scope — 배정 범위 변경 (전체 / 사용자 지정)
router.put('/:id/scope', async (req, res) => {
    const { id } = req.params;
    const { userType: callerType, companyId: callerCompanyId } = req.user;
    const { scope } = req.body;
    if (!scope || !['all', 'assigned'].includes(scope)) {
        return res.status(400).json({ error: '유효한 범위를 지정해주세요. (all 또는 assigned)' });
    }
    try {
        // D87 하위호환: assignment_scope 컬럼 없으면 안내
        try {
            await database_1.default.query(`SELECT assignment_scope FROM callback_numbers LIMIT 0`);
        }
        catch {
            return res.status(400).json({ error: 'DB 마이그레이션이 필요합니다. 관리자에게 문의하세요.' });
        }
        // 해당 번호 소유 회사 확인
        const check = await database_1.default.query('SELECT company_id FROM callback_numbers WHERE id = $1', [id]);
        if (check.rows.length === 0)
            return res.status(404).json({ error: '발신번호를 찾을 수 없습니다.' });
        const targetCompanyId = check.rows[0].company_id;
        if (callerType === 'company_admin' && targetCompanyId !== callerCompanyId) {
            return res.status(403).json({ error: '자사 발신번호만 수정할 수 있습니다.' });
        }
        const updated = await (0, sender_registration_1.updateAssignmentScope)(id, targetCompanyId, scope);
        if (!updated) {
            return res.status(404).json({ error: '발신번호를 찾을 수 없습니다.' });
        }
        res.json({ success: true, message: scope === 'all' ? '전체 사용으로 변경되었습니다.' : '사용자 지정으로 변경되었습니다.' });
    }
    catch (error) {
        console.error('배정 범위 변경 실패:', error);
        res.status(500).json({ error: error.message || '배정 범위 변경 실패' });
    }
});
// GET /:id/assignments — 배정된 사용자 목록 조회
router.get('/:id/assignments', async (req, res) => {
    const { id } = req.params;
    const { userType: callerType, companyId: callerCompanyId } = req.user;
    try {
        const check = await database_1.default.query('SELECT company_id FROM callback_numbers WHERE id = $1', [id]);
        if (check.rows.length === 0)
            return res.status(404).json({ error: '발신번호를 찾을 수 없습니다.' });
        const targetCompanyId = check.rows[0].company_id;
        if (callerType === 'company_admin' && targetCompanyId !== callerCompanyId) {
            return res.status(403).json({ error: '자사 발신번호만 조회할 수 있습니다.' });
        }
        const assignments = await (0, sender_registration_1.getAssignmentsByCallback)(id, targetCompanyId);
        res.json({ success: true, assignments });
    }
    catch (error) {
        console.error('배정 사용자 조회 실패:', error);
        res.status(500).json({ error: '조회 실패' });
    }
});
// PUT /:id/assignments — 배정 사용자 전체 교체 (프론트에서 체크박스 선택 후 저장)
router.put('/:id/assignments', async (req, res) => {
    const { id } = req.params;
    const { userType: callerType, companyId: callerCompanyId, userId: callerId } = req.user;
    const { userIds } = req.body; // string[]
    if (!Array.isArray(userIds)) {
        return res.status(400).json({ error: '사용자 ID 목록이 필요합니다.' });
    }
    try {
        const check = await database_1.default.query('SELECT company_id FROM callback_numbers WHERE id = $1', [id]);
        if (check.rows.length === 0)
            return res.status(404).json({ error: '발신번호를 찾을 수 없습니다.' });
        const targetCompanyId = check.rows[0].company_id;
        if (callerType === 'company_admin' && targetCompanyId !== callerCompanyId) {
            return res.status(403).json({ error: '자사 발신번호만 수정할 수 있습니다.' });
        }
        const assignments = await (0, sender_registration_1.replaceAssignments)(id, targetCompanyId, userIds, callerId);
        res.json({ success: true, assignments, message: '사용자 배정이 저장되었습니다.' });
    }
    catch (error) {
        console.error('배정 저장 실패:', error);
        res.status(400).json({ error: error.message || '배정 저장 실패' });
    }
});
// DELETE /:id/assignments/:userId — 개별 배정 해제
router.delete('/:id/assignments/:userId', async (req, res) => {
    const { id, userId: targetUserId } = req.params;
    const { userType: callerType, companyId: callerCompanyId } = req.user;
    try {
        const check = await database_1.default.query('SELECT company_id FROM callback_numbers WHERE id = $1', [id]);
        if (check.rows.length === 0)
            return res.status(404).json({ error: '발신번호를 찾을 수 없습니다.' });
        const targetCompanyId = check.rows[0].company_id;
        if (callerType === 'company_admin' && targetCompanyId !== callerCompanyId) {
            return res.status(403).json({ error: '자사 발신번호만 수정할 수 있습니다.' });
        }
        const removed = await (0, sender_registration_1.unassignUserFromCallback)(id, targetUserId, targetCompanyId);
        if (!removed) {
            return res.status(404).json({ error: '해당 배정을 찾을 수 없습니다.' });
        }
        res.json({ success: true, message: '배정이 해제되었습니다.' });
    }
    catch (error) {
        console.error('배정 해제 실패:', error);
        res.status(500).json({ error: '배정 해제 실패' });
    }
});
exports.default = router;
//# sourceMappingURL=manage-callbacks.js.map