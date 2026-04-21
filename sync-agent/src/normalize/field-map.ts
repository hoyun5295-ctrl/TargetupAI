/**
 * FIELD_MAP — 서버 FIELD_MAP의 Agent 로컬 미러
 *
 * ※ SoT: packages/backend/src/utils/standard-field-map.ts (FIELD_MAP 상수)
 *   한줄로 백엔드와 싱크에이전트의 정규화 동작을 100% 일치시키기 위해
 *   백엔드 FIELD_MAP을 Agent 쪽에 1:1 복제한다.
 *   백엔드에 필드 추가/변경 시 반드시 이 파일도 함께 갱신한다.
 *   (DB 의존 헬퍼는 Agent에서는 필요 없으므로 제외 — 순수 상수만 포함)
 *
 * 원칙 (feedback_mirror_hanjul_standard.md):
 *   Agent 정규화 로직은 엑셀 업로드(upload.ts)와 동일하게 동작해야 한다.
 */

export type FieldCategory = 'basic' | 'purchase' | 'store' | 'membership' | 'marketing' | 'custom';
export type StorageType = 'column' | 'custom_fields';
export type DataType = 'string' | 'number' | 'date' | 'boolean';

export interface StandardFieldMapping {
  fieldKey: string;
  category: FieldCategory;
  displayName: string;
  aliases?: string[];
  dataType: DataType;
  storageType: StorageType;
  columnName: string;
  normalizeFunction?: string;
  sortOrder: number;
}

export const FIELD_MAP: StandardFieldMapping[] = [
  // basic
  { fieldKey: 'name',       category: 'basic', displayName: '고객명',       aliases: ['이름', '성함'],             dataType: 'string', storageType: 'column', columnName: 'name',       normalizeFunction: 'trim',            sortOrder: 1 },
  { fieldKey: 'phone',      category: 'basic', displayName: '고객전화번호', aliases: ['전화번호', '연락처', '휴대폰'], dataType: 'string', storageType: 'column', columnName: 'phone',      normalizeFunction: 'normalizePhone',  sortOrder: 2 },
  { fieldKey: 'gender',     category: 'basic', displayName: '성별',         dataType: 'string', storageType: 'column', columnName: 'gender',     normalizeFunction: 'normalizeGender', sortOrder: 3 },
  { fieldKey: 'age',        category: 'basic', displayName: '나이',         dataType: 'number', storageType: 'column', columnName: 'age',        normalizeFunction: 'parseInt',        sortOrder: 4 },
  { fieldKey: 'birth_date', category: 'basic', displayName: '생일',         dataType: 'date',   storageType: 'column', columnName: 'birth_date', normalizeFunction: 'normalizeDate',   sortOrder: 5 },
  { fieldKey: 'email',      category: 'basic', displayName: '이메일주소',   dataType: 'string', storageType: 'column', columnName: 'email',      normalizeFunction: 'normalizeEmail',  sortOrder: 6 },
  { fieldKey: 'address',    category: 'basic', displayName: '주소',         dataType: 'string', storageType: 'column', columnName: 'address',    normalizeFunction: 'trim',            sortOrder: 7 },
  { fieldKey: 'region',     category: 'basic', displayName: '지역',         dataType: 'string', storageType: 'column', columnName: 'region',     normalizeFunction: 'trim',            sortOrder: 7.5 },
  // purchase
  { fieldKey: 'recent_purchase_store',  category: 'purchase', displayName: '최근구매매장', dataType: 'string', storageType: 'column', columnName: 'recent_purchase_store',  normalizeFunction: 'trim',            sortOrder: 8 },
  { fieldKey: 'recent_purchase_amount', category: 'purchase', displayName: '최근구매금액', dataType: 'number', storageType: 'column', columnName: 'recent_purchase_amount', normalizeFunction: 'normalizeAmount', sortOrder: 9 },
  { fieldKey: 'total_purchase_amount',  category: 'purchase', displayName: '누적구매금액', dataType: 'number', storageType: 'column', columnName: 'total_purchase_amount',  normalizeFunction: 'normalizeAmount', sortOrder: 10 },
  { fieldKey: 'purchase_count',         category: 'purchase', displayName: '구매횟수',     dataType: 'number', storageType: 'column', columnName: 'purchase_count',         normalizeFunction: 'parseInt',        sortOrder: 10.5 },
  { fieldKey: 'recent_purchase_date',   category: 'purchase', displayName: '최근구매일',   dataType: 'date',   storageType: 'column', columnName: 'recent_purchase_date',   normalizeFunction: 'normalizeDate',   sortOrder: 10.7 },
  // store
  { fieldKey: 'store_code',        category: 'store', displayName: '브랜드',       dataType: 'string', storageType: 'column', columnName: 'store_code',        normalizeFunction: 'trim',                sortOrder: 11 },
  { fieldKey: 'registration_type', category: 'store', displayName: '등록구분',     dataType: 'string', storageType: 'column', columnName: 'registration_type', normalizeFunction: 'trim',                sortOrder: 12 },
  { fieldKey: 'registered_store',  category: 'store', displayName: '등록매장정보', dataType: 'string', storageType: 'column', columnName: 'registered_store',  normalizeFunction: 'trim',                sortOrder: 13 },
  { fieldKey: 'store_phone',       category: 'store', displayName: '매장전화번호', dataType: 'string', storageType: 'column', columnName: 'store_phone',       normalizeFunction: 'normalizeStorePhone', sortOrder: 14 },
  { fieldKey: 'store_name',        category: 'store', displayName: '매장명',       dataType: 'string', storageType: 'column', columnName: 'store_name',        normalizeFunction: 'trim',                sortOrder: 14.5 },
  // membership
  { fieldKey: 'grade',  category: 'membership', displayName: '고객등급',   dataType: 'string', storageType: 'column', columnName: 'grade',  normalizeFunction: 'normalizeGrade', sortOrder: 15 },
  { fieldKey: 'points', category: 'membership', displayName: '보유포인트', dataType: 'number', storageType: 'column', columnName: 'points', normalizeFunction: 'parseInt',       sortOrder: 16 },
  // marketing
  { fieldKey: 'sms_opt_in', category: 'marketing', displayName: '수신동의여부', dataType: 'boolean', storageType: 'column', columnName: 'sms_opt_in', normalizeFunction: 'normalizeSmsOptIn', sortOrder: 17 },
  // custom 15 slots
  { fieldKey: 'custom_1',  category: 'custom', displayName: '커스텀1',  dataType: 'string', storageType: 'custom_fields', columnName: 'custom_1',  sortOrder: 18 },
  { fieldKey: 'custom_2',  category: 'custom', displayName: '커스텀2',  dataType: 'string', storageType: 'custom_fields', columnName: 'custom_2',  sortOrder: 19 },
  { fieldKey: 'custom_3',  category: 'custom', displayName: '커스텀3',  dataType: 'string', storageType: 'custom_fields', columnName: 'custom_3',  sortOrder: 20 },
  { fieldKey: 'custom_4',  category: 'custom', displayName: '커스텀4',  dataType: 'string', storageType: 'custom_fields', columnName: 'custom_4',  sortOrder: 21 },
  { fieldKey: 'custom_5',  category: 'custom', displayName: '커스텀5',  dataType: 'string', storageType: 'custom_fields', columnName: 'custom_5',  sortOrder: 22 },
  { fieldKey: 'custom_6',  category: 'custom', displayName: '커스텀6',  dataType: 'string', storageType: 'custom_fields', columnName: 'custom_6',  sortOrder: 23 },
  { fieldKey: 'custom_7',  category: 'custom', displayName: '커스텀7',  dataType: 'string', storageType: 'custom_fields', columnName: 'custom_7',  sortOrder: 24 },
  { fieldKey: 'custom_8',  category: 'custom', displayName: '커스텀8',  dataType: 'string', storageType: 'custom_fields', columnName: 'custom_8',  sortOrder: 25 },
  { fieldKey: 'custom_9',  category: 'custom', displayName: '커스텀9',  dataType: 'string', storageType: 'custom_fields', columnName: 'custom_9',  sortOrder: 26 },
  { fieldKey: 'custom_10', category: 'custom', displayName: '커스텀10', dataType: 'string', storageType: 'custom_fields', columnName: 'custom_10', sortOrder: 27 },
  { fieldKey: 'custom_11', category: 'custom', displayName: '커스텀11', dataType: 'string', storageType: 'custom_fields', columnName: 'custom_11', sortOrder: 28 },
  { fieldKey: 'custom_12', category: 'custom', displayName: '커스텀12', dataType: 'string', storageType: 'custom_fields', columnName: 'custom_12', sortOrder: 29 },
  { fieldKey: 'custom_13', category: 'custom', displayName: '커스텀13', dataType: 'string', storageType: 'custom_fields', columnName: 'custom_13', sortOrder: 30 },
  { fieldKey: 'custom_14', category: 'custom', displayName: '커스텀14', dataType: 'string', storageType: 'custom_fields', columnName: 'custom_14', sortOrder: 31 },
  { fieldKey: 'custom_15', category: 'custom', displayName: '커스텀15', dataType: 'string', storageType: 'custom_fields', columnName: 'custom_15', sortOrder: 32 },
];

export function getFieldByKey(fieldKey: string): StandardFieldMapping | undefined {
  return FIELD_MAP.find(f => f.fieldKey === fieldKey);
}

export function getColumnFields(): StandardFieldMapping[] {
  return FIELD_MAP.filter(f => f.storageType === 'column').sort((a, b) => a.sortOrder - b.sortOrder);
}
