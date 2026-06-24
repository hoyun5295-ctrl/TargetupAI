export declare const ALL_SMS_TABLES: string[];
export declare const toKoreaTimeStr: (date: Date) => string;
/**
 * ★ D103: QTmsg 메시지 타입 코드 변환 컨트롤타워
 * 'SMS' → 'S', 'LMS' → 'L', 'MMS' → 'M'
 * campaigns.ts 3곳, auto-campaign-worker 1곳, spam-test-queue 2곳, spam-filter 2곳에서
 * 인라인으로 반복되던 변환 로직을 한 곳으로 통합.
 */
export declare function toQtmsgType(msgType: string): string;
/** 회사/사용자별 발송 테이블 조회 (캐시) — userId가 있으면 사용자 개별 라인그룹 우선 */
export declare function getCompanySmsTables(companyId: string, userId?: string): Promise<string[]>;
/** 회사 전용 라인그룹 할당 여부 확인 (발송 차단용) */
export declare function hasCompanyLineGroup(companyId: string): Promise<boolean>;
/** 테스트 발송 테이블 조회 (캐시) */
export declare function getTestSmsTables(): Promise<string[]>;
/**
 * ★ D103: 테스트/스팸필터 전용 단건 SMS INSERT 컨트롤타워
 * spam-test-queue.ts, spam-filter.ts, campaigns.ts test-send에서
 * 인라인으로 반복되던 테스트 INSERT 로직을 한 곳으로 통합.
 */
export declare function insertTestSmsQueue(destNo: string, callBack: string, content: string, msgType: string, testId: string, subject: string, extra?: {
    companyId?: string;
    billId?: string;
    mmsImages?: string[];
}): Promise<void>;
/** 인증번호 발송 테이블 조회 (캐시) */
export declare function getAuthSmsTable(): Promise<string>;
/** 캐시 무효화 (라인그룹 설정 변경 시 호출) */
export declare function invalidateLineGroupCache(companyId?: string, userId?: string): void;
/** INSERT용: 라운드로빈으로 다음 테이블 반환 */
export declare function getNextSmsTable(tables: string[]): string;
/** ★ COUNT 합산 — UNION ALL 단일 쿼리 */
export declare function smsCountAll(tables: string[], whereClause: string, params: any[]): Promise<number>;
/** ★ 집계 합산 — UNION ALL 단일 쿼리 + JS 합산 */
export declare function smsAggAll(tables: string[], selectFields: string, whereClause: string, params: any[]): Promise<any>;
/**
 * ★ SELECT 합산 — UNION ALL 단일 쿼리
 * _sms_table 메타는 리터럴 컬럼으로 보존. ORDER BY/LIMIT은 outer에서 적용.
 */
export declare function smsSelectAll(tables: string[], selectFields: string, whereClause: string, params: any[], suffix?: string): Promise<any[]>;
/** ★ MIN 합산 — UNION ALL 단일 쿼리 */
export declare function smsMinAll(tables: string[], field: string, whereClause: string, params: any[]): Promise<any>;
/**
 * ★ 다중 campaign_id 배치 집계 — UNION ALL + GROUP BY 단일 쿼리
 * sync-results처럼 여러 캠페인을 한 번에 집계할 때 사용. N개 쿼리 → 1개.
 *
 * @param tables      대상 테이블 목록
 * @param groupField  그룹 컬럼(e.g., 'app_etc1')
 * @param aggFields   `success_count: SUM(CASE ...)` 형식 — 여러 개 지원
 * @param ids         IN 절에 들어갈 값들
 * @returns Map<groupValue, { [aggField]: number }>
 */
export declare function smsBatchAggByGroup(tables: string[], groupField: string, aggFields: string, ids: (string | number)[]): Promise<Map<string, Record<string, number>>>;
/**
 * ★ GROUP BY 집계 — UNION ALL + 단일 GROUP BY
 * results.ts의 smsUnionGroupBy를 CT-04로 승격. 오류사유/통신사별 집계 등에 사용.
 */
export declare function smsGroupByAll(tables: string[], rawField: string, whereClause: string, params: any[]): Promise<Record<string, number>>;
/** DELETE/UPDATE: 해당 테이블 모두 실행 */
export declare function smsExecAll(tables: string[], sqlTemplate: string, params: any[]): Promise<void>;
/**
 * ★ 슈퍼관리자 전역 조회용 — 전체 LIVE 테이블 + 전체 LOG 테이블
 * 회사/유저 구분 없이 모든 SMSQ_SEND* 테이블(LIVE+LOG)을 반환한다.
 * admin.ts의 sms-detail 등 어드민 범위 조회에서 사용.
 */
export declare function getAllSmsTablesWithLogs(): Promise<string[]>;
/**
 * ★ 캠페인 단일 조회용 — 해당 회사의 LIVE 테이블 + 발송월 LOG 테이블만 반환
 * admin.ts sms-detail, 결과 상세 조회 등에서 사용. 확장성 O(1~3개).
 *
 * @param companyId - 캠페인 소유 회사 ID
 * @param refDate   - 캠페인 발송 기준 시각 (sent_at || scheduled_at || created_at)
 * @param userId    - (선택) 사용자 라인그룹이 있을 경우
 */
export declare function getCampaignSmsTables(companyId: string, refDate: Date, userId?: string): Promise<string[]>;
/** 회사 발송 테이블 + 로그 테이블 (결과 조회용) */
export declare function getCompanySmsTablesWithLogs(companyId: string, userId?: string): Promise<string[]>;
export declare function ensureMonthlyLogTables(): Promise<void>;
/** 카카오 브랜드메시지 큐 INSERT */
export declare function insertKakaoQueue(params: {
    bubbleType: string;
    senderKey: string;
    phone: string;
    targeting: string;
    message: string;
    isAd: boolean;
    reservedDate?: string;
    attachmentJson?: string;
    carouselJson?: string;
    header?: string;
    resendType?: string;
    resendFrom?: string;
    resendMessage?: string;
    resendTitle?: string;
    unsubscribePhone?: string;
    unsubscribeAuth?: string;
    requestUid?: string;
}): Promise<void>;
/**
 * CT-04: 기본형 브랜드메시지 발송 큐 INSERT (IMC_BM_BASIC_BIZ_MSG)
 * 템플릿 코드 + 변수 JSON 기반 발송
 */
export declare function insertKakaoBasicQueue(params: {
    bubbleType: string;
    senderKey: string;
    phone: string;
    targeting: string;
    templateCode: string;
    isAd: boolean;
    reservedDate?: string;
    header?: string;
    message?: string;
    additionalContent?: string;
    attachmentJson?: string;
    carouselJson?: string;
    messageVariableJson?: string;
    buttonVariableJson?: string;
    couponVariableJson?: string;
    imageVariableJson?: string;
    videoVariableJson?: string;
    commerceVariableJson?: string;
    carouselVariableJson?: string;
    resendType?: string;
    resendFrom?: string;
    resendMessage?: string;
    resendTitle?: string;
    unsubscribePhone?: string;
    unsubscribeAuth?: string;
    requestUid?: string;
}): Promise<void>;
/**
 * CT-04: 알림톡 발송 큐 INSERT (SMSQ_SEND에 msg_type='K')
 * QTmsg Agent가 SMSQ_SEND에서 가져가서 발송
 */
export declare function insertAlimtalkQueue(tables: string[], rows: {
    phone: string;
    callback: string;
    message: string;
    templateCode: string;
    nextType?: string;
    nextContents?: string;
    buttonJson?: string;
    etcJson?: string;
    titleStr?: string;
    reservedDate?: string;
    companyId?: string;
}[]): Promise<number>;
/** 카카오 발송 결과 집계 */
export declare function kakaoAgg(whereClause: string, params: any[]): Promise<{
    total: number;
    success: number;
    fail: number;
    pending: number;
}>;
/** 카카오 예약 대기 건수 */
export declare function kakaoCountPending(requestUid: string): Promise<number>;
/** 카카오 예약 취소 (대기 건 삭제) */
export declare function kakaoCancelPending(requestUid: string): Promise<number>;
/** 카카오 COUNT — whereClause는 "WHERE" 접두사 선택적 */
export declare function kakaoCountWhere(whereClause: string, params: any[]): Promise<number>;
/** 카카오 SELECT — suffix에 ORDER BY/LIMIT/GROUP BY 지정 가능 */
export declare function kakaoSelectWhere(fields: string, whereClause: string, params: any[], suffix?: string): Promise<any[]>;
/**
 * ★ 카카오 다중 REQUEST_UID 배치 집계 — GROUP BY 단일 쿼리
 * sync-results 등에서 여러 캠페인 한 번에 집계.
 */
export declare function kakaoBatchAggByGroup(ids: string[]): Promise<Map<string, {
    total: number;
    success: number;
    fail: number;
    pending: number;
}>>;
/** 카카오 GROUP BY — 오류사유별/상태별 집계 */
export declare function kakaoGroupBy(rawField: string, whereClause: string, params: any[]): Promise<Record<string, number>>;
/**
 * SMS 큐에 메시지를 bulk INSERT한다.
 * 모든 발송 경로(AI캠페인, 직접발송, 자동발송)가 이 함수를 사용한다.
 *
 * @param tables       회사 발송 테이블 목록 (라운드로빈 분배)
 * @param rows         발송 데이터 배열. 각 row:
 *                     [dest_no, call_back, msg_contents, msg_type, title_str,
 *                      sendTime, app_etc1, app_etc2, file_name1, file_name2, file_name3]
 * @param useNow       true면 sendTime 무시하고 NOW() 사용 (즉시발송)
 * @returns            성공 건수
 */
export declare function bulkInsertSmsQueue(tables: string[], rows: any[][], useNow?: boolean): Promise<number>;
//# sourceMappingURL=sms-queue.d.ts.map