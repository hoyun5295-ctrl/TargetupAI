export type SampleCustomerKey = 'vip' | 'newbie' | 'empty';
export type SampleCustomer = {
    key: SampleCustomerKey;
    label: string;
    description: string;
    data: Record<string, any> | null;
};
/**
 * 회사별 샘플 고객 3종 선정.
 * VIP: grade='VIP' 또는 points 상위 / Newbie: 최근 가입 + 구매횟수 적음 / Empty: 가상 null
 */
export declare function selectSampleCustomers(companyId: string): Promise<SampleCustomer[]>;
export declare function selectSampleCustomerByKey(companyId: string, key: SampleCustomerKey): Promise<SampleCustomer>;
//# sourceMappingURL=dm-sample-customer.d.ts.map