/**
 * security-report.ts — 고객 보안 점검 공지(B 카드 · C 점검 기록) 문구 원장 (★2026-10-29 · 설계 docs/2026-10-29-customer-security-notice-ack-design.md)
 *
 * ⛔ 여기 문장은 고객에게 보이는 사실 주장이다. 서버 처방(.65 · .66 Node 보안판)과 실측이 끝난 뒤에만 배포한다(설계서 §5).
 *    APPLIED_AT = 실제 적용 완료일 · 서버 범위만 말한다(싱크에이전트는 말하지 않는다 · 설계서 §4 결정 5).
 *    가운뎃점 · 줄표 · 모델명 0(외부 문장 규칙).
 * NOTICE_ID 는 서버 공지 원장(backend utils/customer-notice.ts CUSTOMER_NOTICES)의 id 와 같아야 한다(계약 시험이 대조한다).
 */
export const SECURITY_NOTICE_ID = '2026-10-security-check';

/** 보안판 적용 완료일(KST · 표기용) */
export const APPLIED_AT = '2026.10.29';

export type SecurityItemState = 'applied' | 'na';

export const SECURITY_ITEMS: ReadonlyArray<{ title: string; tag?: string; state: SecurityItemState; chip: string; short: string; detail: string }> = [
  {
    title: 'Node.js 취약점',
    tag: '고위험 4건 포함 10건',
    state: 'applied',
    chip: '보안판 적용',
    short: '10월 21일 공개된 보안 업데이트 판으로 서버를 올렸습니다.',
    detail: '한줄로 서비스 서버와 발송 서버를 10월 21일 보안 업데이트 판으로 올렸습니다. 교체한 뒤 서비스가 정상 동작하는 것을 확인했습니다.',
  },
  {
    title: 'PHP 취약점',
    state: 'na',
    chip: '해당 없음',
    short: '한줄로 서버는 PHP를 쓰지 않습니다.',
    detail: '한줄로 서버는 PHP를 쓰지 않습니다.',
  },
  {
    title: '본인인증 연동',
    state: 'na',
    chip: '영향 없음',
    short: '인증 모듈은 이번 취약점과 무관한 방식으로 동작해 교체가 필요 없습니다.',
    detail: '인증 모듈은 Node.js나 PHP 판과 무관한 방식으로 동작해 교체가 필요 없습니다.',
  },
];

/** C 화면에만 있는 줄(B 카드에는 넣지 않는다) */
export const SECURITY_CUSTOMER_ITEM = { title: '고객사 조치', chip: '필요 없음', detail: '서버 쪽 조치라 고객사에서 따로 하실 일은 없습니다.' };

export const SECURITY_TIMELINE: ReadonlyArray<{ at: string; title: string; detail: string; final?: boolean }> = [
  { at: '2026.10.21', title: 'Node.js 보안 업데이트 공개', detail: '고위험 4건을 포함한 10건을 고친 판이 나왔습니다.' },
  { at: '2026.10.23', title: '보호나라 보안공지', detail: 'PHP와 Node.js 취약점 주의가 공지됐습니다.' },
  { at: APPLIED_AT, title: '한줄로 서버 점검', detail: '실행 중인 프로그램의 판을 서버마다 직접 확인했습니다.' },
  { at: APPLIED_AT, title: '보안판 적용 완료', detail: '교체 뒤 서비스 정상 동작을 확인했습니다.', final: true },
];

/** Node.js 2026-10-21 보안 공지의 고위험 항목(nodejs.org 공지 원문 기준) */
export const SECURITY_CVES: ReadonlyArray<{ id: string; what: string }> = [
  { id: 'CVE-2026-111497', what: 'Brotli 압축 해제 메모리 쓰기' },
  { id: 'CVE-2026-106069', what: 'TLS 인증서 호스트 확인 우회' },
  { id: 'CVE-2026-105483', what: 'TLS 인증서 호스트 확인 우회' },
  { id: 'CVE-2026-105482', what: 'DNS 이름 처리 오류' },
];
export const SECURITY_CVE_REST = '그 밖 중간 3건, 낮음 3건';
