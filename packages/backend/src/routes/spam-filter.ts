import { Router, Request, Response } from 'express';
import { query, mysqlQuery } from '../config/database';
import { authenticate } from '../middlewares/auth';

const router = Router();

// ============================================================
// 스팸필터 테스트 전용 080 번호 (하이픈 없이 저장)
// ============================================================
const SPAM_CHECK_NUMBER = '08071906700';
const SPAM_CHECK_NUMBER_FORMATTED = '080-719-6700'; // LMS용

// 테스트 타임아웃 (3분)
const TEST_TIMEOUT_MS = 60 * 1000;

// 쿨다운 (60초)
const COOLDOWN_SECONDS = 60;

// 앱 인증 토큰 (환경변수)
const SPAM_APP_TOKEN = process.env.SPAM_APP_TOKEN || 'spam-hanjul-secret-2026';

// ============================================================
// [POST] /api/spam-filter/test — 스팸필터 테스트 요청
// ============================================================
router.post('/test', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const companyId = (req as any).user.companyId;
    const { callbackNumber, messageContentSms, messageContentLms, messageType } = req.body;

    if (!callbackNumber) {
      return res.status(400).json({ error: '발신번호를 입력해주세요.' });
    }
    if (!messageContentSms && !messageContentLms) {
      return res.status(400).json({ error: '테스트할 메시지를 입력해주세요.' });
    }

    // 1) 쿨다운 체크 (회사 기준 60초)
    const cooldownCheck = await query(
      `SELECT created_at FROM spam_filter_tests
       WHERE company_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [companyId]
    );
    if (cooldownCheck.rows.length > 0) {
      const lastTest = new Date(cooldownCheck.rows[0].created_at);
      const elapsed = Date.now() - lastTest.getTime();
      if (elapsed < COOLDOWN_SECONDS * 1000) {
        const remaining = Math.ceil((COOLDOWN_SECONDS * 1000 - elapsed) / 1000);
        return res.status(429).json({
          error: `테스트 간격 제한`,
          message: `${remaining}초 후에 다시 시도해주세요.`,
          remainingSeconds: remaining
        });
      }
    }

    // 2) 회사당 active/pending 테스트 1건 제한
    const activeCheck = await query(
      `SELECT id FROM spam_filter_tests
       WHERE company_id = $1 AND status IN ('pending', 'active')`,
      [companyId]
    );
    if (activeCheck.rows.length > 0) {
      return res.status(409).json({
        error: '이미 진행 중인 테스트가 있습니다.',
        testId: activeCheck.rows[0].id
      });
    }

    // 3) 활성 테스트폰 조회
    const devices = await query(
      `SELECT id, carrier, phone FROM spam_filter_devices
       WHERE is_active = true ORDER BY carrier`
    );
    if (devices.rows.length === 0) {
      return res.status(400).json({ error: '등록된 테스트폰이 없습니다. 관리자에게 문의하세요.' });
    }

    // 4) 테스트 건 생성
    const testResult = await query(
      `INSERT INTO spam_filter_tests
       (company_id, user_id, callback_number, message_content_sms, message_content_lms, spam_check_number, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')
       RETURNING id, created_at`,
      [companyId, userId, callbackNumber, messageContentSms || null, messageContentLms || null, SPAM_CHECK_NUMBER]
    );
    const testId = testResult.rows[0].id;

    // 5) 통신사별 × 타입별 결과 행 생성 + SMS 발송
    const messageTypes: string[] = [];
    if (messageType === 'LMS' || messageType === 'MMS') {
      if (messageContentLms) messageTypes.push('LMS');
    } else {
      if (messageContentSms) messageTypes.push('SMS');
    }

    for (const device of devices.rows) {
      for (const msgType of messageTypes) {
        // 결과 행 생성
        await query(
          `INSERT INTO spam_filter_test_results (test_id, carrier, message_type, phone)
           VALUES ($1, $2, $3, $4)`,
          [testId, device.carrier, msgType, device.phone]
        );

        // 메시지 내용에서 080 번호 치환
        let content = msgType === 'SMS' ? messageContentSms : messageContentLms;
        content = replaceOptOutNumber(content, msgType);

        // QTmsg 테스트 라인으로 발송
        await insertSmsQueue(
          device.phone,
          callbackNumber,
          content,
          msgType,
          testId
        );
      }
    }

    // 6) 타임아웃 스케줄 (3분 후 미수신 건 timeout 처리)
    setTimeout(async () => {
      try {
        await query(
          `UPDATE spam_filter_tests SET status = 'completed', completed_at = NOW()
           WHERE id = $1 AND status = 'active'`,
          [testId]
        );
      } catch (err) {
        console.error('[SpamFilter] 타임아웃 처리 오류:', err);
      }
    }, TEST_TIMEOUT_MS);

    const totalCount = devices.rows.length * messageTypes.length;
    res.json({
      success: true,
      testId,
      totalCount,
      message: `${devices.rows.length}대 테스트폰에 ${messageTypes.join('/')} 발송 완료 (${totalCount}건)`,
      timeoutSeconds: TEST_TIMEOUT_MS / 1000
    });

  } catch (err) {
    console.error('[SpamFilter] 테스트 요청 오류:', err);
    res.status(500).json({ error: '테스트 요청 중 오류가 발생했습니다.' });
  }
});

// ============================================================
// [POST] /api/spam-filter/report — 앱 수신 리포트
// ============================================================
router.post('/report', async (req: Request, res: Response) => {
  try {
    const authToken = req.headers['x-spam-token'] as string;
    const { deviceId, senderNumber, messageContent, messageType } = req.body;

    // 1) 앱 토큰 인증
    if (authToken !== SPAM_APP_TOKEN) {
      return res.status(401).json({ error: '인증 실패' });
    }
    if (!deviceId || !senderNumber) {
      return res.status(400).json({ error: '필수 항목 누락' });
    }

    // 2) 디바이스 확인 + last_seen 업데이트
    const deviceResult = await query(
      `UPDATE spam_filter_devices SET last_seen_at = NOW()
       WHERE device_id = $1 AND is_active = true
       RETURNING id, carrier, phone`,
      [deviceId]
    );
    if (deviceResult.rows.length === 0) {
      return res.status(404).json({ error: '등록되지 않은 디바이스' });
    }
    const device = deviceResult.rows[0];

    // 3) 080 번호 포함 여부 확인 (스팸필터 테스트 건인지 판별)
    const contentDigits = (messageContent || '').replace(/\D/g, '');
    if (!contentDigits.includes(SPAM_CHECK_NUMBER)) {
      // 우리 전용 080 번호가 아니면 → 일반 문자, 무시
      return res.json({ success: true, matched: false, message: '스팸필터 테스트 건이 아닙니다.' });
    }

    // 4) 발신번호로 active 테스트 매칭
    const senderClean = senderNumber.replace(/\D/g, '');
    const testResult = await query(
      `SELECT id FROM spam_filter_tests
       WHERE status = 'active'
         AND REPLACE(callback_number, '-', '') = $1
       ORDER BY created_at DESC LIMIT 1`,
      [senderClean]
    );
    if (testResult.rows.length === 0) {
      return res.json({ success: true, matched: false, message: '매칭되는 테스트가 없습니다.' });
    }
    const testId = testResult.rows[0].id;

    // 5) SMS/LMS 판별 (하이픈 유무로 자동 구분)
    const detectedType = (messageContent || '').includes(SPAM_CHECK_NUMBER_FORMATTED) ? 'LMS' : 'SMS';

    // 6) 결과 업데이트
    const updateResult = await query(
      `UPDATE spam_filter_test_results
       SET received = true, received_at = NOW()
       WHERE test_id = $1 AND carrier = $2 AND message_type = $3 AND received = false
       RETURNING id`,
      [testId, device.carrier, detectedType]
    );

    // 7) 모든 결과 수신 완료 체크
    const pendingCheck = await query(
      `SELECT COUNT(*) as cnt FROM spam_filter_test_results
       WHERE test_id = $1 AND received = false`,
      [testId]
    );
    if (parseInt(pendingCheck.rows[0].cnt) === 0) {
      await query(
        `UPDATE spam_filter_tests SET status = 'completed', completed_at = NOW()
         WHERE id = $1`,
        [testId]
      );
    }

    res.json({
      success: true,
      matched: true,
      testId,
      carrier: device.carrier,
      messageType: detectedType,
      updated: (updateResult.rowCount ?? 0) > 0
    });

  } catch (err) {
    console.error('[SpamFilter] 리포트 처리 오류:', err);
    res.status(500).json({ error: '리포트 처리 중 오류가 발생했습니다.' });
  }
});

// ============================================================
// [GET] /api/spam-filter/tests — 내 테스트 이력 조회
// ============================================================
router.get('/tests', authenticate, async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user.companyId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;

    const countResult = await query(
      `SELECT COUNT(*) FROM spam_filter_tests WHERE company_id = $1`,
      [companyId]
    );

    const tests = await query(
      `SELECT t.id, t.callback_number, t.status, t.created_at, t.completed_at,
              u.name as user_name,
              (SELECT COUNT(*) FROM spam_filter_test_results r WHERE r.test_id = t.id AND r.received = true) as received_count,
              (SELECT COUNT(*) FROM spam_filter_test_results r WHERE r.test_id = t.id) as total_count
       FROM spam_filter_tests t
       JOIN users u ON u.id = t.user_id
       WHERE t.company_id = $1
       ORDER BY t.created_at DESC
       LIMIT $2 OFFSET $3`,
      [companyId, limit, offset]
    );

    res.json({
      tests: tests.rows,
      total: parseInt(countResult.rows[0].count),
      page,
      totalPages: Math.ceil(parseInt(countResult.rows[0].count) / limit)
    });

  } catch (err) {
    console.error('[SpamFilter] 이력 조회 오류:', err);
    res.status(500).json({ error: '조회 중 오류가 발생했습니다.' });
  }
});

// ============================================================
// [GET] /api/spam-filter/tests/:id — 테스트 상세 결과
// ============================================================
router.get('/tests/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user.companyId;
    const testId = req.params.id;

    const test = await query(
      `SELECT t.*, u.name as user_name
       FROM spam_filter_tests t
       JOIN users u ON u.id = t.user_id
       WHERE t.id = $1 AND t.company_id = $2`,
      [testId, companyId]
    );
    if (test.rows.length === 0) {
      return res.status(404).json({ error: '테스트를 찾을 수 없습니다.' });
    }

    const results = await query(
      `SELECT carrier, message_type, received, received_at
       FROM spam_filter_test_results
       WHERE test_id = $1
       ORDER BY carrier, message_type`,
      [testId]
    );

    // 타임아웃 체크 (active인데 3분 초과 시 자동 완료 처리)
    const testData = test.rows[0];
    if (testData.status === 'active') {
      const elapsed = Date.now() - new Date(testData.created_at).getTime();
      if (elapsed > TEST_TIMEOUT_MS) {
        await query(
          `UPDATE spam_filter_tests SET status = 'completed', completed_at = NOW()
           WHERE id = $1`,
          [testId]
        );
        testData.status = 'completed';
      }
    }

    res.json({
      test: testData,
      results: results.rows
    });

  } catch (err) {
    console.error('[SpamFilter] 상세 조회 오류:', err);
    res.status(500).json({ error: '조회 중 오류가 발생했습니다.' });
  }
});

// ============================================================
// [POST] /api/spam-filter/devices — 테스트폰 디바이스 등록 (앱)
// ============================================================
router.post('/devices', async (req: Request, res: Response) => {
  try {
    const authToken = req.headers['x-spam-token'] as string;
    if (authToken !== SPAM_APP_TOKEN) {
      return res.status(401).json({ error: '인증 실패' });
    }

    const { deviceId, carrier, phone, deviceName } = req.body;
    if (!deviceId || !carrier || !phone) {
      return res.status(400).json({ error: '필수 항목 누락 (deviceId, carrier, phone)' });
    }
    if (!['SKT', 'KT', 'LGU'].includes(carrier)) {
      return res.status(400).json({ error: '통신사는 SKT, KT, LGU 중 하나여야 합니다.' });
    }

    // UPSERT
    const result = await query(
      `INSERT INTO spam_filter_devices (device_id, carrier, phone, device_name, last_seen_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (device_id) DO UPDATE SET
         carrier = $2, phone = $3, device_name = $4,
         is_active = true, last_seen_at = NOW()
       RETURNING id, device_id, carrier, phone`,
      [deviceId, carrier, phone, deviceName || null]
    );

    res.json({ success: true, device: result.rows[0] });

  } catch (err) {
    console.error('[SpamFilter] 디바이스 등록 오류:', err);
    res.status(500).json({ error: '디바이스 등록 중 오류가 발생했습니다.' });
  }
});

// ============================================================
// [GET] /api/spam-filter/admin/devices — 슈퍼관리자: 디바이스 목록
// ============================================================
router.get('/admin/devices', authenticate, async (req: Request, res: Response) => {
  try {
    if ((req as any).user.role !== 'super_admin') {
      return res.status(403).json({ error: '권한이 없습니다.' });
    }

    const devices = await query(
      `SELECT * FROM spam_filter_devices ORDER BY carrier, created_at`
    );

    res.json({ devices: devices.rows });

  } catch (err) {
    console.error('[SpamFilter] 디바이스 목록 오류:', err);
    res.status(500).json({ error: '조회 중 오류가 발생했습니다.' });
  }
});

// ============================================================
// 헬퍼: 080 수신거부 번호 치환
// ============================================================
function replaceOptOutNumber(content: string, messageType: string): string {
  if (!content) return content;

  // 기존 080 번호 패턴 (하이픈 있는 형태: 080-XXX-XXXX)
  const formatted080 = /080-\d{3,4}-\d{4}/g;
  // 기존 080 번호 패턴 (하이픈 없는 형태: 080XXXXXXX)
  const unformatted080 = /080\d{7,8}/g;

  if (messageType === 'LMS') {
    // LMS: 하이픈 있는 형태로 치환
    content = content.replace(formatted080, SPAM_CHECK_NUMBER_FORMATTED);
    content = content.replace(unformatted080, SPAM_CHECK_NUMBER_FORMATTED);
  } else {
    // SMS: 하이픈 없는 형태로 치환
    content = content.replace(unformatted080, SPAM_CHECK_NUMBER);
    content = content.replace(formatted080, SPAM_CHECK_NUMBER);
  }

  return content;
}

// ============================================================
// 헬퍼: QTmsg 테스트 라인에 SMS/LMS INSERT
// ============================================================
async function insertSmsQueue(
  destNo: string,
  callBack: string,
  content: string,
  msgType: string,
  testId: string
): Promise<void> {
  const testTable = getTestSmsTable();
  const mType = msgType === 'SMS' ? 'S' : 'L';

  await mysqlQuery(
    `INSERT INTO ${testTable} (
      dest_no, call_back, msg_contents, msg_type, sendreq_time, status_code, rsv1, app_etc1
    ) VALUES (?, ?, ?, ?, NOW(), 100, '1', ?)`,
    [destNo, callBack, content, mType, testId]
  );
}

// 테스트 전용 SMS 테이블 (환경변수 기반)
function getTestSmsTable(): string {
  const allTables = (process.env.SMS_TABLES || 'SMSQ_SEND').split(',').map(t => t.trim());
  return allTables.find(t => t === 'SMSQ_SEND_10') || allTables[allTables.length - 1];
}

export default router;
