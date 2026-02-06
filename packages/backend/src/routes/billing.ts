import { Router, Request, Response } from 'express';
import { authenticate, requireSuperAdmin } from '../middlewares/auth';
import pool, { mysqlQuery } from '../config/database';

const router = Router();

// ============================================================
//  정산(Billing) API — 슈퍼관리자 전용
//  마운트: /api/admin/billing
// ============================================================

// ★ 전체 라우트에 인증 + 슈퍼관리자 권한 적용
router.use(authenticate, requireSuperAdmin);

// ============================================================
//  정산(Billing) CRUD
// ============================================================

// POST /generate - 정산 데이터 생성 (월별 집계)
router.post('/generate', async (req: Request, res: Response) => {
  try {
    const { company_id, user_id, billing_start, billing_end } = req.body;
    const adminId = (req as any).user?.userId;

    if (!company_id || !billing_start || !billing_end) {
      return res.status(400).json({ error: '필수: company_id, billing_start, billing_end' });
    }

    if (billing_start > billing_end) {
      return res.status(400).json({ error: '시작일이 종료일보다 늦을 수 없습니다' });
    }

    const startDate = new Date(billing_start);
    const billing_year = startDate.getFullYear();
    const billing_month = startDate.getMonth() + 1;

    // 1) 중복 체크 (기간 겹침)
    const existCheck = await pool.query(
      `SELECT id, status, billing_start, billing_end FROM billings
       WHERE company_id = $1
         AND COALESCE(user_id, '00000000-0000-0000-0000-000000000000') = COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000')
         AND billing_start <= $4::date AND billing_end >= $3::date`,
      [company_id, user_id || null, billing_start, billing_end]
    );
    if (existCheck.rows.length > 0) {
      const ex = existCheck.rows[0];
      return res.status(409).json({
        error: `해당 기간과 겹치는 정산이 이미 존재합니다 (${String(ex.billing_start).slice(0,10)} ~ ${String(ex.billing_end).slice(0,10)})`,
        existing_id: ex.id,
        existing_status: ex.status
      });
    }

    // 2) 고객사 단가 조회 (스냅샷)
    const companyResult = await pool.query(
      `SELECT cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao,
              cost_per_test_sms, cost_per_test_lms
       FROM companies WHERE id = $1`,
      [company_id]
    );
    if (companyResult.rows.length === 0) {
      return res.status(404).json({ error: '고객사를 찾을 수 없습니다' });
    }
    const co = companyResult.rows[0];
    const prices: Record<string, number> = {
      SMS: Number(co.cost_per_sms) || 0,
      LMS: Number(co.cost_per_lms) || 0,
      MMS: Number(co.cost_per_mms) || 0,
      KAKAO: Number(co.cost_per_kakao) || 0,
      TEST_SMS: Number(co.cost_per_test_sms) || Number(co.cost_per_sms) || 0,
      TEST_LMS: Number(co.cost_per_test_lms) || Number(co.cost_per_lms) || 0,
    };

    // 3) campaign_runs 조회
    let runsSql = `
      SELECT cr.id as run_id
      FROM campaign_runs cr
      JOIN campaigns c ON c.id = cr.campaign_id
      WHERE c.company_id = $1
        AND cr.sent_at >= $2::date
        AND cr.sent_at < ($3::date + interval '1 day')
        AND cr.status = 'completed'`;
    const runsParams: any[] = [company_id, billing_start, billing_end];

    if (user_id) {
      runsParams.push(user_id);
      runsSql += ` AND c.user_id = $${runsParams.length}`;
    }
    
    const runsResult = await pool.query(runsSql, runsParams);
    const runIds = runsResult.rows.map((r: any) => r.run_id);

    // 4) MySQL 일자별 집계 구조
    interface DayCounts { total: number; success: number; fail: number; pending: number }
    const dayData: Record<string, Record<string, DayCounts>> = {};

    // 5) 일반발송 집계
    if (runIds.length > 0) {
      const ph = runIds.map(() => '?').join(',');
      const rows = await mysqlQuery(
        `SELECT msg_type, DATE(sendreq_time) as send_date,
                COUNT(*) as total_count,
                SUM(CASE WHEN status_code IN (6, 1000, 1800) THEN 1 ELSE 0 END) as success_count,
                SUM(CASE WHEN status_code NOT IN (6, 100, 1000, 1800) AND status_code >= 200 THEN 1 ELSE 0 END) as fail_count,
                SUM(CASE WHEN status_code = 100 THEN 1 ELSE 0 END) as pending_count
         FROM SMSQ_SEND
         WHERE app_etc1 IN (${ph})
         GROUP BY msg_type, DATE(sendreq_time)`,
        runIds
      );

      (rows as any[]).forEach((row: any) => {
        const d = row.send_date instanceof Date
          ? row.send_date.toISOString().slice(0, 10)
          : String(row.send_date).slice(0, 10);
        const t = row.msg_type === 'S' ? 'SMS' : row.msg_type === 'L' ? 'LMS' : row.msg_type;
        if (!dayData[d]) dayData[d] = {};
        if (!dayData[d][t]) dayData[d][t] = { total: 0, success: 0, fail: 0, pending: 0 };
        dayData[d][t].total += Number(row.total_count);
        dayData[d][t].success += Number(row.success_count);
        dayData[d][t].fail += Number(row.fail_count);
        dayData[d][t].pending += Number(row.pending_count);
      });
    }

    // 6) 테스트발송 집계 (고객사 전체일 때만 — 사용자별은 추적 불가)
    if (!user_id) {
      const testRows = await mysqlQuery(
        `SELECT msg_type, DATE(sendreq_time) as send_date,
                COUNT(*) as total_count,
                SUM(CASE WHEN status_code IN (6, 1000, 1800) THEN 1 ELSE 0 END) as success_count,
                SUM(CASE WHEN status_code NOT IN (6, 100, 1000, 1800) AND status_code >= 200 THEN 1 ELSE 0 END) as fail_count,
                SUM(CASE WHEN status_code = 100 THEN 1 ELSE 0 END) as pending_count
         FROM SMSQ_SEND
         WHERE app_etc1 = 'test' AND app_etc2 = ?
           AND sendreq_time >= ? AND sendreq_time < DATE_ADD(?, INTERVAL 1 DAY)
         GROUP BY msg_type, DATE(sendreq_time)`,
         [company_id, billing_start, billing_end]
      );

      (testRows as any[]).forEach((row: any) => {
        const d = row.send_date instanceof Date
          ? row.send_date.toISOString().slice(0, 10)
          : String(row.send_date).slice(0, 10);
        const t = row.msg_type === 'S' ? 'TEST_SMS' : 'TEST_LMS';
        if (!dayData[d]) dayData[d] = {};
        if (!dayData[d][t]) dayData[d][t] = { total: 0, success: 0, fail: 0, pending: 0 };
        dayData[d][t].total += Number(row.total_count);
        dayData[d][t].success += Number(row.success_count);
        dayData[d][t].fail += Number(row.fail_count);
        dayData[d][t].pending += Number(row.pending_count);
      });
    }

    // 7) 합산
    let totalSms = 0, totalLms = 0, totalMms = 0, totalKakao = 0, totalTestSms = 0, totalTestLms = 0;
    Object.values(dayData).forEach(types => {
      if (types.SMS) totalSms += types.SMS.success;
      if (types.LMS) totalLms += types.LMS.success;
      if (types.MMS) totalMms += types.MMS.success;
      if (types.KAKAO) totalKakao += types.KAKAO.success;
      if (types.TEST_SMS) totalTestSms += types.TEST_SMS.success;
      if (types.TEST_LMS) totalTestLms += types.TEST_LMS.success;
    });

    const subtotal =
      (totalSms * prices.SMS) + (totalLms * prices.LMS) +
      (totalMms * prices.MMS) + (totalKakao * prices.KAKAO) +
      (totalTestSms * prices.TEST_SMS) + (totalTestLms * prices.TEST_LMS);
    const vat = Math.round(subtotal * 0.1);
    const totalAmount = subtotal + vat;

    // 8) billings INSERT
    const billingResult = await pool.query(
      `INSERT INTO billings (
        company_id, user_id, billing_year, billing_month, billing_start, billing_end,
        sms_success, lms_success, mms_success, kakao_success,
        sms_unit_price, lms_unit_price, mms_unit_price, kakao_unit_price,
        test_sms_count, test_lms_count, test_sms_unit_price, test_lms_unit_price,
        subtotal, vat, total_amount, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
      RETURNING *`,
      [
        company_id, user_id || null, billing_year, billing_month, billing_start, billing_end,
        totalSms, totalLms, totalMms, totalKakao,
        prices.SMS, prices.LMS, prices.MMS, prices.KAKAO,
        totalTestSms, totalTestLms, prices.TEST_SMS, prices.TEST_LMS,
        subtotal, vat, totalAmount, adminId
      ]
    );
    const billing = billingResult.rows[0];

    // 9) billing_items INSERT (일자별 상세)
    const itemValues: any[][] = [];
    Object.entries(dayData).forEach(([dateStr, types]) => {
      Object.entries(types).forEach(([msgType, counts]) => {
        const up = prices[msgType] || 0;
        itemValues.push([
          billing.id, company_id, user_id || null, null,
          dateStr, msgType,
          counts.total, counts.success, counts.fail, counts.pending,
          up, counts.success * up
        ]);
      });
    });

    if (itemValues.length > 0) {
      const ph = itemValues.map((_, i) => {
        const b = i * 12;
        return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12})`;
      }).join(',');

      await pool.query(
        `INSERT INTO billing_items (
          billing_id, company_id, user_id, agent_id,
          item_date, message_type,
          total_count, success_count, fail_count, pending_count,
          unit_price, amount
        ) VALUES ${ph}`,
        itemValues.flat()
      );
    }

    return res.json({
      billing,
      items_count: itemValues.length,
      summary: { totalSms, totalLms, totalMms, totalKakao, totalTestSms, totalTestLms, subtotal, vat, totalAmount }
    });
  } catch (error: any) {
    console.error('정산 생성 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET /list - 정산 목록
router.get('/list', async (req: Request, res: Response) => {
  try {
    const { company_id, year, status } = req.query;
    let sql = `SELECT b.*, c.company_name, u.name as user_name
               FROM billings b
               JOIN companies c ON c.id = b.company_id
               LEFT JOIN users u ON u.id = b.user_id
               WHERE 1=1`;
    const params: any[] = [];

    if (company_id) { params.push(company_id); sql += ` AND b.company_id = $${params.length}`; }
    if (year) { params.push(year); sql += ` AND b.billing_year = $${params.length}`; }
    if (status) { params.push(status); sql += ` AND b.status = $${params.length}`; }
    sql += ' ORDER BY b.billing_year DESC, b.billing_month DESC, b.created_at DESC';

    const result = await pool.query(sql, params);
    return res.json(result.rows);
  } catch (error: any) {
    console.error('정산 목록 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET /company-users/:companyId - 고객사 사용자 목록
router.get('/company-users/:companyId', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, name, login_id, department, role
       FROM users WHERE company_id = $1 AND is_active = true
       ORDER BY name`,
      [req.params.companyId]
    );
    return res.json(result.rows);
  } catch (error: any) {
    console.error('사용자 목록 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ============================================================
//  정산 파라미터 라우트 (/:id — 리터럴 라우트 뒤에 배치)
// ============================================================

// GET /:id/items - 정산 일자별 상세
router.get('/:id/items', async (req: Request, res: Response) => {
  try {
    const billing = await pool.query(
      `SELECT b.*, c.company_name, u.name as user_name
       FROM billings b
       JOIN companies c ON c.id = b.company_id
       LEFT JOIN users u ON u.id = b.user_id
       WHERE b.id = $1`,
      [req.params.id]
    );
    if (billing.rows.length === 0) {
      return res.status(404).json({ error: '정산을 찾을 수 없습니다' });
    }

    const items = await pool.query(
      `SELECT * FROM billing_items WHERE billing_id = $1 ORDER BY item_date ASC, message_type ASC`,
      [req.params.id]
    );

    return res.json({ billing: billing.rows[0], items: items.rows });
  } catch (error: any) {
    console.error('정산 상세 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// PUT /:id/status - 정산 상태 변경
router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    if (!['draft', 'confirmed', 'paid'].includes(status)) {
      return res.status(400).json({ error: '유효한 상태: draft, confirmed, paid' });
    }
    const result = await pool.query(
      `UPDATE billings SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '정산을 찾을 수 없습니다' });
    }
    return res.json(result.rows[0]);
  } catch (error: any) {
    console.error('정산 상태 변경 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// DELETE /:id - 정산 삭제 (draft만)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const check = await pool.query('SELECT status FROM billings WHERE id = $1', [req.params.id]);
    if (check.rows.length === 0) return res.status(404).json({ error: '정산을 찾을 수 없습니다' });
    if (check.rows[0].status !== 'draft') {
      return res.status(400).json({ error: '초안 상태의 정산만 삭제할 수 있습니다' });
    }
    // billing_items는 ON DELETE CASCADE로 자동 삭제
    await pool.query('DELETE FROM billings WHERE id = $1', [req.params.id]);
    return res.json({ success: true });
  } catch (error: any) {
    console.error('정산 삭제 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ============================================================
//  정산 PDF 생성
//  TODO: PDF 렌더링 로직을 services/pdfService.ts로 분리
// ============================================================

// GET /:id/pdf - 정산 PDF (2페이지: 요약 + 일자별 상세)
router.get('/:id/pdf', async (req: Request, res: Response) => {
  try {
    // 1) 정산 + 회사 정보
    const result = await pool.query(
      `SELECT b.*, c.company_name, c.business_number, c.ceo_name, c.address,
              c.contact_name, c.contact_phone, c.contact_email,
              c.business_type, c.business_category,
              u.name as user_name
       FROM billings b
       JOIN companies c ON c.id = b.company_id
       LEFT JOIN users u ON u.id = b.user_id
       WHERE b.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '정산을 찾을 수 없습니다' });
    }
    const bil = result.rows[0];

    // 2) 일자별 상세
    const itemsResult = await pool.query(
      `SELECT * FROM billing_items WHERE billing_id = $1 ORDER BY item_date ASC, message_type ASC`,
      [req.params.id]
    );
    const items = itemsResult.rows;

    // 3) PDF 생성
    const PDFDocument = require('pdfkit');
    const fs = require('fs');
    const path = require('path');

    const fontPath = path.join(__dirname, '../../fonts/malgun.ttf');
    const fontBoldPath = path.join(__dirname, '../../fonts/malgunbd.ttf');
    const hasFont = fs.existsSync(fontPath);

    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    const pdfDir = path.join(__dirname, '../../pdfs');
    if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });
    const pdfFilename = `billing_${bil.id.slice(0, 8)}_${bil.billing_year}_${String(bil.billing_month).padStart(2, '0')}.pdf`;
    const pdfPath = path.join(pdfDir, pdfFilename);
    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);

    const setFont = (bold = false) => { if (hasFont) doc.font(bold ? fontBoldPath : fontPath); };
    const primary = '#4338ca';
    const dark = '#1f2937';
    const gray = '#6b7280';
    const n = (v: any) => Number(v) || 0;

    // ============================
    // PAGE 1 — 요약
    // ============================
    setFont(true);
    doc.fontSize(22).fillColor(primary).text('정산서', 50, 50);
    setFont(false);
    doc.fontSize(9).fillColor(gray).text('BILLING STATEMENT', 50, 78);

    const rightX = 350;
    setFont(false);
    doc.fontSize(9).fillColor(gray);
    doc.text('정산번호:', rightX, 50, { continued: true });
    setFont(true);
    doc.fillColor(dark).text(`  BIL-${bil.id.slice(0, 8).toUpperCase()}`);
    setFont(false);
    doc.fontSize(9).fillColor(gray);
    doc.text('발행일:', rightX, 65, { continued: true });
    doc.fillColor(dark).text(`  ${new Date().toISOString().slice(0, 10)}`);
    const fmtDate = (d: any) => d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
    doc.text('정산기간:', rightX, 80, { continued: true });
    doc.fillColor(dark).text(`  ${fmtDate(bil.billing_start)} ~ ${fmtDate(bil.billing_end)}`);

    if (bil.user_name) {
      setFont(false);
      doc.fontSize(9).fillColor(gray);
      doc.text('사용자:', rightX, 98, { continued: true });
      doc.fillColor(dark).text(`  ${bil.user_name}`);
    }

    doc.moveTo(50, bil.user_name ? 118 : 115).lineTo(545, bil.user_name ? 118 : 115).strokeColor('#e5e7eb').stroke();

    // 공급자 / 공급받는자
    let y = 130;
    setFont(true);
    doc.fontSize(10).fillColor(primary).text('공급자', 50, y);
    setFont(false);
    doc.fontSize(9).fillColor(dark);
    y += 18;
    doc.text('상호: 주식회사 인비토 (INVITO corp.)', 50, y); y += 14;
    doc.text('대표: 유 호 윤', 50, y); y += 14;
    doc.text('사업자번호: 667-86-00578', 50, y); y += 14;
    doc.text('업태/종목: 서비스 / 소프트웨어및앱개발 공급', 50, y); y += 14;
    doc.text('주소: 서울시 송파구 오금로 36길46, 4층', 50, y); y += 14;
    doc.text('연락처: 1800-8125 / mobile@invitocorp.com', 50, y);

    y = 130;
    setFont(true);
    doc.fontSize(10).fillColor(primary).text('공급받는자', rightX, y);
    setFont(false);
    doc.fontSize(9).fillColor(dark);
    y += 18;
    doc.text(`상호: ${bil.company_name || '-'}`, rightX, y); y += 14;
    doc.text(`대표: ${bil.ceo_name || '-'}`, rightX, y); y += 14;
    doc.text(`사업자번호: ${bil.business_number || '-'}`, rightX, y); y += 14;
    doc.text(`업태/종목: ${bil.business_type || '-'} / ${bil.business_category || '-'}`, rightX, y); y += 14;
    doc.text(`주소: ${bil.address || '-'}`, rightX, y); y += 14;
    doc.text(`연락처: ${bil.contact_phone || '-'} / ${bil.contact_email || '-'}`, rightX, y);

    doc.moveTo(50, 245).lineTo(545, 245).strokeColor('#e5e7eb').stroke();

    // 내역 테이블
    y = 260;
    doc.rect(50, y, 495, 25).fill(primary);
    setFont(true);
    doc.fontSize(9).fillColor('white');
    doc.text('항목', 60, y + 7);
    doc.text('수량', 250, y + 7, { width: 80, align: 'right' });
    doc.text('단가', 340, y + 7, { width: 80, align: 'right' });
    doc.text('금액', 430, y + 7, { width: 105, align: 'right' });
    y += 25;

    const drawRow = (label: string, count: number, price: number, amount: number, bg = 'white') => {
      if (count <= 0) return;
      if (bg !== 'white') doc.rect(50, y, 495, 22).fill(bg);
      setFont(false);
      doc.fontSize(9).fillColor(dark);
      doc.text(label, 60, y + 6);
      doc.text(count.toLocaleString(), 250, y + 6, { width: 80, align: 'right' });
      doc.text(`₩${price.toLocaleString()}`, 340, y + 6, { width: 80, align: 'right' });
      setFont(true);
      doc.text(`₩${amount.toLocaleString()}`, 430, y + 6, { width: 105, align: 'right' });
      y += 22;
      doc.moveTo(50, y).lineTo(545, y).strokeColor('#e5e7eb').stroke();
    };

    drawRow('SMS', n(bil.sms_success), n(bil.sms_unit_price), n(bil.sms_success) * n(bil.sms_unit_price));
    drawRow('LMS', n(bil.lms_success), n(bil.lms_unit_price), n(bil.lms_success) * n(bil.lms_unit_price));
    drawRow('MMS', n(bil.mms_success), n(bil.mms_unit_price), n(bil.mms_success) * n(bil.mms_unit_price));
    drawRow('카카오', n(bil.kakao_success), n(bil.kakao_unit_price), n(bil.kakao_success) * n(bil.kakao_unit_price));
    drawRow('테스트 SMS', n(bil.test_sms_count), n(bil.test_sms_unit_price), n(bil.test_sms_count) * n(bil.test_sms_unit_price), '#fefce8');
    drawRow('테스트 LMS', n(bil.test_lms_count), n(bil.test_lms_unit_price), n(bil.test_lms_count) * n(bil.test_lms_unit_price), '#fefce8');

    // 합계
    y += 15;
    const summaryX = 340;
    setFont(false);
    doc.fontSize(9).fillColor(gray);
    doc.text('공급가액:', summaryX, y, { width: 80, align: 'right' });
    setFont(true);
    doc.fillColor(dark).text(`₩${n(bil.subtotal).toLocaleString()}`, 430, y, { width: 105, align: 'right' });
    y += 18;
    setFont(false);
    doc.fillColor(gray);
    doc.text('부가세 (10%):', summaryX, y, { width: 80, align: 'right' });
    setFont(true);
    doc.fillColor(dark).text(`₩${n(bil.vat).toLocaleString()}`, 430, y, { width: 105, align: 'right' });
    y += 22;

    doc.rect(summaryX - 10, y - 2, 225, 28).fill('#eef2ff');
    setFont(true);
    doc.fontSize(11).fillColor(primary);
    doc.text('합계:', summaryX, y + 5, { width: 80, align: 'right' });
    doc.fontSize(13).text(`₩${n(bil.total_amount).toLocaleString()}`, 430, y + 3, { width: 105, align: 'right' });

    if (bil.notes) {
      y += 50;
      setFont(true);
      doc.fontSize(9).fillColor(gray).text('비고:', 50, y);
      setFont(false);
      doc.fillColor(dark).text(bil.notes, 50, y + 15, { width: 495 });
    }

    doc.fontSize(8).fillColor(gray);
    doc.text('본 정산서는 INVITO Target-UP 시스템에서 자동 생성되었습니다.', 50, 770, { align: 'center', width: 495 });

    // ============================
    // PAGE 2+ — 일자별 상세
    // ============================
    if (items.length > 0) {
      doc.addPage();

      setFont(true);
      doc.fontSize(14).fillColor(primary).text('일자별 상세 내역', 50, 50);
      setFont(false);
      doc.fontSize(9).fillColor(gray).text(
        `${bil.company_name} | ${bil.billing_year}년 ${bil.billing_month}월${bil.user_name ? ' | ' + bil.user_name : ''}`,
        50, 72
      );

      doc.moveTo(50, 90).lineTo(545, 90).strokeColor('#e5e7eb').stroke();

      // 테이블 헤더
      const cols = [
        { label: '일자', x: 50, w: 75, align: 'left' as const },
        { label: '유형', x: 125, w: 60, align: 'left' as const },
        { label: '전송', x: 185, w: 55, align: 'right' as const },
        { label: '성공', x: 240, w: 55, align: 'right' as const },
        { label: '실패', x: 295, w: 55, align: 'right' as const },
        { label: '대기', x: 350, w: 55, align: 'right' as const },
        { label: '단가', x: 405, w: 65, align: 'right' as const },
        { label: '금액', x: 470, w: 75, align: 'right' as const },
      ];

      let iy = 95;
      const rowH = 18;
      const pageBottom = 760;

      const drawDetailHeader = () => {
        doc.rect(50, iy, 495, 22).fill('#f3f4f6');
        setFont(true);
        doc.fontSize(8).fillColor(gray);
        cols.forEach(c => doc.text(c.label, c.x + 4, iy + 6, { width: c.w - 8, align: c.align }));
        iy += 22;
      };

      drawDetailHeader();

      const typeLabel: Record<string, string> = {
        SMS: 'SMS', LMS: 'LMS', MMS: 'MMS', KAKAO: '카카오',
        TEST_SMS: '테스트SMS', TEST_LMS: '테스트LMS'
      };

      let detailSubtotal = 0;
      items.forEach((item: any, idx: number) => {
        // 페이지 넘김 체크
        if (iy + rowH > pageBottom) {
          setFont(false);
          doc.fontSize(8).fillColor(gray).text('(다음 페이지에 계속)', 50, iy + 5, { align: 'center', width: 495 });
          doc.addPage();
          iy = 50;
          setFont(true);
          doc.fontSize(10).fillColor(primary).text('일자별 상세 내역 (계속)', 50, iy);
          iy += 25;
          drawDetailHeader();
        }

        const isTest = item.message_type.startsWith('TEST');
        if (isTest) doc.rect(50, iy, 495, rowH).fill('#fefce8');
        else if (idx % 2 === 0) doc.rect(50, iy, 495, rowH).fill('#fafafa');

        setFont(false);
        doc.fontSize(8).fillColor(dark);
        const dateStr = item.item_date instanceof Date
          ? item.item_date.toISOString().slice(5, 10)
          : String(item.item_date).slice(5, 10);
        doc.text(dateStr, cols[0].x + 4, iy + 5, { width: cols[0].w - 8 });
        doc.text(typeLabel[item.message_type] || item.message_type, cols[1].x + 4, iy + 5, { width: cols[1].w - 8 });
        doc.text(n(item.total_count).toLocaleString(), cols[2].x + 4, iy + 5, { width: cols[2].w - 8, align: 'right' });
        doc.text(n(item.success_count).toLocaleString(), cols[3].x + 4, iy + 5, { width: cols[3].w - 8, align: 'right' });

        if (n(item.fail_count) > 0) doc.fillColor('#dc2626');
        doc.text(n(item.fail_count).toLocaleString(), cols[4].x + 4, iy + 5, { width: cols[4].w - 8, align: 'right' });
        doc.fillColor(dark);

        doc.text(n(item.pending_count).toLocaleString(), cols[5].x + 4, iy + 5, { width: cols[5].w - 8, align: 'right' });
        doc.text(`₩${n(item.unit_price).toLocaleString()}`, cols[6].x + 4, iy + 5, { width: cols[6].w - 8, align: 'right' });
        setFont(true);
        doc.text(`₩${n(item.amount).toLocaleString()}`, cols[7].x + 4, iy + 5, { width: cols[7].w - 8, align: 'right' });

        detailSubtotal += n(item.amount);
        iy += rowH;
        doc.moveTo(50, iy).lineTo(545, iy).strokeColor('#eeeeee').stroke();
      });

      // 합계 행
      iy += 4;
      doc.rect(50, iy, 495, 22).fill('#eef2ff');
      setFont(true);
      doc.fontSize(9).fillColor(primary);
      doc.text('합계', cols[0].x + 4, iy + 6);
      doc.text(`₩${detailSubtotal.toLocaleString()}`, cols[7].x + 4, iy + 6, { width: cols[7].w - 8, align: 'right' });
    }

    doc.end();
    await new Promise<void>((resolve) => stream.on('finish', resolve));

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(pdfFilename)}"`);
    const fileStream = fs.createReadStream(pdfPath);
    fileStream.pipe(res);

  } catch (error: any) {
    console.error('정산 PDF 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});


// ============================================================
//  거래내역서(Invoice) API
// ============================================================

// GET /preview - 정산 미리보기
router.get('/preview', async (req: Request, res: Response) => {
  try {
    const { company_id, start, end, type = 'combined' } = req.query;

    if (!company_id || !start || !end) {
      return res.status(400).json({ error: '필수 파라미터: company_id, start, end' });
    }

    // 1) 회사 단가 조회
    const companyResult = await pool.query(
      `SELECT cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao,
              cost_per_test_sms, cost_per_test_lms, service_type
       FROM companies WHERE id = $1`,
      [company_id]
    );
    if (companyResult.rows.length === 0) {
      return res.status(404).json({ error: '고객사를 찾을 수 없습니다' });
    }
    const company = companyResult.rows[0];

    // 2) 해당 기간 campaign_run_id 목록 조회 (PostgreSQL)
    const runsResult = await pool.query(
      `SELECT cr.id as run_id, c.callback_number, cb.store_code, cb.store_name
       FROM campaign_runs cr
       JOIN campaigns c ON c.id = cr.campaign_id
       LEFT JOIN callback_numbers cb ON cb.phone = c.callback_number AND cb.company_id = c.company_id
       WHERE c.company_id = $1
         AND cr.sent_at >= $2::date
         AND cr.sent_at < ($3::date + interval '1 day')`,
      [company_id, start, end]
    );

    const runIds = runsResult.rows.map((r: any) => r.run_id);
    const runStoreMap: Record<string, { store_code: string; store_name: string }> = {};
    runsResult.rows.forEach((r: any) => {
      runStoreMap[r.run_id] = {
        store_code: r.store_code || 'default',
        store_name: r.store_name || '본사'
      };
    });

    // 3) MySQL에서 일반발송 성공 집계
    let normalCounts: any[] = [];
    if (runIds.length > 0) {
      const placeholders = runIds.map(() => '?').join(',');
      const rows = await mysqlQuery(
        `SELECT app_etc1 as run_id, msg_type,
                COUNT(*) as total_count,
                SUM(CASE WHEN status_code IN (6, 1000, 1800) THEN 1 ELSE 0 END) as success_count
         FROM SMSQ_SEND
         WHERE app_etc1 IN (${placeholders})
           AND sendreq_time >= ? AND sendreq_time < DATE_ADD(?, INTERVAL 1 DAY)
         GROUP BY app_etc1, msg_type`,
        [...runIds, start, end]
      );
      normalCounts = rows as any[];
    }

    // 4) MySQL에서 테스트발송 집계
    const testRows = await mysqlQuery(
      `SELECT msg_type,
              COUNT(*) as total_count,
              SUM(CASE WHEN status_code IN (6, 1000, 1800) THEN 1 ELSE 0 END) as success_count
       FROM SMSQ_SEND
       WHERE app_etc1 = 'test' AND app_etc2 = ?
         AND sendreq_time >= ? AND sendreq_time < DATE_ADD(?, INTERVAL 1 DAY)
       GROUP BY msg_type`,
      [company_id, start, end]
    );

    // 5) 집계 계산
    if (type === 'brand') {
      const brandMap: Record<string, any> = {};
      normalCounts.forEach((row: any) => {
        const store = runStoreMap[row.run_id] || { store_code: 'default', store_name: '본사' };
        const key = store.store_code;
        if (!brandMap[key]) {
          brandMap[key] = { store_code: store.store_code, store_name: store.store_name, sms_success: 0, lms_success: 0, mms_success: 0, kakao_success: 0 };
        }
        if (row.msg_type === 'S') brandMap[key].sms_success += Number(row.success_count);
        if (row.msg_type === 'L') brandMap[key].lms_success += Number(row.success_count);
      });

      const brands = Object.values(brandMap).map((b: any) => ({
        ...b,
        sms_amount: b.sms_success * (Number(company.cost_per_sms) || 0),
        lms_amount: b.lms_success * (Number(company.cost_per_lms) || 0),
        mms_amount: b.mms_success * (Number(company.cost_per_mms) || 0),
        kakao_amount: b.kakao_success * (Number(company.cost_per_kakao) || 0),
      }));

      return res.json({ type: 'brand', brands, test: buildTestSummary(testRows, company) });
    } else {
      let sms_success = 0, lms_success = 0, mms_success = 0, kakao_success = 0;
      normalCounts.forEach((row: any) => {
        if (row.msg_type === 'S') sms_success += Number(row.success_count);
        if (row.msg_type === 'L') lms_success += Number(row.success_count);
      });

      const summary = {
        sms_success, lms_success, mms_success, kakao_success,
        sms_amount: sms_success * (Number(company.cost_per_sms) || 0),
        lms_amount: lms_success * (Number(company.cost_per_lms) || 0),
        mms_amount: mms_success * (Number(company.cost_per_mms) || 0),
        kakao_amount: kakao_success * (Number(company.cost_per_kakao) || 0),
      };

      return res.json({ type: 'combined', summary, test: buildTestSummary(testRows, company) });
    }
  } catch (error: any) {
    console.error('정산 미리보기 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

function buildTestSummary(testRows: any, company: any) {
  let test_sms = 0, test_lms = 0;
  (testRows as any[]).forEach((row: any) => {
    if (row.msg_type === 'S') test_sms += Number(row.success_count);
    if (row.msg_type === 'L') test_lms += Number(row.success_count);
  });
  return {
    test_sms, test_lms,
    test_sms_amount: test_sms * (Number(company.cost_per_test_sms) || Number(company.cost_per_sms) || 0),
    test_lms_amount: test_lms * (Number(company.cost_per_test_lms) || Number(company.cost_per_lms) || 0),
  };
}

// POST /invoices - 거래내역서 생성
router.post('/invoices', async (req: Request, res: Response) => {
  try {
    const {
      company_id, store_code, store_name, billing_start, billing_end,
      invoice_type = 'combined', billing_id,
      sms_success_count = 0, sms_unit_price = 0,
      lms_success_count = 0, lms_unit_price = 0,
      mms_success_count = 0, mms_unit_price = 0,
      kakao_success_count = 0, kakao_unit_price = 0,
      test_sms_count = 0, test_sms_unit_price = 0,
      test_lms_count = 0, test_lms_unit_price = 0,
      spam_filter_count = 0, spam_filter_unit_price = 0,
      notes, created_by
    } = req.body;

    if (!company_id || !billing_start || !billing_end) {
      return res.status(400).json({ error: '필수: company_id, billing_start, billing_end' });
    }

    const subtotal =
      (sms_success_count * sms_unit_price) +
      (lms_success_count * lms_unit_price) +
      (mms_success_count * mms_unit_price) +
      (kakao_success_count * kakao_unit_price) +
      (test_sms_count * test_sms_unit_price) +
      (test_lms_count * test_lms_unit_price) +
      (spam_filter_count * spam_filter_unit_price);
    const vat = Math.round(subtotal * 0.1);
    const total_amount = subtotal + vat;

    const result = await pool.query(
      `INSERT INTO billing_invoices (
        company_id, store_code, store_name, billing_start, billing_end, invoice_type, billing_id,
        sms_success_count, sms_unit_price, lms_success_count, lms_unit_price,
        mms_success_count, mms_unit_price, kakao_success_count, kakao_unit_price,
        test_sms_count, test_sms_unit_price, test_lms_count, test_lms_unit_price,
        spam_filter_count, spam_filter_unit_price,
        subtotal, vat, total_amount, status, notes, created_by
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,'draft',$25,$26
      ) RETURNING *`,
      [
        company_id, store_code || null, store_name || null, billing_start, billing_end, invoice_type, billing_id || null,
        sms_success_count, sms_unit_price, lms_success_count, lms_unit_price,
        mms_success_count, mms_unit_price, kakao_success_count, kakao_unit_price,
        test_sms_count, test_sms_unit_price, test_lms_count, test_lms_unit_price,
        spam_filter_count, spam_filter_unit_price,
        subtotal, vat, total_amount, notes || null, created_by || null
      ]
    );

    return res.json(result.rows[0]);
  } catch (error: any) {
    console.error('거래내역서 생성 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET /invoices - 거래내역서 목록
router.get('/invoices', async (req: Request, res: Response) => {
  try {
    const { company_id, status } = req.query;
    // ★ 수정: c.name → c.company_name (companies 테이블 컬럼명 일치)
    let sql = `SELECT bi.*, c.company_name
               FROM billing_invoices bi
               JOIN companies c ON c.id = bi.company_id
               WHERE 1=1`;
    const params: any[] = [];

    if (company_id) { params.push(company_id); sql += ` AND bi.company_id = $${params.length}`; }
    if (status) { params.push(status); sql += ` AND bi.status = $${params.length}`; }
    sql += ' ORDER BY bi.created_at DESC';

    const result = await pool.query(sql, params);
    return res.json(result.rows);
  } catch (error: any) {
    console.error('거래내역서 목록 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET /invoices/:id - 거래내역서 상세
router.get('/invoices/:id', async (req: Request, res: Response) => {
  try {
    // ★ 수정: c.name → c.company_name
    const result = await pool.query(
      `SELECT bi.*, c.company_name, c.business_number, c.ceo_name, c.address
       FROM billing_invoices bi
       JOIN companies c ON c.id = bi.company_id
       WHERE bi.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '거래내역서를 찾을 수 없습니다' });
    }
    return res.json(result.rows[0]);
  } catch (error: any) {
    console.error('거래내역서 상세 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// PUT /invoices/:id/status - 상태 변경
router.put('/invoices/:id/status', async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    if (!['draft', 'confirmed', 'paid'].includes(status)) {
      return res.status(400).json({ error: '유효한 상태: draft, confirmed, paid' });
    }
    const result = await pool.query(
      `UPDATE billing_invoices SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '거래내역서를 찾을 수 없습니다' });
    }
    return res.json(result.rows[0]);
  } catch (error: any) {
    console.error('상태 변경 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ============================================================
//  거래내역서 PDF
//  TODO: 정산 PDF와 공통 렌더링 로직을 services/pdfService.ts로 분리
// ============================================================

// GET /invoices/:id/pdf - PDF 거래내역서 생성 & 다운로드
router.get('/invoices/:id/pdf', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT bi.*, c.company_name, c.business_number, c.ceo_name, c.address,
              c.contact_name, c.contact_phone, c.contact_email, c.business_type, c.business_category
       FROM billing_invoices bi
       JOIN companies c ON c.id = bi.company_id
       WHERE bi.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '거래내역서를 찾을 수 없습니다' });
    }
    const inv = result.rows[0];

    const PDFDocument = require('pdfkit');
    const fs = require('fs');
    const path = require('path');

    const fontPath = path.join(__dirname, '../../fonts/malgun.ttf');
    const fontBoldPath = path.join(__dirname, '../../fonts/malgunbd.ttf');
    const hasFont = fs.existsSync(fontPath);

    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    const pdfDir = path.join(__dirname, '../../pdfs');
    if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });
    const bStart = inv.billing_start instanceof Date ? inv.billing_start.toISOString().slice(0, 10) : String(inv.billing_start).slice(0, 10);
    const bEnd = inv.billing_end instanceof Date ? inv.billing_end.toISOString().slice(0, 10) : String(inv.billing_end).slice(0, 10);
    const pdfFilename = `invoice_${inv.id.slice(0, 8)}_${bStart}_${bEnd}.pdf`;
    const pdfPath = path.join(pdfDir, pdfFilename);
    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);

    const setFont = (bold = false) => { if (hasFont) doc.font(bold ? fontBoldPath : fontPath); };
    const primary = '#4338ca';
    const dark = '#1f2937';
    const gray = '#6b7280';

    // 헤더
    setFont(true);
    doc.fontSize(22).fillColor(primary).text('거래내역서', 50, 50);
    setFont(false);
    doc.fontSize(9).fillColor(gray).text('INVOICE', 50, 78);

    const rightX = 350;
    setFont(false);
    doc.fontSize(9).fillColor(gray);
    doc.text('내역서 번호:', rightX, 50, { continued: true });
    setFont(true);
    doc.fillColor(dark).text(`  INV-${inv.id.slice(0, 8).toUpperCase()}`);
    setFont(false);
    doc.fontSize(9).fillColor(gray);
    doc.text('발행일:', rightX, 65, { continued: true });
    doc.fillColor(dark).text(`  ${new Date().toISOString().slice(0, 10)}`);
    doc.text('정산기간:', rightX, 80, { continued: true });
    doc.fillColor(dark).text(`  ${bStart} ~ ${bEnd}`);

    doc.moveTo(50, 105).lineTo(545, 105).strokeColor('#e5e7eb').stroke();

    // 공급자 / 공급받는자
    let iy = 120;
    setFont(true);
    doc.fontSize(10).fillColor(primary).text('공급자', 50, iy);
    setFont(false);
    doc.fontSize(9).fillColor(dark);
    iy += 18;
    doc.text('상호: 주식회사 인비토 (INVITO corp.)', 50, iy); iy += 14;
    doc.text('대표: 유 호 윤', 50, iy); iy += 14;
    doc.text('사업자번호: 667-86-00578', 50, iy); iy += 14;
    doc.text('업태/종목: 서비스 / 소프트웨어및앱개발 공급', 50, iy); iy += 14;
    doc.text('주소: 서울시 송파구 오금로 36길46, 4층', 50, iy); iy += 14;
    doc.text('연락처: 1800-8125 / mobile@invitocorp.com', 50, iy);

    iy = 120;
    setFont(true);
    doc.fontSize(10).fillColor(primary).text('공급받는자', rightX, iy);
    setFont(false);
    doc.fontSize(9).fillColor(dark);
    iy += 18;
    doc.text(`상호: ${inv.company_name || '-'}`, rightX, iy); iy += 14;
    doc.text(`대표: ${inv.ceo_name || '-'}`, rightX, iy); iy += 14;
    doc.text(`사업자번호: ${inv.business_number || '-'}`, rightX, iy); iy += 14;
    doc.text(`업태/종목: ${inv.business_type || '-'} / ${inv.business_category || '-'}`, rightX, iy); iy += 14;
    doc.text(`주소: ${inv.address || '-'}`, rightX, iy); iy += 14;
    doc.text(`연락처: ${inv.contact_phone || '-'} / ${inv.contact_email || '-'}`, rightX, iy);

    doc.moveTo(50, 230).lineTo(545, 230).strokeColor('#e5e7eb').stroke();

    iy = 240;
    if (inv.store_name && inv.invoice_type === 'brand') {
      setFont(false);
      doc.fontSize(9).fillColor(gray).text(`브랜드: ${inv.store_name} (${inv.store_code || ''})`, 50, iy);
      iy += 20;
    }

    // 내역 테이블
    doc.rect(50, iy, 495, 25).fill(primary);
    setFont(true);
    doc.fontSize(9).fillColor('white');
    doc.text('항목', 60, iy + 7);
    doc.text('수량', 250, iy + 7, { width: 80, align: 'right' });
    doc.text('단가', 340, iy + 7, { width: 80, align: 'right' });
    doc.text('금액', 430, iy + 7, { width: 105, align: 'right' });
    iy += 25;

    const drawInvRow = (label: string, count: number, price: number, amount: number, bg = 'white') => {
      if (count <= 0) return;
      if (bg !== 'white') doc.rect(50, iy, 495, 22).fill(bg);
      setFont(false);
      doc.fontSize(9).fillColor(dark);
      doc.text(label, 60, iy + 6);
      doc.text(count.toLocaleString(), 250, iy + 6, { width: 80, align: 'right' });
      doc.text(`₩${price.toLocaleString()}`, 340, iy + 6, { width: 80, align: 'right' });
      setFont(true);
      doc.text(`₩${amount.toLocaleString()}`, 430, iy + 6, { width: 105, align: 'right' });
      iy += 22;
      doc.moveTo(50, iy).lineTo(545, iy).strokeColor('#e5e7eb').stroke();
    };

    const n = (v: any) => Number(v) || 0;
    drawInvRow('SMS', n(inv.sms_success_count), n(inv.sms_unit_price), n(inv.sms_success_count) * n(inv.sms_unit_price));
    drawInvRow('LMS', n(inv.lms_success_count), n(inv.lms_unit_price), n(inv.lms_success_count) * n(inv.lms_unit_price));
    drawInvRow('MMS', n(inv.mms_success_count), n(inv.mms_unit_price), n(inv.mms_success_count) * n(inv.mms_unit_price));
    drawInvRow('카카오', n(inv.kakao_success_count), n(inv.kakao_unit_price), n(inv.kakao_success_count) * n(inv.kakao_unit_price));
    drawInvRow('테스트 SMS', n(inv.test_sms_count), n(inv.test_sms_unit_price), n(inv.test_sms_count) * n(inv.test_sms_unit_price), '#fefce8');
    drawInvRow('테스트 LMS', n(inv.test_lms_count), n(inv.test_lms_unit_price), n(inv.test_lms_count) * n(inv.test_lms_unit_price), '#fefce8');
    drawInvRow('스팸필터', n(inv.spam_filter_count), n(inv.spam_filter_unit_price), n(inv.spam_filter_count) * n(inv.spam_filter_unit_price), '#fefce8');

    // 합계
    iy += 15;
    const invSummaryX = 340;
    setFont(false);
    doc.fontSize(9).fillColor(gray);
    doc.text('공급가액:', invSummaryX, iy, { width: 80, align: 'right' });
    setFont(true);
    doc.fillColor(dark).text(`₩${n(inv.subtotal).toLocaleString()}`, 430, iy, { width: 105, align: 'right' });
    iy += 18;
    setFont(false);
    doc.fillColor(gray);
    doc.text('부가세 (10%):', invSummaryX, iy, { width: 80, align: 'right' });
    setFont(true);
    doc.fillColor(dark).text(`₩${n(inv.vat).toLocaleString()}`, 430, iy, { width: 105, align: 'right' });
    iy += 22;

    doc.rect(invSummaryX - 10, iy - 2, 225, 28).fill('#eef2ff');
    setFont(true);
    doc.fontSize(11).fillColor(primary);
    doc.text('합계:', invSummaryX, iy + 5, { width: 80, align: 'right' });
    doc.fontSize(13).text(`₩${n(inv.total_amount).toLocaleString()}`, 430, iy + 3, { width: 105, align: 'right' });

    if (inv.notes) {
      iy += 50;
      setFont(true);
      doc.fontSize(9).fillColor(gray).text('비고:', 50, iy);
      setFont(false);
      doc.fillColor(dark).text(inv.notes, 50, iy + 15, { width: 495 });
    }

    doc.fontSize(8).fillColor(gray);
    doc.text('본 거래내역서는 INVITO Target-UP 시스템에서 자동 생성되었습니다.', 50, 770, { align: 'center', width: 495 });

    doc.end();
    await new Promise<void>((resolve) => stream.on('finish', resolve));

    await pool.query(
      'UPDATE billing_invoices SET pdf_path = $1, updated_at = now() WHERE id = $2',
      [pdfPath, req.params.id]
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(pdfFilename)}"`);
    const fileStream = fs.createReadStream(pdfPath);
    fileStream.pipe(res);

  } catch (error: any) {
    console.error('PDF 생성 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

export default router;
