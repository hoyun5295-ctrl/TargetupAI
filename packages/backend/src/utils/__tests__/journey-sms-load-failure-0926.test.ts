/**
 * 여정 문자 적재 실패 = 발송 아님 (★2026-09-26 한줄로 V2 F40·F41)
 *
 * bulkInsertSmsQueue는 배치 INSERT 오류를 삼키고 **적재한 건수**를 돌려준다(0 = 한 건도 못 넣음).
 * 여정 실행기가 반환값을 버려, MySQL이 잠깐 끊긴 동안 도는 실행마다 'sent' 기록 · 선불 1건 차감 · 다음 단계 진행이 일어났다
 * (수신자는 못 받고 고객사는 값을 냄). 5분 뒤 1회 재시도 · 자동 정지 분기는 throw로만 들어가 한 번도 돌지 않았다.
 * 알림톡 분기(insertAlimtalkQueue)는 실패 시 throw하므로 이미 그 분기를 탄다 — 문자 분기만 맞춘다.
 *
 * 못 박는 것: 문자 적재의 반환값을 받아 0이면 같은 try 안에서 throw한다 → catch의 재시도·정지 분기 · 'sent'·차감 없음.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '..', 'journey-executor.ts'), 'utf8');

describe('여정 문자 적재 실패 처리', () => {
  // ★ 2026-11-02 묶음 발송(설계서 3-8) — 옛 「삼킨 오류 = 0건 반환 → 던짐」 대신 단위 적재 CT 가 결말 셋을 돌려준다(삼키는 길 0)
  const sq = readFileSync(join(__dirname, '..', 'sms-queue.ts'), 'utf8');
  const unit = sq.slice(sq.indexOf('export async function loadQueueUnit('), sq.indexOf('export async function isMysqlThreadAlive('));

  it('들어감(loaded)은 INSERT 문장이 성공 응답을 돌려준 뒤에만 · 보낸 뒤 실패 = 결과 불명(unknown · 연결 파기)', () => {
    const sendAt = unit.indexOf('await conn.query(ins.sql, ins.params);');
    expect(sendAt).toBeGreaterThan(0);
    expect(unit.indexOf("state: 'loaded'")).toBeGreaterThan(sendAt);
    const fail = unit.slice(sendAt, unit.indexOf("state: 'loaded'"));
    expect(fail).toContain('conn.destroy();');
    expect(fail).toContain("return { state: 'unknown', table, threadId,");
    // 문장 보내기 전 실패만 rejected(시연 막기 · 표 없음 · 연결 받기 · 연결 번호 · 단위 기록)
    expect(unit.slice(0, sendAt).split("state: 'rejected'").length - 1).toBe(5);
    expect(unit.slice(sendAt).split("state: 'rejected'").length - 1).toBe(0);
  });

  it('실행기 = 들어감만 확정 · 안 들어감 = 표식 지우고 재시도 규칙 · 결과 불명 = 표식 보존(sent 기록 0 · 다음 회차 판정)', () => {
    const u = src.slice(src.indexOf('async function sendUnits('), src.indexOf('async function retryOrPauseAfterLoadFailure('));
    const loadedAt = u.indexOf("if (outcome.state === 'loaded') {");
    const rejectedAt = u.indexOf("if (outcome.state === 'rejected') {");
    const unknownAt = u.indexOf('// unknown = 표식 보존');
    expect(loadedAt).toBeGreaterThan(0);
    expect(rejectedAt).toBeGreaterThan(loadedAt);
    expect(unknownAt).toBeGreaterThan(rejectedAt);
    expect(u.slice(loadedAt, rejectedAt)).toContain('confirmLoadUnit(');
    expect(u.slice(rejectedAt, unknownAt)).toContain('await retryOrPauseAfterLoadFailure(head, step, claimed.map((r) => r.exec), outcome.reason, res);');
    expect(u.slice(unknownAt)).not.toMatch(/DELETE FROM journey_step_logs|clearLoadUnit\(|confirmLoadUnit\(/);
  });
});
