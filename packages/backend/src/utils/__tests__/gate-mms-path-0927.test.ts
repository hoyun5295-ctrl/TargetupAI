/**
 * MMS 이미지 경로는 그 회사 MMS 저장소 안의 파일만 (★ 2026-09-27 한줄로 V2 차수 1 GATE — m026 · m119 일부)
 *
 * m026 대행발송 접수가 MMS 이미지 경로를 클라이언트 값 그대로 QTmsg file_name에 실었다 — 같은 모양이 테스트 발송·AI 캠페인 생성·
 *      직접발송(동기)에도 있다(요청 본문의 mmsImagePaths). 서버 파일 경로를 아무거나 넣으면 발송 에이전트가 그 파일을 읽으려 한다.
 *      업로드(routes/mms-images.ts)·메일 접수(saveMmsImageBuffer)는 모두 `MMS 저장소/회사ID/파일`에 저장하고 그 절대경로를 돌려준다.
 *      → MMS 검사 CT(validateMmsPayload)에 회사 id를 **필수 인자**로 더하고, 모든 경로가 그 회사 저장소 아래일 때만 통과.
 *        필수 인자라 호출부 전부가 컴파일로 잡힌다.
 * m119 직접발송 대량 확정(commit)에는 MMS 검사 자체가 없었다(동기 경로에는 있음) → 같은 CT를 배선.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import path from 'path';
import { validateMmsPayload } from '../mms-validator';
import { isCompanyMmsPath, MMS_IMAGE_BASE } from '../mms-image-util';

const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '22222222-2222-4222-8222-222222222222';
const own = path.join(MMS_IMAGE_BASE, C1, 'a.jpg');
const other = path.join(MMS_IMAGE_BASE, C2, 'b.jpg');

describe('경로 판정', () => {
  it('그 회사 저장소 안의 파일만 통과', () => {
    expect(isCompanyMmsPath(C1, own)).toBe(true);
    expect(isCompanyMmsPath(C1, other)).toBe(false);
    expect(isCompanyMmsPath(C1, path.join(MMS_IMAGE_BASE, C1, '..', C2, 'b.jpg'))).toBe(false);
    expect(isCompanyMmsPath(C1, path.join(MMS_IMAGE_BASE, C1))).toBe(false);            // 폴더 자체
    expect(isCompanyMmsPath(C1, path.join(MMS_IMAGE_BASE, C1 + 'x', 'a.jpg'))).toBe(false); // 접두 흉내
    expect(isCompanyMmsPath(C1, '/etc/passwd')).toBe(false);
    expect(isCompanyMmsPath(C1, 'a.jpg')).toBe(false);                                  // 상대경로
    expect(isCompanyMmsPath('', own)).toBe(false);
  });
});

describe('MMS 검사 CT', () => {
  it('종전 규칙 유지: MMS인데 0장이면 실패 · SMS/LMS는 이미지 없이 통과', () => {
    expect(validateMmsPayload('MMS', [], C1).code).toBe('MMS_IMAGE_REQUIRED');
    expect(validateMmsPayload('SMS', undefined, C1).ok).toBe(true);
    expect(validateMmsPayload('LMS', [], C1).ok).toBe(true);
  });
  it('자기 회사 경로면 통과(문자열 · {path} 객체 모두)', () => {
    expect(validateMmsPayload('MMS', [own], C1).ok).toBe(true);
    expect(validateMmsPayload('MMS', [{ path: own, originalName: 'a.jpg' }], C1).ok).toBe(true);
  });
  it('다른 회사·저장소 밖 경로가 하나라도 있으면 실패(유형과 무관하게)', () => {
    expect(validateMmsPayload('MMS', [own, other], C1).code).toBe('MMS_IMAGE_PATH_INVALID');
    expect(validateMmsPayload('MMS', ['/etc/passwd'], C1).code).toBe('MMS_IMAGE_PATH_INVALID');
    expect(validateMmsPayload('SMS', ['/etc/passwd'], C1).code).toBe('MMS_IMAGE_PATH_INVALID');
    expect(validateMmsPayload('MMS', [{ path: other }], C1).code).toBe('MMS_IMAGE_PATH_INVALID');
    expect(validateMmsPayload('MMS', [own], '').code).toBe('MMS_IMAGE_PATH_INVALID');
  });
});

describe('배선', () => {
  const camp = readFileSync(join(__dirname, '..', '..', 'routes', 'campaigns.ts'), 'utf8');
  it('직접발송 대량 확정(commit)도 MMS 검사 CT를 쓴다(m119)', () => {
    const at = camp.indexOf("const commitChannel = resolveSendChannel('direct', sendChannel);");
    const seg = camp.slice(at, at + 4000);
    expect(seg).toContain('validateMmsPayload(commitMsgResolved.messageType, mmsImagePaths, companyId)');
  });
});
