export interface ManagerDocInfo {
    originalName: string;
    storedName: string;
    filePath: string;
    fileSize: number;
    uploadedAt: string;
}
export interface SenderManager {
    id: string;
    company_id: string;
    manager_name: string;
    manager_phone: string;
    manager_email: string | null;
    authorization_doc: ManagerDocInfo | null;
    status: string;
    reviewed_by: string | null;
    reviewed_at: string | null;
    reject_reason: string | null;
    created_at: string;
    updated_at: string;
    company_name?: string;
    reviewed_by_name?: string;
}
export interface DocumentInfo {
    type: 'telecom_cert' | 'authorization' | 'consent_form' | 'employment_cert' | 'business_relation';
    originalName: string;
    storedName: string;
    filePath: string;
    fileSize: number;
    uploadedAt: string;
}
export interface SenderRegistration {
    id: string;
    company_id: string;
    requested_by: string;
    phone: string;
    label: string | null;
    store_code: string | null;
    store_name: string | null;
    number_type: 'company' | 'other';
    documents: DocumentInfo[];
    request_note: string | null;
    status: string;
    reviewed_by: string | null;
    reviewed_at: string | null;
    reject_reason: string | null;
    approved_callback_id: string | null;
    created_at: string;
    updated_at: string;
    company_name?: string;
    requested_by_name?: string;
    reviewed_by_name?: string;
}
/** 담당자 목록 조회 (inactive 제외) */
export declare function getManagers(companyId: string): Promise<SenderManager[]>;
/** 담당자 등록 (위임장 첨부 시 status='pending' → 슈퍼관리자 승인 필요) */
export declare function createManager(companyId: string, data: {
    managerName: string;
    managerPhone: string;
    managerEmail?: string;
    authorizationDoc?: ManagerDocInfo;
}): Promise<SenderManager>;
/** 담당자 수정 */
export declare function updateManager(managerId: string, companyId: string, data: {
    managerName?: string;
    managerPhone?: string;
    managerEmail?: string;
}): Promise<SenderManager | null>;
/** 담당자 삭제 (soft delete) */
export declare function deleteManager(managerId: string, companyId: string): Promise<boolean>;
/** 담당자 승인 대기 목록 (슈퍼관리자용) */
export declare function getPendingManagers(): Promise<SenderManager[]>;
/** 전체 담당자 목록 (슈퍼관리자용, 필터 가능) */
export declare function getAllManagers(status?: string): Promise<SenderManager[]>;
/** 담당자 위임장 승인 */
export declare function approveManager(managerId: string, reviewedBy: string): Promise<SenderManager>;
/** 담당자 위임장 반려 */
export declare function rejectManager(managerId: string, reviewedBy: string, rejectReason: string): Promise<SenderManager>;
/** 담당자 승인 대기 건수 (배지용) */
export declare function getPendingManagerCount(): Promise<number>;
/** 승인된 담당자가 있는지 확인 (발신번호 등록 전제조건) */
export declare function hasApprovedManager(companyId: string): Promise<boolean>;
/** 등록 신청 생성 */
export declare function createRegistration(data: {
    companyId: string;
    requestedBy: string;
    phone: string;
    label?: string;
    storeCode?: string;
    storeName?: string;
    numberType?: 'company' | 'other';
    documents: DocumentInfo[];
    requestNote?: string;
}): Promise<SenderRegistration>;
/** 고객사의 신청 목록 조회 */
export declare function getRegistrationsByCompany(companyId: string): Promise<SenderRegistration[]>;
/** 승인 대기 목록 조회 (슈퍼관리자용) */
export declare function getPendingRegistrations(): Promise<SenderRegistration[]>;
/** 전체 신청 목록 조회 (슈퍼관리자용, 필터 가능) */
export declare function getAllRegistrations(status?: string): Promise<SenderRegistration[]>;
/** 단건 조회 */
export declare function getRegistrationById(registrationId: string): Promise<SenderRegistration | null>;
/** 승인 처리 — callback_numbers에 INSERT + 상태 변경 */
export declare function approveRegistration(registrationId: string, reviewedBy: string): Promise<{
    registration: SenderRegistration;
    callbackNumber: any;
}>;
/** 반려 처리 */
export declare function rejectRegistration(registrationId: string, reviewedBy: string, rejectReason: string): Promise<SenderRegistration>;
export interface CallbackNumberAssignment {
    id: string;
    callback_number_id: string;
    user_id: string;
    assigned_by: string;
    created_at: string;
    user_name?: string;
    user_email?: string;
    store_codes?: string[];
}
/** 배정 범위 변경 (all / assigned) */
export declare function updateAssignmentScope(callbackNumberId: string, companyId: string, scope: 'all' | 'assigned'): Promise<boolean>;
/** 사용자 배정 추가 (여러 명 한 번에) */
export declare function assignUsersToCallback(callbackNumberId: string, companyId: string, userIds: string[], assignedBy: string): Promise<CallbackNumberAssignment[]>;
/** 사용자 배정 해제 */
export declare function unassignUserFromCallback(callbackNumberId: string, userId: string, companyId: string): Promise<boolean>;
/** 특정 발신번호에 배정된 사용자 목록 조회 */
export declare function getAssignmentsByCallback(callbackNumberId: string, companyId: string): Promise<CallbackNumberAssignment[]>;
/** 특정 사용자에게 배정된 발신번호 ID 목록 조회 (발송 시 필터링용) */
export declare function getAssignedCallbackIds(userId: string, companyId: string): Promise<string[]>;
/** 배정 전체 교체 (기존 삭제 → 새로 INSERT) */
export declare function replaceAssignments(callbackNumberId: string, companyId: string, userIds: string[], assignedBy: string): Promise<CallbackNumberAssignment[]>;
/** 승인 대기 건수 조회 (슈퍼관리자 대시보드 배지용) — 담당자 + 발신번호 합산 */
export declare function getPendingCount(): Promise<{
    managers: number;
    registrations: number;
    total: number;
}>;
//# sourceMappingURL=sender-registration.d.ts.map