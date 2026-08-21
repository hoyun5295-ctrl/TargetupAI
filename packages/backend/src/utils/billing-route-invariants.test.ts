/**
 * 정산 라우트 계약 불변식 — 소스 스캔 (★ 2026-07-26 신설)
 *
 * 신설 사유: **화면이 부르는 라우트와 내가 고친 라우트가 달랐다.**
 *   `app.ts`가 `/api/admin/billing`(billing 라우터)을 `/api/admin`(admin 라우터)보다 **먼저** 마운트하므로
 *   `POST /api/admin/billing/:id/send-email`은 항상 `routes/billing.ts`에서 잡힌다.
 *   그런데 같은 URL 구현이 `routes/admin.ts`에도 있어서, 한 세션이 닿지 않는 쪽을 고쳤다.
 *   그 사이 실경로는 응답에 `success`가 없었고 화면은 `if (!res.data?.success)`로 판정해
 *   **메일이 실제로 나갔는데 "발송 실패"를 띄웠다** — 운영자가 재발송하면 고객이 같은 청구서를 두 번 받는다.
 *
 * 런타임 테스트로는 이 부류가 안 잡힌다(라우터를 직접 부르면 마운트 순서를 안 밟는다).
 * 그래서 소스 계약으로 밟는다 — 선례 = `dm-flow-invariants.test.ts` §#7.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const appSrc = read('../app.ts');
const billingSrc = read('../routes/billing.ts');
const adminSrc = read('../routes/admin.ts');
// ★ 2026-07-28 발행 코어가 utils/billing-issue.ts로 추출됐다(일괄발급 배치와 공유).
//   /generate 내부를 보던 검사들은 이 파일을 스캔한다 — 파일 전체가 곧 발행 코어다.
const issueSrc = read('./billing-issue.ts');
// ★ 2026-07-28 PDF 생성이 utils/billing-pdf.ts로 추출됐다(일괄발급 메일 첨부와 공유).
//   PDF 그림 코드를 보던 검사들은 이 파일을 스캔한다 — 라우트만 보면 코드가 옮겨간 뒤 **조용히 통과**한다.
const pdfSrc = read('./billing-pdf.ts');
// ★ 2026-07-28 컨펌 요청 메일(첨부·버튼 하나)과 공개 컨펌 페이지(항목표 제거·ack).
const confirmSrc = read('./invoice-confirm.ts');
const publicSrc = read('../routes/invoice-public.ts');
const bulkSrc = read('./billing-bulk.ts');

describe('정산 라우트 계약 불변식 (2026-07-26)', () => {
  it('billing 라우터가 admin 라우터보다 먼저 마운트된다 — 순서가 뒤집히면 send-email 실경로가 조용히 바뀐다', () => {
    const billingMount = appSrc.indexOf("app.use('/api/admin/billing'");
    const adminMount = appSrc.indexOf("app.use('/api/admin',");
    expect(billingMount, '/api/admin/billing 마운트를 찾지 못했다').toBeGreaterThan(-1);
    expect(adminMount, '/api/admin 마운트를 찾지 못했다').toBeGreaterThan(-1);
    expect(billingMount).toBeLessThan(adminMount);
  });

  it('admin.ts에 정산 메일 라우트를 다시 만들지 않는다 — 같은 URL 두 구현은 "닿지 않는 쪽을 고치는" 사고를 부른다', () => {
    expect(adminSrc).not.toMatch(/router\.(post|put|patch)\(\s*['"`]\/billing\/:id\/send-email/);
  });

  it('정산 메일 응답에 success가 있다 — 화면이 이 필드로 성공을 판정한다', () => {
    const start = billingSrc.indexOf("router.post('/:id/send-email'");
    expect(start, '정산 메일 라우트를 찾지 못했다').toBeGreaterThan(-1);
    const end = billingSrc.indexOf("router.post('/invoices/:id/send-email'", start);
    const body = billingSrc.slice(start, end === -1 ? undefined : end);
    expect(body).toContain('success: true');
  });

  it('정산 메일은 발송 표시를 SMTP 앞에 FOR UPDATE로 남긴다 — 발송 중 삭제되면 이중 청구가 된다', () => {
    const start = billingSrc.indexOf("router.post('/:id/send-email'");
    const body = billingSrc.slice(start);
    const markIdx = body.indexOf('FOR UPDATE');
    const sendIdx = body.indexOf('transporter.sendMail');
    expect(markIdx).toBeGreaterThan(-1);
    expect(sendIdx).toBeGreaterThan(-1);
    expect(markIdx, '표시가 SMTP 뒤로 가면 4차 지적이 그대로 되살아난다').toBeLessThan(sendIdx);
  });

  it('발송 표시와 SMTP 사이에 COMMIT이 없다 — 먼저 커밋하면 잠금이 풀려 발송 중 삭제가 통과한다', () => {
    // ★ 5차 지적 — 앞 검사는 "FOR UPDATE가 sendMail보다 먼저"만 봐서, 그 사이 COMMIT을 못 잡았다.
    const start = billingSrc.indexOf("router.post('/:id/send-email'");
    const body = billingSrc.slice(start);
    const lockIdx = body.indexOf('FOR UPDATE');
    const sendIdx = body.indexOf('transporter.sendMail');
    const between = body.slice(lockIdx, sendIdx);
    expect(between, '잠금과 발송 사이 COMMIT은 발송 중 삭제 창을 다시 연다').not.toContain("query('COMMIT')");
  });

  it('발송 타임아웃은 표시를 되돌리지 않는다 — 롤백하면 다음 클릭이 409를 못 만나 중복 발송된다', () => {
    // ★ 7차 ① — `Promise.race`는 sendMail을 취소하지 못한다. 타임아웃 뒤에도 전달될 수 있으므로
    //   "발송 여부 미확정"은 표시를 남기는 쪽(중복 차단)으로 처리한다.
    const start = billingSrc.indexOf("router.post('/:id/send-email'");
    const body = billingSrc.slice(start);
    const timeoutIdx = body.indexOf('mailTimedOut');
    expect(timeoutIdx).toBeGreaterThan(-1);
    expect(body).toContain('BILLING_EMAIL_SEND_UNCERTAIN');
    // 타임아웃 분기가 COMMIT을 하고, 그 분기가 일반 ROLLBACK보다 앞에 있어야 한다.
    const branch = body.slice(body.indexOf('if (mailTimedOut)'));
    expect(branch.slice(0, branch.indexOf('return res.status(504)'))).toContain("query('COMMIT')");
  });

  it('요금제 이력도 발행 트랜잭션 안에서 재검증한다 — 발행 중 소급 변경이 구간을 바꾼다', () => {
    // ★ 7차 ②-2 — 원장 지문은 같은 월정액의 플랜 변경을 못 잡는다(plan_id를 지문에서 뺐다).
    // ★ 2026-07-28 발행 코어 추출로 스캔 대상 = billing-issue.ts.
    expect(issueSrc).toContain('BILLING_PLAN_HISTORY_CHANGED');
    expect(issueSrc, '재검증은 트랜잭션 client로 다시 읽어야 의미가 있다').toContain('loadPlanChanges(company_id, billing_end, client)');
  });

  it('라우트는 발행 코어를 부른다 — 코어를 복사한 두 번째 발행 구현이 생기면 반드시 갈라진다 (2026-07-28)', () => {
    const start = billingSrc.indexOf("router.post('/generate'");
    const end = billingSrc.indexOf("router.get('/list'", start);
    const body = billingSrc.slice(start, end === -1 ? undefined : end);
    expect(body).toContain('issueBilling(');
    expect(body, '차단 응답은 코어의 BillingIssueError를 그대로 옮겨야 코드·문구 계약이 유지된다').toContain('BillingIssueError');
    // 발행 본체(트랜잭션·장 분할)가 라우트에 되살아나면 코어와 두 벌이 된다.
    expect(body, '발행 본체는 코어에만 있어야 한다').not.toContain('splitBillingSheets');
    expect(body, '발행 본체는 코어에만 있어야 한다').not.toContain("hashtext('billing')");
  });

  it('재발송은 확인을 받는다 — 잠근 행에서 기존 발송 이력을 보고 409로 되돌린다', () => {
    const start = billingSrc.indexOf("router.post('/:id/send-email'");
    const body = billingSrc.slice(start);
    expect(body).toContain('BILLING_ALREADY_EMAILED');
    expect(body, '재발송 확인 플래그가 없으면 확인 없이 중복 발송된다').toContain('resend');
  });

  it('정산 메일 본문은 서버가 만든다 — 화면 본문을 그대로 보내면 항목 정합 검사를 우회한다', () => {
    const start = billingSrc.indexOf("router.post('/:id/send-email'");
    const end = billingSrc.indexOf("router.post('/invoices/:id/send-email'", start);
    const body = billingSrc.slice(start, end === -1 ? undefined : end);
    expect(body).toContain('buildInvoiceLines');
    expect(body).toContain('checkInvoiceLinesAgainstHeader');
    expect(body, '요청 본문(body_html)을 메일 본문으로 쓰면 정합 검사가 무력해진다').not.toContain('body_html');
  });

  it('부가세는 vatOfSupply 하나로만 만든다 — 라우트에서 직접 곱하면 절사 규칙이 문서마다 갈린다 (2026-07-26)', () => {
    // 정산 헤더·장별·미리보기·거래내역서 네 곳이 각자 `Math.round(x * 0.1)`을 하고 있었다.
    expect(billingSrc, '부가세 산출은 utils/money.ts vatOfSupply만 쓴다')
      .not.toMatch(/Math\.round\(\s*\w*[sS]ubtotal\s*\*\s*0\.1\s*\)/);
    expect(billingSrc).toContain('vatOfSupply');
  });

  it('★공급가액은 장별 "절사된 항목줄 합"에서 파생된다 — 절사는 최종 금액에서 1회 (2026-07-30 Harold 정정)', () => {
    // 0726 "행 단위 절사"는 과대 해석이었다(서수란 0729 접수 — 항목표가 수량×단가와 수십 원 어긋남).
    // 새 계약: 일자행 정확값 → buildInvoiceLines 항목줄 절사 1회 → 헤더 = 장별 절사 합의 정수 덧셈.
    expect(issueSrc, '헤더는 장별 절사 합(sumFlooredInvoiceLines)에서 파생돼야 한다').toContain('sumFlooredInvoiceLines');
    expect(issueSrc, '장 공급가액도 같은 파생값을 쓴다(sheet.amount 직접 사용 금지 — 그건 정확값 축이다)').toContain('sheetFloored[sheetIdx]');
    expect(issueSrc, '헤더 교차검증은 정확값 축(amountExact)으로 해야 탐지력이 유지된다').toContain('i.amountExact');
    expect(issueSrc, '부가세 산출은 vatOfSupply만 쓴다').toContain('vatOfSupply');
    expect(issueSrc).not.toMatch(/Math\.round\(\s*\w*[sS]ubtotal\s*\*\s*0\.1\s*\)/);
    // 항목줄 절사의 소유자는 buildInvoiceLines 하나다 — 발행 코드가 따로 절사하면 두 절사가 갈라진다.
    const linesSrc = readFileSync(resolve(__dirname, 'billing-invoice-lines.ts'), 'utf8');
    expect(linesSrc, '항목줄 절사는 buildInvoiceLines 안에 있어야 한다').toMatch(/amount:\s*floorWon\(line\.amount\)/);
  });

  it('청구서 항목표에 페이지 넘김이 있다 — 줄이 많으면 합계·감사 인사·하단을 뚫고 인쇄된다 (2026-07-26)', () => {
    // 웹만 쓰는 회사는 11줄이라 안 터지고, 에이전트가 섞이는 순간(발송ID마다 유형별 줄) 터지는 구조였다.
    const start = pdfSrc.indexOf('const drawItemHeader = ()');
    expect(start, '항목표 헤더 함수를 찾지 못했다').toBeGreaterThan(-1);
    const body = pdfSrc.slice(start, pdfSrc.indexOf('const invoiceLines = buildInvoiceLines', start));
    expect(body, '행을 그리기 전에 남은 높이를 봐야 한다').toContain('ITEM_TABLE_BOTTOM');
    expect(body, '넘칠 때 새 페이지를 열고 헤더를 다시 그려야 한다').toMatch(/doc\.addPage\(\)[\s\S]*drawItemHeader\(\)/);
  });

  it('청구 문서에 시스템 자동 생성 안내를 넣지 않는다 — 고객에게 나가는 문서다 (Harold 2026-07-26)', () => {
    expect(billingSrc).not.toContain('시스템에서 자동 생성되었습니다');
    expect(pdfSrc, 'PDF 그림 코드가 추출됐으므로 여기도 함께 본다 — 라우트만 보면 조용히 통과한다')
      .not.toContain('시스템에서 자동 생성되었습니다');
  });

  it('PDF 당사자 블록은 CT로만 그린다 — 고정 y 증가로 그리면 각자대표 회사에서 줄이 겹친다 (2026-07-26)', () => {
    // 금강제화(대표 2명) 실측: 대표 줄이 두 줄로 흐르는데 다음 줄을 14pt만 내려 사업자번호와 겹쳤다.
    expect(pdfSrc, 'PDF CT가 당사자 블록 CT를 써야 한다').toContain('drawPartyBlock');
    expect(pdfSrc, 'PDF CT에서 당사자 줄을 직접 그리면 같은 사고가 재발한다')
      .not.toMatch(/doc\.text\(`사업자번호: /);
    expect(billingSrc, '라우트에는 PDF 그림 코드가 남아 있으면 안 된다 — 생성기는 CT 하나다')
      .not.toContain('new PDFDocument(');
  });

  // ═══ 컨펌 메일·공개 페이지 계약 (★2026-07-28 — Harold 지시로 구조를 바꿨다) ═══

  it('컨펌 요청 메일은 거래내역서 PDF를 첨부한다 — 첨부가 빠지면 고객이 내역을 볼 방법이 없다', () => {
    expect(confirmSrc, '첨부 없이 보내면 안 된다').toContain('attachments');
    expect(confirmSrc, '장(billings 행)마다 그 장의 PDF를 렌더해야 한다 — 계정별은 계정 장이 각각이다')
      .toContain('renderBillingStatementPdf');
    expect(confirmSrc, '다운로드 라우트와 같은 로더를 써야 줄 순서가 갈리지 않는다')
      .toContain('loadBillingStatementData');
  });

  it('항목합이 공급가액과 어긋나면 메일을 보내지 않는다 — 틀린 문서는 회수가 안 된다', () => {
    expect(confirmSrc, '다운로드 라우트와 같은 정합 검사를 걸어야 한다')
      .toContain('checkInvoiceLinesAgainstHeader');
  });

  it('통지 대상을 메일보다 먼저 DB에 확정한다 — 적재 INSERT가 첫 SMTP보다 앞', () => {
    // 발송 성공 뒤에야 추적행을 만들면 "이 장이 통지됐는가"의 진실이 메일 뒤에만 생긴다.
    // 부분 발송·중복·고아 PDF는 전부 거기서 파생됐다. 행을 먼저 만들면 남은 행이 곧 재시도 목록이다.
    const claimIdx = confirmSrc.indexOf('INSERT INTO invoice_confirmations');
    const sendIdx = confirmSrc.indexOf('transporter.sendMail');
    expect(claimIdx, '적재 INSERT를 찾지 못했다').toBeGreaterThan(-1);
    expect(claimIdx, '적재가 발송 뒤로 가면 재구성 이전 구조로 되돌아간 것이다').toBeLessThan(sendIdx);
  });

  it('적재는 한 트랜잭션에서 장을 잠그고 이미 나갔거나 추적행이 있으면 건너뛴다', () => {
    const start = confirmSrc.indexOf('1단계: 적재');
    const body = confirmSrc.slice(start, confirmSrc.indexOf('2단계: 전송', start));
    expect(body, '장을 잠그지 않으면 동시 적재가 겹친다').toContain('FOR UPDATE');
    expect(body, '이미 발송된 장을 다시 적재하면 안 된다').toContain('emailed_at');
    expect(body, '살아 있는 추적행이 있으면 대상이 아니다').toMatch(/NOT NULL\) AS has_confirmation|has_confirmation/);
  });

  it('발송 소유권은 조건부 UPDATE 하나로 잡는다 — 0행이면 남이 가져간 것이다', () => {
    expect(confirmSrc).toMatch(/UPDATE billings SET emailed_at = NOW\(\)[\s\S]{0,120}emailed_at IS NULL RETURNING id/);
    expect(confirmSrc, '표시는 SMTP 앞에 남겨야 발송 중 삭제가 막힌다')
      .toSatisfy(() => confirmSrc.indexOf('emailed_at IS NULL RETURNING id') < confirmSrc.indexOf('transporter.sendMail'));
  });

  it('PDF는 보내기 직전에 만든다 — 미리 렌더하면 막힌 회차마다 렌더본이 쌓인다', () => {
    const claimIdx = confirmSrc.indexOf('INSERT INTO invoice_confirmations');
    const renderIdx = confirmSrc.indexOf('renderBillingStatementPdf(');
    expect(renderIdx, '렌더가 적재보다 앞이면 안 나간 PDF가 남는다').toBeGreaterThan(claimIdx);
  });

  it('재구성으로 걷어낸 장치가 되살아나지 않는다 — 행 상태가 자물쇠다', () => {
    expect(confirmSrc, '회사 세션 잠금은 durable 상태가 없던 시절의 보상 장치였다').not.toContain('pg_advisory_lock');
    expect(confirmSrc, 'preflight 사전 렌더도 마찬가지다').not.toContain('const prepared');
  });

  it('미발송 장은 발행을 다시 하지 않고 통지 단계만 재시도한다 — 재발행은 기간 중복에 막힌다', () => {
    expect(confirmSrc).toContain('retryUnsentConfirmations');
    expect(confirmSrc, '이미 나간 장은 대상이 아니다').toContain('b.emailed_at IS NULL');
    expect(billingSrc, '화면이 부를 경로가 없으면 복구 수단이 아니다').toContain("router.post('/bulk/retry-confirmations'");
    // batch_id는 장이 2개 이상일 때만 생긴다(billing-issue). 그걸로만 받으면 기본 발급(단일 장)에 안 닿는다.
    expect(billingSrc, '입력은 장 id여야 한다').toContain('billing_id');
    expect(billingSrc, 'batch_id를 입력으로 받으면 단일 장이 복구 불가가 된다').not.toContain('req.body || {}).batch_id');
  });

  it('발송 차단 사유를 금액 불일치와 인프라 장애로 나눠 센다 — 뭉치면 멀쩡한 묶음을 지우고 재발행하게 된다', () => {
    expect(confirmSrc, '금액이 틀린 장 — 재발송으로 안 풀린다').toContain('mismatchBlocked');
    expect(confirmSrc, '조회·렌더·디스크 장애 — 재시도하면 풀린다').toContain('renderFailed');
    expect(bulkSrc, '작업 결과 문구도 둘을 나눠 안내해야 한다').toContain('메일 재시도');
  });

  it('PDF 쓰기 스트림 오류를 reject로 올린다 — finish만 기다리면 디스크 오류에서 배치가 영원히 멈춘다', () => {
    expect(pdfSrc).toMatch(/stream\.on\('error'/);
    expect(pdfSrc, '부분 파일을 남기면 다음 실행이 헷갈린다').toMatch(/unlinkSync\(pdfPath\)/);
  });

  it('다운로드본은 응답 뒤 지운다 — 렌더마다 새 파일이라 정리하지 않으면 누를 때마다 쌓인다', () => {
    expect(billingSrc).toMatch(/fileStream\.on\('close'[\s\S]{0,160}unlinkSync\(pdfPath\)/);
  });

  it('메일 버튼은 컨펌 하나다 — "확인 · 컨펌" 합성 라벨은 누르는 순간 컨펌된 것처럼 읽힌다 (Harold 2026-07-28)', () => {
    expect(confirmSrc).not.toContain('거래내역서 확인 · 컨펌하기');
  });

  it('공개 페이지는 항목표를 다시 그리지 않는다 — 내역의 진실은 첨부 PDF 하나다 (Harold 2026-07-28)', () => {
    expect(publicSrc, '항목 줄 CT를 페이지에서 다시 쓰면 내역이 두 벌이 된다')
      .not.toContain('buildInvoiceLines');
    expect(publicSrc, 'billing_items를 페이지가 다시 조회하면 안 된다').not.toContain('FROM billing_items');
  });

  it('컨펌·이의신청은 바뀐 행 수를 확인하고 성공을 말한다 — 6원칙 ②', () => {
    // 상태 점검과 UPDATE 사이 경합에서 지면 0행인데, 그대로 success를 주면 화면이 "완료"를 띄운다.
    const confirmBlock = publicSrc.slice(publicSrc.indexOf("router.post('/:token/confirm'"), publicSrc.indexOf("router.post('/:token/objection'"));
    expect(confirmBlock, '컨펌이 rowCount를 안 본다').toMatch(/rowCount/);
    const objectionBlock = publicSrc.slice(publicSrc.indexOf("router.post('/:token/objection'"));
    expect(objectionBlock, '이의신청이 rowCount를 안 본다').toMatch(/rowCount/);
  });

  it('PDF 표시 이름과 디스크 경로는 분리돼 있다 — 같으면 동시 렌더가 같은 파일을 물고 재발행이 옛 문서를 덮는다', () => {
    expect(pdfSrc).toContain('buildDisplayFilename');
    expect(pdfSrc, '디스크 파일명은 렌더마다 달라야 한다(시각+난수)').toContain('buildDiskFilename');
    expect(pdfSrc, '디스크 이름에 난수가 없으면 동시 렌더가 겹친다').toContain('randomBytes');
    // 라우트는 표시 이름을 Content-Disposition에, 디스크 경로를 스트림에 쓴다.
    expect(billingSrc).toMatch(/Content-Disposition[\s\S]{0,80}encodeURIComponent\(displayFilename\)/);
  });

  it('메일 라우트는 PDF가 디스크에 있는지 추측하지 않는다 — 파일명 규칙이 바뀌면 조용히 깨지던 자리', () => {
    expect(billingSrc, '"먼저 다운로드하세요" 분기는 폐기됐다').not.toContain('BILLING_PDF_NOT_READY');
    expect(billingSrc).not.toContain('PDF가 아직 생성되지 않았습니다');
  });

  it('사업자등록번호는 트랜잭션 전에 전부 검증하고 어느 계정인지 알려준다', () => {
    const putIdx = billingSrc.indexOf("router.put('/company-billing-settings/:companyId'");
    const beginIdx = billingSrc.indexOf("client.query('BEGIN')", putIdx);
    const preamble = billingSrc.slice(putIdx, beginIdx);
    expect(preamble, 'BEGIN 뒤에서 던지면 같이 넣은 다른 값까지 롤백된다').toContain('normalizeBizNumber');
    expect(preamble, '오류에 계정 라벨이 붙어야 한다').toContain('c.label');
  });

  it('정산 목록에서 발행됨·미발송 장을 다시 찾을 수 있다 — 발송이 막힌 장은 컨펌 목록에 안 뜬다', () => {
    expect(billingSrc).toContain('b.emailed_at IS NULL');
  });

  it('소스에 NUL 바이트가 없다 — 조립·치환 중 제어문자가 섞이면 도구가 파일을 바이너리로 본다', () => {
    for (const [name, src] of [['billing-pdf', pdfSrc], ['invoice-confirm', confirmSrc], ['invoice-public', publicSrc], ['billing', billingSrc]] as const) {
      expect(src.includes(String.fromCharCode(0)), `${name}.ts에 NUL 바이트가 있다`).toBe(false);
    }
  });

  it('발행·삭제·메일이 전부 같은 트랜잭션 헬퍼를 쓴다 — pool.query로 BEGIN을 걸면 커넥션이 갈려 트랜잭션이 성립하지 않는다', () => {
    // `pool.query('BEGIN')`이 있으면 그 트랜잭션은 서로 다른 커넥션에 나뉜다(0725 실제 결함).
    expect(billingSrc).not.toMatch(/pool\.query\(\s*['"`]BEGIN/);
    expect(adminSrc).not.toMatch(/pool\.query\(\s*['"`]BEGIN/);
    expect(issueSrc, '발행 코어도 같은 규칙 — client 고정 트랜잭션만').not.toMatch(/pool\.query\(\s*['"`]BEGIN/);
  });

  // ★ 2026-08-05 서수란 접수 2건 — 축을 되돌리면 그날의 사고가 그대로 돌아온다.
  it('최소과금 정액 발행은 plan_id 존재로 막지 않는다 — 체험 만료 회사는 FREE(월정액 0)로 강등돼도 plan_id가 남는다', () => {
    // 그 축으로 막으면 화면에 "요금제 미가입"으로 보이는 회사가 정액 발행에서 거부된다(씨티케이이비전 실측).
    expect(issueSrc).not.toMatch(/if\s*\(\s*ledger\.companyPriceRow\?\.plan_id\s*\)/);
    // 판정은 **그 기간에 요금제 요금이 청구되는가** — 발행 코어와 같은 함수로 구한다.
    const guard = issueSrc.slice(issueSrc.indexOf('MIN_CHARGE_NOT_POSTPAID'), issueSrc.indexOf('MIN_CHARGE_PLAN_COMPANY'));
    expect(guard, '최소과금 가드가 기간 축 요금제 금액을 구하지 않는다').toContain('sumPlanSegments');
    expect(guard, '현재 축(월정액)이 빠지면 이력이 유실된 유료 회사를 놓친다').toContain('plan_monthly_price');
  });

  it('작성일자 지정은 컨펌 없이 발급 큐에 올리지 않는다 — ready는 팝빌 발행 큐다', () => {
    const at = billingSrc.indexOf("/confirmations/:id/issue-date");
    expect(at, '작성일자 지정 라우트를 찾지 못했다').toBeGreaterThan(-1);
    const route = billingSrc.slice(at, at + 3000);
    expect(route, "manual_wait → ready 승격에 confirmed_at 조건이 없다").toContain('confirmed_at IS NOT NULL');
    expect(route, '컨펌 전이라는 사유를 운영자에게 알려야 한다').toContain('TAXBILL_CONFIRM_REQUIRED');
  });

  it('발행 완료분은 재발행이 아니라 메일만 다시 보낸다 — 미수신 대응을 수정발행으로 하면 국세청에 한 장 더 나간다', () => {
    expect(billingSrc).toContain('/taxbill-issues/:id/resend-email');
    const popbillSrc = read('./taxbill-popbill.ts');
    const at = popbillSrc.indexOf('export async function resendIssuedTaxbillEmail');
    expect(at, '재발송 CT가 없다').toBeGreaterThan(-1);
    const fn = popbillSrc.slice(at, at + 3000);
    expect(fn, "발행이 끝난 장만 대상이다").toContain("!== 'issued'");
    expect(fn, '이 경로는 상태를 쓰지 않는다 — 쓰는 순간 발행 축과 겹친다').not.toMatch(/UPDATE\s+taxbill_issues/);
  });

  it('정산 회사 잠금은 CT 하나뿐이다 — 인라인으로 복사하면 그 복제본이 갈라져 한쪽만 막는다 (B-0805-1)', () => {
    // 기원: 같은 잠금이 7벌로 복제돼 있어 발행에만 회사 행을 더했더니 수동완료·080은 옛 축에 남았다.
    for (const [name, src] of [
      ['billing-issue', issueSrc], ['billing-bulk', bulkSrc], ['billing.ts', billingSrc],
      ['billing-080', read('./billing-080.ts')],
    ] as const) {
      expect(src.includes("hashtext('billing')"), `${name}에 인라인 정산 잠금이 남아 있다`).toBe(false);
    }
    const lockSrc = read('./billing-lock.ts');
    // 두 겹 — advisory(옛 축, 배포 호환)와 회사 행(정규 축, 표기 무관·요금제 변경과 직렬화).
    expect(lockSrc).toContain("hashtext('billing')");
    expect(lockSrc, '회사 행 잠금이 빠지면 표기가 갈린 두 요청이 나란히 통과한다').toContain('FOR NO KEY UPDATE');
    // FOR UPDATE면 자식 INSERT의 KEY SHARE까지 막는다 — 집계를 트랜잭션 안에서 도는 경로가 있어 그 몇 초가 전파된다.
    expect(lockSrc).not.toMatch(/companies WHERE id = \$1::uuid FOR UPDATE/);
    // 다건 정렬은 **DB가 만든다.** JS에서 정규화해 정렬하면 표기가 하나 늘 때마다 순서가 다시 뒤집힌다
    // (대소문자 → 중괄호 → 하이픈 생략으로 같은 부류가 세 번 났다). billing-lock.test.ts가 이 계약을 못 박는다.
    expect(lockSrc, '다건 순서를 DB에 묻지 않는다').toContain('ORDER BY c.id');
    expect(lockSrc, 'JS에서 다시 정렬하면 그 정렬이 다시 축이 된다').not.toContain('.sort()');
  });

  it('테스트베드 발행분 판정은 **행에 적힌 환경 표식**이다 — 승인번호 모양으로 가르면 팝빌 규칙이 바뀔 때 조용히 틀린다', () => {
    const at = billingSrc.indexOf('/taxbill-issues/:id/reissue-production');
    expect(at, '운영 재발행 라우트가 없다').toBeGreaterThan(-1);
    const route = billingSrc.slice(at, at + 4500);
    expect(route, '환경 표식으로 판정하지 않는다').toContain("'is_test'");
    expect(route, '승인번호 모양으로 가르고 있다').not.toMatch(/8888|nts_confirm_num\s*(LIKE|~)/);
    expect(route, '표식이 없을 때(백필 전) 되돌리면 사고다').toContain('DB_MIGRATION_PENDING');
    expect(route, '운영 발행 행이 이미 있으면 막아야 한다').toContain('TAXBILL_PRODUCTION_EXISTS');
    // 문서번호는 그대로 둔다 — 행마다 결정적이라 같은 번호로 나가는 것이 중복 방지 계약이다.
    expect(route, '문서번호를 지우면 다른 번호로 나가 중복 방지가 깨진다').not.toMatch(/invoicer_mgt_key\s*=\s*NULL/);
    // ★ Codex 수용 3종 — 되돌리기가 열리는 조건을 코드에 못 박는다.
    expect(route, '지금 환경이 테스트면 되돌려도 테스트베드로 또 나간다').toContain('TAXBILL_ENV_IS_TEST');
    expect(route, '수정 장은 당초 승인번호가 테스트베드 것이라 운영에 원본이 없다').toContain('TAXBILL_NOT_ORIGINAL');
    expect(route, "되돌리기 UPDATE도 원본으로 한정해야 한다").toMatch(/kind = 'original'/);
    // ★ 뿌리 — 되돌린 뒤 워커가 집기까지 사이에 환경이 바뀌면 테스트로 또 나간다. 목표를 행에 적고,
    //   워커는 자기 환경과 같은 행만 집는다. 요청 시점 확인만으로는 그 구간이 닫히지 않는다.
    expect(route, '목표 환경을 행에 적지 않으면 소비 시점에 보장이 없다').toMatch(/is_test = false/);
    // 발행 패스가 환경을 기록해야 다음부터 추측이 필요 없다.
    const popbillSrc = read('./taxbill-popbill.ts');
    expect(popbillSrc, '발행 시 환경을 행에 남기지 않는다').toContain('is_test = $3');
    expect(popbillSrc, '워커가 자기 환경과 다른 행을 집으면 안 된다').toContain("'AND is_test = $2'");
    // NULL 관용은 표식 없는 행을 양쪽 환경에 열어 격리를 되돌린다 — 컬럼이 NOT NULL이라 관용할 이유도 없다.
    expect(popbillSrc, 'claim에서 환경 판정을 COALESCE로 관용하면 격리가 무너진다').not.toContain('COALESCE(is_test');
  });

  it('취소된 장부는 멱등 판정에서 빠진다 — 안 빼면 취소 뒤 다시 발행하려 해도 조용히 멈춘다', () => {
    const workerSrc = read('./taxbill-worker.ts');
    expect(workerSrc, '워커의 NOT EXISTS가 cancelled를 세고 있다').toMatch(/t\.kind = 'original' AND t\.status <> 'cancelled'/);
    expect(billingSrc, '작성일자 지정의 NOT EXISTS가 cancelled를 세고 있다').toMatch(/t\.kind = 'original' AND t\.status <> 'cancelled'/);
    // 취소 창구 자체 — ★2026-08-07 `ready`(발급 대기 취소) + `failed`(실패 장 폐기)만 받는다.
    //   `submitted`는 팝빌에 올라갔을 수 있어 되돌리면 거짓 취소이고, `issued`는 수정세금계산서 축이다(§2-8).
    //   `failed`를 넣은 이유 = 실패 장을 없애는 길이 [재시도]뿐이라 목록에 영원히 남아 잘못 눌리게 유혹했다
    //   (크로커다일 수정 장 −3,903,325 — 국세청 전송이 끝난 뒤 재시도하면 정상 원본이 취소된다).
    const at = billingSrc.indexOf("/taxbill-issues/:id/cancel");
    expect(at, '발급 대기 취소 라우트가 없다').toBeGreaterThan(-1);
    // 경계는 **다음 라우트 선언**까지다. 고정 길이 슬라이스는 주석이 늘면 검사 대상 앞에서 잘려
    // "조건이 사라졌다"는 거짓 실패를 내고, 반대로 짧으면 남의 코드를 검사한다(0801 교훈).
    //   `at`은 주석 줄이라 바로 뒤 `router.post(`는 **이 라우트 자신의 선언**이다. 그것을 건너뛰고 다음 것을 경계로 삼는다.
    const ownDecl = billingSrc.indexOf('router.post(', at);
    const nextRoute = billingSrc.indexOf('router.post(', ownDecl + 10);
    const route = billingSrc.slice(at, nextRoute > ownDecl ? nextRoute : undefined);
    expect(route, '취소 대상은 ready 하나다').toContain("status = 'ready'");
    expect(route, 'submitted·issued가 취소 대상에 들어가면 거짓 취소·이중 문서가 된다').not.toContain("'submitted'");
    expect(route, '취소 뒤 추적행을 ready에 두면 어느 쪽으로도 못 간다').toContain("taxbill_status = 'manual_wait'");
    // ★ 2026-08-07 이 경로에서 드러난 기존 결함 둘. `failed` 폐기는 **넣지 않았다** —
    //   로컬 데이터로는 "국세청에 문서가 없다"를 증명할 수 없다(305는 발행됐는데 승인번호가 없다).
    expect(
      route,
      '웹훅이 304를 관측하면 failed를 ready로 되돌리며 승인번호를 적는다 — 그 행은 이미 나간 문서의 재확인 큐다',
    ).toContain('nts_confirm_num IS NULL');
    // ★ 2026-08-07(2) 양수 화이트리스트 — 음수 조건(IS DISTINCT FROM 1)은 사유 1만 막고
    //   미지·손상 코드를 단독 장으로 간주해 통과시킨다. 사유 1 쌍 차단은 화이트리스트가 흡수한다.
    expect(
      route,
      '내릴 수 있는 것은 원본과 단독 수정 장(2·4·6)뿐 — 미지 코드가 통과하면 쌍·손상 장이 한쪽만 내려간다',
    ).toContain("(kind = 'original' OR (kind = 'modify' AND modify_code IN (2, 4, 6)))");
    expect(route, '음수 조건이 되살아나면 미지 코드가 다시 통과한다').not.toContain('modify_code IS DISTINCT FROM 1');
    expect(route, 'failed 폐기는 이 경로에 없다').not.toContain("status IN ('ready', 'failed')");
  });

  it('수정(취소·정정) 장 재시도는 관문을 지난다 — 국세청에 있는 원본을 건드리는 문서다', () => {
    const at = billingSrc.indexOf("/taxbill-issues/:id/retry");
    expect(at, '재시도 라우트가 없다').toBeGreaterThan(-1);
    const ownDecl = billingSrc.indexOf('router.post(', at);
    const nextRoute = billingSrc.indexOf('router.post(', ownDecl + 10);
    const route = billingSrc.slice(at, nextRoute > ownDecl ? nextRoute : undefined);
    // 판정은 UPDATE 안에서 한다 — 밖에서 읽고 쓰면 그 사이 상태가 바뀐다.
    // ★ 2026-08-07(2) 양수 화이트리스트 — 무관문 재시도는 kind = original 뿐이다. 음수 조건(kind <> modify)은
    //   미지·손상 값을 무관문으로 통과시킨다.
    expect(
      route,
      '수정 장이 무가드로 재시도되면 국세청에 정상으로 올라가 있는 원본이 취소된다(크로커다일 −3,903,325)',
    ).toContain("kind = 'original' OR (kind = 'modify' AND ");
    expect(route, '음수 조건이 되살아나면 미지 종류가 무관문으로 통과한다').not.toContain("kind <> 'modify'");
    expect(route, '확인과 사유가 함께 있어야 통과한다').toContain('$2::boolean = true AND $3::text IS NOT NULL');
    expect(route, '원본 장 재시도는 그대로 — 안 나간 청구서를 같은 번호로 다시 보내는 것이라 안전하다').toContain("status = 'failed'");
  });

  it('폐기(cancelled)는 종단 상태다 — 늦게 온 웹훅이 되살리면 사유가 지워지고 재시도가 열린다', () => {
    const hookSrc = read('../routes/popbill-webhook.ts');
    const at = hookSrc.indexOf('UPDATE taxbill_issues');
    expect(at, '웹훅 갱신문을 찾지 못했다').toBeGreaterThan(-1);
    const stmt = hookSrc.slice(at, hookSrc.indexOf('RETURNING status', at));
    // ★ 2026-08-07(2) 상태·사유는 CASE 첫 분기가 지킨다(WHERE 제외가 아니다) — WHERE에서 빼면
    //   승인번호(외부 발행 증거)까지 함께 버려져, 취소가 먼저 커밋된 경합에서 증거가 로그에만 남는다.
    expect(
      stmt,
      '웹훅이 cancelled의 상태를 덮으면 사람이 내린 판단이 외부 신호로 뒤집힌다',
    ).toContain("WHEN status = 'cancelled' THEN status");
    expect(
      stmt,
      '웹훅이 cancelled의 사유(error)를 덮으면 취소 근거가 지워진다',
    ).toContain("WHEN status = 'cancelled' THEN error");
    expect(
      stmt,
      'cancelled 행에도 승인번호는 적어야 한다 — 이 증거가 없으면 재발행 길목이 막을 근거가 없다',
    ).toContain('nts_confirm_num = COALESCE($3, nts_confirm_num)');
    expect(stmt, 'WHERE에서 cancelled를 통째로 빼면 증거 기록까지 사라진다').not.toContain("status <> 'cancelled'");
    // 상태를 덮지 않는 대신 사실은 남겨야 한다 — 조용히 지나가면 아무도 모른다.
    expect(hookSrc, '폐기된 장에 외부 신호가 와도 기록이 없으면 대사할 수 없다').toContain('[팝빌웹훅][대사필요]');
  });

  it('취소된 장의 승인번호(대사 필요 증거)가 있으면 재발행 길목 전부가 막는다 — 외부에 실존하는 문서와 같은 건이 두 장 나간다', () => {
    // 증거 조건은 네 길목이 같은 모양이어야 한다 — 워커 CTE·작성일자 지정·삭제 가드·운영 재발행.
    const EVIDENCE_T = "t.status = 'cancelled' AND t.nts_confirm_num IS NOT NULL";
    const EVIDENCE_OR = "OR (status = 'cancelled' AND nts_confirm_num IS NOT NULL)";
    const workerSrc = read('./taxbill-worker.ts');
    expect(
      workerSrc,
      '워커가 대사 필요 건의 컨펌을 ready로 옮기면 새 원본이 나간다',
    ).toContain(EVIDENCE_T);
    expect(
      billingSrc,
      '작성일자 지정이 대사 필요 건을 재발행하면 이중 발행이다',
    ).toContain("code: 'TAXBILL_RECONCILE_REQUIRED'");
    expect(
      billingSrc,
      '작성일자 지정 관문의 증거 조건이 워커와 다르면 한쪽이 샌다',
    ).toContain(EVIDENCE_T);
    // 삭제 가드·운영 재발행 dup 체크 — 같은 OR 절이 두 곳에 있어야 한다.
    const count = billingSrc.split(EVIDENCE_OR).length - 1;
    expect(count, `삭제 가드·운영 재발행 dup 체크 두 곳에 증거 조건이 있어야 한다(현재 ${count}곳)`).toBeGreaterThanOrEqual(2);
    // ★ 운영 재발행 dup 체크는 failed 운영 원본도 막는다(Codex 2R) — 305는 팝빌에 문서가 실존할 수
    //   있고(승인번호 없음), failed의 올바른 처치는 그 행의 [재시도]다. 삭제 가드의 failed 확대는
    //   §7 getInfo 대사 별건과 묶인다(대사 없이 막으면 정정 경로가 전면 불능이 된다).
    expect(
      billingSrc,
      '운영 재발행 dup 체크가 failed 운영 원본을 통과시키면 서로 다른 관리키의 실제 문서가 중복된다',
    ).toContain("status IN ('ready', 'submitted', 'issued', 'failed')");
  });

  it('발행된 세금계산서가 붙은 정산은 재발행만이 아니라 **일반 삭제도** 막는다 — 지우면 고아 계산서가 남고 원본이 한 장 더 나간다', () => {
    const at = billingSrc.indexOf('BILLING_TAXBILL_ALREADY_ISSUED');
    expect(at, '세금계산서 가드를 찾지 못했다').toBeGreaterThan(-1);
    // 가드가 `if (reissue) {` 안에 있으면 사유를 적은 일반 삭제가 그대로 통과한다(B-0805-2 기원).
    const before = billingSrc.slice(0, at);
    const lastReissueOpen = before.lastIndexOf('if (reissue) {');
    const lastTargetIds = before.lastIndexOf('const targetIds =');
    expect(lastTargetIds, '가드는 삭제 대상 확정 뒤에 있어야 한다').toBeGreaterThan(-1);
    expect(lastReissueOpen, '가드가 재발행 분기 안에 갇혀 있다').toBeLessThan(lastTargetIds);
  });

  it('재발송 실패를 전부 422로 내리지 않는다 — 팝빌 게이트·SDK 장애가 입력 오류로 기록되면 알림·재시도가 막힌다', () => {
    const at = billingSrc.indexOf("/taxbill-issues/:id/resend-email");
    const route = billingSrc.slice(at, at + 2500);
    expect(route, '분류된 실패만 그 상태로 돌려줘야 한다').toContain('TaxbillResendError');
    expect(route, '미분류 장애는 500으로 올린다').toContain("code: 'TAXBILL_RESEND_FAILED'");
    // 게이트 닫힘은 503, 전 주소 실패는 502 — 운영자가 고칠 수 없는 것을 422로 위장하지 않는다.
    const popbillSrc = read('./taxbill-popbill.ts');
    expect(popbillSrc).toContain("TaxbillResendError(503, 'TAXBILL_POPBILL_GATE_OFF'");
    expect(popbillSrc).toContain("TaxbillResendError(502, 'TAXBILL_RESEND_ALL_FAILED'");
  });
});

// ★ 2026-08-21 080 고정료 자동 파생 + 세금계산서 작성일자 정합 (서수란 접수 · Codex 1R high 3건 수용).
//   런타임 테스트로는 SQL 조건·라우트 관문의 존재를 못 잡는다 — 소스 계약으로 고정한다.
describe('080 고정료 자동 파생·작성일자 계약 (2026-08-21)', () => {
  it('발행 코어의 080_base 생성은 소비된 080_call 검사를 포함한다 — 구 파생이 이미 청구한 달의 고정료 재청구 차단', () => {
    const at = issueSrc.indexOf("'080_base', '080 고정료(자동)'");
    expect(at, '080_base 자동 생성 INSERT를 찾지 못했다').toBeGreaterThan(-1);
    const body = issueSrc.slice(at, at + 1500);
    expect(body, '옛 고정료 행이 있는 달은 생성하지 않는다').toContain("pe.kind IN ('080_base', '080_fee', '080_svc')");
    expect(body, '소비된 통화료 스냅샷이 있는 달은 생성하지 않는다').toContain("pc.kind = '080_call'");
    expect(body, '소비 여부 조건이 빠지면 분할 2차 발행에서 재청구된다').toContain('pc.billed_billing_id IS NOT NULL');
  });

  it('최소과금 정액 발행은 고정료 있는 활성 080 매핑을 거부한다 — 자동 생성을 지나지 않는 경로라 그대로 두면 고정료가 영구 누락된다', () => {
    expect(issueSrc).toContain("MIN_CHARGE_080_MAPPING_ACTIVE");
    // 거부 축은 고정료(이용료·부가서비스 > 0)뿐이다(Codex 2R high 수용) — 통화료 축을 넣으면
    // 고정료 무료·통화료만 청구인 매핑이 스냅샷 0원·부재인 달에 어느 경로로도 발행 못 하는 교착이 된다.
    // 통화료 양수는 아래 기존 안전핀(스냅샷 파생 금액 거부)이 소유한다.
    const at = issueSrc.indexOf("MIN_CHARGE_080_MAPPING_ACTIVE");
    const before = issueSrc.slice(Math.max(0, at - 1600), at);
    expect(before).toContain('monthly_fee_supply > 0 OR kt_fee_supply > 0');
    expect(before).not.toContain('charge_call_fee = TRUE');
  });

  it('세금계산서 발행 claim은 작성일자 도래 게이트를 지난다 — 미래 작성일자는 그날 발행(KST), NULL은 집어서 드러낸다', () => {
    const popbillSrc = read('./taxbill-popbill.ts');
    expect(popbillSrc).toContain("issue_date IS NULL OR issue_date <= (NOW() AT TIME ZONE 'Asia/Seoul')::date");
  });

  it('작성일자 변경은 "외부 호출 없음이 행으로 증명되는 건"만 허용한다 — 승인번호 부재 ≠ 외부 문서 부재(Codex 1R~4R)', () => {
    // ★ 4R medium 수용 — 앵커는 설명 주석이 아니라 라우트 선언이다(주석만 남아도 통과하는 함정 제거).
    const at = billingSrc.indexOf("router.put('/taxbill-issues/:id/issue-date'");
    expect(at, '작성일자 변경 라우트 선언을 찾지 못했다').toBeGreaterThan(-1);
    const route = billingSrc.slice(at, at + 5500);
    // 허용 화이트리스트 2종 — 그 외 전부 거부(TAXBILL_ISSUE_DATE_UNSAFE). 팝빌 조회는 하지 않는다
    //   (외부로 나간 적 있는 요청의 부재는 로컬에서 완전하게 증명할 수 없다 — 4R 지연 완료·환경·빈 키).
    // ★ 5R — ①은 엄격 NULL(빈 문자열·공백 fail-open 차단), 수신자 미등록은 허용 근거가 못 된다
    //   (registIssue 성공 후 submitted 재claim에서 수신자 실패가 error를 덮는 반례).
    expect(route, '채번 전 판정은 엄격 NULL').toContain('invoicer_mgt_key == null');
    expect(route, '수신자 실패는 허용 근거가 아니다').not.toContain("rowErr.includes('세금계산서 수신자");
    expect(route, '-11002009 = 팝빌 검증 거절 완결 응답 = 미등록 확정').toContain('-11002009');
    expect(route, '화이트리스트 밖은 전부 거부').toContain("TAXBILL_ISSUE_DATE_UNSAFE");
    expect(route, '외부 조회 관문은 걷어냈다 — 되살리면 4R의 fail-open 부류가 돌아온다').not.toContain('checkPopbillDocExists');
    // ★ 5R medium — 컨펌 동기화는 superseded 행을 덮지 않는다.
    expect(route, 'superseded 컨펌 행 보호').toContain('superseded_at IS NULL');
    // 판정·쓰기는 행 잠금 안 단일 시퀀스 — SELECT의 FOR UPDATE가 UPDATE보다 앞(둘 다 실제 SQL 문자열).
    const lockAt = route.indexOf('FOR UPDATE`');
    const writeAt = route.indexOf('UPDATE taxbill_issues SET issue_date');
    expect(lockAt, '행 잠금 SELECT가 있어야 한다').toBeGreaterThan(-1);
    expect(lockAt, '쓰기는 잠금 뒤여야 한다').toBeLessThan(writeAt);
    // 컨펌 행 동기화 — 화면이 invoice_confirmations.taxbill_issue_date를 보여준다(이중 진실 차단).
    expect(route).toContain('UPDATE invoice_confirmations SET taxbill_issue_date');
  });

  it('화이트리스트의 근거가 되는 발행 패스 계약이 유지된다 — 채번은 외부 호출 직전·trim 기준 저장, 재시도는 자격을 지우지 않는다', () => {
    // invoicer_mgt_key 엄격 NULL = "집힌 적 없음"이 성립하려면 채번이 processOne 안(외부 호출 직전)에만
    // 있어야 하고, 공백 키 행도 저장이 일어나야 한다(5R — 생성 키로 호출하고 공백을 남기면 추적 유실).
    const popbillSrc = read('./taxbill-popbill.ts');
    const keyAt = popbillSrc.indexOf('buildInvoicerMgtKey(issueDate, id)');
    const registAt = popbillSrc.indexOf('await registIssueAsync(');
    expect(keyAt, '채번 지점을 찾지 못했다').toBeGreaterThan(-1);
    expect(registAt, '외부 호출 지점을 찾지 못했다').toBeGreaterThan(-1);
    expect(keyAt, '채번은 외부 호출보다 앞').toBeLessThan(registAt);
    expect(popbillSrc, '저장 판정도 trim 기준(공백 키 추적 유실 차단)')
      .toContain("if (!String(row.invoicer_mgt_key || '').trim())");
    // [재시도]가 error를 지우면 -11002009 행이 날짜 변경 자격을 잃고 복구 불능이 된다(5R medium).
    const retryAt = billingSrc.indexOf("router.post('/taxbill-issues/:id/retry'");
    const retryBody = billingSrc.slice(retryAt, retryAt + 2500);
    expect(retryBody, '재시도는 status만 올린다 — error 소거 금지').not.toContain('error = NULL');
  });
});
