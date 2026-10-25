/**
 * ★2026-10-15 임은지 접수 2건 고정
 *   - B-1015-4 cmv8xo7z11enpjnn4hrpy97os: 슈퍼관리자 충전관리에서 「카드결제」로 조회하면 0건.
 *       카드 충전(payment-processor)의 balance_transactions INSERT 만 payment_method 를 안 넣어 NULL(→ 조회 COALESCE '시스템')이었다.
 *       → 결제 원장(payments.payment_method)을 그대로 잇는다(없으면 'card'). 기존 행은 UPDATE 1회(BUGS).
 *   - B-1015-5 cmv8v9nyf1e8pjnn4050isyjl: DM 보내기 창이 "고칠 곳 N곳" 개수만 보여 어디를 고칠지 몰랐다.
 *       → 검수 항목을 만들기 화면과 같은 변환기(fixItemsOf · must)로 사람 말로 바꿔 함께 보여 주고 「만들기 화면에서 고치기」(창 닫기)를 단다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

describe('B-1015-4 카드 충전 = 결제수단을 적는다', () => {
  const pp = read('backend/src/utils/payment-processor.ts');
  it('pending 결제 행 조회에 payment_method 가 있고, 충전 INSERT 가 payment_method 를 $7 로 넣는다(결제 원장 값 · 없으면 card)', () => {
    expect(pp).toContain("SELECT id, company_id, user_id, amount, status, pg_payment_key, payment_method\n       FROM payments");
    expect(pp).toContain("reference_type, reference_id, created_by, payment_method, created_at\n      ) VALUES (\n        $1, 'charge', $2, $3, $4,\n        'payment', $5, $6, $7, NOW()");
    expect(pp).toContain("pending.payment_method || 'card',");
  });
  it('조회 라우트의 수단 필터·화면 옵션·표시 라벨이 같은 값(card)을 쓴다', () => {
    const admin = read('backend/src/routes/admin.ts');
    expect(admin).toContain("where += ` AND COALESCE(bt.payment_method, 'system') = $${paramIdx++}`;");
    const tab = read('frontend/src/components/admin/tabs/DepositsTab.tsx');
    expect(tab).toContain('<option value="card">카드결제</option>');
    expect(tab).toContain("card: { label: '카드결제'");
  });
  it('다른 충전 경로는 이미 수단을 넣고 있다(무통장 bank_transfer · 관리자 admin)', () => {
    expect(read('backend/src/utils/deposit-approve.ts')).toContain("'deposit_request', $6, $7, 'bank_transfer')");
    expect(read('backend/src/routes/admin.ts')).toContain("VALUES ($1, $2, $3, $4, $5, $6, $7, 'admin')");
  });
});

describe('B-1015-5 DM 보내기 창 = 고칠 곳을 항목으로 보여 준다', () => {
  const modal = read('frontend/src/components/make/MakeSendModal.tsx');
  it('검수 항목을 만들기 화면과 같은 변환기(fixItemsOf · must)로 바꿔 보관한다', () => {
    expect(modal).toContain("import { defaultDmSmsText, fixItemsOf, type FixItem } from '../../utils/make-flow';");
    expect(modal).toContain("setFatalItems(fixItemsOf({ items }, [], []).filter((it) => it.kind === 'must'));");
  });
  it('항목(제목 · 방법)을 목록으로 그리고, 「만들기 화면에서 고치기」는 창을 닫아 [고치기] 버튼이 있는 화면으로 돌아간다', () => {
    expect(modal).toContain('고칠 곳 {fatalItems.length}곳 · 만들기 화면에서 채우면 보낼 수 있어요');
    expect(modal).toContain('<b>{it.title}</b>{it.sub ? <span className="text-slate-500"> · {it.sub}</span> : null}');
    expect(modal).toContain('onClick={onGoFix} className="mt-2 ml-6 text-[12.5px] font-semibold text-violet-700 hover:underline">만들기 화면에서 고치기</button>');
    expect(modal).toContain('onOpenAdvanced={onOpenAdvancedDm} onGoFix={onClose} />');
    // 개수 문구(막는 판정)는 그대로 — 표시만 더했다
    expect(modal).toContain("`고칠 곳 ${fatal.blocking}곳을 먼저 채워 주세요.`");
  });
  it('변환기는 만들기 화면 레일과 같은 함수다(넘길 수 없는 치명만 must)', () => {
    const flow = read('frontend/src/utils/make-flow.ts');
    expect(flow).toContain('export function fixItemsOf(');
    expect(flow).toContain("if (it.overridable === true) {");
  });
});
