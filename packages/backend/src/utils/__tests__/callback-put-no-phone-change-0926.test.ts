/**
 * 발신번호 수정 API는 번호를 바꾸지 않는다 (★2026-09-26 한줄로 V2 S1-H02)
 *
 * 등록(POST)은 자체등록 허용 · 형식 · 중복 · 회선 상한을 검사하는데, 수정(PUT /:id)은 phone을 그대로 덮어써
 * API로 등록되지 않은 번호로 바꿔 보낼 수 있었다(발신번호 사전등록 우회). 화면은 이 API로 번호를 바꾸지 않는다
 * (manageCallbacksApi.update 호출 0건 · 0926 grep). 번호 변경은 삭제 뒤 새로 등록해야 등록 절차를 거친다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '..', '..', 'routes', 'manage-callbacks.ts'), 'utf8');
const put = () => src.slice(src.indexOf("router.put('/:id'"), src.indexOf("router.delete('/:id'"));

describe('PUT /manage/callbacks/:id', () => {
  it('번호가 지금과 다르면 400으로 거절한다(정규화 비교)', () => {
    const p = put();
    expect(p).toContain("code: 'CALLBACK_PHONE_IMMUTABLE'");
    expect(p).toContain('normalizePhone(String(phone)) !== normalizePhone(String(current.rows[0].phone))');
  });

  it('UPDATE는 번호 열을 쓰지 않는다(라벨만)', () => {
    const p = put();
    const upd = p.slice(p.indexOf('UPDATE callback_numbers'), p.indexOf('RETURNING'));
    expect(upd).not.toContain('phone =');
    expect(upd).toContain('label = COALESCE(');
  });

  it('고객사관리자는 자사 번호만 — 회사 확인이 거절 판정보다 앞', () => {
    const p = put();
    expect(p.indexOf('자사 발신번호만 수정할 수 있습니다.')).toBeLessThan(p.indexOf("code: 'CALLBACK_PHONE_IMMUTABLE'"));
  });
});
