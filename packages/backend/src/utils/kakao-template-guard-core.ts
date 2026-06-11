/**
 * ★ CT-87 코어: 카카오 템플릿 활성상태 발송 판정 — 순수 (DB import 0, 테스트 전용 분리)
 *   DB 헬퍼는 kakao-template-guard.ts (이 파일을 재노출). 판정 원칙은 그 파일 머리주석 참조.
 */

export interface KakaoTemplateSendableDecision {
  sendable: boolean;
  /** 차단 시 사용자 노출 사유 (자연어) */
  reason?: string;
  /** 차단 시 기계 식별 코드 */
  code?: 'TEMPLATE_INACTIVE' | 'TEMPLATE_STOPPED' | 'TEMPLATE_DELETED';
}

/** IMC 템플릿 활성상태(A/R/S/D) 기반 발송 가능 판정 — 순수 함수 */
export function decideKakaoTemplateSendable(
  imcTemplateStatus: string | null | undefined
): KakaoTemplateSendableDecision {
  const s = String(imcTemplateStatus || '').trim().toUpperCase();
  if (!s) return { sendable: true }; // 미동기 — 기존 검수상태 가드만으로 진행 (과차단 방지)
  if (s === 'A') return { sendable: true };
  if (s === 'R') {
    return {
      sendable: false,
      code: 'TEMPLATE_INACTIVE',
      reason:
        '카카오 측에서 이 템플릿이 아직 활성(A) 상태가 아닙니다 (현재: 활성 대기 R). 검수 승인 후에도 활성 전환이 끝나야 발송할 수 있습니다. 카카오 검수팀에 활성 전환을 요청해주세요.',
    };
  }
  if (s === 'S') {
    return {
      sendable: false,
      code: 'TEMPLATE_STOPPED',
      reason: '카카오 측에서 이 템플릿이 중단(S) 상태입니다. 템플릿을 다시 활성화한 뒤 발송할 수 있습니다.',
    };
  }
  if (s === 'D') {
    return {
      sendable: false,
      code: 'TEMPLATE_DELETED',
      reason: '카카오 측에서 이 템플릿이 삭제(D) 상태입니다. 템플릿을 새로 등록한 뒤 발송할 수 있습니다.',
    };
  }
  // 미지의 상태값 — 차단하지 않고 통과 (과차단으로 발송 전면 중단이 더 큰 사고)
  return { sendable: true };
}
