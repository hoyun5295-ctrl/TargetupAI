/**
 * 대량 직접발송 워커 — 개별 회신번호의 등록 여부를 적재 전에 거른다 (★2026-09-26 한줄로 V2 F19)
 *
 * 동기 경로(/direct-send)는 filterByIndividualCallback으로 번호 없음·미등록·미배정 행을 뺐는데, 화면이 쓰는 대량 경로(commit → 워커)는
 * 개별 회신번호 모드면 등록 검사를 통째로 건너뛰어 미등록 발신번호로 적재했다(발신번호 사전등록제 위반 · API로는 임의 번호).
 * 처방: 워커가 청크마다 같은 CT(filterByIndividualCallback)로 거르고, 걸러진 행은 적재하지 않는다(미적재 환불로 돌아간다) ·
 *       제외 사유(exclusions.callbackExcluded)에 건수를 남긴다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { callbackAssignmentUserId } from '../callback-filter';

const src = readFileSync(join(__dirname, '..', 'direct-send-worker.ts'), 'utf8');
const loop = src.slice(src.indexOf('while (processed < total) {'), src.indexOf('} catch (loopErr: any) {'));

describe('워커 개별 회신번호 필터', () => {
  it('개별 회신번호 모드면 청크를 CT로 거른 뒤 적재한다', () => {
    expect(loop).toMatch(/if \(cfg\.useIndividualCallback\) \{\s*const cb = await filterByIndividualCallback\(recipients, companyId, callbackFilterUserId\);/);
    expect(loop).toContain('chunkRecipients = cb.filtered;');
    expect(loop).toContain('callbackExcluded += cb.callbackSkippedCount;');
    const call = loop.slice(loop.indexOf('await processSendChunk({'), loop.indexOf('});', loop.indexOf('await processSendChunk({')));
    expect(call).toContain('recipients: chunkRecipients,');
  });

  it('제외 사유에 건수를 남긴다', () => {
    expect(src).toMatch(/const exclusions = JSON\.stringify\(\{[^}]*callbackExcluded,/);
  });
});

/**
 * ★ Codex 4차 1R high — 동기 경로는 회사 관리자·슈퍼관리자에게 배정 제한을 걸지 않는데(전체 등록 번호 허용) 워커는 작성자 기준으로 걸었다.
 * 판정을 CT 하나(callbackAssignmentUserId)로 모아 동기 경로 두 곳·워커가 같이 쓴다. 워커는 작성자 유형을 캠페인당 한 번 읽는다.
 */

describe('배정 필터 대상 사용자(CT)', () => {
  it('관리자(회사·슈퍼)는 배정 제한 없음 · 일반 사용자는 본인 기준', () => {
    expect(callbackAssignmentUserId('company_admin', 'u1')).toBeUndefined();
    expect(callbackAssignmentUserId('super_admin', 'u1')).toBeUndefined();
    expect(callbackAssignmentUserId('company_user', 'u1')).toBe('u1');
    expect(callbackAssignmentUserId(null, 'u1')).toBe('u1');
    expect(callbackAssignmentUserId('company_user', null)).toBeUndefined();
  });

  it('동기 경로 두 곳이 CT를 쓴다(인라인 판정 제거)', () => {
    const routes = readFileSync(join(__dirname, '..', '..', 'routes', 'campaigns.ts'), 'utf8');
    expect(routes).not.toContain("(userType === 'super_admin' || userType === 'company_admin') ? undefined : userId");
    expect((routes.match(/callbackAssignmentUserId\(userType, userId\)/g) || []).length).toBe(2);
  });

  it('워커는 작성자 유형을 캠페인당 한 번 읽어 CT로 정한다(적재할 때만)', () => {
    expect(src).toMatch(/const callbackFilterUserId = cfg\.useIndividualCallback && !skipLoad\s*\? callbackAssignmentUserId\(\(await query\(`SELECT user_type FROM users WHERE id = \$1`, \[userId\]\)\)\.rows\[0\]\?\.user_type, userId\)\s*: undefined;/);
  });
});
