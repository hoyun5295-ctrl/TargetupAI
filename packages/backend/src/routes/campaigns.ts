import { Router, Request, Response } from 'express';
import { query, mysqlQuery } from '../config/database';
import { authenticate } from '../middlewares/auth';
// 한국시간 문자열 변환 (MySQL datetime 형식)
const toKoreaTimeStr = (date: Date) => {
  return date.toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).replace('T', ' ');
};
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
      // status=scheduled 조회 시 MySQL과 동기화
      if (status === 'scheduled') {
        // 예약 캠페인 중 MySQL에 대기 건이 없는 것들 찾아서 상태 업데이트
        const scheduledCampaigns = await query(
          `SELECT id FROM campaigns WHERE company_id = $1 AND status = 'scheduled'`,
          [companyId]
        );
        
        for (const camp of scheduledCampaigns.rows) {
          const pendingCount = await mysqlQuery(
            `SELECT COUNT(*) as cnt FROM SMSQ_SEND WHERE app_etc1 = ? AND status_code = 100`,
            [camp.id]
          ) as any[];
          
          if (pendingCount[0]?.cnt === 0) {
            // 대기 건이 없으면 발송 완료 처리
            const sentCount = await mysqlQuery(
              `SELECT COUNT(*) as cnt FROM SMSQ_SEND WHERE app_etc1 = ?`,
              [camp.id]
            ) as any[];
            
            const successCount = await mysqlQuery(
              `SELECT COUNT(*) as cnt FROM SMSQ_SEND WHERE app_etc1 = ? AND status_code IN (6, 1000, 1800)`,
              [camp.id]
            ) as any[];
            
            const failCount = await mysqlQuery(
              `SELECT COUNT(*) as cnt FROM SMSQ_SEND WHERE app_etc1 = ? AND status_code NOT IN (6, 100, 1000, 1800)`,
              [camp.id]
            ) as any[];
            
            await query(
              `UPDATE campaigns SET status = 'completed', sent_count = $1, success_count = $2, fail_count = $3, sent_at = NOW(), updated_at = NOW() WHERE id = $4`,
              [sentCount[0]?.cnt || 0, successCount[0]?.cnt || 0, failCount[0]?.cnt || 0, camp.id]
            );
          }
        }
      }
      
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
    
    // count 쿼리용 파라미터 복사
    const countParams = [...params];
    
    const countResult = await query(
      `SELECT COUNT(*) FROM campaigns ${whereClause}`,
      countParams
    );
    const total = parseInt(countResult.rows[0].count);
    
    params.push(Number(limit), offset);
    const result = await query(
      `SELECT 
        id, campaign_name, status, message_type, send_type,
        target_count, sent_count, success_count, fail_count,
        scheduled_at, sent_at, created_at,
        TO_CHAR(event_start_date, 'YYYY-MM-DD') as event_start_date,
        TO_CHAR(event_end_date, 'YYYY-MM-DD') as event_end_date,
        message_content
       FROM campaigns
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

    // 회사 설정에서 담당자 정보 가져오기
    const companyResult = await query(
      'SELECT manager_phone, manager_contacts FROM companies WHERE id = $1',
      [companyId]
    );

    if (companyResult.rows.length === 0) {
      return res.status(404).json({ error: '회사 정보를 찾을 수 없습니다.' });
    }

    // 회신번호 가져오기 (callback_numbers 테이블에서)
    const callbackResult = await query(
      'SELECT phone FROM callback_numbers WHERE company_id = $1 AND is_default = true LIMIT 1',
      [companyId]
    );
    const callbackNumber = callbackResult.rows[0]?.phone?.replace(/-/g, '') || '18008125';

    // 새 형식 (manager_contacts) 우선, 없으면 기존 형식 (manager_phone)
    let managerContacts: {phone: string, name?: string}[] = [];
    
    if (companyResult.rows[0].manager_contacts && companyResult.rows[0].manager_contacts.length > 0) {
      managerContacts = companyResult.rows[0].manager_contacts;
    } else if (companyResult.rows[0].manager_phone) {
      const managerPhoneRaw = companyResult.rows[0].manager_phone;
      try {
        const phones = JSON.parse(managerPhoneRaw);
        managerContacts = phones.map((p: string) => ({ phone: p }));
      } catch {
        managerContacts = [{ phone: managerPhoneRaw }];
      }
    }

    if (managerContacts.length === 0) {
      return res.status(400).json({ error: '등록된 담당자 번호가 없습니다. 설정에서 번호를 추가해주세요.' });
    }

    // 담당자별로 SMSQ_SEND에 INSERT
    const msgType = (messageType || 'SMS') === 'SMS' ? 'S' : 'L';
    let sentCount = 0;

    for (const contact of managerContacts) {
      const cleanPhone = contact.phone.replace(/-/g, '');
      const testMsg = contact.name 
        ? `[테스트] ${contact.name}님, ${messageContent}`
        : `[테스트] ${messageContent}`;
      await mysqlQuery(
        `INSERT INTO SMSQ_SEND (
          dest_no, call_back, msg_contents, msg_type, sendreq_time, status_code, rsv1, app_etc1, app_etc2
        ) VALUES (?, ?, ?, ?, NOW(), 100, '1', ?, ?)`,
        [cleanPhone, callbackNumber, testMsg, msgType, 'test', companyId]
      );
      sentCount++;
    }

    return res.json({
      message: `담당자 ${sentCount}명에게 테스트 문자를 발송했습니다.`,
      sentCount,
      contacts: managerContacts.map(c => ({
        name: c.name || '이름없음',
        phone: `${c.phone.replace(/\D/g, '').slice(0, 3)}-****-${c.phone.replace(/\D/g, '').slice(-4)}`
      })),
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

    // 회사 정보 조회 (회신번호)
    const companyResult = await query(
      'SELECT reject_number FROM companies WHERE id = $1',
      [companyId]
    );
    const callbackNumber = companyResult.rows[0]?.reject_number || '18008125';

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
      `SELECT id, phone, name FROM customers c
       WHERE c.company_id = $1 AND c.is_active = true AND c.sms_opt_in = true ${filterQuery.where}
       AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.company_id = c.company_id AND u.phone = c.phone)`,
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
      [customer.phone.replace(/-/g, ''), callbackNumber.replace(/-/g, ''), campaign.message_content, campaign.message_type === 'SMS' ? 'S' : 'L', campaignRun.id, companyId]
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

// 담당자 테스트 발송 통계
router.get('/test-stats', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: '고객사 권한이 필요합니다.' });
    }

    const { yearMonth } = req.query;
    
    // 월 필터링
    let dateFilter = '';
    if (yearMonth) {
      const year = String(yearMonth).slice(0, 4);
      const month = String(yearMonth).slice(4, 6);
      dateFilter = `AND DATE_FORMAT(sendreq_time, '%Y%m') = '${year}${month}'`;
    }

    // MySQL에서 담당자 테스트 조회 (app_etc1 = 'test', app_etc2 = companyId)
    const testResults = await mysqlQuery(
      `SELECT 
        seqno, dest_no, msg_contents, msg_type, sendreq_time, status_code, mobsend_time
      FROM SMSQ_SEND 
      WHERE app_etc1 = 'test' AND app_etc2 = ?
      ${dateFilter}
      ORDER BY sendreq_time DESC
      LIMIT 100`,
      [companyId]
    ) as any[];

    // 통계 계산
    const stats = {
      total: testResults.length,
      success: testResults.filter((r: any) => [6, 1000, 1800].includes(r.status_code)).length,
      fail: testResults.filter((r: any) => ![6, 1000, 1800, 100].includes(r.status_code)).length,
      pending: testResults.filter((r: any) => r.status_code === 100).length,
      cost: 0,
    };
    
    // 비용 계산 (SMS 27원, LMS 81원 기준)
    testResults.forEach((r: any) => {
      if ([6, 1000, 1800].includes(r.status_code)) {
        stats.cost += r.msg_type === 'S' ? 27 : 81;
      }
    });

    // 리스트 포맷팅
    const list = testResults.map((r: any) => ({
      id: r.seqno,
      phone: r.dest_no, // 담당자 테스트는 마스킹 안함
      content: r.msg_contents,
      type: r.msg_type === 'S' ? 'SMS' : 'LMS',
      sentAt: r.sendreq_time,
      status: [6, 1000, 1800].includes(r.status_code) ? 'success' : r.status_code === 100 ? 'pending' : 'fail',
      testType: 'manager', // 담당자 테스트
    }));

    res.json({
      stats,
      list,
    });
  } catch (error) {
    console.error('테스트 통계 조회 실패:', error);
    res.status(500).json({ error: '테스트 통계 조회 실패' });
  }
});

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

    // 직접발송 동기화 (send_type='direct'인 campaigns)
    const directCampaigns = await query(
      `SELECT id FROM campaigns WHERE send_type = 'direct' AND status IN ('sending', 'completed') AND (success_count IS NULL OR success_count = 0)`
    );

    for (const campaign of directCampaigns.rows) {
      const mysqlResult = await mysqlQuery(
        `SELECT 
          COUNT(*) as total_count,
          COUNT(CASE WHEN status_code IN (6, 1000, 1800) THEN 1 END) as success_count,
          COUNT(CASE WHEN status_code NOT IN (6, 1000, 1800, 100) THEN 1 END) as fail_count
         FROM SMSQ_SEND WHERE app_etc1 = ?`,
        [campaign.id]
      );

      const rows = mysqlResult as any[];
      const successCount = rows[0]?.success_count || 0;
      const failCount = rows[0]?.fail_count || 0;

      if (successCount > 0 || failCount > 0) {
        const newStatus = failCount === 0 ? 'completed' : 'completed';
        
        await query(
          `UPDATE campaigns SET 
            success_count = $1, 
            fail_count = $2, 
            status = $3
           WHERE id = $4`,
          [successCount, failCount, newStatus, campaign.id]
        );
        syncCount++;
      }
    }

    return res.json({ message: `${syncCount}건 동기화 완료` });
  } catch (error) {
    console.error('결과 동기화 에러:', error);
    return res.status(500).json({ error: '동기화 실패' });
  }
});
// 직접발송 API
router.post('/direct-send', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    if (!companyId) {
      return res.status(401).json({ success: false, error: '인증 필요' });
    }

    const { 
      msgType,        // SMS, LMS, MMS
      subject,        // 제목 (LMS/MMS)
      message,        // 메시지 내용 (광고문구 포함된 최종 메시지)
      callback,       // 회신번호
      recipients,     // [{phone, name, extra1, extra2, extra3}]
      adEnabled,      // 광고문구 포함 여부
      scheduled,      // 예약 여부
      scheduledAt,    // 예약 시간
      splitEnabled,   // 분할전송 여부
      splitCount      // 분당 발송 건수
    } = req.body;

    if (!recipients || recipients.length === 0) {
      return res.status(400).json({ success: false, error: '수신자가 없습니다' });
    }

    if (!callback) {
      return res.status(400).json({ success: false, error: '회신번호를 선택해주세요' });
    }

    // 1. 수신거부 필터링
    const phones = recipients.map((r: any) => r.phone.replace(/-/g, ''));
    const unsubResult = await query(
      `SELECT phone FROM unsubscribes WHERE company_id = $1 AND phone = ANY($2)`,
      [companyId, phones]
    );
    const unsubPhones = new Set(unsubResult.rows.map((r: any) => r.phone));
    const filteredRecipients = recipients.filter((r: any) => !unsubPhones.has(r.phone.replace(/-/g, '')));
    
    if (filteredRecipients.length === 0) {
      return res.status(400).json({ success: false, error: '모든 수신자가 수신거부 상태입니다' });
    }
    
    const excludedCount = recipients.length - filteredRecipients.length;

    // 2. 캠페인 레코드 생성 (원본 템플릿도 저장)
    const campaignResult = await query(
      `INSERT INTO campaigns (company_id, campaign_name, message_type, message_content, subject, callback_number, target_count, send_type, status, scheduled_at, message_template, message_subject, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'direct', $8, $9, $10, $11, NOW())
       RETURNING id`,
      [
        companyId,
        `직접발송 ${new Date().toLocaleString('ko-KR')}`,
        msgType,
        message,
        subject || null,
        callback,
        filteredRecipients.length,
        scheduled ? 'scheduled' : 'sending',
        scheduled && scheduledAt ? new Date(scheduledAt) : null,
        message,  // message_template: 원본 템플릿
        subject || null  // message_subject: 원본 제목
      ]
    );
    const campaignId = campaignResult.rows[0].id;

    // 2. MySQL 큐에 메시지 삽입 (Bulk INSERT로 성능 최적화)
    const isScheduledSend = scheduled && scheduledAt;
    const bulkBatchSize = 1000; // 1000건씩 Bulk INSERT
    const bulkData: any[][] = [];
    
    // 데이터 준비
    for (let i = 0; i < filteredRecipients.length; i++) {
      const recipient = filteredRecipients[i];
      // 변수 치환
      let finalMessage = message
        .replace(/%이름%/g, recipient.name || '')
        .replace(/%기타1%/g, recipient.extra1 || '')
        .replace(/%기타2%/g, recipient.extra2 || '')
        .replace(/%기타3%/g, recipient.extra3 || '');

      // 분할전송 시간 계산
      let sendTime: string;
      if (isScheduledSend) {
        const baseTime = new Date(scheduledAt);
        if (splitEnabled && splitCount > 0) {
          const batchIndex = Math.floor(i / splitCount);
          baseTime.setMinutes(baseTime.getMinutes() + batchIndex);
        }
        sendTime = toKoreaTimeStr(baseTime);
      } else if (splitEnabled && splitCount > 0) {
        const baseTime = new Date();
        const batchIndex = Math.floor(i / splitCount);
        baseTime.setMinutes(baseTime.getMinutes() + batchIndex);
        sendTime = toKoreaTimeStr(baseTime);
      } else {
        sendTime = toKoreaTimeStr(new Date());
      }

      const batchIdx = Math.floor(i / bulkBatchSize);
      if (!bulkData[batchIdx]) bulkData[batchIdx] = [];
      
      bulkData[batchIdx].push([
        recipient.phone.replace(/-/g, ''),
        callback.replace(/-/g, ''),
        finalMessage,
        msgType === 'SMS' ? 'S' : msgType === 'LMS' ? 'L' : 'M',
        subject || '',
        sendTime,
        campaignId
      ]);
    }

    // Bulk INSERT 실행 (1000건씩)
    for (const batch of bulkData) {
      const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, 100, \'1\', ?)').join(', ');
      const flatValues = batch.flat();
      
      await mysqlQuery(
        `INSERT INTO SMSQ_SEND (dest_no, call_back, msg_contents, msg_type, title_str, sendreq_time, status_code, rsv1, app_etc1) VALUES ${placeholders}`,
        flatValues
      );
    }

    // 3. 즉시발송이면 상태 업데이트
    if (!scheduled) {
      await query(
        `UPDATE campaigns SET status = 'completed', sent_at = NOW() WHERE id = $1`,
        [campaignId]
      );
    }

    res.json({ 
      success: true, 
      campaignId,
      message: `${filteredRecipients.length}건 발송 ${scheduled ? '예약' : '완료'}${excludedCount > 0 ? ` (수신거부 ${excludedCount}건 제외)` : ''}` 
    });
  } catch (error) {
    console.error('직접발송 실패:', error);
    res.status(500).json({ success: false, error: '발송 실패' });
  }
});

// 예약 취소
router.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const campaignId = req.params.id;

    // 1. 캠페인 확인
    const campaign = await query(
      `SELECT * FROM campaigns WHERE id = $1 AND company_id = $2`,
      [campaignId, companyId]
    );

    if (campaign.rows.length === 0) {
      return res.status(404).json({ success: false, error: '캠페인을 찾을 수 없습니다' });
    }

    if (campaign.rows[0].status !== 'scheduled') {
      return res.status(400).json({ success: false, error: '예약 상태가 아닙니다' });
    }

    // 15분 이내 체크
    const scheduledAt = new Date(campaign.rows[0].scheduled_at);
    const now = new Date();
    const diffMinutes = (scheduledAt.getTime() - now.getTime()) / (1000 * 60);
    if (diffMinutes < 15) {
      return res.status(400).json({ success: false, error: '발송 15분 전에는 취소할 수 없습니다', tooLate: true });
    }

    // 2. MySQL에서 대기 중인 메시지 삭제 (status_code = 100)
    await mysqlQuery(
      `DELETE FROM SMSQ_SEND WHERE app_etc1 = ? AND status_code = 100`,
      [campaignId]
    );

    // 3. PostgreSQL 캠페인 상태 변경
    await query(
      `UPDATE campaigns SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [campaignId]
    );

    res.json({ success: true, message: '예약이 취소되었습니다' });
  } catch (error) {
    console.error('예약 취소 실패:', error);
    res.status(500).json({ success: false, error: '취소 실패' });
  }
});

// 예약 캠페인 수신자 조회
router.get('/:id/recipients', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const campaignId = req.params.id;

    // 캠페인 확인
    const campaign = await query(
      `SELECT * FROM campaigns WHERE id = $1 AND company_id = $2`,
      [campaignId, companyId]
    );

    if (campaign.rows.length === 0) {
      return res.status(404).json({ success: false, error: '캠페인을 찾을 수 없습니다' });
    }

    // MySQL에서 수신자 목록 조회 (status_code = 100: 대기중)
    const recipients = await mysqlQuery(
      `SELECT seqno as idx, dest_no as phone, msg_contents as message, sendreq_time, status_code 
       FROM SMSQ_SEND 
       WHERE app_etc1 = ? AND status_code = 100
       ORDER BY seqno
       LIMIT 1000`,
      [campaignId]
    );

    const totalResult = await mysqlQuery(
      `SELECT COUNT(*) as total FROM SMSQ_SEND WHERE app_etc1 = ? AND status_code = 100`,
      [campaignId]
    ) as any[];

    res.json({ 
      success: true, 
      campaign: campaign.rows[0],
      recipients: recipients,
      total: totalResult[0]?.total || 0
    });
  } catch (error) {
    console.error('수신자 조회 실패:', error);
    res.status(500).json({ success: false, error: '조회 실패' });
  }
});

// 예약 캠페인 개별 수신자 삭제
router.delete('/:id/recipients/:idx', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const campaignId = req.params.id;
    const idx = req.params.idx;

    // 캠페인 확인
    const campaign = await query(
      `SELECT * FROM campaigns WHERE id = $1 AND company_id = $2 AND status = 'scheduled'`,
      [campaignId, companyId]
    );

    if (campaign.rows.length === 0) {
      return res.status(404).json({ success: false, error: '예약 캠페인을 찾을 수 없습니다' });
    }

    // 15분 이내 체크
    const scheduledAt = new Date(campaign.rows[0].scheduled_at);
    const now = new Date();
    const diffMinutes = (scheduledAt.getTime() - now.getTime()) / (1000 * 60);
    if (diffMinutes < 15) {
      return res.status(400).json({ success: false, error: '발송 15분 전에는 수정할 수 없습니다', tooLate: true });
    }

    // MySQL에서 해당 수신자 삭제
    await mysqlQuery(
      `DELETE FROM SMSQ_SEND WHERE app_etc1 = ? AND seqno = ? AND status_code = 100`,
      [campaignId, idx]
    );

    // 캠페인 target_count 업데이트
    const remainingCount = await mysqlQuery(
      `SELECT COUNT(*) as cnt FROM SMSQ_SEND WHERE app_etc1 = ? AND status_code = 100`,
      [campaignId]
    ) as any[];

    await query(
      `UPDATE campaigns SET target_count = $1, updated_at = NOW() WHERE id = $2`,
      [remainingCount[0]?.cnt || 0, campaignId]
    );

    res.json({ success: true, message: '삭제되었습니다', remainingCount: remainingCount[0]?.cnt || 0 });
  } catch (error) {
    console.error('수신자 삭제 실패:', error);
    res.status(500).json({ success: false, error: '삭제 실패' });
  }
});

// 예약 시간 수정
router.put('/:id/reschedule', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const campaignId = req.params.id;
    const { scheduledAt } = req.body;

    // 캠페인 확인
    const campaign = await query(
      `SELECT * FROM campaigns WHERE id = $1 AND company_id = $2 AND status = 'scheduled'`,
      [campaignId, companyId]
    );

    if (campaign.rows.length === 0) {
      return res.status(404).json({ success: false, error: '예약 캠페인을 찾을 수 없습니다' });
    }

    // 15분 이내 체크
    const currentScheduledAt = new Date(campaign.rows[0].scheduled_at);
    const now = new Date();
    const diffMinutes = (currentScheduledAt.getTime() - now.getTime()) / (1000 * 60);
    if (diffMinutes < 15) {
      return res.status(400).json({ success: false, error: '발송 15분 전에는 시간을 변경할 수 없습니다', tooLate: true });
    }

    // 1. 현재 가장 빠른 시간 조회 (분할전송 기준점)
    const minTimeResult = await mysqlQuery(
      `SELECT MIN(sendreq_time) as min_time FROM SMSQ_SEND WHERE app_etc1 = ? AND status_code = 100`,
      [campaignId]
    ) as any[];

    const currentMinTime = minTimeResult[0]?.min_time;
    if (!currentMinTime) {
      return res.status(400).json({ success: false, error: '수신자가 없습니다' });
    }

    // 2. 시간 차이 계산 (초 단위)
    const newTime = new Date(scheduledAt);
    const diffSeconds = Math.round((newTime.getTime() - new Date(currentMinTime).getTime()) / 1000);

    // 3. 모든 건의 시간을 차이만큼 조정 (분할전송 간격 유지)
    await mysqlQuery(
      `UPDATE SMSQ_SEND SET sendreq_time = DATE_ADD(sendreq_time, INTERVAL ? SECOND) WHERE app_etc1 = ? AND status_code = 100`,
      [diffSeconds, campaignId]
    );

    // PostgreSQL 캠페인 업데이트
    await query(
      `UPDATE campaigns SET scheduled_at = $1, updated_at = NOW() WHERE id = $2`,
      [new Date(scheduledAt), campaignId]
    );

    res.json({ success: true, message: '예약 시간이 변경되었습니다' });
  } catch (error) {
    console.error('예약 시간 수정 실패:', error);
    res.status(500).json({ success: false, error: '수정 실패' });
  }
});
// 예약 캠페인 문안 수정
router.put('/:id/message', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const campaignId = req.params.id;
    const { message, subject } = req.body;

    // 캠페인 확인
    const campaign = await query(
      `SELECT * FROM campaigns WHERE id = $1 AND company_id = $2 AND status = 'scheduled'`,
      [campaignId, companyId]
    );

    if (campaign.rows.length === 0) {
      return res.status(404).json({ success: false, error: '예약 캠페인을 찾을 수 없습니다' });
    }

    // 15분 이내 체크
    const currentScheduledAt = new Date(campaign.rows[0].scheduled_at);
    const now = new Date();
    const diffMinutes = (currentScheduledAt.getTime() - now.getTime()) / (1000 * 60);
    if (diffMinutes < 15) {
      return res.status(400).json({ success: false, error: '발송 15분 전에는 수정할 수 없습니다', tooLate: true });
    }

    // 1. MySQL에서 수신자 목록 조회 (전화번호, seqno)
    const recipients = await mysqlQuery(
      `SELECT seqno, dest_no FROM SMSQ_SEND WHERE app_etc1 = ? AND status_code = 100`,
      [campaignId]
    ) as any[];

    if (recipients.length === 0) {
      return res.status(400).json({ success: false, error: '수신자가 없습니다' });
    }

    // 2. 전화번호로 고객 정보 조회 (PostgreSQL)
    const phones = recipients.map((r: any) => r.dest_no);
    const customersResult = await query(
      `SELECT phone, name, grade, region FROM customers WHERE company_id = $1 AND phone = ANY($2)`,
      [companyId, phones]
    );
    
    // 전화번호 → 고객정보 맵
    const customerMap = new Map();
    customersResult.rows.forEach((c: any) => {
      customerMap.set(c.phone, c);
    });

    // 3. 광고 문구 처리
    const adEnabled = campaign.rows[0].message_content?.startsWith('(광고)');
    const msgType = campaign.rows[0].message_type;
    
    // 4. Bulk UPDATE (1000건씩 배치)
    const batchSize = 1000;
    let processedCount = 0;
    
    // Redis에 진행률 저장
    const redis = require('ioredis');
    const redisClient = new redis(process.env.REDIS_URL || 'redis://localhost:6379');
    
    await redisClient.set(`message_edit:${campaignId}:progress`, JSON.stringify({
      total: recipients.length,
      processed: 0,
      percent: 0
    }), 'EX', 600);

    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);
      
      // CASE WHEN 으로 배치 업데이트
      const cases: string[] = [];
      const titleCases: string[] = [];
      const seqnos: number[] = [];
      
      for (const recipient of batch) {
        const customer = customerMap.get(recipient.dest_no) || {};
        
        // 변수 치환
        let finalMessage = message
          .replace(/%이름%/g, customer.name || '고객')
          .replace(/%등급%/g, customer.grade || '')
          .replace(/%지역%/g, customer.region || '');
        
        // 광고 문구 추가
        if (adEnabled) {
          finalMessage = '(광고) ' + finalMessage;
          if (msgType === 'SMS') {
            finalMessage += `\n무료거부${campaign.rows[0].callback_number?.replace(/-/g, '')}`;
          } else {
            finalMessage += `\n무료수신거부 ${campaign.rows[0].callback_number}`;
          }
        }
        
        // SQL escape
        const escapedMessage = finalMessage.replace(/'/g, "''");
        cases.push(`WHEN seqno = ${recipient.seqno} THEN '${escapedMessage}'`);
        
        // 제목 처리 (LMS/MMS)
        if (subject && (msgType === 'LMS' || msgType === 'MMS')) {
          let finalSubject = subject
            .replace(/%이름%/g, customer.name || '고객')
            .replace(/%등급%/g, customer.grade || '')
            .replace(/%지역%/g, customer.region || '');
          const escapedSubject = finalSubject.replace(/'/g, "''");
          titleCases.push(`WHEN seqno = ${recipient.seqno} THEN '${escapedSubject}'`);
        }
        
        seqnos.push(recipient.seqno);
      }
      
      // Bulk UPDATE 실행
      let updateQuery = `
        UPDATE SMSQ_SEND 
        SET msg_contents = CASE ${cases.join(' ')} END
      `;
      
      if (titleCases.length > 0) {
        updateQuery += `, title_str = CASE ${titleCases.join(' ')} END`;
      }
      
      updateQuery += ` WHERE seqno IN (${seqnos.join(',')}) AND status_code = 100`;
      
      await mysqlQuery(updateQuery, []);
      
      processedCount += batch.length;
      
      // 진행률 업데이트
      await redisClient.set(`message_edit:${campaignId}:progress`, JSON.stringify({
        total: recipients.length,
        processed: processedCount,
        percent: Math.round((processedCount / recipients.length) * 100)
      }), 'EX', 600);
    }

    // 5. PostgreSQL 캠페인 템플릿 업데이트
    await query(
      `UPDATE campaigns SET message_template = $1, message_subject = $2, message_content = $3, updated_at = NOW() WHERE id = $4`,
      [message, subject || null, message, campaignId]
    );

    await redisClient.quit();

    res.json({ 
      success: true, 
      message: '문안이 수정되었습니다',
      updatedCount: processedCount 
    });
  } catch (error) {
    console.error('문안 수정 실패:', error);
    res.status(500).json({ success: false, error: '문안 수정 실패' });
  }
});

// 문안 수정 진행률 조회
router.get('/:id/message/progress', async (req: Request, res: Response) => {
  try {
    const campaignId = req.params.id;
    const redis = require('ioredis');
    const redisClient = new redis(process.env.REDIS_URL || 'redis://localhost:6379');
    
    const data = await redisClient.get(`message_edit:${campaignId}:progress`);
    await redisClient.quit();
    
    if (data) {
      return res.json(JSON.parse(data));
    }
    return res.json({ total: 0, processed: 0, percent: 100 });
  } catch (error) {
    return res.json({ total: 0, processed: 0, percent: 100 });
  }
});

export default router;
