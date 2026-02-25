import { Router, Request, Response } from 'express';
import { query, mysqlQuery } from '../config/database';
import { authenticate } from '../middlewares/auth';
import { createHash } from 'crypto';

const router = Router();

// 테스트 타임아웃 (3분)
const TEST_TIMEOUT_MS = 180 * 1000;

// 앱 인증 토큰 (환경변수)
const SPAM_APP_TOKEN = process.env.SPAM_APP_TOKEN || 'spam-hanjul-secret-2026';

// ============================================================
// 헬퍼: 메시지 내용 정규화 (공백/줄바꿈 제거)
// ============================================================
function normalizeContent(s: string): string {
  return (s || '').replace(/[\s\r\n]+/g, '');
}

// ============================================================
// 헬퍼: 메시지 내용 해시 (SHA-256 앞 16자)
// ============================================================
function computeMessageHash(content: string): string {
  const normalized = normalizeContent(content);
  if (!normalized) return '';
  return createHash('sha256').update(normalized, 'utf8').digest('hex').substring(0, 16);
}

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

    // 1) 사용자별 active/pending 테스트 1건 제한
    const activeCheck = await query(
      `SELECT id FROM spam_filter_tests
       WHERE user_id = $1 AND status IN ('pending', 'active')`,
      [userId]
    );
    if (activeCheck.rows.length > 0) {
      return res.status(409).json({
        error: '이미 진행 중인 테스트가 있습니다.',
        testId: activeCheck.rows[0].id
      });
    }

    // 2) 실제 발송될 메시지 내용 결정 + 해시 계산
    const isLmsType = messageType === 'LMS' || messageType === 'MMS';
    const rawActualContent = isLmsType ? (messageContentLms || '') : (messageContentSms || '');
    // ★ #3: 해시는 치환 후 내용으로 계산 (앱이 리포트하는 내용과 일치시킴)
    const SAMPLE_HASH_DATA: Record<string, string> = {
      '이름': '김민수', '포인트': '12,500', '등급': 'VIP', '매장명': '강남점',
      '지역': '서울', '구매금액': '350,000', '구매횟수': '8', '성별': '남성',
      '나이': '35', '평균주문금액': '43,750', '최근구매일': '2026-02-10',
      '최근구매매장': '강남점', '생일': '3월 15일', '결혼기념일': '5월 20일',
    };
    let personalizedForHash = rawActualContent;
    Object.entries(SAMPLE_HASH_DATA).forEach(([k, v]) => { personalizedForHash = personalizedForHash.replace(new RegExp(`%${k}%`, 'g'), v); });
    personalizedForHash = personalizedForHash.replace(/%[^%\s]{1,20}%/g, '');
    const messageHash = computeMessageHash(personalizedForHash);

    // 3) 동일 발신번호 + 동일 메시지 해시로 진행 중인 테스트 차단 (세션 격리)
    if (messageHash) {
      const callbackClean = callbackNumber.replace(/-/g, '');
      const duplicateCheck = await query(
        `SELECT id FROM spam_filter_tests
         WHERE status = 'active'
           AND REPLACE(callback_number, '-', '') = $1
           AND message_hash = $2`,
        [callbackClean, messageHash]
      );
      if (duplicateCheck.rows.length > 0) {
        return res.status(409).json({
          error: '동일한 발신번호와 메시지로 진행 중인 테스트가 있습니다.',
          message: '해당 테스트가 완료된 후 다시 시도해주세요.'
        });
      }
    }

    // 4) 활성 테스트폰 조회
    const devices = await query(
      `SELECT id, carrier, phone FROM spam_filter_devices
       WHERE is_active = true ORDER BY carrier`
    );
    if (devices.rows.length === 0) {
      return res.status(400).json({ error: '등록된 테스트폰이 없습니다. 관리자에게 문의하세요.' });
    }

    // 5) 테스트 건 생성 (message_hash 포함)
    const testResult = await query(
      `INSERT INTO spam_filter_tests
       (company_id, user_id, callback_number, message_content_sms, message_content_lms, message_hash, spam_check_number, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
       RETURNING id, created_at`,
      [companyId, userId, callbackNumber, messageContentSms || null, messageContentLms || null, messageHash || null, null]
    );
    const testId = testResult.rows[0].id;

    // 6) 통신사별 × 타입별 결과 행 생성 + SMS 발송
    const messageTypes: string[] = [];
    if (isLmsType) {
      if (messageContentLms) messageTypes.push('LMS');
    } else {
      if (messageContentSms) messageTypes.push('SMS');
    }

    // ★ #3: 스팸테스트 시 개인화 변수를 샘플 데이터로 치환 (실제 발송과 유사한 메시지로 테스트)
    const SAMPLE_DATA: Record<string, string> = {
      '이름': '김민수', '포인트': '12,500', '등급': 'VIP', '매장명': '강남점',
      '지역': '서울', '구매금액': '350,000', '구매횟수': '8', '성별': '남성',
      '나이': '35', '평균주문금액': '43,750', '최근구매일': '2026-02-10',
      '최근구매매장': '강남점', '생일': '3월 15일', '결혼기념일': '5월 20일',
    };
    const applySampleVars = (text: string): string => {
      let result = text;
      Object.entries(SAMPLE_DATA).forEach(([key, val]) => {
        result = result.replace(new RegExp(`%${key}%`, 'g'), val);
      });
      // 남은 미치환 변수 제거 (커스텀 필드 등)
      result = result.replace(/%[^%\s]{1,20}%/g, '');
      return result;
    };

    for (const device of devices.rows) {
      for (const msgType of messageTypes) {
        // 결과 행 생성
        await query(
          `INSERT INTO spam_filter_test_results (test_id, carrier, message_type, phone)
           VALUES ($1, $2, $3, $4)`,
          [testId, device.carrier, msgType, device.phone]
        );

        // ★ #3: 개인화 변수를 샘플 데이터로 치환하여 발송 (원본은 DB에 보관)
        const rawContent = msgType === 'SMS' ? messageContentSms : messageContentLms;
        const content = applySampleVars(rawContent || '');

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

    // 7) 15초 폴링 — QTmsg 성공인데 앱 미수신이면 즉시 blocked 처리
    const pollInterval = setInterval(async () => {
      try {
        // 아직 active인지 확인
        const activeCheck2 = await query(
          `SELECT id, created_at FROM spam_filter_tests WHERE id = $1 AND status = 'active'`,
          [testId]
        );
        if (activeCheck2.rows.length === 0) {
          clearInterval(pollInterval);
          return;
        }

        // 미수신 건 조회
        const unreceived = await query(
          `SELECT id, phone, message_type FROM spam_filter_test_results
           WHERE test_id = $1 AND received = false AND result IS NULL`,
          [testId]
        );

        if (unreceived.rows.length === 0) {
          clearInterval(pollInterval);
          await query(
            `UPDATE spam_filter_tests SET status = 'completed', completed_at = NOW()
             WHERE id = $1 AND status = 'active'`,
            [testId]
          );
          return;
        }

        // QTmsg 결과 조회 (현재 큐 + 월별 로그 테이블)
        const testTable = getTestSmsTable();
        const now2 = new Date();
        const yyyymm = `${now2.getFullYear()}${String(now2.getMonth() + 1).padStart(2, '0')}`;
        const logTable = `${testTable}_${yyyymm}`;

        let mqRows: any[] = [];
        const mqCurrent = await mysqlQuery(
          `SELECT dest_no, msg_type, status_code FROM ${testTable} WHERE app_etc1 = ?`,
          [testId]
        ) as any[];
        if (mqCurrent && mqCurrent.length > 0) mqRows = mqCurrent;

        try {
          const mqLog = await mysqlQuery(
            `SELECT dest_no, msg_type, status_code FROM ${logTable} WHERE app_etc1 = ?`,
            [testId]
          ) as any[];
          if (mqLog && mqLog.length > 0) mqRows = [...mqRows, ...mqLog];
        } catch (e) { /* 로그 테이블 미존재 시 무시 */ }

        let updatedCount = 0;
        for (const row of unreceived.rows) {
          const mType = row.message_type === 'SMS' ? 'S' : 'L';
          const mqMatch = mqRows.find(
            (m: any) => m.dest_no === row.phone && m.msg_type === mType
          );

          if (!mqMatch) continue; // 아직 QTmsg 결과 없음

          const sc = Number(mqMatch.status_code);
          let result: string | null = null;

          if (sc === 6 || sc === 1000 || sc === 1800) {
            // ★ #1 수정: 이통사 전달 성공이지만 앱 미수신 → 아직 대기 (앱이 감지할 시간 필요)
            // blocked 판정은 타임아웃(3분) 시점에서만 확정
            result = null; // 계속 대기
          } else if (sc === 100 || sc === 104) {
            result = null; // 아직 대기 중
          } else {
            result = 'failed'; // 이통사 실패
          }

          if (result) {
            await query(
              `UPDATE spam_filter_test_results SET result = $1 WHERE id = $2`,
              [result, row.id]
            );
            updatedCount++;
          }
        }

        // 전부 처리됐으면 완료
        if (updatedCount > 0) {
          const remaining = await query(
            `SELECT id FROM spam_filter_test_results
             WHERE test_id = $1 AND received = false AND result IS NULL`,
            [testId]
          );
          if (remaining.rows.length === 0) {
            clearInterval(pollInterval);
            await query(
              `UPDATE spam_filter_tests SET status = 'completed', completed_at = NOW()
               WHERE id = $1 AND status = 'active'`,
              [testId]
            );
            return;
          }
        }

        // 최종 타임아웃 (3분 초과) — ★ #1: QTmsg 상태 기반 blocked/timeout 분류
        const elapsed2 = Date.now() - new Date(activeCheck2.rows[0].created_at).getTime();
        if (elapsed2 > TEST_TIMEOUT_MS) {
          clearInterval(pollInterval);
          const stillUnresolved = await query(
            `SELECT id, phone, message_type FROM spam_filter_test_results
             WHERE test_id = $1 AND received = false AND result IS NULL`,
            [testId]
          );

          // QTmsg 결과 한 번 더 조회
          const testTable2 = getTestSmsTable();
          const now3 = new Date();
          const yyyymm2 = `${now3.getFullYear()}${String(now3.getMonth() + 1).padStart(2, '0')}`;
          const logTable2 = `${testTable2}_${yyyymm2}`;
          let mqFinal: any[] = [];
          const mqF1 = await mysqlQuery(`SELECT dest_no, msg_type, status_code FROM ${testTable2} WHERE app_etc1 = ?`, [testId]) as any[];
          if (mqF1?.length > 0) mqFinal = mqF1;
          try {
            const mqF2 = await mysqlQuery(`SELECT dest_no, msg_type, status_code FROM ${logTable2} WHERE app_etc1 = ?`, [testId]) as any[];
            if (mqF2?.length > 0) mqFinal = [...mqFinal, ...mqF2];
          } catch (e) { /* 로그 테이블 미존재 시 무시 */ }

          for (const row of stillUnresolved.rows) {
            const mType = row.message_type === 'SMS' ? 'S' : 'L';
            const mqMatch = mqFinal.find((m: any) => m.dest_no === row.phone && m.msg_type === mType);
            const sc = mqMatch ? Number(mqMatch.status_code) : 0;

            let finalResult = 'timeout';
            if (sc === 6 || sc === 1000 || sc === 1800) {
              finalResult = 'blocked'; // 이통사 전달 성공 + 앱 미수신 = 스팸 차단
            } else if (sc && sc !== 100 && sc !== 104) {
              finalResult = 'failed'; // 이통사 실패
            }

            await query(
              `UPDATE spam_filter_test_results SET result = $1 WHERE id = $2`,
              [finalResult, row.id]
            );
          }
          await query(
            `UPDATE spam_filter_tests SET status = 'completed', completed_at = NOW()
             WHERE id = $1 AND status = 'active'`,
            [testId]
          );
        }
      } catch (err) {
        console.error('[SpamFilter] 폴링 처리 오류:', err);
      }
    }, 15000);

    // 안전장치: 4분 후 강제 종료
    setTimeout(() => { clearInterval(pollInterval); }, TEST_TIMEOUT_MS + 60000);

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

    // 3) 발신번호로 active 테스트 후보 조회
    const senderClean = senderNumber.replace(/\D/g, '');
    const candidates = await query(
      `SELECT id, message_content_sms, message_content_lms, message_hash FROM spam_filter_tests
       WHERE status = 'active'
         AND REPLACE(callback_number, '-', '') = $1
       ORDER BY created_at DESC`,
      [senderClean]
    );
    if (candidates.rows.length === 0) {
      return res.json({ success: true, matched: false, message: '매칭되는 테스트가 없습니다.' });
    }

    let testId: string | null = null;

    if (candidates.rows.length === 1) {
      // 단일 건 → 바로 매칭
      testId = candidates.rows[0].id;
    } else {
      // 복수 건 → 1차: 메시지 해시 매칭
      const reportHash = computeMessageHash(messageContent || '');
      if (reportHash) {
        const hashMatched = candidates.rows.find((row: any) => row.message_hash === reportHash);
        if (hashMatched) {
          testId = hashMatched.id;
        }
      }

      // 2차: 정규화 문자열 매칭
      if (!testId) {
        const msgNorm = normalizeContent(messageContent || '');
        const normMatched = candidates.rows.find((row: any) =>
          normalizeContent(row.message_content_sms) === msgNorm ||
          normalizeContent(row.message_content_lms) === msgNorm
        );
        if (normMatched) {
          testId = normMatched.id;
        }
      }

      // ★ fallback 제거 — 매칭 실패 시 잘못된 테스트에 배정하지 않음
      if (!testId) {
        console.log(`[SpamFilter] 복수 active 테스트 중 매칭 실패 — sender=${senderClean}, 무시 처리`);
        return res.json({ success: true, matched: false, message: '메시지 내용 매칭 실패 (무시)' });
      }
    }

    // 4) SMS/LMS 타입: 앱이 보내는 messageType 직접 사용
    const detectedType = (messageType === 'LMS') ? 'LMS' : 'SMS';

    // 5) 결과 업데이트
    const updateResult = await query(
      `UPDATE spam_filter_test_results
       SET received = true, received_at = NOW(), result = 'received'
       WHERE test_id = $1 AND carrier = $2 AND message_type = $3 AND received = false
       RETURNING id`,
      [testId, device.carrier, detectedType]
    );

    // 6) 모든 결과 수신 완료 체크 → 즉시 completed 전환
    const pendingCheck = await query(
      `SELECT COUNT(*) as cnt FROM spam_filter_test_results
       WHERE test_id = $1 AND received = false AND result IS NULL`,
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
// [GET] /api/spam-filter/active-test — 진행 중인 테스트 조회 (모달 복원용)
// ============================================================
router.get('/active-test', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;

    // 사용자별 active 테스트 조회
    const activeTest = await query(
      `SELECT t.id, t.callback_number, t.message_content_sms, t.message_content_lms,
              t.status, t.created_at
       FROM spam_filter_tests t
       WHERE t.user_id = $1 AND t.status = 'active'
       ORDER BY t.created_at DESC LIMIT 1`,
      [userId]
    );

    if (activeTest.rows.length === 0) {
      return res.json({ active: false });
    }

    const test = activeTest.rows[0];

    // 타임아웃 체크
    const elapsed = Date.now() - new Date(test.created_at).getTime();
    if (elapsed > TEST_TIMEOUT_MS) {
      // 이미 만료 → 완료 처리 (미판정 건 timeout 처리)
      const stillUnresolved = await query(
        `SELECT id FROM spam_filter_test_results
         WHERE test_id = $1 AND received = false AND result IS NULL`,
        [test.id]
      );
      for (const row of stillUnresolved.rows) {
        await query(
          `UPDATE spam_filter_test_results SET result = 'timeout' WHERE id = $1`,
          [row.id]
        );
      }
      await query(
        `UPDATE spam_filter_tests SET status = 'completed', completed_at = NOW()
         WHERE id = $1 AND status = 'active'`,
        [test.id]
      );
      return res.json({ active: false });
    }

    // 결과 조회
    const results = await query(
      `SELECT carrier, message_type, received, received_at, result
       FROM spam_filter_test_results
       WHERE test_id = $1
       ORDER BY carrier, message_type`,
      [test.id]
    );

    const remainingMs = TEST_TIMEOUT_MS - elapsed;

    res.json({
      active: true,
      testId: test.id,
      createdAt: test.created_at,
      remainingSeconds: Math.ceil(remainingMs / 1000),
      results: results.rows
    });

  } catch (err) {
    console.error('[SpamFilter] active-test 조회 오류:', err);
    res.status(500).json({ error: '조회 중 오류가 발생했습니다.' });
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
      `SELECT carrier, message_type, received, received_at, result
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
        // 미판정 건 timeout 처리
        const stillUnresolved = await query(
          `SELECT id FROM spam_filter_test_results
           WHERE test_id = $1 AND received = false AND result IS NULL`,
          [testId]
        );
        for (const row of stillUnresolved.rows) {
          await query(
            `UPDATE spam_filter_test_results SET result = 'timeout' WHERE id = $1`,
            [row.id]
          );
        }
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
