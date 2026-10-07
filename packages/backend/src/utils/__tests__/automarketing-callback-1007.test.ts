/**
 * ★ 2026-10-07 (임은지 접수 cmuxnbr670okrjnn4vqlzrt6z) 자동 마케팅 회신번호 — 고른 등록 번호 · 고객별 매장번호(개별 회신)
 * 고정하는 계약:
 *  ① 적재 SQL 은 옵션을 줄 때만 매장번호를 callback 칸에 싣는다(플래너 · 옛 호출 무변경)
 *  ② 개별 회신 제외는 차감 · 상한 검사 **전**(줄어든 인원으로 돈을 센다) · 워커와 같은 배정 판정 사용자를 spec 에 싣는다
 *  ③ 회신번호 칸은 to_jsonb 로 읽는다(DDL 전에도 발송 문이 깨지지 않는다)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildSendableStagingInsertSql } from '../operator-recipients';

const back = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

describe('적재 SQL — 매장번호 회신 옵션', () => {
  it('옵션 없음 = 종전 그대로(callback 칸 없음)', () => {
    const { sql } = buildSendableStagingInsertSql('STG', ['CID'], '', [], '');
    expect(sql).toContain('(staging_id, company_id, phone, name)');
    expect(sql).not.toContain('store_phone');
  });
  it('옵션 = callback 칸에 매장번호(빈 값은 NULL)', () => {
    const { sql } = buildSendableStagingInsertSql('STG', ['CID'], '', [], '', {}, { callbackFromStorePhone: true });
    expect(sql).toContain('(staging_id, company_id, phone, name, callback)');
    expect(sql).toContain("NULLIF(btrim(COALESCE(c.store_phone, '')), '')");
  });
});

describe('자동 마케팅 발송 — 회신번호', () => {
  const op = back('utils/continuous-operator.ts');

  it('개별 회신 제외가 예산 · 상한 검사보다 먼저', () => {
    const plan = op.indexOf('planIndividualCallbackExclusion(stagingId');
    expect(plan).toBeGreaterThan(0);
    expect(plan).toBeLessThan(op.indexOf('const budgetClient = await pool.connect()'));
  });

  it('spec 에 개별 회신 · 배정 판정 사용자를 싣는다', () => {
    expect(op).toContain('...(useIndividualCb ? { useIndividualCallback: true, callbackFilterUserId: cbFilterUserId } : {}),');
  });

  it('회신번호 칸은 to_jsonb 로 읽는다(DDL 전 안전)', () => {
    expect(op).toContain("to_jsonb(o) ->> 'callback_number' AS cb_number");
    expect(op).toContain("COALESCE((to_jsonb(o) ->> 'use_individual_callback')::boolean, false) AS cb_individual");
  });

  it('고른 번호가 등록 목록에 없으면 보내지 않는다', () => {
    expect(op).toContain("auto_execute_reason = '고른 회신번호가 등록 목록에 없음. 발송 보류'");
  });
});

describe('회신번호 저장 = 등록 · 수정 한 문장(Codex 1R high)', () => {
  const op = back('utils/continuous-operator.ts');
  const routes = back('routes/ai.ts');
  it('등록 INSERT 에 같이 들어간다(차감 전)', () => {
    expect(op).toContain('schedule_month, target_hint, mms_image_paths${segCols}${cbCols}${v2Cols},');
    expect(op).toContain('$25, $26, $27::text[]${segVals}${cbVals}${v2Vals},');
  });
  it('수정 UPDATE 에 같이 들어간다', () => {
    expect(op).toContain("${patch.callback ? `callback_number = $${28 + (withSegment ? 2 : 0) + (withHintParam ? 1 : 0)}, use_individual_callback = $${29 + (withSegment ? 2 : 0) + (withHintParam ? 1 : 0)},` : ''}");
  });
  it('따로 저장하는 길이 없다', () => {
    expect(op).not.toContain('export async function saveOperatorCallback(');
    expect(routes).not.toContain('saveOperatorCallback');
  });
});
