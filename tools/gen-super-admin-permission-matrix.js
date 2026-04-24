/**
 * 슈퍼관리자 권한 매트릭스 엑셀 생성기
 *
 * 목적: 한줄로 슈퍼관리자 전체 기능을 카테고리별로 정리하고,
 *       4개 ID(Harold/서팀장/직원A/직원B)에 어떤 권한을 부여할지
 *       Harold님이 O/X 체크해서 반환할 수 있는 엑셀 파일 생성.
 *
 * 실행:
 *   cd packages/backend && node ../../tools/gen-super-admin-permission-matrix.js
 *
 * 결과:
 *   docs/슈퍼관리자-권한-매트릭스.xlsx
 */

const path = require('path');
const XLSX = require(path.resolve(__dirname, '..', 'packages', 'backend', 'node_modules', 'xlsx'));

// ==========================================================================
// 기능 목록 (소스 분석 기반 — admin.ts, companies.ts, alimtalk.ts,
// billing.ts, sender-registration.ts, admin-sync.ts, switch-service.ts,
// admin/flyer-admin.ts 의 requireSuperAdmin 엔드포인트 전수)
// ==========================================================================

const features = [
  // A. 고객사 관리 (13건)
  { cat: 'A. 고객사 관리', name: '고객사 목록 조회', desc: '전체 고객사 리스트 (검색·페이지네이션)', risk: '', api: 'GET /api/companies' },
  { cat: 'A. 고객사 관리', name: '고객사 상세 조회', desc: '개별 고객사 정보·설정', risk: '', api: 'GET /api/companies/:id' },
  { cat: 'A. 고객사 관리', name: '고객사 생성', desc: '신규 고객사 등록', risk: '', api: 'POST /api/companies' },
  { cat: 'A. 고객사 관리', name: '고객사 수정 (기본정보)', desc: '이름·도메인·설정 변경', risk: '', api: 'PUT /api/admin/companies/:id' },
  { cat: 'A. 고객사 관리', name: '고객사 삭제', desc: '고객사 완전 삭제 (복구 불가)', risk: '⚠️⚠️', api: 'DELETE /api/admin/companies/:id' },
  { cat: 'A. 고객사 관리', name: '무료체험 부여 (30일 PRO)', desc: 'PRO 30일 무료 제공 (grant-trial)', risk: '', api: 'POST /api/companies/:id/grant-trial' },
  { cat: 'A. 고객사 관리', name: '무료체험 회수', desc: '체험 강제 종료 (revoke-trial)', risk: '', api: 'POST /api/companies/:id/revoke-trial' },
  { cat: 'A. 고객사 관리', name: '대시보드 카드 설정 조회', desc: '고객사별 대시보드 카드 구성', risk: '', api: 'GET /dashboard-cards' },
  { cat: 'A. 고객사 관리', name: '대시보드 카드 설정 수정', desc: '카드 on/off 및 순서 변경', risk: '', api: 'PUT /dashboard-cards' },
  { cat: 'A. 고객사 관리', name: '고객사 필드 조회', desc: 'FIELD_MAP + 커스텀 필드 상태', risk: '', api: 'GET /api/admin/companies/:id/fields' },
  { cat: 'A. 고객사 관리', name: '고객사 필드 수정', desc: 'enabled 필드 on/off 강제 변경', risk: '', api: 'PUT /api/admin/companies/:id/fields' },
  { cat: 'A. 고객사 관리', name: '고객사 필드 데이터 체크', desc: '실제 데이터 존재 여부 검증', risk: '', api: 'GET /field-data-check' },
  { cat: 'A. 고객사 관리', name: '표준 필드 조회', desc: '시스템 전역 표준 필드 정의', risk: '', api: 'GET /api/admin/standard-fields' },

  // B. 사용자 관리 (9건)
  { cat: 'B. 사용자 관리', name: '사용자 목록 조회 (전체 회사)', desc: '모든 고객사 사용자 리스트', risk: '', api: 'GET /api/admin/users' },
  { cat: 'B. 사용자 관리', name: '사용자 생성', desc: 'admin / user 계정 신규 생성', risk: '', api: 'POST /api/admin/users' },
  { cat: 'B. 사용자 관리', name: '사용자 수정', desc: '이름·권한·브랜드 배정', risk: '', api: 'PUT /api/admin/users/:id' },
  { cat: 'B. 사용자 관리', name: '사용자 삭제', desc: '계정 비활성화', risk: '⚠️', api: 'DELETE /api/admin/users/:id' },
  { cat: 'B. 사용자 관리', name: '사용자 비밀번호 초기화', desc: '임시 비밀번호 재발급', risk: '⚠️', api: 'POST /api/admin/users/:id/reset-password' },
  { cat: 'B. 사용자 관리', name: '사용자 수신거부 조회', desc: '사용자(브랜드)별 수신거부 목록', risk: '🔒', api: 'GET /api/admin/users/:id/unsubscribes' },
  { cat: 'B. 사용자 관리', name: '사용자 수신거부 삭제', desc: '수신거부 엔트리 제거', risk: '⚠️', api: 'DELETE /api/admin/users/:id/unsubscribes' },
  { cat: 'B. 사용자 관리', name: '수신거부 엑셀 다운로드', desc: '수신거부 전화번호 추출', risk: '🔒', api: 'GET /unsubscribes/export' },
  { cat: 'B. 사용자 관리', name: '사용자 고객 전체 삭제', desc: '해당 사용자의 고객 DB 전체 삭제 (복구 불가)', risk: '⚠️⚠️', api: 'DELETE /api/admin/users/:id/customers' },

  // C. 고객 DB 접근 (5건)
  { cat: 'C. 고객 DB 접근', name: '고객 DB 조회 (회사 지정)', desc: '특정 고객사 고객 리스트/상세', risk: '🔒', api: 'GET /api/customers?companyId=' },
  { cat: 'C. 고객 DB 접근', name: '고객 DB 엑셀 다운로드', desc: '고객사 고객 정보 전체 추출 (★ 가장 민감)', risk: '🔒🔒', api: 'GET /api/customers/download' },
  { cat: 'C. 고객 DB 접근', name: '고객 마스킹 해제 (제안·미구현)', desc: '기본 마스킹을 2FA 재인증 후 임시 해제 (감사 로그)', risk: '🔒🔒', api: '(신규 제안)' },
  { cat: 'C. 고객 DB 접근', name: '고객사 대시보드 카드 데이터', desc: 'companyId 지정 고객사 현황 조회', risk: '🔒', api: 'GET /dashboard-cards' },
  { cat: 'C. 고객 DB 접근', name: '싱크에이전트 API 키 조회', desc: 'Agent API 키 (해킹 시 직접 DB 접근)', risk: '🔒🔒', api: 'GET /api/admin/companies/:id/sync-keys' },

  // D. 요금제 (7건)
  { cat: 'D. 요금제', name: '요금제 목록', desc: 'FREE/STARTER/BASIC/PRO 전체', risk: '', api: 'GET /api/admin/plans' },
  { cat: 'D. 요금제', name: '요금제 생성', desc: '신규 플랜 등록', risk: '', api: 'POST /api/admin/plans' },
  { cat: 'D. 요금제', name: '요금제 수정', desc: '가격·기능 게이팅 변경', risk: '', api: 'PUT /api/admin/plans/:id' },
  { cat: 'D. 요금제', name: '요금제 삭제', desc: '플랜 제거', risk: '⚠️', api: 'DELETE /api/admin/plans/:id' },
  { cat: 'D. 요금제', name: '플랜 변경 신청 조회', desc: '고객 요청 대기 목록', risk: '', api: 'GET /api/admin/plan-requests' },
  { cat: 'D. 요금제', name: '플랜 변경 신청 승인', desc: '신청 → 반영', risk: '', api: 'PUT /plan-requests/:id/approve' },
  { cat: 'D. 요금제', name: '플랜 변경 신청 반려', desc: '신청 거부', risk: '', api: 'PUT /plan-requests/:id/reject' },

  // E. 입금·잔액·청구 (15건)
  { cat: 'E. 입금·잔액·청구', name: '청구 방식 변경 (선불/후불)', desc: 'billing_type 전환', risk: '⚠️', api: 'PATCH /api/admin/companies/:id/billing-type' },
  { cat: 'E. 입금·잔액·청구', name: '잔액 수동 조정', desc: '잔액 강제 변경 (자금 흐름)', risk: '⚠️🔒', api: 'POST /balance-adjust' },
  { cat: 'E. 입금·잔액·청구', name: '잔액 이력 조회', desc: '고객사 잔액 변동 로그', risk: '🔒', api: 'GET /balance-transactions' },
  { cat: 'E. 입금·잔액·청구', name: '입금 신청 목록', desc: '입금 대기 리스트', risk: '', api: 'GET /api/admin/deposit-requests' },
  { cat: 'E. 입금·잔액·청구', name: '입금 신청 승인', desc: '입금 확인 → 잔액 충전', risk: '🔒', api: 'PUT /deposit-requests/:id/approve' },
  { cat: 'E. 입금·잔액·청구', name: '입금 신청 반려', desc: '입금 반려', risk: '', api: 'PUT /deposit-requests/:id/reject' },
  { cat: 'E. 입금·잔액·청구', name: '전체 잔액 현황', desc: '모든 고객사 잔액 오버뷰', risk: '🔒', api: 'GET /api/admin/balance-overview' },
  { cat: 'E. 입금·잔액·청구', name: '충전/차감 이력 관리', desc: '전체 잔액 변동 집계', risk: '🔒', api: 'GET /api/admin/charge-management' },
  { cat: 'E. 입금·잔액·청구', name: '청구서 생성', desc: '월간 청구서 발행', risk: '', api: 'POST /api/billing/generate' },
  { cat: 'E. 입금·잔액·청구', name: '청구서 목록/상세', desc: '발행된 청구서 조회', risk: '', api: 'GET /api/billing/list' },
  { cat: 'E. 입금·잔액·청구', name: '청구서 상태 변경', desc: '발송/수금 상태', risk: '', api: 'PUT /api/billing/:id/status' },
  { cat: 'E. 입금·잔액·청구', name: '청구서 삭제', desc: '청구서 취소', risk: '⚠️', api: 'DELETE /api/billing/:id' },
  { cat: 'E. 입금·잔액·청구', name: '청구서 PDF 다운로드', desc: 'PDF 생성/다운', risk: '', api: 'GET /api/billing/:id/pdf' },
  { cat: 'E. 입금·잔액·청구', name: '청구서 이메일 발송', desc: '고객사 이메일로 발송', risk: '🔒', api: 'POST /api/admin/billing/:id/send-email' },
  { cat: 'E. 입금·잔액·청구', name: '인보이스 관리', desc: '개별 인보이스 CRUD', risk: '', api: '/api/billing/invoices/*' },

  // F. 캠페인 (4건)
  { cat: 'F. 캠페인', name: '전체 캠페인 조회 (모든 회사)', desc: '플랫폼 내 모든 캠페인 리스트', risk: '🔒', api: 'GET /api/admin/campaigns/all' },
  { cat: 'F. 캠페인', name: '예약 캠페인 조회', desc: '예약 대기 중인 캠페인', risk: '', api: 'GET /api/admin/campaigns/scheduled' },
  { cat: 'F. 캠페인', name: '캠페인 강제 취소 (관리자)', desc: '임의 캠페인 취소 + 환불', risk: '⚠️', api: 'POST /api/admin/campaigns/:id/cancel' },
  { cat: 'F. 캠페인', name: '캠페인 SMS 상세 조회', desc: '수신자별 성공/실패 메시지 내용', risk: '🔒', api: 'GET /sms-detail' },

  // G. 발송 통계 (3건)
  { cat: 'G. 발송 통계', name: '발송 통계 조회', desc: '기간·채널별 집계', risk: '', api: 'GET /api/admin/stats/send' },
  { cat: 'G. 발송 통계', name: '발송 통계 상세', desc: '고객사·사용자별 드릴다운', risk: '', api: 'GET /stats/send/detail' },
  { cat: 'G. 발송 통계', name: '발송 통계 엑셀 다운로드', desc: 'CSV 통계 추출', risk: '🔒', api: 'GET /api/admin/stats/export' },

  // H. 발신/회신번호 (10건)
  { cat: 'H. 발신/회신번호', name: '기본 회신번호 조회', desc: '플랫폼 공용 회신번호', risk: '', api: 'GET /callback-numbers' },
  { cat: 'H. 발신/회신번호', name: '기본 회신번호 생성', desc: '신규 등록', risk: '', api: 'POST /callback-numbers' },
  { cat: 'H. 발신/회신번호', name: '기본 회신번호 수정/삭제', desc: '이름·배정 변경', risk: '', api: 'PUT/DELETE /callback-numbers/:id' },
  { cat: 'H. 발신/회신번호', name: '담당자 위임장 대기 조회', desc: '승인 대기 담당자', risk: '', api: 'GET /pending-managers' },
  { cat: 'H. 발신/회신번호', name: '담당자 승인/반려', desc: '위임장 처리', risk: '', api: 'POST /managers/:id/{approve,reject}' },
  { cat: 'H. 발신/회신번호', name: '발신번호 신청 목록 (대기/전체)', desc: 'KISA 승인 대기', risk: '', api: 'GET /sender-registration/admin/{pending,all}' },
  { cat: 'H. 발신/회신번호', name: '발신번호 상세', desc: '증빙서류 포함', risk: '🔒', api: 'GET /sender-registration/admin/:id' },
  { cat: 'H. 발신/회신번호', name: '발신번호 승인', desc: '사용 가능 처리', risk: '', api: 'POST /admin/:id/approve' },
  { cat: 'H. 발신/회신번호', name: '발신번호 반려', desc: '신청 거부', risk: '', api: 'POST /admin/:id/reject' },
  { cat: 'H. 발신/회신번호', name: '증빙서류 다운로드', desc: '사업자등록증·위임장', risk: '🔒', api: 'GET /admin/download/:filename' },

  // I. 알림톡·브랜드메시지 (14건)
  { cat: 'I. 알림톡·RCS', name: '카카오 발신프로필 조회', desc: '등록된 발신프로필', risk: '', api: 'GET /kakao-profiles' },
  { cat: 'I. 알림톡·RCS', name: '카카오 발신프로필 등록/삭제', desc: '프로필 신규·삭제', risk: '', api: 'POST/DELETE /kakao-profiles' },
  { cat: 'I. 알림톡·RCS', name: '카카오 발신프로필 승인 (IMC)', desc: '신청 승인 → 사용 가능', risk: '', api: 'POST /senders/:id/approve' },
  { cat: 'I. 알림톡·RCS', name: '카카오 발신프로필 반려', desc: '신청 거부', risk: '', api: 'POST /senders/:id/reject' },
  { cat: 'I. 알림톡·RCS', name: '카카오 발신프로필 해지', desc: '사용 중단', risk: '⚠️', api: 'POST /senders/:id/unsubscribe' },
  { cat: 'I. 알림톡·RCS', name: '발신프로필 브랜드 타겟팅', desc: '회사·브랜드별 프로필 매핑', risk: '', api: 'PUT /senders/:id/brand-targeting' },
  { cat: 'I. 알림톡·RCS', name: '카카오 템플릿 목록', desc: '등록된 템플릿', risk: '', api: 'GET /kakao-templates' },
  { cat: 'I. 알림톡·RCS', name: '카카오 템플릿 승인', desc: '검수 완료 처리', risk: '', api: 'PUT /kakao-templates/:id/approve' },
  { cat: 'I. 알림톡·RCS', name: '카카오 템플릿 반려', desc: '검수 거부', risk: '', api: 'PUT /kakao-templates/:id/reject' },
  { cat: 'I. 알림톡·RCS', name: '카카오 템플릿 수동 등록', desc: '이관용 수동 등록', risk: '', api: 'POST /kakao-templates/manual' },
  { cat: 'I. 알림톡·RCS', name: '카카오 카테고리/템플릿/프로필 동기화 Job', desc: 'IMC 서버 상태 배치', risk: '', api: 'POST /alimtalk/jobs/*' },
  { cat: 'I. 알림톡·RCS', name: '웹훅 이벤트 조회', desc: 'IMC → 서버 이벤트 로그', risk: '', api: 'GET /alimtalk/webhook-events' },
  { cat: 'I. 알림톡·RCS', name: '수신거부 이미지 관리', desc: '마케팅 동의 이미지', risk: '', api: '/images/marketing-agree/*' },
  { cat: 'I. 알림톡·RCS', name: 'RCS(브랜드메시지) 템플릿 승인/반려', desc: 'RCS 템플릿 검수', risk: '', api: 'PUT /rcs-templates/:id/{approve,reject}' },

  // J. 싱크에이전트 (9건)
  { cat: 'J. 싱크에이전트', name: 'Agent 목록 조회', desc: '전체 Agent 상태 (온/오프라인)', risk: '', api: 'GET /api/admin/sync/agents' },
  { cat: 'J. 싱크에이전트', name: 'Agent 상세 조회', desc: '개별 Agent 설정·로그', risk: '', api: 'GET /sync/agents/:agentId' },
  { cat: 'J. 싱크에이전트', name: 'Agent 설정 변경', desc: '동기화 주기·대상 변경', risk: '', api: 'PUT /sync/agents/:agentId/config' },
  { cat: 'J. 싱크에이전트', name: 'Agent 명령 전송', desc: 'pause/resume/fullSync', risk: '', api: 'POST /sync/agents/:agentId/command' },
  { cat: 'J. 싱크에이전트', name: 'Agent 삭제', desc: 'Agent 등록 해제', risk: '⚠️', api: 'DELETE /sync/agents/:agentId' },
  { cat: 'J. 싱크에이전트', name: 'Agent 로그 조회', desc: '동기화 이력', risk: '', api: 'GET /sync/agents/:agentId/logs' },
  { cat: 'J. 싱크에이전트', name: '싱크 키 조회 (API 토큰)', desc: 'API 키 노출 — DB 직결 가능', risk: '🔒🔒', api: 'GET /sync-keys' },
  { cat: 'J. 싱크에이전트', name: '싱크 키 재발급', desc: 'API 키 회전', risk: '⚠️', api: 'POST /sync-keys/regenerate' },
  { cat: 'J. 싱크에이전트', name: '싱크 키 수정', desc: 'Agent 설정 변경', risk: '', api: 'PUT /sync-keys' },

  // K. 시스템 설정 (3건)
  { cat: 'K. 시스템', name: '라인그룹 관리 (CRUD)', desc: 'SMS 발송 라인 그룹화', risk: '', api: '/api/admin/line-groups/*' },
  { cat: 'K. 시스템', name: '감사 로그 조회', desc: '전체 관리자 활동 로그', risk: '🔒', api: 'GET /api/admin/audit-logs' },
  { cat: 'K. 시스템', name: '서비스 전환 (한줄로↔전단AI)', desc: 'JWT 재발급 → 서비스 컨텍스트 변경', risk: '', api: 'POST /api/admin/switch-service' },

  // L. 전단AI (별도 서비스, 8건)
  { cat: 'L. 전단AI (별도)', name: '전단AI 대시보드', desc: '전체 현황 요약', risk: '', api: 'GET /api/admin/flyer/dashboard' },
  { cat: 'L. 전단AI (별도)', name: '전단AI 고객사 관리 (CRUD)', desc: '업체 목록·생성·수정·삭제', risk: '', api: '/admin/flyer/companies/*' },
  { cat: 'L. 전단AI (별도)', name: '전단AI 사용자 관리', desc: '업체 사용자 계정', risk: '', api: '/admin/flyer/users/*' },
  { cat: 'L. 전단AI (별도)', name: '전단AI 매장 관리 (CRUD+충전)', desc: '매장 활성화·충전', risk: '⚠️', api: '/admin/flyer/stores/*' },
  { cat: 'L. 전단AI (별도)', name: '전단AI 업종 조회', desc: '마트/정육 등 업종', risk: '', api: 'GET /admin/flyer/business-types' },
  { cat: 'L. 전단AI (별도)', name: '전단AI POS Agent 관리', desc: 'POS 연동 키 생성', risk: '🔒', api: '/admin/flyer/pos-agents/*' },
  { cat: 'L. 전단AI (별도)', name: '전단AI 청구 조회', desc: '매장별 청구 현황', risk: '🔒', api: 'GET /admin/flyer/billing' },
  { cat: 'L. 전단AI (별도)', name: '전단AI 감사 로그', desc: '전단AI 전용 감사 로그', risk: '🔒', api: 'GET /admin/flyer/audit-logs' },
];

// ==========================================================================
// Sheet 1: 권한 매트릭스
// ==========================================================================

const sheet1Header = [
  '#', '카테고리', '기능명', '설명', '민감도', 'API 경로',
  'ID1 (Harold/owner)', 'ID2 (서팀장/ops)', 'ID3 (직원A/support)', 'ID4 (직원B/viewer)',
  '비고'
];

const sheet1Rows = features.map((f, i) => [
  i + 1, f.cat, f.name, f.desc, f.risk, f.api,
  '', '', '', '',  // ID 4개 컬럼 — Harold님이 O/X 입력
  ''
]);

const sheet1Data = [sheet1Header, ...sheet1Rows];
const ws1 = XLSX.utils.aoa_to_sheet(sheet1Data);

// 컬럼 너비
ws1['!cols'] = [
  { wch: 4 },   // #
  { wch: 16 },  // 카테고리
  { wch: 32 },  // 기능명
  { wch: 44 },  // 설명
  { wch: 8 },   // 민감도
  { wch: 36 },  // API
  { wch: 18 },  // ID1
  { wch: 18 },  // ID2
  { wch: 18 },  // ID3
  { wch: 18 },  // ID4
  { wch: 24 },  // 비고
];

// 1행 freeze
ws1['!freeze'] = { xSplit: '3', ySplit: '1' };

// 자동 필터
const lastCol = XLSX.utils.encode_col(sheet1Header.length - 1);
ws1['!autofilter'] = { ref: `A1:${lastCol}${sheet1Rows.length + 1}` };

// ==========================================================================
// Sheet 2: ID 정보
// ==========================================================================

const sheet2Data = [
  ['ID 번호', '로그인 ID', '이름', '역할 (제안)', '이메일', '휴대폰', '2FA 사용', '비고'],
  ['ID1', 'harold (예시)', 'Harold', 'Owner — 모든 권한 + 최종 책임', '', '', '✅ 필수', '대표자'],
  ['ID2', '', '서팀장', 'Operations — 운영·승인·고객사 CRUD', '', '', '✅ 필수', ''],
  ['ID3', '', '(직원 A)', 'Support — 고객지원·조회·CS 대응', '', '', '✅ 필수', ''],
  ['ID4', '', '(직원 B)', 'Viewer — 조회 전용·통계', '', '', '✅ 필수', ''],
  [],
  ['※ Harold님이 이 시트에 실제 ID·이름·이메일 채워주시면, 매트릭스 시트의 O/X 체크와 병합하여 시스템에 반영합니다.'],
];
const ws2 = XLSX.utils.aoa_to_sheet(sheet2Data);
ws2['!cols'] = [
  { wch: 8 }, { wch: 20 }, { wch: 16 }, { wch: 32 }, { wch: 24 }, { wch: 14 }, { wch: 10 }, { wch: 40 }
];

// ==========================================================================
// Sheet 3: 범례
// ==========================================================================

const sheet3Data = [
  ['구분', '기호 / 값', '의미'],
  ['민감도', '(없음)', '일반 기능 — 업무상 필요 시 자유롭게 허용 가능'],
  ['민감도', '⚠️', '위험 — 삭제·상태 파괴적 작업 (비밀번호 초기화 등)'],
  ['민감도', '⚠️⚠️', '최고 위험 — 복구 불가 (고객사 삭제, 전체 고객 삭제 등)'],
  ['민감도', '🔒', '민감 — 개인정보 / 증빙서류 / 실제 돈 흐름'],
  ['민감도', '🔒🔒', '최고 민감 — 대량 개인정보 추출 / API 키 / 마스킹 해제'],
  [],
  ['입력값', 'O', '권한 부여 (기능 사용 가능)'],
  ['입력값', 'X', '권한 없음 (메뉴에서 비활성화 또는 숨김)'],
  ['입력값', '△', '조건부 — 예: 조회만 가능 / 2FA 재인증 필요 / 감사 로그 기록'],
  [],
  ['카테고리', '', ''],
  ['A', '고객사 관리', '고객사 CRUD, 무료체험, 필드 설정'],
  ['B', '사용자 관리', '사용자 계정 CRUD, 비밀번호 초기화, 수신거부'],
  ['C', '고객 DB 접근', '★ 가장 민감 — 고객 개인정보 직접 접근'],
  ['D', '요금제', '플랜 정의, 변경 신청 승인/반려'],
  ['E', '입금·잔액·청구', '돈 흐름 전반 — 자금 관련 가장 민감'],
  ['F', '캠페인', '전체 회사 캠페인 조회, 강제 취소'],
  ['G', '발송 통계', '기간·채널별 집계, 엑셀 추출'],
  ['H', '발신/회신번호', 'KISA 승인, 담당자 위임장, 증빙서류'],
  ['I', '알림톡·RCS', '카카오 발신프로필, 템플릿 검수'],
  ['J', '싱크에이전트', 'Agent 명령·키 관리 (★ 키는 DB 직결)'],
  ['K', '시스템', '라인그룹, 감사 로그, 서비스 전환'],
  ['L', '전단AI', '전단AI 서비스 관리 (별도 서비스)'],
  [],
  ['권장 기본 프리셋 (참고용)', '', ''],
  ['Owner (Harold)', '전체 O', '모든 권한 + 2FA 필수'],
  ['Operations (서팀장)', 'E(입금승인까지 O), 마스킹해제/키조회/싱크키 X, L(전단AI) 조건부', '운영 필수 + 자금 일부'],
  ['Support (직원A)', 'B/C/F/G/H/I 일부 O, 삭제·수정 X, 고객DB 엑셀 다운로드 X', '고객지원 조회 중심'],
  ['Viewer (직원B)', '모든 카테고리 조회만 O, 쓰기·삭제 전부 X', '리포트·통계 용도'],
];
const ws3 = XLSX.utils.aoa_to_sheet(sheet3Data);
ws3['!cols'] = [{ wch: 20 }, { wch: 48 }, { wch: 60 }];

// ==========================================================================
// Sheet 4: 카테고리 요약
// ==========================================================================

const categoryMap = {};
features.forEach(f => {
  categoryMap[f.cat] = (categoryMap[f.cat] || 0) + 1;
});
const sheet4Data = [
  ['카테고리', '기능 수', '비고'],
  ...Object.entries(categoryMap).map(([cat, count]) => [cat, count, '']),
  [],
  ['합계', features.length, `총 ${features.length}개 기능`],
];
const ws4 = XLSX.utils.aoa_to_sheet(sheet4Data);
ws4['!cols'] = [{ wch: 24 }, { wch: 10 }, { wch: 40 }];

// ==========================================================================
// 워크북 생성 + 저장
// ==========================================================================

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws1, '권한 매트릭스');
XLSX.utils.book_append_sheet(wb, ws2, 'ID 정보');
XLSX.utils.book_append_sheet(wb, ws3, '범례');
XLSX.utils.book_append_sheet(wb, ws4, '카테고리 요약');

const outPath = path.resolve(__dirname, '..', 'docs', '슈퍼관리자-권한-매트릭스.xlsx');
XLSX.writeFile(wb, outPath);

console.log(`\n✅ 엑셀 생성 완료`);
console.log(`   경로: ${outPath}`);
console.log(`   총 기능: ${features.length}개`);
console.log(`   카테고리: ${Object.keys(categoryMap).length}개`);
console.log(`   시트: 권한 매트릭스 / ID 정보 / 범례 / 카테고리 요약\n`);
