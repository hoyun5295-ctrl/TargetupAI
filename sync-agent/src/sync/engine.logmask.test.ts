/**
 * 동기화 엔진 로그 마스킹 배선 계약 (★2026-09-13 적대검토 등재분 ⑥·⑩)
 *
 *   ⑥ 동기화 실패 로그가 행 식별값(고객 전화번호 원문)을 `key` 필드로 남겼다. 로그 요청 명령이 그 줄을 서버로 올린다.
 *      `key`는 흔한 이름이라 키 기준 마스킹 목록에 넣을 수 없다(다른 로그의 `key`까지 가린다) → 호출부에서 가린다.
 *   ⑩ DRY RUN이 정규화된 고객 행을 **메시지 문자열**로 찍어 키 기준 마스킹을 거치지 않았다.
 *
 *   가리는 함수 자체는 `logger/masking.contract.test.ts`가 잠근다. 이 파일은 **엔진이 그 함수를 부르는가**만 본다
 *   (0912 경위: 함수는 멀쩡했고 연결이 끊겨 있었다).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.resolve(__dirname, 'engine.ts'), 'utf8');

describe('동기화 엔진 로그 마스킹 배선', () => {
  it('오류 상세의 행 식별값은 maskRecordKey를 거쳐 남는다(등재 ⑥)', () => {
    const start = src.indexOf('private logResult(');
    const end = src.indexOf('private async sendSyncLog(');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const seg = src.slice(start, end);
    expect(seg).toMatch(/maskRecordKey\(err\.recordKey\)/);
    expect(seg).not.toMatch(/\{ key: err\.recordKey \}/);
  });

  it('서버 전송·로컬 로그·알림 세 출구와 검증 문장이 공용 창구를 거친다(★2026-09-13(3) 싱크 ⓐ)', () => {
    expect(src).toMatch(/errorMessage: buildSyncLogErrorMessage\(result\.errors\)/);
    expect(src).not.toMatch(/map\(e => `\[\$\{e\.code\}\] \$\{e\.message\}`\)/);
    expect(src).toMatch(/safeErrorText\(err\.message\)/);
    expect(src).toMatch(/map\(e => safeErrorText\(e\.message\)\)/);
    expect((src.match(/formatValidationIssues\(invalid\.errors\.issues\)/g) || []).length).toBe(2);
    expect(src).not.toMatch(/\$\{i\.message\}`\)\.join/);
  });

  it('DRY RUN 샘플은 maskSensitiveData를 거친 뒤 찍는다(등재 ⑩)', () => {
    expect(src).toMatch(/JSON\.stringify\(maskSensitiveData\(item\), null, 2\)/);
    expect(src).not.toMatch(/logger\.info\(JSON\.stringify\(item, null, 2\)\)/);
  });
});
