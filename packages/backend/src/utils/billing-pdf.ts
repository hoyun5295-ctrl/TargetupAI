/**
 * ★ CT: 정산서·거래내역서 PDF 생성 (2026-07-28 추출)
 *
 * SoT = docs/2026-07-28-bulk-invoice-confirm-taxbill-design.md §6.
 * 소비처: 슈퍼관리자 다운로드 라우트(`GET /:id/pdf`·`GET /invoices/:id/pdf`) ·
 *         정산서·거래내역서 메일 첨부 · 컨펌 요청 메일 첨부(일괄발급).
 *
 * 추출 이유: PDF가 라우트 안에만 있어서 **일괄발급 경로에는 PDF 생성 자체가 없었다.**
 *   그래서 컨펌 요청 메일이 내역을 첨부하지 못하고 웹페이지에서 항목표를 다시 그려야 했다.
 *   생성기를 여기로 모아 라우트·메일·발급이 같은 함수를 쓴다(no_inline_duplication).
 *
 * ⚠ 동작 무변경 추출이다. 그림 코드는 라우트에 있던 것을 그대로 옮겼고 좌표·문구를 손대지 않았다.
 *   `__dirname` 기준 경로(`../../fonts`·`../../pdfs`)는 routes/ 와 utils/ 가 같은 깊이라 그대로 유효하다.
 *   그림 함수는 DB를 모른다 — 데이터는 넘겨받고, `pdf_path` 기록도 호출부 몫이다.
 *   읽기는 `loadBillingStatementData` 하나만 둔다(라우트·메일이 같은 행·같은 정렬을 쓰게 하려고).
 */

import { INVITO_INFO } from '../config/defaults';
import { drawPartyBlock, drawThanksNote, THANKS_NOTE_HEIGHT } from './pdf-party-block';
import { toDayKey } from './send-usage-aggregation';
import { buildInvoiceLines } from './billing-invoice-lines';
import { resolveBillingScopeLabel } from './billing-scope-label';
import { getAgentCustNameMap } from './pay-stats';
import { floorWon } from './money';
import pool from '../config/database';
import { pickTaxbillParty } from './billing-settings';
import { randomBytes } from 'node:crypto';

export interface BillingStatementData { bil: any; items: any[]; }

/**
 * 정산서 PDF에 필요한 데이터 로드 (★2026-07-28 추출).
 * 다운로드 라우트와 컨펌 요청 메일이 **같은 행·같은 정렬**을 쓰게 한다 —
 * 각자 조회하면 정렬 tie-breaker 하나만 달라도 고객이 받는 두 문서의 줄 순서가 갈린다.
 * 없는 정산이면 null (호출부가 404/스킵을 정한다).
 */
export async function loadBillingStatementData(billingId: string, db: any = pool): Promise<BillingStatementData | null> {
  // 1) 정산 + 회사 정보
  const result = await db.query(
    // ★ 2026-07-29 공급받는자 사업자를 3단(계정 → 회사 → companies)으로 읽는다.
    //   그 전에는 `companies`만 봐서 정산 탭에 등록한 사업자가 인쇄물에 반영되지 않았다.
    //   단계 선택은 `pickTaxbillParty`(순수)가 하고 여기서는 **후보를 접두로 구분해 내려주기만** 한다 —
    //   SQL에서 COALESCE로 섞으면 상호와 대표자가 다른 사업자에서 조합된다.
    `SELECT b.*, c.company_name, c.business_number, c.ceo_name, c.address,
            c.contact_name, c.contact_phone, c.contact_email,
            c.business_type, c.business_category,
            u.name as user_name,
            bca.taxbill_company_name AS acct_taxbill_company_name,
            bca.taxbill_biz_number   AS acct_taxbill_biz_number,
            bca.taxbill_ceo_name     AS acct_taxbill_ceo_name,
            bca.taxbill_address      AS acct_taxbill_address,
            bca.taxbill_biz_type     AS acct_taxbill_biz_type,
            bca.taxbill_biz_item     AS acct_taxbill_biz_item,
            bcc.taxbill_company_name AS co_taxbill_company_name,
            bcc.taxbill_biz_number   AS co_taxbill_biz_number,
            bcc.taxbill_ceo_name     AS co_taxbill_ceo_name,
            bcc.taxbill_address      AS co_taxbill_address,
            bcc.taxbill_biz_type     AS co_taxbill_biz_type,
            bcc.taxbill_biz_item     AS co_taxbill_biz_item
     FROM billings b
     JOIN companies c ON c.id = b.company_id
     LEFT JOIN users u ON u.id = b.user_id
     LEFT JOIN billing_contacts bca ON bca.company_id = b.company_id AND bca.user_id = b.user_id
     LEFT JOIN billing_contacts bcc ON bcc.company_id = b.company_id AND bcc.user_id IS NULL
     WHERE b.id = $1`,
    [billingId]
  );
  if (result.rows.length === 0) {
    return null;
  }
  const bil = result.rows[0];

  // 2) 일자별 상세
  const itemsResult = await db.query(
    // ★ 2026-07-26 정렬에 channel·발송ID 추가. 축이 계정·발송ID로 쪼개지면서 같은 날 같은 유형 행이
    //   여러 줄 생기는데 tie-breaker가 없어 순서가 비결정적이었다(D150-4와 같은 계열).
    // ★ 2026-07-26 발송ID 병기 — 에이전트 행이 어느 발송ID 것인지가 정산 대조의 근거다.
    //   JOIN 대상(`company_agent_ids.id`)·FK(`billing_items_agent_id_fkey`)는 pg_constraint 실측 확인분.
    // ★ 2026-07-31 계정명 병기(서수란 접수) — 구분 칸이 웹 행에 늘 '한줄로'만 찍어
    //   한 회사 안에서 어느 계정(지점)이 쓴 발송인지 청구서로 구분할 수 없었다.
    //   값은 이미 `bi.user_id`에 있었고 읽는 쪽이 users를 안 붙였을 뿐이다(admin.ts:1505와 같은 조인 형태).
    `SELECT bi.*, cai.agent_send_id, u.name AS user_name, u.login_id AS user_login_id
       FROM billing_items bi
       LEFT JOIN company_agent_ids cai ON cai.id = bi.agent_id
       LEFT JOIN users u ON u.id = bi.user_id
      WHERE bi.billing_id = $1
      ORDER BY bi.channel ASC, bi.item_date ASC, bi.message_type ASC,
               cai.agent_send_id ASC NULLS FIRST, bi.user_id ASC NULLS FIRST, bi.id ASC`,
    [billingId]
  );
  // ★ 2026-07-31 (Codex 적대검증) 발급명 보강을 **공용 로더로** 옮긴다.
  //   그 전에는 상세 모달(routes/billing.ts)만 getAgentCustNameMap을 붙여서, 같은 청구서인데
  //   화면은 `B0082 / 금강제화`, 다운로드·메일 PDF는 `B0082`로 갈렸다 — 라벨 단일화의 목적 자체가 무너진다.
  //   조회 실패해도 발송ID는 그대로 나온다(이름만 비는 폴백).
  const custNameMap = await getAgentCustNameMap().catch(() => new Map<string, string>());
  const items = itemsResult.rows.map((r: any) => ({
    ...r,
    cust_name: r.agent_send_id ? custNameMap.get(String(r.agent_send_id)) || null : null,
  }));

  return { bil, items };
}

export interface RenderedPdf {
  /** 디스크 절대 경로 — 렌더마다 다르다. 다운로드 스트리밍·메일 첨부의 `path`로 쓴다. */
  pdfPath: string;
  /** 고객이 보는 이름 — 첨부·`Content-Disposition`에 쓴다. 디스크 경로와 다르다. */
  displayFilename: string;
}

/**
 * 파일명 규칙 (★2026-07-28 — 표시 이름과 디스크 경로를 분리한다).
 *
 * 왜 나누나:
 *  - 표시 이름을 디스크 경로로 그대로 쓰면 **같은 장을 두 번 렌더할 때 같은 파일에 두 스트림이 붙는다.**
 *    배치가 도는 중 슈퍼관리자가 그 장을 다운로드하거나 재발송을 누르면 겹치고, 결과는 깨진 PDF다.
 *  - 재발행 때 이전 문서를 덮어써서 "그때 고객에게 보낸 문서"의 서버 사본이 사라진다. 세금계산서 분쟁의 증거다.
 *  - 고객이 받는 첨부 이름이 `billing_1a2b3c4d_2026_07.pdf`면 무슨 문서인지 알 수 없다.
 * ⇒ 디스크는 렌더마다 새 파일(시각+난수), 표시 이름은 사람이 읽는 이름.
 */
const sanitizeForFilename = (s: any): string =>
  String(s ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40) || '고객사';

/** 고객이 보는 이름. 문서 이름은 화면·메일과 같은 말을 쓴다(거래내역서). */
export function buildDisplayFilename(companyName: any, periodLabel: string): string {
  return `거래내역서_${sanitizeForFilename(companyName)}_${periodLabel}.pdf`;
}

/** 상세 표 한 행의 기본 높이 — 한 줄로 끝나는 행은 예전 그대로 이 값을 쓴다. */
export const DETAIL_ROW_MIN_H = 18;
/** 행 안쪽 위·아래 여백. 글자를 그리는 y 오프셋과 **같은 값**이어야 칸 가운데를 벗어나지 않는다. */
export const DETAIL_ROW_PAD_Y = 5;

/**
 * 표 칸에 들어갈 문자열의 **개행·제어문자를 없앤다** (★ 2026-08-06 · Codex 5R medium).
 *
 * 행 높이를 내용에서 만들기 때문에, 값 안에 줄바꿈이 들어 있으면 글자 수와 무관하게 줄이 늘어난다.
 * `users.name`은 `varchar(100)`이지만 그것은 **글자 수 제한이지 줄 수 제한이 아니다** —
 * 개행 62개가 든 64자 값이면 63줄이 되어 한 행이 페이지의 표 영역(663pt)을 넘는다.
 * 여기서 한 줄로 만들면 **줄 수가 칸 폭으로만 결정되므로** 그 상한이 코드로 성립한다.
 * 게이트웨이 원장에서 오는 발급명(`cust_name`)처럼 우리가 형식을 통제하지 못하는 값이 이 칸에 들어온다.
 *
 * ⛔ **`\s`로 지우면 안 된다**(0806 실측 · Codex 6R high). 두 방향으로 틀린다 —
 *   ① JS `\s`는 **U+0085(NEL)를 포함하지 않는데** pdfkit은 그것을 강제 개행으로 처리한다.
 *      `A + U+0085×62 + B`는 `varchar(100)` 안의 64자이면서 63줄이 되어 상세표 영역(663pt)을 넘는다.
 *   ② 반대로 `\s`는 NBSP·전각 공백을 포함해서, 그것들을 ASCII 공백으로 바꾸면 **발급명 표시가 변형된다**
 *      (`더화이트 커뮤니케이션　본점`의 전각 공백이 사라진다).
 * ⇒ **강제 개행을 만드는 문자만** 골라 공백으로 바꾸고 정상 공백은 건드리지 않는다.
 *   실측으로 LF·CR·VT·FF·NEL·LS·PS가 전부 강제 개행이고, 아래 범위(C0·DEL·C1·LS·PS)가 그 일곱을 덮는다.
 */
export function toSingleLine(value: any): string {
  // 정규식 리터럴에 제어문자를 적지 않는다 — 소스에 그대로 실려 파일이 바이너리로 잡힌다.
  //   판정은 코드포인트로 한다: C0(0x00~0x1F) · DEL(0x7F) · C1(0x80~0x9F, U+0085 NEL 포함) · LS · PS.
  let out = '';
  let gap = false;
  for (const ch of String(value ?? '')) {
    const c = ch.codePointAt(0) ?? 0;
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029) {
      gap = out.length > 0;   // 연속된 강제 개행은 공백 하나로 접는다
      continue;
    }
    if (gap) { out += ' '; gap = false; }
    out += ch;
  }
  return out.trim();
}

/**
 * 표 한 행의 높이를 **내용에서 만든다** (★ 2026-08-06 · 서수란 접수 "PDF 구분값 데이터 검증 이슈").
 *
 * 무엇이 문제였나: 구분 칸이 `B0093 / 더화이…`로 잘려 나가 업체가 내역을 대조할 수 없었다(더화이트 클레임).
 *   0731에 넣은 말줄임(`fitToWidth`)이 그 원인인데, 그 말줄임은 **행 높이가 고정**이라
 *   두 줄이 되는 순간 다음 행을 침범하기 때문에 넣은 응급 처치였다. 뿌리는 폭이 아니라 고정 높이다.
 *
 * 폭으로는 닫히지 않는다 (8pt 맑은고딕 실측):
 *   `B0093 / 더화이트커뮤니케이션` = 111.1pt인데, 표 495pt 안에서 나머지 8열을 실제 필요폭까지
 *   깎아도 구분 칸에 줄 수 있는 최대가 약 105pt다. 넓히는 방향은 임계값만 옮기고 다음 회사에서 재발한다.
 * ⇒ 넘치면 줄바꿈하고 행이 그만큼 높아진다. **잘리지 않고 다음 행과 겹치지도 않는다.**
 *   ⚠ 보장은 **그 행이 새 페이지의 표 영역에 들어갈 때까지**다 — 경계를 넘으면 페이지를 한 번 더할 뿐
 *   행 자체를 쪼개지는 않는다(상세표 663pt · 항목표 520pt). 강제 개행은 `toSingleLine`이 지우므로
 *   줄 수는 칸 폭으로만 결정되고, 한글 100자가 10줄(약 114pt)이라 663pt를 채우려면 62줄이 필요하다.
 *
 * 늘어나는 것은 실제로 두 줄 이상이 된 행뿐이다 — 한 줄 행은 예전 높이 그대로라 대부분 문서의 쪽수가 안 바뀐다.
 * 1페이지 항목표와 2페이지 상세표가 **같은 함수**를 쓴다(최소 높이만 다르다) — 둘이 갈리면 한쪽만 또 굳는다.
 * 높이 측정(`heightOfString`)은 현재 폰트·크기 기준이므로 반드시 setFont·fontSize 뒤에서 부른다.
 */
export function contentRowHeight(minHeight: number, lineHeight: any, ...textHeights: any[]): number {
  const floor = Number(minHeight) > 0 ? Number(minHeight) : DETAIL_ROW_MIN_H;
  const oneLine = Number(lineHeight) || 0;
  // 측정 실패(폰트 미로드 등)면 옛 고정 높이로 돌아간다 — 렌더가 죽거나 0높이 행이 나오는 것보다 낫다.
  if (oneLine <= 0) return floor;
  let lines = 1;
  for (const h of textHeights) {
    const n = Math.max(1, Math.round((Number(h) || 0) / oneLine));
    if (n > lines) lines = n;
  }
  return floor + Math.ceil((lines - 1) * oneLine);
}

/** 디스크 파일명 — 장 ID + 렌더 시각 + 난수. 덮어쓰기·동시 쓰기가 구조적으로 불가능하다. */
function buildDiskFilename(prefix: string, id: any): string {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15); // YYYYMMDDHHmmss
  return `${prefix}_${String(id ?? '').slice(0, 8)}_${stamp}_${randomBytes(3).toString('hex')}.pdf`;
}

/**
 * 거래내역서 PDF (`billings` 축). `bil` = billings + companies 조인 행, `items` = billing_items 행.
 * 컨펌 요청 메일 첨부이자 슈퍼관리자 다운로드 문서다 — 고객이 실제로 받는 것이 이것이다.
 */
export async function renderBillingStatementPdf(bil: any, items: any[]): Promise<RenderedPdf> {
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
    const displayFilename = buildDisplayFilename(
      bil.company_name, `${bil.billing_year}-${String(bil.billing_month).padStart(2, '0')}`,
    );
    const pdfPath = path.join(pdfDir, buildDiskFilename('billing', bil.id));
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
    // ★ 2026-07-28 문서 이름을 '거래내역서'로 통일(Harold 지시). 화면·메일·첨부가 같은 말을 써야
    //   고객이 "정산서와 거래내역서가 각각 뭔가"를 묻지 않는다. 이 PDF가 곧 컨펌 메일 첨부다.
    doc.fontSize(22).fillColor(primary).text('거래내역서', 50, 50);
    setFont(false);
    doc.fontSize(9).fillColor(gray).text('INVOICE', 50, 78);

    const rightX = 350;
    setFont(false);
    doc.fontSize(9).fillColor(gray);
    doc.text('문서번호:', rightX, 50, { continued: true });
    setFont(true);
    doc.fillColor(dark).text(`  BIL-${bil.id.slice(0, 8).toUpperCase()}`);
    setFont(false);
    doc.fontSize(9).fillColor(gray);
    doc.text('발행일:', rightX, 65, { continued: true });
    doc.fillColor(dark).text(`  ${toDayKey(new Date())}`);
    // ★ 2026-07-26 `toISOString()` 폐기. PG `date`는 로컬 자정 Date로 오므로 ISO로 바꾸면 하루 밀린다.
    //   집계(`toDayKey`)만 고치고 렌더를 안 고치면 청구서에 찍히는 날짜가 그대로 밀린 채 나간다.
    const fmtDate = (d: any) => toDayKey(d);
    doc.text('정산기간:', rightX, 80, { continued: true });
    doc.fillColor(dark).text(`  ${fmtDate(bil.billing_start)} ~ ${fmtDate(bil.billing_end)}`);

    if (bil.user_name) {
      setFont(false);
      doc.fontSize(9).fillColor(gray);
      doc.text('사용자:', rightX, 98, { continued: true });
      // ★ 2026-08-06 표 밖 표기도 같은 값이 들어온다 — 개행이 살아 있으면 아래 구분선(고정 y)과 겹친다.
      doc.fillColor(dark).text(`  ${toSingleLine(bil.user_name)}`);
    }

    doc.moveTo(50, bil.user_name ? 118 : 115).lineTo(545, bil.user_name ? 118 : 115).strokeColor('#e5e7eb').stroke();

    // 공급자 / 공급받는자
    // ★ 2026-07-26 고정 y 증가(+14) 폐기. 대표자가 두 명인 회사(각자대표)는 대표 줄이 칸 폭을 넘어
    //   두 줄로 흐르는데 다음 줄을 14pt만 내려서 사업자번호 줄과 겹쳐 인쇄됐다(Harold 실측).
    //   블록이 실제로 끝난 y를 받아 구분선·항목표 시작을 거기서 잡는다 — 고정 좌표를 남기면 재발한다.
    const partyTop = 130;
    const leftBottom = drawPartyBlock(doc, {
      x: 50, y: partyTop, width: rightX - 50 - 20, title: '공급자', primary, dark, setFont,
      lines: [
        { label: '상호', value: INVITO_INFO.companyName },
        { label: '대표', value: INVITO_INFO.ceoName },
        { label: '사업자번호', value: INVITO_INFO.bizNumber },
        { label: '업태/종목', value: INVITO_INFO.bizType },
        { label: '주소', value: INVITO_INFO.address },
        { label: '연락처', value: `${INVITO_INFO.phone} / ${INVITO_INFO.email}` },
      ],
    });
    // ★ 2026-07-29 계정 → 회사 → companies 3단에서 **묶음으로** 고른다(섞으면 유령 사업자가 찍힌다).
    const party = pickTaxbillParty(bil);
    const rightBottom = drawPartyBlock(doc, {
      x: rightX, y: partyTop, width: 545 - rightX, title: '공급받는자', primary, dark, setFont,
      lines: [
        { label: '상호', value: party.companyName || '-' },
        { label: '대표', value: party.ceoName || '-' },
        { label: '사업자번호', value: party.bizNumber || '-' },
        { label: '업태/종목', value: `${party.bizType || '-'} / ${party.bizItem || '-'}` },
        { label: '주소', value: party.address || '-' },
        { label: '연락처', value: `${bil.contact_phone || '-'} / ${bil.contact_email || '-'}` },
      ],
    });

    const partyBottom = Math.max(leftBottom, rightBottom);
    doc.moveTo(50, partyBottom + 4).lineTo(545, partyBottom + 4).strokeColor('#e5e7eb').stroke();

    // 내역 테이블
    // ★ 2026-07-26 항목표에 **페이지 넘김**을 넣는다. 그 전에는 줄 수와 무관하게 y만 늘려서,
    //   항목이 많은 회사(웹+에이전트 병용·발송ID 여러 개)는 합계·감사 인사·하단 안내를 뚫고 인쇄됐다.
    //   웹만 쓰는 회사는 11줄이라 안 터지고, 에이전트가 섞이는 순간 터지는 구조였다.
    const ITEM_ROW_H = 22;
    const ITEM_TABLE_BOTTOM = 620;   // 이 아래로는 새 줄을 그리지 않는다(합계 블록·감사 인사 자리 확보)
    let y = partyBottom + 19;

    const drawItemHeader = () => {
      doc.rect(50, y, 495, 25).fill(primary);
      setFont(true);
      doc.fontSize(9).fillColor('white');
      doc.text('항목', 60, y + 7);
      doc.text('수량', 250, y + 7, { width: 80, align: 'right' });
      doc.text('단가', 340, y + 7, { width: 80, align: 'right' });
      doc.text('금액', 430, y + 7, { width: 105, align: 'right' });
      y += 25;
    };
    drawItemHeader();

    // ★ 2026-07-26 `quantityText`가 있으면 수량 칸을 그 문구로 쓴다 — 요금제는 `9일 / 31일`이다.
    //   없으면 `0건 × ₩350,000 = ₩101,613`이라는 거짓 산식이 인쇄된다.
    // ★ 2026-08-06 이 표도 2페이지 상세와 **같은 규약**이다 — 칸을 목록으로 먼저 만들고,
    //   같은 옵션으로 재고, 같은 목록으로 그린다. `lineBreak: false`는 `width`가 있으면 줄바꿈을
    //   막지 못한다는 것이 실측으로 확인됐다(0806). 그 옵션을 믿고 행 높이를 22pt로 굳혀 두면
    //   긴 항목명·큰 금액에서 다음 행과 겹친다 — 여기는 폭 여유가 커서 아직 안 터졌을 뿐 전제는 같다.
    const drawRow = (label: string, count: number, price: number, amount: number, bg = 'white', quantityText?: string) => {
      if (count <= 0 && !quantityText) return;
      const cells: { x: number; text: string; opts: any; bold?: boolean }[] = [
        { x: 60, text: toSingleLine(label), opts: { width: 185 } },
        { x: 250, text: toSingleLine(quantityText || count.toLocaleString()), opts: { width: 80, align: 'right' } },
        { x: 340, text: `₩${price.toLocaleString()}`, opts: { width: 80, align: 'right' } },
        { x: 430, text: `₩${amount.toLocaleString()}`, opts: { width: 105, align: 'right' }, bold: true },
      ];
      const cellHeights = cells.map((c) => {
        setFont(!!c.bold);
        doc.fontSize(9);
        return doc.heightOfString(c.text, c.opts);
      });
      setFont(false);
      doc.fontSize(9);
      const rowH = contentRowHeight(ITEM_ROW_H, doc.currentLineHeight(true), ...cellHeights);
      if (y + rowH > ITEM_TABLE_BOTTOM) {
        doc.addPage();
        y = 50;
        setFont(true);
        doc.fontSize(10).fillColor(primary).text('청구 내역 (계속)', 50, y);
        y += 25;
        drawItemHeader();
      }
      if (bg !== 'white') doc.rect(50, y, 495, rowH).fill(bg);
      for (const c of cells) {
        setFont(!!c.bold);
        doc.fontSize(9).fillColor(dark);
        doc.text(c.text, c.x, y + 6, c.opts);
      }
      y += rowH;
      doc.moveTo(50, y).lineTo(545, y).strokeColor('#e5e7eb').stroke();
    };

    // ★ 2026-07-26 항목표를 헤더 컬럼이 아니라 `billing_items`에서 만든다.
    //   헤더에는 에이전트 칸이 없는데 공급가액에는 에이전트 금액이 더해져,
    //   **고객이 항목을 세로로 더하면 공급가액과 안 맞는** 상태였다(1페이지↔2페이지 합계도 갈렸다).
    const invoiceLines = buildInvoiceLines(items);
    const CHANNEL_BG: Record<string, string> = { web: 'white', agent: '#eff6ff', test: '#fefce8', spam: '#fef3c7' };
    invoiceLines.forEach((line) => {
      drawRow(line.label, line.count, line.unitPrice, line.amount, CHANNEL_BG[line.channel] || 'white', line.quantityText);
    });
    drawRow('AI 크레딧', n(bil.ai_credit_count), n(bil.ai_credit_count) > 0 ? Math.round(n(bil.ai_credit_supply) / n(bil.ai_credit_count)) : 0, n(bil.ai_credit_supply), '#f5f3ff');

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

    // 합계 박스가 끝난 지점 — 감사 인사 위치를 여기서부터 잡는다(고정 y를 쓰면 항목 많은 회사에서 겹친다).
    let contentBottom = y + 28;
    if (bil.notes) {
      y += 50;
      setFont(true);
      doc.fontSize(9).fillColor(gray).text('비고:', 50, y);
      setFont(false);
      doc.fillColor(dark).text(bil.notes, 50, y + 15, { width: 495 });
      contentBottom = y + 15 + Math.ceil(doc.heightOfString(String(bil.notes), { width: 495 }));
    }

    // ★ 2026-07-26 감사 인사(Harold 지시). 청구서는 매달 고객에게 나가는 유일한 정기 문서다.
    //   합계·비고 아래, 자동생성 안내(y=770) 위에 둔다. 728 = 770 − 블록 높이 34 − 여백 8.
    // ★ 2026-07-26 자리가 없으면 **그리지 않는다**(Codex #11). 고정 728로 밀어 넣으면
    //   항목·비고가 길 때 기존 내용 위에 겹쳐 인쇄된다 — 없는 것보다 나쁘다.
    const thanksY = Math.max(contentBottom + 16, 690);
    if (thanksY + THANKS_NOTE_HEIGHT <= 762) {
      drawThanksNote(doc, {
        x: 50, y: thanksY, width: 495, primary, gray, setFont,
        message: `${bil.billing_month}월도 한줄로를 이용해 주셔서 감사합니다.`,
      });
    }


    // ============================
    // PAGE 2+ — 일자별 상세
    // ============================
    if (items.length > 0) {
      doc.addPage();

      setFont(true);
      doc.fontSize(14).fillColor(primary).text('일자별 상세 내역', 50, 50);
      setFont(false);
      doc.fontSize(9).fillColor(gray).text(
        toSingleLine(`${bil.company_name} | ${bil.billing_year}년 ${bil.billing_month}월${bil.user_name ? ' | ' + bil.user_name : ''}`),
        50, 72
      );

      doc.moveTo(50, 90).lineTo(545, 90).strokeColor('#e5e7eb').stroke();

      // 테이블 헤더
      // ★ 2026-07-26 '구분' 열 추가. 축이 채널·계정·발송ID로 쪼개지면서 같은 날 같은 유형 행이
      //   여러 줄 생기는데, 구분이 없으면 고객 눈에 중복 오류로 보인다.
      //   에이전트 행은 발송ID를 그대로 적는다 — 고객이 게이트웨이 쪽 통계와 대조하는 근거다.
      // ★ 2026-08-06 일자 칸의 남는 폭을 구분 칸으로 옮긴다(서수란 접수 — 더화이트 클레임).
      //   일자는 언제나 `MM-DD` 5자(8pt 실측 20.9pt)인데 칸 안쪽이 47pt로 26pt를 놀리고 있었다.
      //   일자 55→34 · 구분 70→91 — **합이 125로 같아** 유형(x=175) 이후 7열의 좌표는 그대로다.
      //   이 이동만으로 `B0228 / 제이씨패밀리`(79.1pt)·`B0082 / 금강제화`(63.1pt)·
      //   `스팸필터 · 관리자`(63.4pt)가 한 줄에 들어간다 — 그전에는 셋 다 잘렸다.
      //   더 긴 라벨은 줄바꿈으로 처리한다(`contentRowHeight`) — 폭을 계속 넓히는 방향으로 가지 않는다.
      const cols = [
        { label: '일자', x: 50, w: 34, align: 'left' as const },
        { label: '구분', x: 84, w: 91, align: 'left' as const },
        { label: '유형', x: 175, w: 55, align: 'left' as const },
        { label: '전송', x: 230, w: 48, align: 'right' as const },
        { label: '성공', x: 278, w: 48, align: 'right' as const },
        { label: '실패', x: 326, w: 45, align: 'right' as const },
        { label: '대기', x: 371, w: 45, align: 'right' as const },
        { label: '단가', x: 416, w: 55, align: 'right' as const },
        { label: '금액', x: 471, w: 74, align: 'right' as const },
      ];

      let iy = 95;
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
        TEST_SMS: '테스트SMS', TEST_LMS: '테스트LMS',
        SPAM_SMS: '스팸SMS', SPAM_LMS: '스팸LMS',
        // ★ 2026-07-30 080·부가서비스·최소과금 청구. 내부 키(EXTRA_*)는 고객에게 보일 값이 아니다.
        EXTRA_080_FEE: '080 이용료', EXTRA_080_SVC: '080 부가서비스', EXTRA_080_CALL: '080 통화료',
        EXTRA_MANUAL: '부가서비스', EXTRA_BASE_FEE: '기본요금',
      };

      let detailSubtotal = 0;
      items.forEach((item: any, idx: number) => {
        // ★ 2026-07-26 판정을 유형키 접두가 아니라 `channel`로. 접두 판정은 새 유형이 생기면 조용히 어긋난다.
        const ch = String(item.channel || 'web');
        // ★ 2026-07-26 일자 칸은 **모든 행이 시작일만**이다. 요금제 행에만 적용 구간(`07-01~07-26`, 11자)을
        //   넣었더니 칸 폭을 넘겨 두 줄로 흘러 다음 행과 겹쳤다(Harold 스크린샷 실측). 적용 구간은
        //   1페이지 항목표가 `요금제 FREE (07-01~07-26)` + `26일 / 31일`로 이미 담고 있어 정보 손실이 없다.
        const dateStr = toDayKey(item.item_date).slice(5, 10);
        // ★ 2026-07-31 구분 칸 판정을 CT 하나로 (PDF·상세 모달·화면 3면 동일).
        //   그 전에는 여기와 AdminDashboard에 인라인 두 벌이라 이미 갈려 있었다 —
        //   에이전트 발급명이 화면에만 있었고, `extra` 행은 화면에서 원문 'extra'로 노출됐다.
        const scopeLabel = resolveBillingScopeLabel(item);
        // 요금제 행의 '유형' 칸은 플랜 코드다 — `PLAN_` 접두는 내부 키라 고객에게 보일 값이 아니다.
        const typeText = ch === 'plan'
          ? String(item.message_type || '').replace(/^PLAN_/, '')
          : (typeLabel[item.message_type] || item.message_type);

        // ★ 2026-08-06 한 행의 칸을 **먼저 목록으로 만들고, 같은 목록으로 재고 같은 목록으로 그린다.**
        //   재는 옵션과 그리는 옵션이 다르면 행 높이가 실제 그림과 어긋난다(Codex 적대검증 high).
        //   ⚠ `lineBreak: false`는 **줄바꿈을 막지 못한다** — `width`가 있으면 그대로 흐른다
        //     (0806 실측: width 37pt에 긴 숫자를 넣으면 옵션 유무와 무관하게 `doc.y`가 21.28pt = 두 줄 이동).
        //     0726에 금액 칸을 지킨다고 넣은 그 옵션은 동작한 적이 없고 값이 칸보다 짧아서 안 터졌을 뿐이다.
        //     그래서 "이 칸은 안 흐른다"는 전제를 두지 않는다 — 전부 재서 행 높이에 넣는다.
        const cells: { col: number; text: string; opts: any; bold?: boolean; color?: string }[] = [
          { col: 0, text: toSingleLine(dateStr), opts: { width: cols[0].w - 8 } },
          // 구분·유형은 길이 제한이 없는 값(계정명·`발송ID / 발급명`·플랜코드)이라 폭으로는 못 덮는다.
          //   줄바꿈을 허용하고 행이 그만큼 커진다 — 말줄임 폐기(서수란 접수 "구분값 전체 출력").
          //   값 안의 개행은 `toSingleLine`이 지운다 — 남겨 두면 줄 수가 글자 수와 무관해져 상한이 사라진다.
          { col: 1, text: toSingleLine(scopeLabel), opts: { width: cols[1].w - 8 } },
          { col: 2, text: toSingleLine(typeText), opts: { width: cols[2].w - 8 } },
        ];
        if (ch === 'plan' || ch === 'extra') {
          // 수량 4칸 = '-'. 요금제 일수는 1페이지 `9일 / 31일`, 추가 항목(080 등)은 발송이 아니라 수량 축이 없다.
          [3, 4, 5, 6].forEach((c) => cells.push({ col: c, text: '-', opts: { width: cols[c].w - 8, align: 'right' } }));
        } else {
          cells.push({ col: 3, text: n(item.total_count).toLocaleString(), opts: { width: cols[3].w - 8, align: 'right' } });
          cells.push({ col: 4, text: n(item.success_count).toLocaleString(), opts: { width: cols[4].w - 8, align: 'right' } });
          cells.push({
            col: 5, text: n(item.fail_count).toLocaleString(), opts: { width: cols[5].w - 8, align: 'right' },
            color: n(item.fail_count) > 0 ? '#dc2626' : undefined,
          });
          cells.push({ col: 6, text: n(item.pending_count).toLocaleString(), opts: { width: cols[6].w - 8, align: 'right' } });
        }
        cells.push({ col: 7, text: `₩${n(item.unit_price).toLocaleString()}`, opts: { width: cols[7].w - 8, align: 'right' } });
        cells.push({ col: 8, text: `₩${n(item.amount).toLocaleString()}`, opts: { width: cols[8].w - 8, align: 'right' }, bold: true });

        // 행 높이를 **먼저** 만든다 — 페이지 넘김·배경 사각형·구분선·다음 행 시작이 전부 이 값을 쓴다.
        //   측정은 현재 폰트·크기 기준이라 칸마다 그릴 때와 같은 폰트로 맞춘 뒤 잰다
        //   (볼드 금액이 레귤러보다 넓어 한쪽만 흐르는 경우가 있다. 줄 높이는 두 폰트가 10.640625로 같다 — 0806 실측).
        const cellHeights = cells.map((c) => {
          setFont(!!c.bold);
          doc.fontSize(8);
          return doc.heightOfString(c.text, c.opts);
        });
        setFont(false);
        doc.fontSize(8);
        const rowH = contentRowHeight(DETAIL_ROW_MIN_H, doc.currentLineHeight(true), ...cellHeights);

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

        if (ch === 'plan') doc.rect(50, iy, 495, rowH).fill('#f5f3ff');
        else if (ch === 'spam') doc.rect(50, iy, 495, rowH).fill('#fef3c7');
        else if (ch === 'test') doc.rect(50, iy, 495, rowH).fill('#fefce8');
        else if (ch === 'agent') doc.rect(50, iy, 495, rowH).fill('#eff6ff');
        else if (idx % 2 === 0) doc.rect(50, iy, 495, rowH).fill('#fafafa');

        // 그리기는 위에서 잰 **그 목록·그 옵션 그대로**다. 여기서 옵션을 바꾸면 행 높이가 다시 어긋난다.
        const y0 = iy + DETAIL_ROW_PAD_Y;
        for (const c of cells) {
          setFont(!!c.bold);
          doc.fontSize(8).fillColor(c.color || dark);
          doc.text(c.text, cols[c.col].x + 4, y0, c.opts);
        }

        detailSubtotal += n(item.amount);
        iy += rowH;
        doc.moveTo(50, iy).lineTo(545, iy).strokeColor('#eeeeee').stroke();
      });

      // 합계 행 — Harold 실측(2026-07-26): `₩13,397,454.84`가 칸 폭을 넘겨 두 줄로 흘렀다.
      // ★ 2026-08-06 이 행도 **재서** 높이를 잡는다(일자행과 같은 규약). 자리가 모자라면 그리기 전에
      //   페이지를 넘긴다 — 그러지 않으면 배경 막대만 앞 페이지에 남고 금액 뒷자리가 다음 장에 찍힌다.
      // ★ 2026-07-30 합계 = 헤더 공급가액 − AI 크레딧(상세에 없는 축) — 1페이지 항목표와 정의상 일치.
      //   일자행이 정확값(소수)이 되면서 세로합(detailSubtotal)에 소수가 생길 수 있는데,
      //   Σ소수를 그대로 찍으면 0726 `₩13,397,454.84` 사고가 재현되고, floor(Σ)는 1페이지와 1원 갈릴 수 있다.
      //   최종 표시 금액은 항상 절사된 항목줄 합 하나에서 나온다(Harold 0730 — 절사는 최종 금액에서 1회).
      const detailTotalShown = floorWon(n(bil.subtotal) - n(bil.ai_credit_supply));
      const totalText = `₩${detailTotalShown.toLocaleString()}`;
      const totalOpts = { width: cols[8].w - 8, align: 'right' as const };
      iy += 4;
      setFont(true);
      doc.fontSize(9);
      const totalH = Math.max(22, Math.ceil(doc.heightOfString(totalText, totalOpts)) + 12);
      if (iy + totalH > doc.page.maxY()) {
        doc.addPage();
        iy = 50;
      }
      doc.rect(50, iy, 495, totalH).fill('#eef2ff');
      setFont(true);
      doc.fontSize(9).fillColor(primary);
      doc.text('합계 (원 미만 절사)', cols[0].x + 4, iy + 6);
      doc.text(totalText, cols[8].x + 4, iy + 6, totalOpts);
    }

    doc.end();
    // ★ 2026-07-28 finish만 기다리면 디스크 오류(권한·용량) 때 finish가 오지 않아 **영원히 대기**한다.
    //   메일 첨부가 이 경로를 타므로 일괄발급 배치가 통째로 멈춘다. error를 reject로 올리고 부분 파일은 지운다.
    await new Promise<void>((resolve, reject) => {
      stream.on('finish', () => resolve());
      stream.on('error', (streamErr: any) => {
        try { fs.unlinkSync(pdfPath); } catch { /* 정리 실패가 원인 오류를 가리지 않게 삼킨다 */ }
        reject(streamErr);
      });
    });

  return { pdfPath, displayFilename };
}

/**
 * 거래내역서 PDF용 행 로더 (★ 2026-07-29 신설).
 *
 * 신설 사유: 다운로드 라우트와 메일 발송 라우트가 **각자 SELECT를 적고 있었다.**
 *   메일 쪽은 사업자 필드를 아예 조회하지 않아, 같은 거래내역서인데 다운로드본에는 사업자가 찍히고
 *   고객이 받는 발송본에는 `-`가 찍혔다. 대외 문서가 서로 다른 말을 하는 상태였다.
 *   정산서(`loadBillingStatementData`)는 이미 단일 로더 구조다 — 거래내역서도 같게 만든다.
 *   ⚠ 이 함수 밖에서 거래내역서 행을 새로 조회하지 않는다. 복사하면 다시 갈라진다.
 */
export async function loadInvoicePdfData(invoiceId: string, db: any = pool): Promise<any | null> {
  const r = await db.query(
    `SELECT bi.*, c.company_name, c.business_number, c.ceo_name, c.address,
            c.contact_name, c.contact_phone, c.contact_email,
            c.business_type, c.business_category,
            bca.taxbill_company_name AS acct_taxbill_company_name,
            bca.taxbill_biz_number   AS acct_taxbill_biz_number,
            bca.taxbill_ceo_name     AS acct_taxbill_ceo_name,
            bca.taxbill_address      AS acct_taxbill_address,
            bca.taxbill_biz_type     AS acct_taxbill_biz_type,
            bca.taxbill_biz_item     AS acct_taxbill_biz_item,
            bcc.taxbill_company_name AS co_taxbill_company_name,
            bcc.taxbill_biz_number   AS co_taxbill_biz_number,
            bcc.taxbill_ceo_name     AS co_taxbill_ceo_name,
            bcc.taxbill_address      AS co_taxbill_address,
            bcc.taxbill_biz_type     AS co_taxbill_biz_type,
            bcc.taxbill_biz_item     AS co_taxbill_biz_item,
            -- ★ 2026-07-31 메일 수신자 해석도 **사업자 판정과 같은 계정 축**을 쓴다.
            --   축이 갈리면 공급받는자는 계정 사업자인데 메일은 회사 담당자에게 가는 상태가 된다.
            b.user_id                AS billing_user_id
       FROM billing_invoices bi
       JOIN companies c ON c.id = bi.company_id
       -- ★ 2026-07-29 연결된 정산의 **계정 축**까지 따라간다(billing_id는 nullable이라 LEFT JOIN).
       --   이게 없으면 계정 사업자가 등록된 정산에서 정산서는 account를, 거래내역서는 회사/기본을 골라
       --   같은 건에 대해 고객이 서로 다른 공급받는자를 받는다.
       LEFT JOIN billings b ON b.id = bi.billing_id
       LEFT JOIN billing_contacts bca ON bca.company_id = bi.company_id AND bca.user_id = b.user_id
       LEFT JOIN billing_contacts bcc ON bcc.company_id = bi.company_id AND bcc.user_id IS NULL
      WHERE bi.id = $1`,
    [invoiceId],
  );
  return r.rows.length === 0 ? null : r.rows[0];
}

/** 거래내역서(Invoice) PDF. `inv` = billing_invoices + companies 조인 행. */
export async function renderInvoicePdf(inv: any): Promise<RenderedPdf> {
    const PDFDocument = require('pdfkit');
    const fs = require('fs');
    const path = require('path');

    const fontPath = path.join(__dirname, '../../fonts/malgun.ttf');
    const fontBoldPath = path.join(__dirname, '../../fonts/malgunbd.ttf');
    const hasFont = fs.existsSync(fontPath);

    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    const pdfDir = path.join(__dirname, '../../pdfs');
    if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });
    const bStart = toDayKey(inv.billing_start);
    const bEnd = toDayKey(inv.billing_end);
    const displayFilename = buildDisplayFilename(inv.company_name, `${bStart}_${bEnd}`);
    const pdfPath = path.join(pdfDir, buildDiskFilename('invoice', inv.id));
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
    doc.fillColor(dark).text(`  ${toDayKey(new Date())}`);
    doc.text('정산기간:', rightX, 80, { continued: true });
    doc.fillColor(dark).text(`  ${bStart} ~ ${bEnd}`);

    doc.moveTo(50, 105).lineTo(545, 105).strokeColor('#e5e7eb').stroke();

    // 공급자 / 공급받는자 — 정산서와 같은 CT. 대표자 2명 줄바꿈 겹침(2026-07-26)이 여기도 그대로 있었다.
    const invPartyTop = 120;
    const invLeftBottom = drawPartyBlock(doc, {
      x: 50, y: invPartyTop, width: rightX - 50 - 20, title: '공급자', primary, dark, setFont,
      lines: [
        { label: '상호', value: INVITO_INFO.companyName },
        { label: '대표', value: INVITO_INFO.ceoName },
        { label: '사업자번호', value: INVITO_INFO.bizNumber },
        { label: '업태/종목', value: INVITO_INFO.bizType },
        { label: '주소', value: INVITO_INFO.address },
        { label: '연락처', value: `${INVITO_INFO.phone} / ${INVITO_INFO.email}` },
      ],
    });
    // ★ 2026-07-29 정산서와 같은 3단 판정 — 문서마다 다른 사업자가 찍히면 안 된다.
    const invParty = pickTaxbillParty(inv);
    const invRightBottom = drawPartyBlock(doc, {
      x: rightX, y: invPartyTop, width: 545 - rightX, title: '공급받는자', primary, dark, setFont,
      lines: [
        { label: '상호', value: invParty.companyName || '-' },
        { label: '대표', value: invParty.ceoName || '-' },
        { label: '사업자번호', value: invParty.bizNumber || '-' },
        { label: '업태/종목', value: `${invParty.bizType || '-'} / ${invParty.bizItem || '-'}` },
        { label: '주소', value: invParty.address || '-' },
        { label: '연락처', value: `${inv.contact_phone || '-'} / ${inv.contact_email || '-'}` },
      ],
    });

    const invPartyBottom = Math.max(invLeftBottom, invRightBottom);
    doc.moveTo(50, invPartyBottom + 4).lineTo(545, invPartyBottom + 4).strokeColor('#e5e7eb').stroke();

    let iy = invPartyBottom + 14;
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
    // ★ 2026-07-26 행 금액은 저장 시점과 **같은 절사 함수**를 거친다. 다른 규칙으로 그리면
    //   표의 세로합이 아래 공급가액과 어긋난다(고객이 가장 먼저 검산하는 자리다).
    drawInvRow('SMS', n(inv.sms_success_count), n(inv.sms_unit_price), floorWon(n(inv.sms_success_count) * n(inv.sms_unit_price)));
    drawInvRow('LMS', n(inv.lms_success_count), n(inv.lms_unit_price), floorWon(n(inv.lms_success_count) * n(inv.lms_unit_price)));
    drawInvRow('MMS', n(inv.mms_success_count), n(inv.mms_unit_price), floorWon(n(inv.mms_success_count) * n(inv.mms_unit_price)));
    drawInvRow('카카오', n(inv.kakao_success_count), n(inv.kakao_unit_price), floorWon(n(inv.kakao_success_count) * n(inv.kakao_unit_price)));
    drawInvRow('테스트 SMS', n(inv.test_sms_count), n(inv.test_sms_unit_price), floorWon(n(inv.test_sms_count) * n(inv.test_sms_unit_price)), '#fefce8');
    drawInvRow('테스트 LMS', n(inv.test_lms_count), n(inv.test_lms_unit_price), floorWon(n(inv.test_lms_count) * n(inv.test_lms_unit_price)), '#fefce8');
    drawInvRow('스팸필터', n(inv.spam_filter_count), n(inv.spam_filter_unit_price), floorWon(n(inv.spam_filter_count) * n(inv.spam_filter_unit_price)), '#fef3c7');

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

    let invContentBottom = iy + 28;
    if (inv.notes) {
      iy += 50;
      setFont(true);
      doc.fontSize(9).fillColor(gray).text('비고:', 50, iy);
      setFont(false);
      doc.fillColor(dark).text(inv.notes, 50, iy + 15, { width: 495 });
      invContentBottom = iy + 15 + Math.ceil(doc.heightOfString(String(inv.notes), { width: 495 }));
    }

    // ★ 2026-07-26 감사 인사 — 정산서와 같은 CT·같은 배치(문서 간 톤이 갈리지 않게).
    const invThanksY = Math.max(invContentBottom + 16, 690);
    if (invThanksY + THANKS_NOTE_HEIGHT <= 762) {
      drawThanksNote(doc, {
        x: 50, y: invThanksY, width: 495, primary, gray, setFont,
        message: `${Number(String(bEnd).slice(5, 7))}월도 한줄로를 이용해 주셔서 감사합니다.`,
      });
    }


    doc.end();
    // ★ 2026-07-28 finish만 기다리면 디스크 오류(권한·용량) 때 finish가 오지 않아 **영원히 대기**한다.
    //   메일 첨부가 이 경로를 타므로 일괄발급 배치가 통째로 멈춘다. error를 reject로 올리고 부분 파일은 지운다.
    await new Promise<void>((resolve, reject) => {
      stream.on('finish', () => resolve());
      stream.on('error', (streamErr: any) => {
        try { fs.unlinkSync(pdfPath); } catch { /* 정리 실패가 원인 오류를 가리지 않게 삼킨다 */ }
        reject(streamErr);
      });
    });

  return { pdfPath, displayFilename };
}
