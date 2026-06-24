/**
 * ★ CT-F23 — 전단AI 감사로그 컨트롤타워
 *
 * 전단AI 사용자 접속/액션 이력 기록 및 조회.
 * 한줄로AI audit_logs 패턴 재활용, 전단AI 전용 flyer_audit_logs 테이블 사용.
 *
 * 기록 대상:
 *   - 로그인 (login)
 *   - 전단 생성/수정/삭제 (flyer_create, flyer_update, flyer_delete)
 *   - 발송 (campaign_send)
 *   - 주문 상태 변경 (order_status_change)
 *   - 설정 변경 (settings_update)
 */
export type FlyerAuditAction = 'login' | 'logout' | 'flyer_create' | 'flyer_update' | 'flyer_delete' | 'flyer_publish' | 'campaign_send' | 'order_status_change' | 'coupon_create' | 'coupon_redeem' | 'settings_update' | 'customer_upload' | 'balance_charge';
export interface FlyerAuditLogParams {
    userId: string;
    companyId: string;
    action: FlyerAuditAction;
    targetType?: string;
    targetId?: string;
    details?: Record<string, any>;
    ipAddress?: string | null;
    userAgent?: string | null;
}
export interface FlyerAuditLogEntry {
    id: string;
    userId: string;
    companyId: string;
    action: FlyerAuditAction;
    targetType: string | null;
    targetId: string | null;
    details: Record<string, any> | null;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: string;
    loginId?: string;
    userName?: string;
    storeName?: string;
    companyName?: string;
}
export declare function logFlyerAudit(params: FlyerAuditLogParams): Promise<void>;
export interface FlyerAuditLogQuery {
    companyId?: string;
    userId?: string;
    action?: string;
    fromDate?: string;
    toDate?: string;
    page?: number;
    limit?: number;
}
export interface FlyerAuditLogResult {
    logs: FlyerAuditLogEntry[];
    total: number;
    page: number;
    totalPages: number;
    actions: string[];
}
export declare function queryFlyerAuditLogs(params: FlyerAuditLogQuery): Promise<FlyerAuditLogResult>;
export declare const AUDIT_ACTION_LABELS: Record<string, string>;
//# sourceMappingURL=flyer-audit-log.d.ts.map