/**
 * ★ CT-F05 — 전단AI 메시지 치환/광고문구 컨트롤타워
 *
 * 한줄로 utils/messageUtils.ts와 완전 분리.
 * - 변수 치환: %이름%, %전화%, %등급%, %포인트%, %최근방문% 등 flyer_customers 기본 필드만
 * - 광고 본문: (광고) 접두 + 080 수신거부 번호 부착 (is_ad=true 때만)
 *
 * 한줄로의 복잡한 FIELD_MAP / custom_fields 시스템 미지원 (전단AI는 표준 필드만 사용).
 */
export interface FlyerCustomerVars {
    name?: string;
    phone?: string;
    gender?: string;
    birth_date?: string;
    email?: string;
    address?: string;
    pos_grade?: string;
    pos_points?: number;
    last_purchase_at?: string;
    total_purchase_amount?: number;
    purchase_count?: number;
}
/**
 * 변수 치환. %이름%, %등급% 등을 flyer_customers 실제 값으로 교체.
 * 매칭 실패한 변수는 빈 문자열로 대체 (안전망).
 */
export declare function replaceFlyerVariables(template: string, customer: FlyerCustomerVars): string;
/**
 * (광고) + 무료거부 부착. buildAdMessage와 동일 패턴.
 * idempotent — 이미 (광고)로 시작하면 중복 추가 안 함.
 */
export declare function buildFlyerAdMessage(body: string, isAd: boolean, opt080: string | null): string;
/**
 * (광고) 프리픽스/무료거부 라인 제거 — 표시용 (DB에 저장된 원문에 이미 있으면 정규화).
 */
export declare function stripFlyerAdParts(body: string): string;
/**
 * 발송 직전 최종 준비: 변수 치환 → (광고) 부착.
 * 모든 발송 경로에서 이 함수만 호출하면 일관된 결과.
 */
export declare function prepareFlyerSendMessage(template: string, customer: FlyerCustomerVars, isAd: boolean, opt080: string | null): string;
//# sourceMappingURL=flyer-message.d.ts.map