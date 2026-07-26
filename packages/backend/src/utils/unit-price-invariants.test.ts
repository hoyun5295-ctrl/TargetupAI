/**
 * 단가 기준 불변식 — 소스 스캔 (★ 2026-07-26 신설)
 *
 * 신설 사유: `companies.cost_per_*`가 **부가세 포함**으로 입력돼 있는데 청구 코드는 그 값을
 *   공급가액으로 놓고 10%를 또 더했다(금강제화 7월 실측 +1,339,745원 과청구).
 *   컬럼명에 포함 여부가 안 적혀 있어 **tsc·런타임 테스트·금액 항등식 3중 검사가 전부 통과한다.**
 *   판별 근거는 값의 흔적(7.70=7×1.1)뿐이었다 — 즉 이 부류는 런타임으로 안 잡힌다.
 *
 * 그래서 계약을 소스로 고정한다:
 *   ① 단가를 쓰는 경로는 **하나뿐**이고 그 문장이 `unit_price_basis`를 함께 쓴다
 *   ② 단가를 읽어 돈에 쓰는 경로는 전부 CT(`unit-price.ts`)를 지난다
 *   ③ 청구는 공급가, 선불·표시는 부가세 포함가 — 두 함수를 섞어 쓰지 않는다
 *
 * 선례 = `billing-route-invariants.test.ts` · `dm-flow-invariants.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const adminSrc = read('../routes/admin.ts');
const companiesSrc = read('../routes/companies.ts');
const prepaidSrc = read('./prepaid.ts');
const sweeperSrc = read('./mysql-refund-sweeper.ts');
const balanceSrc = read('../routes/balance.ts');
const aggregationSrc = read('./send-usage-aggregation.ts');
const ledgerSrc = read('./billing-ledger.ts');
const defaultsSrc = read('../config/defaults.ts');

/** `cost_per_*`에 값을 대입하는 SQL 조각(= 쓰기). RETURNING·SELECT 목록은 걸리지 않는다. */
const WRITE_RE = /cost_per_(sms|lms|mms|kakao|test_sms|test_lms)\s*=\s*(?!COALESCE\(cost_per)/g;

describe('단가 쓰기 경로 단일화 (2026-07-26)', () => {
  it('단가 저장 엔드포인트는 단가와 기준을 같은 UPDATE 문에서 쓴다 — 따로 쓰면 그 사이가 사고다', () => {
    const start = adminSrc.indexOf("router.put('/companies/:id/unit-prices'");
    expect(start, '단가 저장 엔드포인트를 찾지 못했다').toBeGreaterThan(-1);
    const end = adminSrc.indexOf("router.put('/companies/:id'", start);
    const body = adminSrc.slice(start, end === -1 ? undefined : end);

    const updateStart = body.indexOf('UPDATE companies');
    expect(updateStart).toBeGreaterThan(-1);
    const stmt = body.slice(updateStart, body.indexOf('RETURNING', updateStart));
    expect(stmt).toContain('cost_per_sms = $2');
    expect(stmt, '기준이 같은 문장에 없으면 단가만 바뀌고 해석은 옛 기준으로 남는다')
      .toContain("unit_price_basis = 'vat_excluded'");
  });

  it('슈퍼관리자 전용이다 — 고객사가 자기 단가를 바꿀 수 있으면 안 된다', () => {
    const line = adminSrc.slice(
      adminSrc.indexOf("router.put('/companies/:id/unit-prices'"),
      adminSrc.indexOf('async (req: Request, res: Response) => {', adminSrc.indexOf("router.put('/companies/:id/unit-prices'")),
    );
    expect(line).toContain('requireSuperAdmin');
  });

  it('옛 회사 수정 라우트는 단가를 받지도 바인딩하지도 않는다 — 식별자가 없어야 컴파일이 막는다', () => {
    // SQL의 `cost_per_sms = COALESCE($14, ...)` 자체는 남겨 둔다. placeholder를 지우면
    // 미사용 파라미터가 되어 PG가 타입을 unknown으로 추론한다(42P08, LESSONS_DB D162).
    // 대신 **바인딩할 값의 이름을 없앤다** — 그러면 다시 묶으려는 순간 tsc가 잡는다.
    const start = adminSrc.indexOf("router.put('/companies/:id'");
    const end = adminSrc.indexOf('res.json({ company: result.rows[0], message:', start);
    const body = adminSrc.slice(start, end === -1 ? undefined : end);
    for (const ident of ['costPerSms', 'costPerLms', 'costPerMms', 'costPerKakao', 'costPerTestSms', 'costPerTestLms']) {
      expect(body.includes(ident), `회사 수정 라우트에 ${ident} 식별자가 남아 있다`).toBe(false);
    }
  });

  it('고객사 설정·관리자 회사 수정도 단가 값을 받지 않는다 — req.body에서 이름 자체가 사라져야 한다', () => {
    // `company_agent_ids`(발송ID별 단가 patch)는 별도 축이라 그대로 둔다.
    // 여기서 막는 건 `companies` 단가를 기준 없이 쓰는 경로다.
    const settingsStart = companiesSrc.indexOf("router.put('/settings'");
    expect(settingsStart, '고객사 설정 라우트를 찾지 못했다').toBeGreaterThan(-1);
    const settingsBody = companiesSrc.slice(settingsStart, companiesSrc.indexOf('} = req.body;', settingsStart));
    for (const ident of ['cost_per_sms', 'cost_per_lms', 'cost_per_mms', 'cost_per_kakao']) {
      expect(settingsBody.includes(ident), `고객사 설정 destructure에 ${ident}가 남아 있다`).toBe(false);
    }

    // `costPerSms`가 나온다면 전부 발송ID 원장(`ledger.costPerSms`) 것이어야 한다.
    // 회사 단가를 받는 이름이 하나라도 남아 있으면 개수가 어긋난다.
    const all = (companiesSrc.match(/costPerSms/g) || []).length;
    const agentOnly = (companiesSrc.match(/ledger\.costPerSms/g) || []).length;
    expect(all, 'companies.ts에 회사 단가 바인딩 식별자(costPerSms)가 남아 있다 — 발송ID 단가만 허용된다')
      .toBe(agentOnly);
  });
});

describe('단가 읽기 — 돈에 닿는 경로는 전부 CT를 지난다 (2026-07-26)', () => {
  it('선불 차감·환불·회수는 resolveChargeUnitPrice만 쓴다 — 셋이 갈리면 잔액이 수렴하지 않는다', () => {
    expect(prepaidSrc).toContain("from './unit-price'");
    // 옛 인라인 삼항 선택(`messageType === 'SMS' ? Number(c.cost_per_sms...`)이 남아 있으면 안 된다.
    expect(prepaidSrc, '인라인 단가 선택이 남아 있으면 그 경로만 옛 기준으로 계산된다')
      .not.toMatch(/messageType === 'SMS'\s*\?\s*Number\(c\.cost_per_sms/);
    // 차감은 `resolveChargeUnitPriceDetailed`(미설정 판별 포함), 환불·회수는 차감 원장 단가 + 폴백.
    expect(prepaidSrc).toContain('resolveChargeUnitPriceDetailed');
    expect((prepaidSrc.match(/resolveChargeUnitPrice(Detailed)?\(/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  it('선불 경로의 SELECT에 unit_price_basis가 있다 — 빠지면 전환한 회사에서 10% 덜 깎인다', () => {
    const selects = prepaidSrc.match(/SELECT[^`']*cost_per_sms[^`']*FROM companies/g) || [];
    expect(selects.length).toBeGreaterThanOrEqual(3);
    for (const s of selects) expect(s).toContain('unit_price_basis');
  });

  it('환불 sweeper는 SQL CASE로 단가를 고르지 않는다 — SQL 안에서는 기준 변환이 빠진다', () => {
    expect(sweeperSrc).not.toMatch(/WHEN 'SMS' THEN cost_per_sms/);
    expect(sweeperSrc).toContain('resolveChargeUnitPrice');
  });

  it('환불·회수는 **차감 당시 단가**로 정산한다 — 현재 단가를 곱하면 단가 변경 순간 짝이 깨진다 (2026-07-26)', () => {
    // `차감 = 성공 + 순환불` 불변식은 실패 1건을 되돌리는 금액이 그 1건을 깎은 금액과 같아야 성립한다.
    // 전 업체 단가를 재입력하는 지금은 이 드리프트가 확실히 발동한다(선불 38사).
    expect(prepaidSrc).toContain('loadDeductLedger');
    expect(prepaidSrc).toContain('parseDeductDescription');
    // 환불·회수 두 곳 모두 `ledger.unitPrice ?? 현재단가` 폴백 형태여야 한다.
    expect((prepaidSrc.match(/ledger\.unitPrice \?\? resolveChargeUnitPrice/g) || []).length,
      '환불·회수 두 경로 모두 차감 단가를 우선해야 한다').toBe(2);
  });

  it('sweeper는 차감 원장을 **먼저** 읽고 그 단가로 판정한다 — 현재 단가 가드가 앞서면 단가를 비웠을 때 환불이 통째로 멈춘다', () => {
    // 2026-07-26 실측: 마이그레이션으로 단가가 8.25→7.50이 되자 옛 코드가 차감 건수를 10% 부풀려
    //   실패 0건인 패밀리투에 83건 622.5원을 환불했다.
    const start = sweeperSrc.indexOf("if (camp.send_phase == null");
    expect(start, 'sweep 정산 블록을 찾지 못했다').toBeGreaterThan(-1);
    const body = sweeperSrc.slice(start, sweeperSrc.indexOf('4-4', start));
    const ledgerIdx = body.indexOf('parseDeductDescription');
    const unitIdx = body.indexOf('getUnitPrice(');
    expect(ledgerIdx).toBeGreaterThan(-1);
    expect(unitIdx).toBeGreaterThan(-1);
    expect(ledgerIdx, '차감 원장을 현재 단가 조회보다 먼저 읽어야 한다').toBeLessThan(unitIdx);
    expect(body, '되읽기 실패는 폴백이 아니라 보류다').toContain('sweep-ledger-unresolved');
  });

  it('환불·회수는 되읽기 실패 시 현재 단가로 폴백하지 않고 멈춘다 — 추측으로 돈을 움직이지 않는다', () => {
    expect(prepaidSrc).toContain('unresolved');
    expect((prepaidSrc.match(/ledger\.unresolved/g) || []).length,
      '환불·회수 두 경로 모두 보류 분기를 가져야 한다').toBe(2);
    expect(prepaidSrc).toContain('warnUnresolvedLedger');
  });

  it('선불 차감·환불·회수가 트랜잭션 안에서 잔액과 원장을 함께 쓴다 — 따로 커밋하면 잔액만 움직인 상태가 남는다', () => {
    // pool.query 두 문장으로 쓰면 각각 즉시 커밋된다(0725 결함과 같은 계열).
    expect((prepaidSrc.match(/await pool\.connect\(\)/g) || []).length,
      '차감·환불·회수 3경로 모두 커넥션을 고정해야 한다').toBe(3);
    expect((prepaidSrc.match(/WHERE id = \$1 FOR UPDATE/g) || []).length,
      '회사 행을 잠가야 동시 호출이 같은 누적값을 보고 이중 환불하지 않는다').toBe(3);
  });

  it('단가 미설정인 선불 회사는 발송이 막힌다 — 0원 통과는 공짜 발송이다', () => {
    expect(prepaidSrc).toContain('resolved.unset');
    expect(prepaidSrc).toContain('단가가 설정되지 않아 발송할 수 없습니다');
  });

  it('단가 저장은 전체 교체다 — 키가 빠지면 그 유형이 조용히 NULL이 되어 무차감 발송이 된다', () => {
    expect(adminSrc).toContain('UNIT_PRICE_INCOMPLETE');
  });

  it('잔액 화면 단가는 부가세 포함가다 — 공급가를 내리면 발송 가능 건수가 10% 과대 표시된다', () => {
    expect(balanceSrc).toContain('resolveChargeUnitPrice');
    expect(balanceSrc).toContain('unit_price_basis');
  });

  it('표시·추정 경로의 단일 진입점(getCompanyCosts)이 기준을 해석한다', () => {
    expect(defaultsSrc).toContain('normalizeUnitPriceBasis');
    expect(defaultsSrc).toContain('toVatIncludedPrice');
  });
});

describe('청구는 공급가로 계산한다 (2026-07-26)', () => {
  it('청구 단가 해석은 toSupplyPrice를 지난다 — 저장값을 그대로 쓰면 부가세가 두 번 붙는다', () => {
    expect(aggregationSrc).toContain('toSupplyPrice');
    expect(aggregationSrc).toContain('normalizeUnitPriceBasis');
  });

  it('발송ID 단가도 같은 기준으로 변환한다 — 회사 안에서 기준이 두 개일 수 없다', () => {
    expect(aggregationSrc).toMatch(/toSupplyPrice\(priceOrNull\(raw\), agentPriceBasis\)/);
  });

  it('원장 스냅샷이 unit_price_basis를 읽고 지문에 넣는다 — 발행 중 전환되면 금액이 10% 달라진다', () => {
    expect(ledgerSrc).toContain('c.unit_price_basis');
    expect(ledgerSrc).toContain('fp(companyPriceRow?.unit_price_basis)');
  });

  it('청구 경로가 부가세 포함가 함수를 쓰지 않는다 — 두 함수를 섞으면 축이 뒤집힌다', () => {
    expect(aggregationSrc).not.toContain('toVatIncludedPrice');
  });
});
