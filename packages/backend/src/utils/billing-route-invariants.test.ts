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
    const start = billingSrc.indexOf("router.post('/generate'");
    const end = billingSrc.indexOf("router.get('/list'", start);
    const body = billingSrc.slice(start, end === -1 ? undefined : end);
    expect(body).toContain('BILLING_PLAN_HISTORY_CHANGED');
    expect(body, '재검증은 트랜잭션 client로 다시 읽어야 의미가 있다').toContain('loadPlanChanges(company_id, billing_end, client)');
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

  it('청구 금액은 원 미만 절사를 거친다 — 소수가 남으면 세금계산서와 안 맞고 PDF 칸을 넘겨 겹친다 (2026-07-26)', () => {
    const start = billingSrc.indexOf("router.post('/generate'");
    const end = billingSrc.indexOf("router.get('/list'", start);
    const body = billingSrc.slice(start, end === -1 ? undefined : end);
    // 공급가액은 절사된 상세 행의 정수 덧셈이어야 한다(헤더가 별도로 `수량 × 단가`를 더하면 소수가 되살아난다).
    expect(body).toContain('billingItems.reduce');
    expect(body, '헤더 교차검증은 절사 전 값(amountExact)으로 해야 탐지력이 유지된다').toContain('i.amountExact');
  });

  it('청구서 항목표에 페이지 넘김이 있다 — 줄이 많으면 합계·감사 인사·하단을 뚫고 인쇄된다 (2026-07-26)', () => {
    // 웹만 쓰는 회사는 11줄이라 안 터지고, 에이전트가 섞이는 순간(발송ID마다 유형별 줄) 터지는 구조였다.
    const start = billingSrc.indexOf('const drawItemHeader = ()');
    expect(start, '항목표 헤더 함수를 찾지 못했다').toBeGreaterThan(-1);
    const body = billingSrc.slice(start, billingSrc.indexOf('const invoiceLines = buildInvoiceLines', start));
    expect(body, '행을 그리기 전에 남은 높이를 봐야 한다').toContain('ITEM_TABLE_BOTTOM');
    expect(body, '넘칠 때 새 페이지를 열고 헤더를 다시 그려야 한다').toMatch(/doc\.addPage\(\)[\s\S]*drawItemHeader\(\)/);
  });

  it('청구 문서에 시스템 자동 생성 안내를 넣지 않는다 — 고객에게 나가는 문서다 (Harold 2026-07-26)', () => {
    expect(billingSrc).not.toContain('시스템에서 자동 생성되었습니다');
  });

  it('PDF 당사자 블록은 CT로만 그린다 — 고정 y 증가로 그리면 각자대표 회사에서 줄이 겹친다 (2026-07-26)', () => {
    // 금강제화(대표 2명) 실측: 대표 줄이 두 줄로 흐르는데 다음 줄을 14pt만 내려 사업자번호와 겹쳤다.
    expect(billingSrc).toContain('drawPartyBlock');
    expect(billingSrc, '라우트에서 당사자 줄을 직접 그리면 같은 사고가 재발한다')
      .not.toMatch(/doc\.text\(`사업자번호: /);
  });

  it('발행·삭제·메일이 전부 같은 트랜잭션 헬퍼를 쓴다 — pool.query로 BEGIN을 걸면 커넥션이 갈려 트랜잭션이 성립하지 않는다', () => {
    // `pool.query('BEGIN')`이 있으면 그 트랜잭션은 서로 다른 커넥션에 나뉜다(0725 실제 결함).
    expect(billingSrc).not.toMatch(/pool\.query\(\s*['"`]BEGIN/);
    expect(adminSrc).not.toMatch(/pool\.query\(\s*['"`]BEGIN/);
  });
});
