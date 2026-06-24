/**
 * messageUtils.ts — 발송 파이프라인 공통 치환 함수
 *
 * 목적: 5개 발송 경로(AI/직접/테스트/스팸필터/예약수정)의 변수 치환을
 *       이 파일 하나로 통합. 한 곳만 수정하면 전체 반영.
 *
 * 위치: packages/backend/src/utils/messageUtils.ts
 * 생성: 2026-02-26 (D32 발송 파이프라인 전면 복구)
 *
 * 의존: services/ai.ts의 VarCatalogEntry, extractVarCatalog 재사용
 */
import { VarCatalogEntry } from '../services/ai';
/**
 * ★ D100: 날짜 값을 한국어 포맷으로 변환
 *
 * 순수 YYYY-MM-DD → 직접 파싱 (new Date() 사용 시 UTC 자정 해석 → KST 변환에서 하루 밀림)
 * ISO 타임스탬프(YYYY-MM-DDT...) → new Date() + KST 변환
 *
 * 프론트 formatDate.ts의 formatDate()와 동일한 방식.
 * D99까지 new Date("1995-03-01")로 파싱 → UTC 자정 → KST -9h → "1995. 2. 28." 버그 발생.
 */
export declare function formatDateValue(value: any): string;
/**
 * fieldMappings에 회사별 커스텀 필드(customer_field_definitions)를 동적 추가
 *
 * - extractVarCatalog()은 FIELD_MAP 기반이라 storageType='custom_fields'를 건너뜀
 * - AI맞춤한줄(generateCustomMessages)은 커스텀 필드 라벨(%선호스타일% 등)을 사용
 * - 실제 발송 시 fieldMappings에 없으면 안전망 regex가 빈값으로 제거 → 미리보기와 불일치
 * - 이 함수가 customer_field_definitions 조회 → fieldMappings에 추가하여 해결
 *
 * ★ B-D70-16 수정: 미리보기 vs 실제 발송 개인화 불일치 해결
 *
 * @param fieldMappings  extractVarCatalog()에서 받은 기본 매핑 (in-place 수정)
 * @param companyId      회사 ID
 * @returns 보강된 fieldMappings (원본 객체 반환)
 */
export declare function enrichWithCustomFields(fieldMappings: Record<string, VarCatalogEntry>, companyId: string): Promise<Record<string, VarCatalogEntry>>;
/**
 * fieldMappings 순회 후 잔여 %변수명% 패턴을 빈문자열로 제거.
 *
 * ★ 시작 문자 한글/영문/언더스코어 강제 — 사용자 본문 보존:
 *   - %이름% / %name% / %기타1% — 한글/영문/언더스코어 시작 → 매칭 (정상 변수)
 *   - %~30% / %50% — 특수문자/숫자 시작 → 매칭 안 됨 (사용자 본문 "50%~30% 할인")
 *
 * 의도: 오타/매핑 안 된 변수만 제거. 본문 % 문자는 보존.
 *
 * @param text 원본 메시지 (이미 fieldMappings 순회 완료 상태)
 * @returns 잔여 %변수% 제거된 메시지
 */
export declare function cleanLeftoverVars(text: string): string;
/**
 * 주소록(직접발송) 수신자의 기타 필드 타입
 * - 직접발송 시 recipients 배열의 각 항목에서 전달됨
 * - %기타1%, %기타2%, %기타3%, %회신번호% 치환에 사용
 */
export interface AddressBookFields {
    name?: string;
    extra1?: string;
    extra2?: string;
    extra3?: string;
    callback?: string;
}
/**
 * 단건 메시지 변수 치환 (모든 발송 경로의 유일한 치환 함수)
 *
 * 실행 흐름:
 *  0. (직접발송) 주소록 기타 필드 치환 — %기타1/2/3%, %회신번호%
 *  1. fieldMappings 순회 — %한글라벨% → customer[column] 치환
 *     - column이 최상위에 없으면 custom_fields JSONB에서 탐색
 *     - 타입별 포맷: number → toLocaleString(), date → toLocaleDateString('ko-KR')
 *  2. 잔여 %...% 패턴 → 빈문자열 strip (안전장치)
 *
 * @param template          원본 메시지 (예: "%이름%님, %등급% 전용 혜택!")
 * @param customer          고객 데이터 (DB row). phone, name, grade, custom_fields 등. null이면 주소록 필드만 치환.
 * @param fieldMappings     { 한글라벨: VarCatalogEntry } — extractVarCatalog()에서 추출
 * @param addressBookFields (선택) 직접발송 주소록 기타 필드. 전달 시 %기타1/2/3%, %회신번호% 치환.
 *                          customer가 null이면 %이름%도 여기서 치환.
 * @returns 치환 완료된 메시지
 */
export declare function replaceVariables(template: string, customer: Record<string, any> | null, fieldMappings: Record<string, VarCatalogEntry>, addressBookFields?: AddressBookFields, options?: {
    skipNumberFormatting?: boolean;
}): string;
/**
 * 복수 고객 일괄 치환 → 수신자별 {phone, message} 배열 반환
 * AI발송 경로에서 사용
 */
export declare function bulkReplaceVariables(template: string, customers: Record<string, any>[], fieldMappings: Record<string, VarCatalogEntry>): {
    phone: string;
    message: string;
}[];
/**
 * 스팸필터/테스트용 — 타겟 최상단(첫 번째) 고객 데이터로 치환
 *
 * Harold님 지시: "실제 발송할 타겟데이터 중 가장 상단에 있는 걸로 테스트"
 * 하드코딩 "김민수/VIP/강남점" 완전 제거
 *
 * @param template       원본 메시지
 * @param customers      발송 대상 고객 배열 (최소 1명)
 * @param fieldMappings  필드 매핑
 * @returns 첫 번째 고객 데이터로 치환된 메시지 (고객 없으면 원본 반환)
 */
export declare function replaceWithFirstCustomer(template: string, customers: Record<string, any>[], fieldMappings: Record<string, VarCatalogEntry>): string;
/**
 * 080 수신거부번호 조회 — users 우선 → companies fallback
 *
 * ★ D102 컨트롤타워화: campaigns.ts 3곳 + auto-campaign-worker.ts + spam-test-queue.ts에
 *   동일한 080번호 조회 로직이 인라인으로 흩어져 있어서 auto-campaign-worker에서 누락됨.
 *   이 함수 하나로 통합.
 *
 * @param userId    사용자 ID (users.opt_out_080_number 우선)
 * @param companyId 회사 ID (companies.opt_out_080_number fallback)
 * @returns 080번호 문자열 (없으면 '')
 */
export declare function getOpt080Number(userId: string | null, companyId: string): Promise<string>;
/**
 * 메시지에 (광고) 접두사 + 무료거부/무료수신거부 접미사 추가
 *
 * ★ D102 컨트롤타워화: 모든 발송 경로(AI발송, 직접발송, 직접타겟발송, 자동발송, 스팸테스트)에서
 *   이 함수 하나로 (광고)+080 조합. 인라인 코드 전면 제거.
 *
 * SMS: (광고)본문\n무료거부08012345678
 * LMS/MMS: (광고) 본문\n무료수신거부 080-1234-5678
 *
 * @param message     원본 메시지 (순수 본문, (광고) 미포함)
 * @param msgType     메시지 타입 ('SMS' | 'LMS' | 'MMS')
 * @param isAd        광고 여부
 * @param opt080Number 080 수신거부번호 (getOpt080Number로 조회한 값)
 * @returns (광고)+본문+무료거부 조합된 메시지. 광고 아니거나 080번호 없으면 원본 반환.
 */
export declare function buildAdMessage(message: string, msgType: string, isAd: boolean, opt080Number: string): string;
/**
 * ★ D142+ (2026-04-29) 0429 PDF B1 — INSERT 직전 D103 강제 정규화 컨트롤타워
 *
 * frontend `formatDate.ts:909 stripAdParts`와 정확히 동일 로직(미러).
 * 사용자가 textarea에 (광고)/무료거부를 직접 박은 변칙 입력을 정규화하여
 * DB의 `campaigns.message_content`는 항상 "순수본문"만 저장되도록 강제한다.
 *
 * 사용처: campaigns.ts direct-send / POST `/` AI 캠페인 등 INSERT 직전
 * 호출부 패턴:
 *   const sanitized = stripAdParts(rawMessage);
 *   const hadMarker = sanitized !== rawMessage;
 *   const finalIsAd = (req.body.adEnabled === true) || hadMarker;  // 자동 승격
 *
 * 정규식은 buildAdMessage가 만드는 정확한 패턴만 매칭 — 본문 내부 텍스트 훼손 방지.
 * idempotent: 이미 순수본문이면 변화 없음. 여러 번 적용해도 동일 결과.
 */
export declare function stripAdParts(text: string): string;
/**
 * ★ KISA 2026-05: LMS/MMS 제목에 (광고) 자동 부착
 * - isAd=true + LMS/MMS일 때만 제목 앞에 "(광고) " 접두사
 * - SMS는 제목 필드 없으므로 원본 반환
 * - 중복 방지: 이미 (광고)로 시작하면 안 붙임
 * - prepareSendMessage 내부에서 호출됨 (컨트롤타워 단일 진입점)
 * - spam-test-queue.ts처럼 prepareSendMessage 미사용 경로에서는 직접 import
 */
export declare function buildAdSubject(subject: string, msgType: string, isAd: boolean): string;
/**
 * ★ D103: 발송 메시지 최종 준비 컨트롤타워
 * 모든 발송 경로(AI즉시/AI예약/직접/타겟/자동발송)의 유일한 진입점.
 * 변수 치환 → (광고)+080 조합을 한 함수로 통합.
 * 각 발송 경로에서 replaceVariables + buildAdMessage를 인라인으로 호출하던 패턴을 제거.
 *
 * ★ KISA 2026-05: subject도 통합 처리. isAd=true + LMS/MMS일 때 제목에 (광고) 자동 부착.
 *   호출부에서 subject를 별도 처리할 필요 없이 반환값의 subject를 그대로 사용.
 */
export declare function prepareSendMessage(template: string, customer: Record<string, any> | null, fieldMappings: Record<string, VarCatalogEntry>, options: {
    msgType: string;
    isAd: boolean;
    opt080Number: string;
    addressBookFields?: AddressBookFields;
    subject?: string;
    skipNumberFormatting?: boolean;
}): {
    message: string;
    subject: string;
};
/**
 * ★ D102: 필드 매핑 준비 컨트롤타워
 * customer_schema 조회 + extractVarCatalog + enrichWithCustomFields 3종 세트를 한 함수로 통합.
 * campaigns.ts 4곳 + spam-filter.ts 1곳 + auto-campaign-worker.ts 1곳 + spam-test-queue.ts 2곳에서
 * 인라인으로 반복되던 코드.
 */
export declare function prepareFieldMappings(companyId: string): Promise<Record<string, VarCatalogEntry>>;
//# sourceMappingURL=messageUtils.d.ts.map