/**
 * fraud-review.ts — 부정사용 보류·소명 컨트롤타워 (★2026-08-19 전송자격인증 2.3)
 *
 * 인증기준이 요구하는 것
 *   "결제정보와 계정의 연계 확인 · 명의 불일치 건의 보류/소명 절차 · 처리 결과를 계정별로 기록"
 *
 * ⛔ 자동 거절하지 않는다 — 판정은 **보류**까지다
 *   입금자명이 배우자·경리·법인 담당자 이름인 정상 사례가 흔하다. 자동 거절하면 정상 충전이 막힌다.
 *   기준이 요구하는 것도 "차단"이 아니라 "보류/소명 절차"다. 사람이 확인하고 푼다.
 *
 * ⛔ 모르는 것을 불일치로 접지 않는다
 *   대조할 명의가 없거나 입금자명이 비어 있으면 `unknown`이다. 이것을 `mismatch`로 접으면
 *   명의 미등록 고객사의 충전이 전부 보류로 쌓인다
 *   (LESSONS_BACKEND "두 값으로 세 상태를 답하지 마라 — 불리언으로 접는 순간 한쪽이 조용히 틀린다").
 *
 * 대조 대상 명의 (2026-08-19 information_schema 실측)
 *   companies.company_name (법인명) · companies.name (회사명) · companies.ceo_name (대표자)
 */

/** 법인 표기 — 같은 이름의 다른 표기일 뿐이라 비교 전에 걷어낸다 */
const CORPORATE_TOKENS = [
  '주식회사', '유한회사', '유한책임회사', '합자회사', '합명회사',
  '재단법인', '사단법인', '의료법인', '학교법인',
  '㈜', '㈔', '㈐',
  '(주)', '(유)', '(합)', '(재)', '(사)', '(의)',
];

/**
 * 명의 비교용 정규화.
 * 법인 표기 제거 → 공백·괄호·구두점 제거 → 소문자.
 */
export function normalizeHolderName(raw: string | null | undefined): string {
  let s = String(raw ?? '');
  for (const token of CORPORATE_TOKENS) s = s.split(token).join('');
  return s
    .replace(/[\s 　]/g, '')
    .replace(/[()[\]{}\-_.,·ㆍ'"`]/g, '')
    .toLowerCase();
}

/** 대표자 구분자 — 사업자등록증의 공동대표는 쉼표 등으로 나뉘어 저장된다 */
const CEO_SEPARATORS = /[,/·ㆍ|]|\s외\s/;

/** 은행 표기가 이름 뒤에 붙이는 숫자 꼬리를 뗀다 — "유호윤0101" */
function stripTrailingDigits(s: string): string {
  return s.replace(/\d+$/, '');
}

/**
 * 입금자명이 등록 명의와 같은가.
 *
 * ⛔ ★0819 Codex 정정 — 양방향 2자 접두를 일치로 봤더니 **"김철"로 "김철수"를 통과**시킬 수 있었다.
 *   등록 명의 앞 두 글자만 적어 보류를 피하는 우회가 성립한다. 그래서 둘을 나눴다.
 *   - `allowPrefix=false` (대표자명) — **완전 일치만**. 사람 이름은 잘려 들어오지 않는다.
 *   - `allowPrefix=true`  (법인명·회사명) — 은행이 긴 상호를 자르는 **한 방향만**, 그것도 4자 이상.
 *     입금자명이 등록 상호의 앞부분일 때만 인정한다(반대 방향은 남의 이름을 삼킨다).
 */
function sameHolder(payer: string, holder: string, allowPrefix: boolean): boolean {
  if (!payer || !holder) return false;
  if (payer === holder) return true;
  if (!allowPrefix) return false;
  return payer.length >= 4 && holder.startsWith(payer);
}

/** 계정에 등록된 명의 — 어느 하나와 맞으면 정상으로 본다 */
export interface AccountHolders {
  /** companies.company_name — 법인명 */
  companyName?: string | null;
  /** companies.name — 회사명 */
  tradeName?: string | null;
  /** companies.ceo_name — 대표자. 대표 개인 계좌 입금은 정상이다 */
  ceoName?: string | null;
}

export type PayerJudgement = 'match' | 'mismatch' | 'unknown';

export interface PayerVerdict {
  result: PayerJudgement;
  /** 보류 사유 — `mismatch`일 때만. 대조 대상 명의는 싣지 않는다(사유는 이력에 남는다) */
  holdReason?: string;
}

/**
 * 입금자명과 계정 명의를 대조한다(순수 — DB를 보지 않는다).
 *
 * `mismatch`여도 거절이 아니라 **보류**다. 호출부는 이 결과로 상태를 `held`로 옮기고
 * 소명을 요청할 뿐, 자동으로 반려하지 않는다.
 */
export function judgePayerName(
  payer: string | null | undefined,
  holders: AccountHolders,
): PayerVerdict {
  // ⛔ ★0819 Codex 2R — "입력이 비었나"와 "이름 성분이 없나"는 다른 상태다.
  //   `(주)`·`주식회사`·`---`는 비어 있지 않은데 정규화 후 빈 문자열이 된다.
  //   이것을 `unknown`(무보류 통과)으로 두면 그게 곧 보류 우회 수단이 된다.
  const rawPayer = String(payer ?? '').trim();
  if (!rawPayer) return { result: 'unknown' };          // 진짜 미입력

  const normalizedPayer = normalizeHolderName(payer);
  const payerCore = stripTrailingDigits(normalizedPayer);
  if (!payerCore) {
    // 적혀는 있는데 이름이 없다 — 숫자만, 법인 표기만, 기호만
    return { result: 'mismatch', holdReason: '입금자명에 이름이 없어 확인이 필요합니다.' };
  }

  // 대조할 명의가 하나도 없을 때만 판정 불가다
  const corporate = [holders.companyName, holders.tradeName].map(normalizeHolderName).filter((v) => v.length > 0);
  // 공동대표는 구분자로 나뉘어 저장된다 — 합쳐서 비교하면 정상 입금이 전부 보류된다
  const persons = String(holders.ceoName ?? '')
    .split(CEO_SEPARATORS)
    .map(normalizeHolderName)
    .filter((v) => v.length > 0);
  if (corporate.length === 0 && persons.length === 0) return { result: 'unknown' };

  const payerForms = normalizedPayer === payerCore ? [payerCore] : [normalizedPayer, payerCore];
  for (const form of payerForms) {
    for (const person of persons) {
      if (sameHolder(form, person, false)) return { result: 'match' };
    }
    for (const c of corporate) {
      if (sameHolder(form, c, true)) return { result: 'match' };
    }
  }

  return {
    result: 'mismatch',
    holdReason: '입금자명이 계정에 등록된 명의와 일치하지 않아 확인이 필요합니다.',
  };
}
