import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { authenticate } from '../middlewares/auth';

const router = Router();

router.use(authenticate);

// GET /api/campaigns - 캠페인 목록
router.get('/', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;

    if (!companyId) {
      return res.status(403).json({ error: '고객사 권한이 필요합니다.' });
    }

    const { status, page = 1, limit = 20 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let whereClause = 'WHERE company_id = $1';
    const params: any[] = [companyId];
    let paramIndex = 2;

    if (status) {
      whereClause += ` AND status = $${paramIndex++}`;
      params.push(status);
    }

    const countResult = await query(
      `SELECT COUNT(*) FROM campaigns ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    params.push(Number(limit), offset);
    const result = await query(
      `SELECT * FROM campaigns
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      params
    );

    return res.json({
      campaigns: result.rows,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error('캠페인 목록 조회 에러:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// POST /api/campaigns - 캠페인 생성
router.post('/', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;

    if (!companyId) {
      return res.status(403).json({ error: '고객사 권한이 필요합니다.' });
    }

    const {
      campaignName,
      messageType,
      targetFilter,
      messageContent,
      scheduledAt,
      isAd,
    } = req.body;

    if (!campaignName || !messageType || !messageContent) {
      return res.status(400).json({ error: '필수 항목을 입력하세요.' });
    }

    // 타겟 인원 계산
    let targetCount = 0;
    if (targetFilter) {
      const filterQuery = buildFilterQuery(targetFilter, companyId);
      const countResult = await query(
        `SELECT COUNT(*) FROM customers WHERE company_id = $1 AND is_active = true ${filterQuery.where}`,
        [companyId, ...filterQuery.params]
      );
      targetCount = parseInt(countResult.rows[0].count);
    }

    const result = await query(
      `INSERT INTO campaigns (
        company_id, campaign_name, message_type, target_filter,
        message_content, scheduled_at, is_ad, target_count, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        companyId, campaignName, messageType, JSON.stringify(targetFilter),
        messageContent, scheduledAt, isAd ?? false, targetCount, userId
      ]
    );

    return res.status(201).json({
      message: '캠페인이 생성되었습니다.',
      campaign: result.rows[0],
    });
  } catch (error) {
    console.error('캠페인 생성 에러:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// POST /api/campaigns/:id/send - 캠페인 발송
router.post('/:id/send', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const { id } = req.params;

    if (!companyId) {
      return res.status(403).json({ error: '고객사 권한이 필요합니다.' });
    }

    // 캠페인 조회
    const campaignResult = await query(
      'SELECT * FROM campaigns WHERE id = $1 AND company_id = $2',
      [id, companyId]
    );

    if (campaignResult.rows.length === 0) {
      return res.status(404).json({ error: '캠페인을 찾을 수 없습니다.' });
    }

    const campaign = campaignResult.rows[0];

    if (campaign.status !== 'draft') {
      return res.status(400).json({ error: '발송 가능한 상태가 아닙니다.' });
    }

    // 타겟 고객 조회
    const targetFilter = campaign.target_filter;
    const filterQuery = buildFilterQuery(targetFilter, companyId);
    
    const customersResult = await query(
      `SELECT id, phone, name FROM customers 
       WHERE company_id = $1 AND is_active = true AND sms_opt_in = true ${filterQuery.where}`,
      [companyId, ...filterQuery.params]
    );

    const customers = customersResult.rows;

    if (customers.length === 0) {
      return res.status(400).json({ error: '발송 대상이 없습니다.' });
    }

    // 메시지 생성 (실제로는 여기서 QTmsg에 INSERT)
    for (const customer of customers) {
      await query(
        `INSERT INTO messages (
          campaign_id, customer_id, phone, message_type,
          message_content, status
        ) VALUES ($1, $2, $3, $4, $5, 'pending')`,
        [
          campaign.id, customer.id, customer.phone,
          campaign.message_type, campaign.message_content
        ]
      );
    }

    // 캠페인 상태 업데이트
    await query(
      `UPDATE campaigns SET 
        status = 'sending', 
        sent_count = $1,
        sent_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [customers.length, id]
    );

    return res.json({
      message: `${customers.length}건 발송이 시작되었습니다.`,
      sentCount: customers.length,
    });
  } catch (error) {
    console.error('캠페인 발송 에러:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 필터 쿼리 빌더
function buildFilterQuery(filter: any, companyId: string) {
  let where = '';
  const params: any[] = [];
  let paramIndex = 2;

  if (!filter) return { where, params };

  if (filter.gender) {
    where += ` AND gender = $${paramIndex++}`;
    params.push(filter.gender);
  }

  if (filter.minAge) {
    where += ` AND EXTRACT(YEAR FROM AGE(birth_date)) >= $${paramIndex++}`;
    params.push(filter.minAge);
  }

  if (filter.maxAge) {
    where += ` AND EXTRACT(YEAR FROM AGE(birth_date)) <= $${paramIndex++}`;
    params.push(filter.maxAge);
  }

  if (filter.grade) {
    where += ` AND grade = $${paramIndex++}`;
    params.push(filter.grade);
  }

  return { where, params };
}

export default router;
