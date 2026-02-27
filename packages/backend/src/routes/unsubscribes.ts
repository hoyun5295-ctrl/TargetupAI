import { Request, Response, Router } from 'express';
import { query } from '../config/database';
import { authenticate } from '../middlewares/auth';

const router = Router();

// ================================================================
// 공통 헬퍼: 유료 플랜 업체의 customers.sms_opt_in 동기화
// plan_id가 있는 업체만 customers 테이블 연동 (플랜 없으면 스킵)
// ================================================================
async function syncCustomerOptIn(companyId: string, phone: string, optIn: boolean): Promise<void> {
  const planResult = await query(
    `SELECT plan_id FROM companies WHERE id = $1`,
    [companyId]
  );
  if (!planResult.rows[0]?.plan_id) return; // 플랜 없으면 스킵

  await query(
    `UPDATE customers SET sms_opt_in = $1, updated_at = NOW()
     WHERE company_id = $2 AND phone = $3 AND sms_opt_in = $4`,
    [optIn, companyId, phone, !optIn]
  );
}

// 벌크 버전 (업로드용)
async function syncCustomerOptInBulk(companyId: string, phones: string[], optIn: boolean): Promise<void> {
  const planResult = await query(
    `SELECT plan_id FROM companies WHERE id = $1`,
    [companyId]
  );
  if (!planResult.rows[0]?.plan_id) return; // 플랜 없으면 스킵

  if (phones.length === 0) return;

  await query(
    `UPDATE customers SET sms_opt_in = $1, updated_at = NOW()
     WHERE company_id = $2 AND phone = ANY($3) AND sms_opt_in = $4`,
    [optIn, companyId, phones, !optIn]
  );
}

// ================================================================
// GET /api/unsubscribes/080callback - 나래인터넷 080 콜백 (토큰 인증)
// D43-4: opt_out_auto_sync = true인 업체만 콜백 처리
// D43-4: 유료 플랜 업체는 customers.sms_opt_in = false 동시 업데이트
// ================================================================
router.get('/080callback', async (req: Request, res: Response) => {
  try {
    const { cid, fr, token } = req.query;

    // 토큰 검증
    const validToken = process.env.OPT_OUT_080_TOKEN;
    if (!validToken || token !== validToken) {
      console.log(`[080콜백] 토큰 인증 실패 - token=${token}`);
      return res.send('0');
    }

    if (!cid || !fr) {
      console.log(`[080콜백] 필수 파라미터 누락 - cid=${cid}, fr=${fr}`);
      return res.send('0');
    }

    const phone = String(cid).replace(/\D/g, '');
    const optOut080Number = String(fr).replace(/\D/g, '');

    if (phone.length < 10) {
      console.log(`[080콜백] 잘못된 전화번호 - cid=${cid}`);
      return res.send('0');
    }

    // D43-4: 080번호로 고객사 찾기 + opt_out_auto_sync 체크
    const companyResult = await query(
      `SELECT id, company_name, opt_out_auto_sync FROM companies
       WHERE REPLACE(REPLACE(opt_out_080_number, '-', ''), ' ', '') = $1
         AND status = 'active'
       LIMIT 1`,
      [optOut080Number]
    );

    if (companyResult.rows.length === 0) {
      console.log(`[080콜백] 고객사 못찾음 - fr=${fr} (${optOut080Number})`);
      return res.send('0');
    }

    const company = companyResult.rows[0];

    // D43-4: 자동동기화 미사용 업체면 콜백 무시
    if (!company.opt_out_auto_sync) {
      console.log(`[080콜백] 자동동기화 미사용 업체 - ${company.company_name} (${phone})`);
      return res.send('0');
    }

    // 해당 고객사의 모든 활성 사용자 조회
    const usersResult = await query(
      `SELECT id FROM users WHERE company_id = $1 AND is_active = true`,
      [company.id]
    );

    if (usersResult.rows.length === 0) {
      console.log(`[080콜백] 활성 사용자 없음 - ${company.company_name}`);
      return res.send('0');
    }

    // 모든 user에게 broadcast INSERT
    let insertedCount = 0;
    for (const user of usersResult.rows) {
      const result = await query(
        `INSERT INTO unsubscribes (company_id, user_id, phone, source)
         VALUES ($1, $2, $3, '080_ars')
         ON CONFLICT (user_id, phone) DO NOTHING
         RETURNING id`,
        [company.id, user.id, phone]
      );
      if (result.rows.length > 0) insertedCount++;
    }

    // D43-4: 유료 플랜 업체면 customers.sms_opt_in = false 동시 업데이트
    await syncCustomerOptIn(company.id, phone, false);

    console.log(`[080콜백] 수신거부 등록: ${phone} → ${company.company_name} (${insertedCount}/${usersResult.rows.length}명, 080: ${fr})`);
    return res.send('1');
  } catch (error) {
    console.error('[080콜백] 처리 오류:', error);
    return res.send('0');
  }
});

// 아래부터는 인증 필요
router.use(authenticate);

// ================================================================
// GET /api/unsubscribes - 수신거부 목록 조회 (company_id 기준, 중복 제거)
// D43-4: opt_out_080_number, opt_out_auto_sync 응답에 추가
// ================================================================
router.get('/', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }
    
    const { page = 1, limit = 20, search } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    
    let whereClause = 'WHERE company_id = $1';
    const params: any[] = [companyId];
    
    if (search) {
      whereClause += ` AND phone LIKE $2`;
      params.push(`%${search}%`);
    }
    
    // company_id 기준 DISTINCT ON (phone) — 같은 번호가 여러 user에 등록된 경우 최신 1건만
    const countResult = await query(
      `SELECT COUNT(*) FROM (
        SELECT DISTINCT ON (phone) id FROM unsubscribes ${whereClause} ORDER BY phone, created_at DESC
      ) sub`,
      params
    );
    const total = parseInt(countResult.rows[0].count);
    
    const result = await query(
      `SELECT DISTINCT ON (phone) id, phone, source, created_at
       FROM unsubscribes
       ${whereClause}
       ORDER BY phone, created_at DESC`,
      params
    );

    // phone 기준 중복 제거 후 created_at DESC 정렬 + 페이지네이션
    const sorted = result.rows.sort((a: any, b: any) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    const paged = sorted.slice(offset, offset + Number(limit));

    // D43-4: 회사의 080 설정 정보 조회
    const companyInfo = await query(
      `SELECT opt_out_080_number, opt_out_auto_sync FROM companies WHERE id = $1`,
      [companyId]
    );
    const opt080Number = companyInfo.rows[0]?.opt_out_080_number || '';
    const optOutAutoSync = companyInfo.rows[0]?.opt_out_auto_sync || false;
    
    return res.json({
      success: true,
      unsubscribes: paged,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
      opt080Number,
      optOutAutoSync,
    });
  } catch (error) {
    console.error('수신거부 목록 조회 에러:', error);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// ================================================================
// POST /api/unsubscribes - 직접 추가 (user_id 기준)
// D43-4: 유료 플랜 업체는 customers.sms_opt_in = false 동시 업데이트
// ================================================================
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const companyId = req.user?.companyId;
    if (!userId || !companyId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }
    
    const { phone } = req.body;
    const cleanPhone = phone.replace(/\D/g, '');
    
    if (cleanPhone.length < 10) {
      return res.status(400).json({ error: '올바른 전화번호를 입력하세요.' });
    }
    
    await query(
      `INSERT INTO unsubscribes (company_id, user_id, phone, source)
       VALUES ($1, $2, $3, 'manual')
       ON CONFLICT (user_id, phone) DO NOTHING`,
      [companyId, userId, cleanPhone]
    );

    // D43-4: 유료 플랜 업체면 customers.sms_opt_in = false 동시 업데이트
    await syncCustomerOptIn(companyId, cleanPhone, false);
    
    return res.json({ success: true, message: '등록되었습니다.' });
  } catch (error) {
    console.error('수신거부 추가 에러:', error);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// ================================================================
// POST /api/unsubscribes/upload - 엑셀 업로드 (user_id 기준)
// D43-4: 유료 플랜 업체는 customers.sms_opt_in = false 벌크 업데이트
// ================================================================
router.post('/upload', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const companyId = req.user?.companyId;
    if (!userId || !companyId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }
    
    const { phones } = req.body;
    
    if (!phones || !Array.isArray(phones) || phones.length === 0) {
      return res.status(400).json({ error: '전화번호 목록이 필요합니다.' });
    }
    
    let insertCount = 0;
    let skipCount = 0;
    const insertedPhones: string[] = [];
    
    for (const phone of phones) {
      const cleanPhone = String(phone).replace(/\D/g, '');
      if (cleanPhone.length >= 10) {
        const result = await query(
          `INSERT INTO unsubscribes (company_id, user_id, phone, source)
           VALUES ($1, $2, $3, 'upload')
           ON CONFLICT (user_id, phone) DO NOTHING
           RETURNING id`,
          [companyId, userId, cleanPhone]
        );
        if (result.rows.length > 0) {
          insertCount++;
          insertedPhones.push(cleanPhone);
        } else {
          skipCount++;
        }
      }
    }

    // D43-4: 유료 플랜 업체면 새로 등록된 번호들 벌크 sms_opt_in = false
    if (insertedPhones.length > 0) {
      await syncCustomerOptInBulk(companyId, insertedPhones, false);
    }
    
    return res.json({
      success: true,
      message: `${insertCount}건 등록, ${skipCount}건 중복 제외`,
      insertCount,
      skipCount,
    });
  } catch (error) {
    console.error('수신거부 업로드 에러:', error);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// ================================================================
// DELETE /api/unsubscribes/:id - 삭제 (company_id 기준)
// D43-4: 유료 플랜 업체만 customers.sms_opt_in = true 복원
// ================================================================
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }
    
    const { id } = req.params;
    
    // 해당 건의 phone을 먼저 조회 → 같은 회사 내 모든 user의 동일 phone 일괄 삭제
    const target = await query(
      `SELECT phone FROM unsubscribes WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );

    if (target.rows.length > 0) {
      const targetPhone = target.rows[0].phone;
      
      // unsubscribes에서 삭제
      await query(
        `DELETE FROM unsubscribes WHERE company_id = $1 AND phone = $2`,
        [companyId, targetPhone]
      );

      // D43-4: 유료 플랜 업체만 customers.sms_opt_in = true 복원
      await syncCustomerOptIn(companyId, targetPhone, true);
    }
    
    return res.json({ success: true, message: '삭제되었습니다.' });
  } catch (error) {
    console.error('수신거부 삭제 에러:', error);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// ================================================================
// POST /api/unsubscribes/check - 수신거부 체크 (company_id 기준)
// ================================================================
router.post('/check', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }

    const { phones } = req.body;
    if (!phones || !Array.isArray(phones)) {
      return res.json({ unsubscribeCount: 0, unsubscribePhones: [] });
    }

    const cleanPhones = phones.map((p: string) => p.replace(/\D/g, ''));
    const result = await query(
      `SELECT DISTINCT phone FROM unsubscribes WHERE company_id = $1 AND phone = ANY($2)`,
      [companyId, cleanPhones]
    );

    return res.json({
      unsubscribeCount: result.rows.length,
      unsubscribePhones: result.rows.map((r: any) => r.phone),
    });
  } catch (error) {
    console.error('수신거부 체크 에러:', error);
    return res.status(500).json({ error: '서버 오류' });
  }
});

export default router;
