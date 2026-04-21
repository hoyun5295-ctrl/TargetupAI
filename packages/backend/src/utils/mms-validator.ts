/**
 * MMS 이미지 첨부 필수 가드 — 발송 라우트 공통 컨트롤타워 (D131)
 *
 * 호출부(test-send, direct-send, POST / AI캠페인 생성, 자동발송, 스팸테스트 등)에서
 * 반복되던 인라인 검증 로직을 한 곳으로 통합.
 *
 * 프론트 미러: packages/frontend/src/utils/formatDate.ts `validateMmsBeforeSend()`
 * 엑셀 업로드·Agent 동기화와 같은 원칙 — 컨트롤타워 하나만 수정하면 전 경로 자동 반영.
 *
 * 배경: 2026-04-21 서수란 팀장 제보 — 담당자 테스트 MMS 37% 9007 파일 오류.
 *       원인 = MMS 선택하고 이미지 0장인 상태로 발송 요청.
 *       대책 = 큐 INSERT 전 라우트 단계 + INSERT 시점(insertTestSmsQueue) 2중 방어.
 */

export interface MmsValidationResult {
  ok: boolean;
  error?: string;
  code?: string;
}

/**
 * MMS payload 검증.
 *   - msgType이 'MMS'(대/소문자 무관) 이면서 mmsImagePaths가 빈 배열/비어있는 경우 실패.
 *   - 그 외 (SMS/LMS/기타 타입 또는 이미지 1장 이상) 통과.
 */
export function validateMmsPayload(
  msgType: unknown,
  mmsImagePaths: unknown,
): MmsValidationResult {
  const normalized = String(msgType ?? '').toUpperCase();
  if (normalized !== 'MMS') return { ok: true };

  const list = mmsImagePaths;
  if (!Array.isArray(list) || list.length === 0) {
    return {
      ok: false,
      code: 'MMS_IMAGE_REQUIRED',
      error:
        'MMS는 이미지 첨부가 필수입니다. 이미지를 업로드하거나 발송타입을 SMS/LMS로 변경해주세요.',
    };
  }
  return { ok: true };
}
