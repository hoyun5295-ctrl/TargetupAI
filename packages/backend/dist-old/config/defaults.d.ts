/**
 * 플랫폼 기본값 설정 (중앙 관리)
 *
 * 원칙: 고객사 DB 값 우선 → 없을 경우 환경변수 → 없을 경우 아래 기본값
 * 하드코딩 방지: 모든 파일에서 이 모듈을 import하여 사용
 * 수정 시 이 파일 하나만 변경하면 전체 반영됨
 */
import Redis from 'ioredis';
export declare const REDIS_URL: string;
export declare const redis: Redis;
export declare const AI_MODELS: {
    claude: string;
    gpt: string;
};
export declare const DEFAULT_COSTS: {
    sms: number;
    lms: number;
    mms: number;
    kakao: number;
};
/**
 * 고객사 단가 조회 헬퍼
 * company 레코드에서 단가를 추출하되, 미설정 시 환경변수 기본값 사용
 */
export declare function getCompanyCosts(company: Record<string, any>): {
    sms: number;
    lms: number;
    mms: number;
    kakao: number;
};
export declare const TIMEOUTS: {
    /** 슈퍼관리자 세션 타임아웃 — 30분 */
    superAdminSessionMinutes: number;
    /** 세션 활동 갱신 주기 — 5분 */
    activityUpdate: number;
    /** 스팸필터 테스트 최종 안전장치 타임아웃 — 60초 (정상 시 QTmsg 성공 후 10초에 판정 완료) */
    spamFilterTest: number;
    /** 스팸필터 안전 강제종료 — 90초 */
    spamFilterSafety: number;
    /** 업로드 파일 정리 주기 — 1시간 */
    uploadCleanup: number;
    /** 동기화 중단 정리 기준 — 30분 */
    syncStaleThreshold: number;
    /** 동기화 정리 주기 — 5분 */
    syncCleanupInterval: number;
    /** AI 재시도 대기 — 2초 */
    aiRetryDelay: number;
};
export declare const BATCH_SIZES: {
    /** 고객 업로드 DB insert 배치 (원래 4000 → 500 으로 축소된 이력 있음, 복원) */
    customerUpload: number;
    /** SMS/LMS/MMS MySQL 큐 INSERT 배치 (max_allowed_packet 64MB 기준, LMS 건당 ~2KB → 5000건=10MB) */
    smsSend: number;
    /** 발송 메시지 업데이트 배치 */
    messageUpdate: number;
    /** 동기화 API 고객 배치 */
    syncCustomer: number;
    /** 동기화 API 구매 배치 */
    syncPurchase: number;
    /** 고객 세그멘테이션 기본 한도 */
    customerSegment: number;
};
export declare const CACHE_TTL: {
    /** 라인그룹 캐시 — 60초 (밀리초 아님 주의: campaigns.ts에서 ms로 변환) */
    lineGroup: number;
    /** 고객 통계 — 60초 */
    customerStats: number;
    /** 업로드 메타데이터 — 10분 */
    uploadMeta: number;
    /** 업로드 진행상태 — 1시간 */
    uploadProgress: number;
    /** 메시지 편집 진행상태 — 10분 */
    messageEditProgress: number;
    /** 발송결과 차트 데이터 — 진행중 5분 / 완료 24시간 */
    resultChartActive: number;
    resultChartCompleted: number;
};
export declare const RATE_LIMITS: {
    /** Rate limit 윈도우 — 1분 */
    windowMs: number;
    /** IP 차단 기준 실패 횟수 */
    ipFailThreshold: number;
    /** 회사별 분당 최대 요청 */
    companyMaxPerMinute: number;
};
export declare const AI_MAX_TOKENS: {
    /** 필드 매핑 (upload.ts) */
    fieldMapping: number;
    /** 브랜드 메시지 생성 */
    brandMessage: number;
    /** 타겟 추천 */
    targeting: number;
    /** 브리핑 파싱 */
    briefingParse: number;
    /** 맞춤 메시지 생성 */
    customMessage: number;
    /** 분석 인사이트 */
    analysis: number;
};
export declare const SEND_HOURS: {
    /** 발송 시작 시각 (24시간제) — 이 시간 이전에는 발송하지 않음 */
    start: number;
    /** 발송 종료 시각 (24시간제) — 이 시간 이후에는 다음날 start로 이월 */
    end: number;
};
export declare const LIMITS: {
    /** Express JSON body 최대 크기 */
    requestBodySize: string;
    /** MMS 이미지 파일 최대 크기 (bytes) */
    mmsImageSize: number;
    /** MMS 이미지 최대 장수 */
    mmsImageCount: number;
    /** JWT 토큰 만료 */
    jwtExpiry: string;
};
export declare const INVITO_INFO: {
    /** 상호 */
    companyName: string;
    /** 대표자명 */
    ceoName: string;
    /** 사업자등록번호 */
    bizNumber: string;
    /** 업태/종목 */
    bizType: string;
    /** 주소 */
    address: string;
    /** 대표 연락처 */
    phone: string;
    /** 대표 이메일 */
    email: string;
};
//# sourceMappingURL=defaults.d.ts.map