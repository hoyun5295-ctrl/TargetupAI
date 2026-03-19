import { Router, Request, Response } from 'express';
import { authenticate, requireCompanyAdmin } from '../middlewares/auth';
import pool from '../config/database';
import { getCompanyScope } from '../utils/permission-helper';
import {
  updateAssignmentScope,
  assignUsersToCallback,
  unassignUserFromCallback,
  getAssignmentsByCallback,
  replaceAssignments,
} from '../utils/sender-registration';

const router = Router();

// ============================================================
//  발신번호 관리 API — 공용 (슈퍼관리자 + 고객사관리자)
//  마운트: /api/manage/callbacks
//  슈퍼관리자: 전체 회사 발신번호 관리 (항상 등록/삭제 가능)
//  고객사관리자: 자사 발신번호만 + allow_callback_self_register=true일 때만 등록/삭제
// ============================================================

router.use(authenticate, requireCompanyAdmin);

// ★ CT-02: getCompanyScope → permission-helper.ts 컨트롤타워로 통합

// 고객사관리자 자체등록 허용 여부 확인
async function checkSelfRegisterAllowed(companyId: string): Promise<boolean> {
  const result = await pool.query(
    'SELECT allow_callback_self_register FROM companies WHERE id = $1',
    [companyId]
  );
  return result.rows[0]?.allow_callback_self_register === true;
}

// GET / - 발신번호 목록 조회 (+allowSelfRegister 포함)
router.get('/', async (req: Request, res: Response) => {
  try {
    const companyScope = getCompanyScope(req);

    // D87 하위호환: assignment_scope 컬럼 존재 여부 확인
    let hasAssignmentScope = true;
    try {
      await pool.query(`SELECT assignment_scope FROM callback_numbers LIMIT 0`);
    } catch {
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
    const params: any[] = [];

    if (companyScope) {
      sql += ' WHERE cn.company_id = $1';
      params.push(companyScope);
    }

    sql += ' ORDER BY c.company_name, cn.is_default DESC, cn.created_at DESC';

    const result = await pool.query(sql, params);

    // 고객사관리자: 자체등록 허용 여부 포함
    let allowSelfRegister = true; // 슈퍼관리자는 항상 true
    if ((req as any).user!.userType === 'company_admin' && companyScope) {
      allowSelfRegister = await checkSelfRegisterAllowed(companyScope);
    }

    res.json({
      callbackNumbers: result.rows,
      allowSelfRegister,
    });
  } catch (error) {
    console.error('발신번호 조회 실패:', error);
    res.status(500).json({ error: '발신번호 조회 실패' });
  }
});

// POST / - 발신번호 등록
router.post('/', async (req: Request, res: Response) => {
  const { userType: callerType, companyId: callerCompanyId } = (req as any).user!;
  const { companyId, phone, label, isDefault, storeCode, storeName } = req.body;

  const targetCompanyId = callerType === 'super_admin' ? companyId : callerCompanyId;

  if (!targetCompanyId || !phone) {
    return res.status(400).json({ error: '회사와 발신번호는 필수입니다.' });
  }

  // 고객사관리자: 자체등록 허용 여부 체크
  if (callerType === 'company_admin') {
    const allowed = await checkSelfRegisterAllowed(callerCompanyId!);
    if (!allowed) {
      return res.status(403).json({ error: '발신번호 자체 등록이 허용되지 않은 고객사입니다. 슈퍼관리자에게 문의해주세요.' });
    }
  }

  try {
    // 대표번호로 설정 시 기존 대표번호 해제
    if (isDefault) {
      await pool.query('UPDATE callback_numbers SET is_default = false WHERE company_id = $1', [targetCompanyId]);
    }

    const result = await pool.query(`
      INSERT INTO callback_numbers (company_id, phone, label, is_default, store_code, store_name)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, phone, label, is_default, store_code, store_name
    `, [targetCompanyId, phone, label || null, isDefault || false, storeCode || null, storeName || null]);

    res.json({
      message: '발신번호가 등록되었습니다.',
      callbackNumber: result.rows[0]
    });
  } catch (error) {
    console.error('발신번호 등록 실패:', error);
    res.status(500).json({ error: '발신번호 등록 실패' });
  }
});

// PUT /:id - 발신번호 수정
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { userType: callerType, companyId: callerCompanyId } = (req as any).user!;
  const { phone, label } = req.body;

  try {
    // 고객사관리자: 자사 발신번호만 수정 가능
    if (callerType === 'company_admin') {
      const check = await pool.query('SELECT company_id FROM callback_numbers WHERE id = $1', [id]);
      if (check.rows.length === 0) return res.status(404).json({ error: '발신번호를 찾을 수 없습니다.' });
      if (check.rows[0].company_id !== callerCompanyId) {
        return res.status(403).json({ error: '자사 발신번호만 수정할 수 있습니다.' });
      }
    }

    const result = await pool.query(`
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
  } catch (error) {
    console.error('발신번호 수정 실패:', error);
    res.status(500).json({ error: '발신번호 수정 실패' });
  }
});

// DELETE /:id - 발신번호 삭제
router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { userType: callerType, companyId: callerCompanyId } = (req as any).user!;

  try {
    // 고객사관리자: 자체등록 허용 + 자사만 삭제
    if (callerType === 'company_admin') {
      const allowed = await checkSelfRegisterAllowed(callerCompanyId!);
      if (!allowed) {
        return res.status(403).json({ error: '발신번호 삭제 권한이 없습니다. 슈퍼관리자에게 문의해주세요.' });
      }
      const check = await pool.query('SELECT company_id FROM callback_numbers WHERE id = $1', [id]);
      if (check.rows.length === 0) return res.status(404).json({ error: '발신번호를 찾을 수 없습니다.' });
      if (check.rows[0].company_id !== callerCompanyId) {
        return res.status(403).json({ error: '자사 발신번호만 삭제할 수 있습니다.' });
      }
    }

    const result = await pool.query('DELETE FROM callback_numbers WHERE id = $1 RETURNING phone', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '발신번호를 찾을 수 없습니다.' });
    }

    res.json({ message: '삭제되었습니다.' });
  } catch (error) {
    console.error('발신번호 삭제 실패:', error);
    res.status(500).json({ error: '발신번호 삭제 실패' });
  }
});

// PUT /:id/default - 대표번호 설정
router.put('/:id/default', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { userType: callerType, companyId: callerCompanyId } = (req as any).user!;

  try {
    const check = await pool.query('SELECT company_id FROM callback_numbers WHERE id = $1', [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: '발신번호를 찾을 수 없습니다.' });
    }

    const targetCompanyId = check.rows[0].company_id;

    // 고객사관리자: 자사만
    if (callerType === 'company_admin' && targetCompanyId !== callerCompanyId) {
      return res.status(403).json({ error: '자사 발신번호만 대표번호로 설정할 수 있습니다.' });
    }

    await pool.query('UPDATE callback_numbers SET is_default = false WHERE company_id = $1', [targetCompanyId]);
    await pool.query('UPDATE callback_numbers SET is_default = true WHERE id = $1', [id]);

    res.json({ message: '대표번호로 설정되었습니다.' });
  } catch (error) {
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
router.put('/:id/scope', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { userType: callerType, companyId: callerCompanyId } = (req as any).user!;
  const { scope } = req.body;

  if (!scope || !['all', 'assigned'].includes(scope)) {
    return res.status(400).json({ error: '유효한 범위를 지정해주세요. (all 또는 assigned)' });
  }

  try {
    // D87 하위호환: assignment_scope 컬럼 없으면 안내
    try {
      await pool.query(`SELECT assignment_scope FROM callback_numbers LIMIT 0`);
    } catch {
      return res.status(400).json({ error: 'DB 마이그레이션이 필요합니다. 관리자에게 문의하세요.' });
    }

    // 해당 번호 소유 회사 확인
    const check = await pool.query('SELECT company_id FROM callback_numbers WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: '발신번호를 찾을 수 없습니다.' });

    const targetCompanyId = check.rows[0].company_id;
    if (callerType === 'company_admin' && targetCompanyId !== callerCompanyId) {
      return res.status(403).json({ error: '자사 발신번호만 수정할 수 있습니다.' });
    }

    const updated = await updateAssignmentScope(id, targetCompanyId, scope);
    if (!updated) {
      return res.status(404).json({ error: '발신번호를 찾을 수 없습니다.' });
    }

    res.json({ success: true, message: scope === 'all' ? '전체 사용으로 변경되었습니다.' : '사용자 지정으로 변경되었습니다.' });
  } catch (error: any) {
    console.error('배정 범위 변경 실패:', error);
    res.status(500).json({ error: error.message || '배정 범위 변경 실패' });
  }
});

// GET /:id/assignments — 배정된 사용자 목록 조회
router.get('/:id/assignments', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { userType: callerType, companyId: callerCompanyId } = (req as any).user!;

  try {
    const check = await pool.query('SELECT company_id FROM callback_numbers WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: '발신번호를 찾을 수 없습니다.' });

    const targetCompanyId = check.rows[0].company_id;
    if (callerType === 'company_admin' && targetCompanyId !== callerCompanyId) {
      return res.status(403).json({ error: '자사 발신번호만 조회할 수 있습니다.' });
    }

    const assignments = await getAssignmentsByCallback(id, targetCompanyId);
    res.json({ success: true, assignments });
  } catch (error: any) {
    console.error('배정 사용자 조회 실패:', error);
    res.status(500).json({ error: '조회 실패' });
  }
});

// PUT /:id/assignments — 배정 사용자 전체 교체 (프론트에서 체크박스 선택 후 저장)
router.put('/:id/assignments', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { userType: callerType, companyId: callerCompanyId, userId: callerId } = (req as any).user!;
  const { userIds } = req.body; // string[]

  if (!Array.isArray(userIds)) {
    return res.status(400).json({ error: '사용자 ID 목록이 필요합니다.' });
  }

  try {
    const check = await pool.query('SELECT company_id FROM callback_numbers WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: '발신번호를 찾을 수 없습니다.' });

    const targetCompanyId = check.rows[0].company_id;
    if (callerType === 'company_admin' && targetCompanyId !== callerCompanyId) {
      return res.status(403).json({ error: '자사 발신번호만 수정할 수 있습니다.' });
    }

    const assignments = await replaceAssignments(id, targetCompanyId, userIds, callerId);
    res.json({ success: true, assignments, message: '사용자 배정이 저장되었습니다.' });
  } catch (error: any) {
    console.error('배정 저장 실패:', error);
    res.status(400).json({ error: error.message || '배정 저장 실패' });
  }
});

// DELETE /:id/assignments/:userId — 개별 배정 해제
router.delete('/:id/assignments/:userId', async (req: Request, res: Response) => {
  const { id, userId: targetUserId } = req.params;
  const { userType: callerType, companyId: callerCompanyId } = (req as any).user!;

  try {
    const check = await pool.query('SELECT company_id FROM callback_numbers WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: '발신번호를 찾을 수 없습니다.' });

    const targetCompanyId = check.rows[0].company_id;
    if (callerType === 'company_admin' && targetCompanyId !== callerCompanyId) {
      return res.status(403).json({ error: '자사 발신번호만 수정할 수 있습니다.' });
    }

    const removed = await unassignUserFromCallback(id, targetUserId, targetCompanyId);
    if (!removed) {
      return res.status(404).json({ error: '해당 배정을 찾을 수 없습니다.' });
    }

    res.json({ success: true, message: '배정이 해제되었습니다.' });
  } catch (error: any) {
    console.error('배정 해제 실패:', error);
    res.status(500).json({ error: '배정 해제 실패' });
  }
});

export default router;
