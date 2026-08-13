/**
 * content-interview-fill.ts — 원스텝 인터뷰 프리필 조회 (★ 2026-08-13 Phase 3)
 *
 * 설계서 = docs/2026-08-13-one-step-content-interview-design.md §4-1·§4-3
 *
 * **묻지 않아도 아는 것만 채운다.** 판정 CT(`content-interview.ts`)는 순수를 유지해야 하므로
 * DB를 만지는 조회는 전부 이 파일이 갖는다.
 *
 * ⛔ 불변
 *   - **신규 조회 로직을 만들지 않는다** — 기존 CT를 부르기만 한다.
 *   - **반쯤 아는 값을 채우지 않는다.** 몰 상품 매칭이 "정규화 후 정확 일치"만 채택하는 것과 같은 엄격도다.
 *     확실하지 않으면 비워 두고 사용자에게 묻는다(틀린 값을 미리 채우면 프리미엄에서 그대로 발송된다).
 *   - **혜택은 어떤 경우에도 채우지 않는다**(AI 임의 혜택 금지 — 사용자만 안다).
 *   - 조회 실패는 "아는 척"으로 가지 않는다 — 그 축을 비우고 사용자에게 묻는다.
 */
import { getCompanyBrandKitRaw } from './dm/dm-brand-kit';
import type { InterviewContext } from './content-interview';

/** 프리필 결과 + 출처 — 화면이 "어디서 가져왔는지"를 그대로 말할 수 있어야 한다(숨기면 수정 부담이 생긴다). */
export interface InterviewPrefill {
  context: InterviewContext;
  /** 축별 출처 라벨 — 화면 칩 문구. 채우지 못한 축은 키가 없다. */
  sources: Partial<Record<'storeInfo' | 'event', string>>;
}

/**
 * 인터뷰 프리필. 행사 맥락(제목·기간·마감)은 호출부가 아는 값을 넘긴다 —
 * 플래너 기입 모달·행사 캠페인 화면이 이미 그 값을 손에 들고 있어 여기서 다시 조회하지 않는다.
 *
 * ⛔ `periodEnd`는 **마감 시각이 실존할 때만** 넣는다. 기간 문구만 있는 경우에 넣으면
 *   마감 없는 카운트다운이 나간다(설계서 §0 판정 C).
 */
export async function prefillInterview(
  companyId: string,
  event?: { title?: string; startsOn?: string; endsOn?: string; periodEnd?: string | null },
): Promise<InterviewPrefill> {
  const sources: InterviewPrefill['sources'] = {};

  let hasStoreAddress = false;
  try {
    const kit = (await getCompanyBrandKitRaw(companyId)) as { contact?: { address?: string } } | null;
    hasStoreAddress = !!String(kit?.contact?.address || '').trim();
    if (hasStoreAddress) sources.storeInfo = '브랜드 설정의 매장 주소에서 가져왔어요';
  } catch (e: any) {
    // 조회 실패 = 모르는 것이다. 켜 두지 않는다(못 확인한 것을 아는 척하지 않는다).
    console.warn('[one-step] 브랜드 설정 조회 실패 — 매장 안내는 사용자에게 묻는다:', e?.message || e);
  }

  if (event?.title) sources.event = '행사 정보에서 가져왔어요';

  return {
    context: {
      eventTitle: event?.title,
      startsOn: event?.startsOn,
      endsOn: event?.endsOn,
      // ⛔ 마감 "시각"만 넘긴다 — 기간 문구는 여기 들어오지 않는다.
      periodEnd: event?.periodEnd ?? null,
      // 상품은 채우지 않는다 — 화면의 연동몰 선택기가 사용자 확인을 거쳐 넣는다.
      mallProducts: [],
      hasStoreAddress,
    },
    sources,
  };
}
