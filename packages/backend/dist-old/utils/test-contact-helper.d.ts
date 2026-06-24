/**
 * ★ CT-11: test-contact-helper.ts — 담당자 사전수신 컨트롤타워
 *
 * 역할: 담당자(test_contacts) 조회/추가/삭제의 유일한 진입점
 * 적용 파일: test-contacts.ts (CRUD API), campaigns.ts (test-send)
 *
 * D97: 항상 사용자별 격리 — 각자 자기 담당자만 관리
 * 기존 공용(user_id=NULL) 데이터는 모든 사용자에게 보임 (하위호환)
 */
export interface TestContact {
    id?: string;
    name: string;
    phone: string;
    user_id?: string | null;
    created_at?: string;
}
/**
 * 사용자별 담당자 목록 조회
 * - 본인 것(user_id=userId) + 기존 공용(user_id=NULL) 포함
 */
export declare function getUserTestContacts(companyId: string, userId: string): Promise<TestContact[]>;
/**
 * 담당자 추가 (항상 사용자별)
 * - user_id = userId로 저장
 * - 중복 체크: 본인 것 중에서만
 */
export declare function addTestContact(companyId: string, userId: string, name: string, phone: string): Promise<{
    success: boolean;
    contact?: TestContact;
    error?: string;
}>;
/**
 * 담당자 삭제
 * - 본인 것(user_id=userId) 또는 공용(user_id=NULL)만 삭제 가능
 */
export declare function deleteTestContact(id: string, companyId: string, userId: string): Promise<{
    success: boolean;
    error?: string;
}>;
//# sourceMappingURL=test-contact-helper.d.ts.map