/**
 * utils/billing-scope-label.ts — 거래내역서 '일자별 상세 내역'의 **구분 칸 라벨** 단일 진실 (★ 2026-07-31)
 *
 * 왜 생겼나 (서수란 접수 "정산 > 거래내역서 상세내역 관련"):
 *   구분 칸이 웹 발송에 대해 항상 리터럴 `한줄로`만 찍었다. 그래서 한 회사 안에서 어느 계정(지점)이
 *   쓴 발송인지 청구서로 구분할 수 없었다 — 라프레리처럼 **본사가 지점별로 나눠 청구하는 고객사**는
 *   이 칸이 곧 실무 도구인데, 통계 화면은 계정을 보여주고 청구서만 못 보여주는 상태였다.
 *   값이 없어서가 아니었다. `billing_items.user_id`에 이미 그 계정이 실려 있었고(웹·테스트·스팸 행),
 *   **읽는 쪽이 users를 조인하지 않아** 이름을 못 만들고 있었을 뿐이다.
 *
 * 왜 CT인가:
 *   같은 판정이 PDF(`billing-pdf.ts`)와 화면(`AdminDashboard.tsx`)에 **인라인으로 두 벌** 있었다.
 *   한쪽만 고치면 청구서와 화면이 갈리고, 그 어긋남은 고객이 먼저 발견한다.
 *   실제로 이미 갈려 있었다 — PDF는 에이전트 칸에 발송ID만, 화면은 `발송ID / 발급명`을 찍었고,
 *   `extra`(080·부가서비스) 행은 PDF가 '추가 항목'인데 화면은 원문 `extra`를 그대로 노출했다.
 *
 * 계약:
 *   - 판정 축은 **`channel`**이다(유형키 접두가 아니다 — 유형이 늘어도 이 함수는 안 바뀐다).
 *   - 계정명이 있으면 계정명을 쓴다. 없으면 채널 기본 라벨로 떨어진다(폴백은 항상 존재 — 빈 칸 금지).
 *   - 순수 함수. DB·네트워크를 모른다. 호출부가 이름을 채워 넣는다.
 */

/** 구분 칸을 만드는 데 필요한 행의 부분집합 — `billing_items` 조회 결과에 조인으로 채워진다. */
export interface BillingScopeRow {
  channel?: string | null;
  /** 에이전트 발송ID (`company_agent_ids.agent_send_id`) */
  agent_send_id?: string | null;
  /** 에이전트 발급명 (게이트웨이 원장 `RSRM_SalesMst.CustNm`) */
  cust_name?: string | null;
  /** ★ 웹·테스트·스팸 행의 계정명 (`users.name`) — 이번 신설분 */
  user_name?: string | null;
  /** 계정명이 비어 있을 때의 대체 표시 (`users.login_id`) */
  user_login_id?: string | null;
}

/** 채널별 기본 라벨 — 계정을 못 붙이는 행(요금제·추가 항목)과 폴백에 쓴다. */
export const BILLING_SCOPE_FALLBACK: Record<string, string> = {
  plan: '요금제',
  web: '한줄로',
  agent: '에이전트',
  test: '테스트',
  spam: '스팸필터',
  extra: '추가 항목',
};

/** 계정명을 붙이는 채널 — 요금제·추가 항목은 발송 계정 축이 없다(행에 user_id가 실리지 않는다). */
const ACCOUNT_SCOPED_CHANNELS = new Set(['web', 'test', 'spam']);

/**
 * 에이전트 표시명 — `발송ID / 발급명`. 발급명이 없으면 발송ID만.
 * (`pay-stats.formatAgentIdLabel`와 같은 형식. 그쪽은 통계용 시그니처라 여기서는 행 기준으로 만든다.)
 */
function agentLabel(row: BillingScopeRow): string {
  const id = String(row.agent_send_id || '').trim();
  const nm = String(row.cust_name || '').trim();
  if (!id) return '(발송ID 미상)';
  return nm ? `${id} / ${nm}` : id;
}

/** 계정 표시명 — 이름 우선, 없으면 로그인 ID. 둘 다 없으면 null(호출부가 채널 폴백으로 간다). */
function accountLabel(row: BillingScopeRow): string | null {
  const nm = String(row.user_name || '').trim();
  if (nm) return nm;
  const id = String(row.user_login_id || '').trim();
  return id || null;
}

/**
 * 상세 내역 한 행의 구분 칸 문자열. **PDF·상세 모달·엑셀이 이 함수 하나만 쓴다.**
 *
 * 채널별:
 *   - `agent` → `발송ID / 발급명`
 *   - `web`·`test`·`spam` → 계정명(없으면 채널 기본 라벨)
 *   - `plan`·`extra` → 채널 기본 라벨(계정 축 없음)
 *   - 그 밖의 미지 채널 → 원문 대신 채널 기본 라벨이 없으므로 원문을 쓰되, 이는 축이 늘었다는 신호다.
 */
export function resolveBillingScopeLabel(row: BillingScopeRow): string {
  const ch = String(row?.channel || 'web');
  if (ch === 'agent') return agentLabel(row);
  if (ACCOUNT_SCOPED_CHANNELS.has(ch)) {
    const acct = accountLabel(row);
    if (acct) {
      // 테스트·스팸은 계정만 찍으면 그 행이 왜 청구되는지 안 읽힌다 — 성격을 함께 남긴다.
      return ch === 'web' ? acct : `${BILLING_SCOPE_FALLBACK[ch]} · ${acct}`;
    }
    return BILLING_SCOPE_FALLBACK[ch];
  }
  return BILLING_SCOPE_FALLBACK[ch] || ch;
}
