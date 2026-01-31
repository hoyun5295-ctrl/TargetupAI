import { Router, Request, Response } from 'express';
import { query, mysqlQuery } from '../config/database';
import { authenticate } from '../middlewares/auth';

const router = Router();

router.use(authenticate);

// GET /api/campaigns - 캠페인 목록 (캘린더용)
router.get('/', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: '고객사 권한이 필요합니다.' });
    }
    
    const { status, page = 1, limit = 20, year, month } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    
    let whereClause = 'WHERE company_id = $1';
    const params: any[] = [companyId];
    let paramIndex = 2;
    
    if (status) {
      whereClause += ` AND status = $${paramIndex++}`;
      params.push(status);
    }
    
    // 월별 필터링 (캘린더용) - 이벤트 기간도 포함
    if (year && month) {
      const monthStart = `${year}-${month}-01`;
      const monthEnd = `${year}-${month}-${new Date(Number(year), Number(month), 0).getDate()}`;
      
      whereClause += ` AND (
        DATE_TRUNC('month', scheduled_at) = $${paramIndex}::date
        OR DATE_TRUNC('month', created_at) = $${paramIndex}::date
        OR (event_start_date <= $${paramIndex + 1}::date AND event_end_date >= $${paramIndex}::date)
      )`;
      params.push(monthStart, monthEnd);
      paramIndex += 2;
    }
    
    const countResult = await query(
      `SELECT COUNT(*) FROM campaigns ${whereClause}`,
      params.slice(0, paramIndex - 2 + (year && month ? 2 : 0))
    );
    const total = parseInt(countResult.rows[0].count);
    
    params.push(Number(limit), offset);
    const result = await query(
      `SELECT 
        id, campaign_name, status, message_type,
        target_count, sent_count, success_count, fail_count,
        scheduled_at, sent_at, created_at,
        TO_CHAR(event_start_date, 'YYYY-MM-DD') as event_start_date,
        TO_CHAR(event_end_date, 'YYYY-MM-DD') as event_end_date,
        message_content
       FROM campaigns
       ${whereClause}
       ORDER BY COALESCE(scheduled_at, created_at) DESC
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

// POST /api/campaigns/test-send - 담당자 사전수신 (테스트 발송)
router.post('/test-send', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: '고객사 권한이 필요합니다.' });
    }

    const { messageContent, messageType } = req.body;
    if (!messageContent) {
      return res.status(400).json({ error: '메시지 내용이 필요합니다.' });
    }

    // 회사 설정에서 담당자 번호 가져오기
    const companyResult = await query(
      'SELECT manager_phone FROM companies WHERE id = $1',
      [companyId]
    );

    if (companyResult.rows.length === 0) {
      return res.status(404).json({ error: '회사 정보를 찾을 수 없습니다.' });
    }

    const managerPhoneRaw = companyResult.rows[0].manager_phone;
    let managerPhones: string[] = [];

    if (managerPhoneRaw) {
      try {
        managerPhones = JSON.parse(managerPhoneRaw);
      } catch {
        // 단일 번호인 경우
        managerPhones = managerPhoneRaw ? [managerPhoneRaw] : [];
      }
    }

    if (managerPhones.length === 0) {
      return res.status(400).json({ error: '등록된 담당자 번호가 없습니다. 설정에서 번호를 추가해주세요.' });
    }

    // 담당자별로 SMSQ_SEND에 INSERT
    const msgType = (messageType || 'SMS') === 'SMS' ? 'S' : 'L';
    let sentCount = 0;

    for (const phone of managerPhones) {
      const cleanPhone = phone.replace(/-/g, '');
      await mysqlQuery(
        `INSERT INTO SMSQ_SEND (
          dest_no, call_back, msg_contents, msg_type, sendreq_time, status_code, rsv1, app_etc1, app_etc2
        ) VALUES (?, ?, ?, ?, NOW(), 100, '1', ?, ?)`,
        [cleanPhone, '18008125', `[테스트] ${messageContent}`, msgType, 'test', companyId]
      );
      sentCount++;
    }

    return res.json({
      message: `담당자 ${sentCount}명에게 테스트 문자를 발송했습니다.`,
      sentCount,
      phones: managerPhones.map(p => {
        const cleaned = p.replace(/\D/g, '');
        return `${cleaned.slice(0, 3)}-****-${cleaned.slice(-4)}`;
      }),
    });
  } catch (error) {
    console.error('담당자 사전수신 에러:', error);
    return res.status(500).json({ error: '테스트 발송에 실패했습니다.' });
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
      eventStartDate,
      eventEndDate,
    } = req.body;

    if (!campaignName || !messageType || !messageContent) {
      return res.status(400).json({ error: '필수 항목을 입력하세요.' });
    }

    // 타겟 인원 계산 (sms_opt_in 조건 포함)
    let targetCount = 0;
    if (targetFilter) {
      const filterQuery = buildFilterQuery(targetFilter, companyId);
      const countResult = await query(
        `SELECT COUNT(*) FROM customers WHERE company_id = $1 AND is_active = true AND sms_opt_in = true ${filterQuery.where}`,
        [companyId, ...filterQuery.params]
      );
      targetCount = parseInt(countResult.rows[0].count);
    }

    const result = await query(
      `INSERT INTO campaigns (
        company_id, campaign_name, message_type, target_filter,
        message_content, scheduled_at, is_ad, target_count, created_by,
        event_start_date, event_end_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        companyId, campaignName, messageType, JSON.stringify(targetFilter),
        messageContent, scheduledAt, isAd ?? false, targetCount, userId,
        eventStartDate || null, eventEndDate || null
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

    // draft 또는 completed 상태에서 재발송 가능
    if (campaign.status === 'sending') {
      return res.status(400).json({ error: '이미 발송 중입니다.' });
    }

    // 타겟 고객 조회
    const targetFilter = campaign.target_filter;
    console.log('targetFilter:', JSON.stringify(targetFilter, null, 2));
    const filterQuery = buildFilterQuery(targetFilter, companyId);
    console.log('filterQuery:', filterQuery);
    
    const customersResult = await query(
      `SELECT id, phone, name FROM customers 
       WHERE company_id = $1 AND is_active = true AND sms_opt_in = true ${filterQuery.where}`,
      [companyId, ...filterQuery.params]
    );

    const customers = customersResult.rows;

    if (customers.length === 0) {
      return res.status(400).json({ error: '발송 대상이 없습니다.' });
    }

    // campaign_runs에 발송 이력 생성
    const runNumberResult = await query(
      `SELECT COALESCE(MAX(run_number), 0) + 1 as next_run 
       FROM campaign_runs WHERE campaign_id = $1`,
      [id]
    );
    const runNumber = runNumberResult.rows[0].next_run;

    // 예약 발송인지 확인
    console.log('scheduled_at:', campaign.scheduled_at);
    const isScheduled = campaign.scheduled_at && new Date(campaign.scheduled_at) > new Date();
    console.log('isScheduled:', isScheduled);

    const runResult = await query(
      `INSERT INTO campaign_runs (
        campaign_id, run_number, target_filter, target_count,
        status, scheduled_at
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [
        id, 
        runNumber, 
        JSON.stringify(targetFilter), 
        customers.length,
        isScheduled ? 'scheduled' : 'sending',
        campaign.scheduled_at
      ]
    );
    const campaignRun = runResult.rows[0];
    
// 즉시 발송일 때만 SMSQ_SEND에 INSERT (MySQL)
if (!isScheduled) {
  for (const customer of customers) {
   await mysqlQuery(
     `INSERT INTO SMSQ_SEND (
       dest_no, call_back, msg_contents, msg_type, sendreq_time, status_code, rsv1, app_etc1, app_etc2
     ) VALUES (?, ?, ?, ?, NOW(), 100, '1', ?, ?)`,
     [customer.phone.replace(/-/g, ''), '18008125', campaign.message_content, campaign.message_type === 'SMS' ? 'S' : 'L', campaignRun.id, companyId]
   );
 }
  
    // campaign_runs 상태 업데이트
    await query(
      `UPDATE campaign_runs SET 
        sent_count = $1, 
        status = 'sending',
        sent_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [customers.length, campaignRun.id]
    );

    // 캠페인 상태 업데이트 (전체 누적)
    await query(
      `UPDATE campaigns SET 
        status = 'sending', 
        sent_count = COALESCE(sent_count, 0) + $1,
        sent_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [customers.length, id]
    );
  } else {
    // 예약 발송: 캠페인/런 상태를 scheduled로
    await query(
      `UPDATE campaigns SET status = 'scheduled', target_count = $1 WHERE id = $2`,
      [customers.length, id]
    );
  }
    return res.json({
      message: `${customers.length}건 발송이 시작되었습니다.`,
      sentCount: customers.length,
      runId: campaignRun.id,
      runNumber: runNumber,
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

  const getValue = (field: any) => {
    if (!field) return null;
    if (typeof field === 'object' && field.value !== undefined) return field.value;
    return field;
  };

  // gender
  const gender = getValue(filter.gender);
  if (gender) {
    where += ` AND gender = $${paramIndex++}`;
    params.push(gender);
  }

  // age (배열: [30, 39])
  const age = getValue(filter.age);
  if (age && Array.isArray(age) && age.length === 2) {
    where += ` AND EXTRACT(YEAR FROM AGE(birth_date)) >= $${paramIndex++}`;
    params.push(age[0]);
    where += ` AND EXTRACT(YEAR FROM AGE(birth_date)) <= $${paramIndex++}`;
    params.push(age[1]);
  }

  // minAge/maxAge (기존 호환)
  const minAge = getValue(filter.minAge) || getValue(filter.min_age);
  if (minAge) {
    where += ` AND EXTRACT(YEAR FROM AGE(birth_date)) >= $${paramIndex++}`;
    params.push(minAge);
  }

  const maxAge = getValue(filter.maxAge) || getValue(filter.max_age);
  if (maxAge) {
    where += ` AND EXTRACT(YEAR FROM AGE(birth_date)) <= $${paramIndex++}`;
    params.push(maxAge);
  }

  // grade
  const grade = getValue(filter.grade);
  if (grade) {
    where += ` AND grade = $${paramIndex++}`;
    params.push(grade);
  }

  // custom_fields 처리 (AI 필터 확장)
  Object.keys(filter).forEach(key => {
    if (key.startsWith('custom_fields.')) {
      const fieldName = key.replace('custom_fields.', '');
      const condition = filter[key];
      const value = getValue(condition);
      const operator = condition?.operator || 'eq';
      
      if (value !== null && value !== undefined) {
        if (operator === 'eq') {
          where += ` AND custom_fields->>'${fieldName}' = $${paramIndex++}`;
          params.push(value);
        } else if (operator === 'gte') {
          where += ` AND (custom_fields->>'${fieldName}')::numeric >= $${paramIndex++}`;
          params.push(value);
        } else if (operator === 'lte') {
          where += ` AND (custom_fields->>'${fieldName}')::numeric <= $${paramIndex++}`;
          params.push(value);
        } else if (operator === 'in' && Array.isArray(value)) {
          where += ` AND custom_fields->>'${fieldName}' = ANY($${paramIndex++})`;
          params.push(value);
        }
      }
    }
  });

  return { where, params };
}

// GET /api/campaigns/:id - 캠페인 상세 조회
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const companyId = req.user?.companyId;
    
    const result = await query(
      `SELECT * FROM campaigns WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '캠페인을 찾을 수 없습니다.' });
    }
    
    // 발송 이력도 함께 조회
    const runs = await query(
      `SELECT * FROM campaign_runs WHERE campaign_id = $1 ORDER BY created_at DESC`,
      [id]
    );
    
    return res.json({
      ...result.rows[0],
      runs: runs.rows
    });
  } catch (error) {
    console.error('캠페인 상세 조회 에러:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});
// POST /api/campaigns/sync-results - MySQL 결과를 PostgreSQL로 동기화
router.post('/sync-results', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }

    // 동기화 대상: sending 상태인 campaign_runs
    const runsResult = await query(
      `SELECT id FROM campaign_runs WHERE status = 'sending'`
    );

    let syncCount = 0;
    for (const run of runsResult.rows) {
      // MySQL에서 해당 run의 결과 조회
      const mysqlResult = await mysqlQuery(
        `SELECT 
          COUNT(CASE WHEN status_code IN (6, 1000, 1800) THEN 1 END) as success_count,
          COUNT(CASE WHEN status_code NOT IN (6, 1000, 1800, 100) THEN 1 END) as fail_count
         FROM SMSQ_SEND WHERE app_etc1 = ?`,
        [run.id]
      );

      const rows = mysqlResult as any[];
      const successCount = rows[0]?.success_count || 0;
      const failCount = rows[0]?.fail_count || 0;

      // PostgreSQL 업데이트
      if (successCount > 0 || failCount > 0) {
        const newStatus = failCount === 0 ? 'completed' : (successCount === 0 ? 'failed' : 'completed');
        
        // campaign_runs 업데이트
        await query(
          `UPDATE campaign_runs SET 
            success_count = $1, 
            fail_count = $2, 
            status = $3
           WHERE id = $4`,
          [successCount, failCount, newStatus, run.id]
        );

        // campaigns 테이블도 업데이트
        const runInfo = await query(`SELECT campaign_id FROM campaign_runs WHERE id = $1`, [run.id]);
        if (runInfo.rows.length > 0) {
          await query(
            `UPDATE campaigns SET 
              success_count = COALESCE(success_count, 0) + $1,
              fail_count = COALESCE(fail_count, 0) + $2,
              status = $3
             WHERE id = $4`,
            [successCount, failCount, newStatus, runInfo.rows[0].campaign_id]
          );
        }

        syncCount++;
      }
    }

    return res.json({ message: `${syncCount}건 동기화 완료` });
  } catch (error) {
    console.error('결과 동기화 에러:', error);
    return res.status(500).json({ error: '동기화 실패' });
  }
});


export default router;
