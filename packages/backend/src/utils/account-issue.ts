/**
 * account-issue.ts — 계정 발급 축 컨트롤타워 (★2026-10-02 전송자격인증 2.1 · 4.1 ②)
 *
 * 왜 있나
 *   계정은 계약 확인 뒤 당사가 발급한다(공개 가입 경로 없음). 그런데 "누가 · 언제 · 어느 고객사에
 *   어떤 계정을 발급했나"가 어디에도 남지 않았다(1002 실측 — 계정 생성 INSERT 4자리 · 고객사 생성 1자리 전부
 *   감사 기록 호출 0). 인증기준 4.1 ②가 요구하는 "회원가입 로그"가 우리 구조에서는 이 발급 기록이다.
 *
 * 이 CT가 소유하는 것
 *   1. 발급 기록 2종 — `user_account_created`(계정 발급) · `company_created`(고객사 등록)
 *   2. 고객사 관리자가 계정 추가를 시도했을 때 돌려주는 안내 문구(화면 문구와 같은 뜻)
 *
 * ⛔ 기록 실패가 발급을 막지 않는다 — 전부 내부에서 삼킨다(`recordAuditLog`와 같은 규율).
 *    발급은 운영 행위이고 기록은 그 부속이다. 기록 때문에 계정이 안 만들어지면 통제가 서비스를 세운 것이다.
 * ⛔ 전화번호 · 이메일 · 비밀번호는 details에 넣지 않는다(감사 기록은 열람 대상이다).
 * ⛔ 과거 발급분을 소급해 만들지 않는다. 없던 기록을 지어내면 그 대장 전체가 심사 근거가 못 된다.
 *
 * 누락 방지 — `__tests__/account-issue.test.ts`가 `INSERT INTO users` · `INSERT INTO companies`가 있는
 *   파일에 이 CT 호출이 함께 있는지 소스로 대조한다. 발급 경로가 늘어도 기록을 빠뜨릴 수 없다.
 */
import { query } from '../config/database';
import { recordAuditLog } from './audit-log';

/** 고객사 관리자의 계정 추가 시도에 대한 안내 — 계정은 당사가 발급한다 */
export const ACCOUNT_ISSUE_NOTICE =
  '계정 추가는 계약 확인 후 인비토가 발급합니다. 담당자 또는 1800-8125로 요청해 주세요.';

/** 발급 경로 — 감사 기록 화면이 한글로 풀어 쓴다(`audit-action-labels.ts`) */
export type AccountIssueChannel =
  | 'super_admin'   // 슈퍼관리자 화면에서 개별 발급
  | 'manage_page'   // 관리 화면 경로(슈퍼관리자 호출분만 — 고객사 관리자는 발급 불가)
  | 'bulk_gateway'  // 게이트웨이 청구 단위 일괄 생성
  | 'bulk_pay'      // 결제 매핑 일괄 생성
  | 'system';       // 연동 전용 시스템 계정(사람이 로그인하지 않는다)

export interface AccountIssuedInput {
  actorUserId?: string | null;
  userId: string;
  loginId: string;
  userType: string;
  companyId?: string | null;
  channel: AccountIssueChannel;
  req?: any;
}

/** 계정 발급 기록 — 실패는 삼킨다 */
export async function recordAccountIssued(input: AccountIssuedInput): Promise<void> {
  try {
    let companyName: string | null = null;
    if (input.companyId) {
      const r = await query('SELECT company_name FROM companies WHERE id = $1::uuid', [input.companyId]);
      companyName = r.rows?.[0]?.company_name ?? null;
    }
    await recordAuditLog({ actorUserId: input.actorUserId, action: 'user_account_created',
      targetType: 'user',
      targetId: input.userId,
      details: {
        loginId: input.loginId,
        userType: input.userType,
        companyId: input.companyId || null,
        companyName,
        channel: input.channel,
      },
      req: input.req,
    });
  } catch (err: any) {
    console.log('[account-issue] 계정 발급 기록 실패 (발급에는 영향 없음):', err?.message);
  }
}

export interface CompanyRegisteredInput {
  actorUserId?: string | null;
  companyId: string;
  companyCode: string;
  companyName: string;
  usageType?: string | null;
  req?: any;
}

/** 고객사 등록 기록 — 실패는 삼킨다 */
export async function recordCompanyRegistered(input: CompanyRegisteredInput): Promise<void> {
  try {
    await recordAuditLog({ actorUserId: input.actorUserId, action: 'company_created',
      targetType: 'company',
      targetId: input.companyId,
      details: {
        companyCode: input.companyCode,
        companyName: input.companyName,
        usageType: input.usageType || null,
      },
      req: input.req,
    });
  } catch (err: any) {
    console.log('[account-issue] 고객사 등록 기록 실패 (등록에는 영향 없음):', err?.message);
  }
}
