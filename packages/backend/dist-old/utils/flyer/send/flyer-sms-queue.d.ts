/**
 * ★ CT-F01 — 전단AI SMS 큐 컨트롤타워
 *
 * 한줄로 utils/sms-queue.ts와 완전 분리.
 * - 라인그룹 조회: flyer_companies.line_group_id 기반
 * - MySQL QTmsg 큐 조작 함수(smsAggAll/bulkInsertSmsQueue 등)는 sms-queue.ts 것을 재export
 *   (MySQL 테이블 조작은 PG 스키마와 무관하므로 안전)
 *
 * ⚠️ flyer_companies.line_group_id 컬럼이 반드시 있어야 함 (FLYER-SCHEMA.md 참조)
 */
/**
 * 전단AI 회사의 발송 라인그룹 테이블 조회.
 * flyer_companies.line_group_id → sms_line_groups → sms_tables 배열
 * 할당 없으면 환경변수 SMS_TABLES fallback (한줄로와 공유하는 기본 라인)
 */
export declare function getFlyerCompanySmsTables(companyId: string): Promise<string[]>;
export declare function invalidateFlyerLineGroupCache(companyId?: string): void;
export { toQtmsgType, toKoreaTimeStr, smsAggAll, smsCountAll, smsSelectAll, smsMinAll, smsGroupByAll, smsBatchAggByGroup, smsExecAll, bulkInsertSmsQueue, insertTestSmsQueue, getTestSmsTables, getAuthSmsTable, } from '../../sms-queue';
//# sourceMappingURL=flyer-sms-queue.d.ts.map