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
  it('문자 적재 반환값을 받아 0건이면 throw한다', () => {
    const at = src.indexOf("await bulkInsertSmsQueue(tables, [row], true, { companyId: exec.company_id, source: 'journey' });");
    expect(at).toBeGreaterThan(0);
    const before = src.slice(at - 40, at);
    expect(before).toMatch(/const loaded = $/);
    const after = src.slice(at, at + 600);
    expect(after).toMatch(/if \(loaded < 1\) \{?\s*throw new Error\(/);
  });

  it('그 throw는 발송 try 안이다 — catch(재시도·정지)보다 앞이고, sent 기록보다 앞이다', () => {
    const throwAt = src.indexOf('if (loaded < 1)');
    const catchAt = src.indexOf('} catch (sendErr: any) {');
    const sentAt = src.indexOf("gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, NOW(), 'sent', $4");
    expect(throwAt).toBeGreaterThan(0);
    expect(throwAt).toBeLessThan(catchAt);
    expect(catchAt).toBeLessThan(sentAt);
    // ★ 2026-09-26 F05 Codex 2R: 차감은 적재보다 앞이다(적재 실패분은 스위퍼 미적재 환불) — journey-refund-ledger 테스트가 소유
  });
});
