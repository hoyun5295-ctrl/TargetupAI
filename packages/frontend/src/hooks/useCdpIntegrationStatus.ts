/**
 * hooks/useCdpIntegrationStatus.ts — 자사몰 연동 상태 판정 훅 (★2026-08-10 Phase 1)
 *
 * 설계서 = docs/2026-08-09-cdp-integration-redesign-design.md
 *   배지 5종 = §5-1-1 · 판정 규칙 = §6 · 식별자 정규화 = §2-3-1
 *
 * ⛔ 이 훅이 배지 판정의 유일한 출처다. 화면이 상태를 다시 계산하지 않는다.
 *
 * 판정에서 지키는 것 두 가지:
 *   1. **모르는 것을 초록으로 칠하지 않는다.** 매핑 보류 몰(네이버·메이크샵)은 이벤트가 0이어도
 *      "설치 대기"가 아니라 'preparing'이다 — 고객 잘못이 아니라 우리 쪽 작업이 남은 것이다.
 *   2. **수신 끊김은 임계값이 확정되기 전까지 판정하지 않는다**(§6-4). 저트래픽 몰을 오탐하면
 *      잘못된 경보가 무배지보다 나쁘다.
 */

import { useMemo } from 'react';
import {
  CDP_PROVIDER_KEYS,
  getProviderKeyEntry,
  sumEventsForProvider,
  type CdpProviderKey,
  type CdpCollectKind,
} from '../utils/cdp-provider-keys';

/** 배지 5종 — 설계서 §5-1-1과 1:1. */
export type CdpIntegrationBadge =
  | 'receiving'    // emerald — 데이터 수신 중
  | 'awaiting'     // amber   — 연결됐는데 아직 0건. 문구는 몰 유형이 가른다(설치 대기 vs 첫 주문 대기)
  | 'preparing'    // violet  — 연결 완료·우리 쪽 매핑 준비 중
  | 'action'       // rose    — 인증 끊김(고객사 담당자 차례)
  | 'disconnected';   // white/40, 아직 연결 전

/** 다음 행동의 주체 — 카드 버튼 문구를 이 값이 정한다(§5-1). */
export type CdpNextActor = 'none' | 'merchant' | 'merchant_dev' | 'hanjul';

/**
 * 연동 인증이 끊겼는가 — `company_integrations.status` 실값 판정의 단일 출처(★2026-08-10).
 *
 * 근거는 추측이 아니라 기록 경로다. refresh 실패 시 네 어댑터가 모두 이 값을 쓴다 —
 * cafe24-client · imweb-client · makeshop-client · naver-commerce-client.
 * `revoked`는 담당자가 스스로 해제한 것이라 조치 대상이 아니다(연결 안 됨이 맞다).
 */
export function isIntegrationAuthBroken(status: string | null | undefined): boolean {
  return status === 'token_expired' || status === 'error';
}

export interface CdpProviderStatus {
  key: CdpProviderKey;
  badge: CdpIntegrationBadge;
  /** 화면 문구 — 형용사가 아니라 문장(§5-5 문구 규율) */
  label: string;
  /**
   * 카드 버튼 문구. ★2026-08-10 — 배지가 아니라 **상태**가 정한다.
   * 같은 `awaiting`이어도 자체 호스팅은 "이어서 설정"(할 일이 있다), 자동 수집 몰은 "상태 보기"(할 일이 없다)다.
   * 화면이 배지로 다시 표를 만들면 그 표가 이 판정과 어긋난다 — 그래서 훅이 함께 소유한다.
   */
  actionLabel: string;
  nextActor: CdpNextActor;
  /** 수집 방식 — 스테퍼가 ② 문구·탈출구·개발자 전달 버튼 노출을 이 값으로 가른다 */
  collect: CdpCollectKind | null;
  connected: boolean;
  total: number;
  count24h: number;
  firstEventAt: string | null;
  lastEventAt: string | null;
  /** 이벤트 축으로 판정 불가한 몰(매핑 보류) — 화면이 수신 배지를 달지 않는 근거 */
  eventsUnavailable: boolean;
}

export interface CdpInstallStatusBySource {
  total: number;
  count24h: number;
  firstEventAt: string | null;
  lastEventAt: string | null;
  signals?: { pageview: boolean; identify: boolean; consent: boolean; click: boolean };
}

export interface UseCdpIntegrationStatusInput {
  /** 몰별 연결 여부 — 각 status 응답의 connected. 미조회는 undefined로 둔다(false와 구분). */
  connected: Partial<Record<CdpProviderKey, boolean | undefined>>;
  /**
   * 몰별 조치 필요 신호. ★2026-08-10 근거 확정 — 판정은 `isIntegrationAuthBroken`이 소유한다.
   * 화면이 안 넘기면 undefined라 그 축은 꺼진 채로 남는다(근거 없는 배지를 켜지 않는 규약 유지).
   */
  needsAction?: Partial<Record<CdpProviderKey, boolean | undefined>>;
  /** GET /api/cdp/install-status 의 bySource (Phase 0 신설) */
  bySource: Record<string, CdpInstallStatusBySource> | null | undefined;
}

export interface UseCdpIntegrationStatusResult {
  statuses: CdpProviderStatus[];
  byKey: Record<CdpProviderKey, CdpProviderStatus>;
  /** 요약 지표 3개(§5-1) */
  summary: { receiving: number; preparing: number; action: number };
}

function decide(
  key: CdpProviderKey,
  connected: boolean,
  needsAction: boolean,
  bySource: Record<string, CdpInstallStatusBySource> | null | undefined,
): CdpProviderStatus {
  const entry = getProviderKeyEntry(key);
  const events = sumEventsForProvider(key, bySource);
  const eventsUnavailable = !entry || entry.ingest !== 'events';
  const total = events?.total ?? 0;
  const count24h = events?.count24h ?? 0;

  const base = {
    key,
    connected,
    total,
    count24h,
    firstEventAt: events?.firstEventAt ?? null,
    lastEventAt: events?.lastEventAt ?? null,
    eventsUnavailable,
    collect: entry?.collect ?? null,
  };

  // ★ 2026-08-10 — 조치 필요가 가장 앞선다. 끊긴 채로 "수신 중"을 보여주면 안 되고,
  //   **"아직 연결 전"으로 보여주는 것은 더 나쁘다** — 한 번 연결했던 몰이 미연결로 뒤바뀌면
  //   담당자는 재연결이 필요하다는 사실 자체를 모른다(카페24 `/status`가 그렇게 응답하고 있었다).
  //   토큰 만료는 `connected`가 false로 오므로 이 판정이 미연결보다 위에 있어야 한다.
  if (needsAction) {
    return { ...base, badge: 'action', label: '연동이 끊겼어요 · 재연결 필요', actionLabel: '조치하기', nextActor: 'merchant' };
  }
  if (!connected) {
    return { ...base, badge: 'disconnected', label: '아직 연결 전', actionLabel: '연결하기', nextActor: 'merchant' };
  }
  // 매핑 보류 몰 — 이벤트가 0인 것이 정상이다. 고객에게 "설치하세요"라고 하면 거짓이다.
  if (eventsUnavailable) {
    return { ...base, badge: 'preparing', label: '연결 완료 · 데이터 연동 준비 중', actionLabel: '상태 보기', nextActor: 'hanjul' };
  }
  if (count24h > 0) {
    return { ...base, badge: 'receiving', label: `데이터 수신 중 · 24시간 ${count24h.toLocaleString()}건`, actionLabel: '상태 보기', nextActor: 'none' };
  }
  // 과거 수신 이력은 있으나 최근 24시간 0건 — '수신 끊김'은 임계값 확정 전까지 판정하지 않는다(§6-4).
  if (total > 0) {
    return { ...base, badge: 'receiving', label: `연결됨 · 누적 ${total.toLocaleString()}건`, actionLabel: '상태 보기', nextActor: 'none' };
  }
  // ★ 2026-08-10 — 연결됐는데 아직 0건. 여기서 몰 유형이 갈린다.
  //   자체 호스팅은 개발자가 설치해야 들어오고, 자동 수집 몰(카페24·아임웹 웹훅 / 고도몰 주기 수집)은
  //   설치할 것이 없고 첫 주문·활동을 기다리는 상태다. 한 문장으로 뭉뚱그리면 반은 거짓이 된다.
  if (base.collect === 'developer') {
    return { ...base, badge: 'awaiting', label: '설치만 남았어요', actionLabel: '이어서 설정', nextActor: 'merchant_dev' };
  }
  return { ...base, badge: 'awaiting', label: '연결됨 · 첫 주문을 기다리는 중', actionLabel: '상태 보기', nextActor: 'none' };
}

export function useCdpIntegrationStatus(input: UseCdpIntegrationStatusInput): UseCdpIntegrationStatusResult {
  const { connected, needsAction, bySource } = input;
  return useMemo(() => {
    const statuses = CDP_PROVIDER_KEYS.map((e) =>
      decide(e.key, connected[e.key] === true, needsAction?.[e.key] === true, bySource),
    );
    const byKey = statuses.reduce((acc, s) => {
      acc[s.key] = s;
      return acc;
    }, {} as Record<CdpProviderKey, CdpProviderStatus>);
    return {
      statuses,
      byKey,
      summary: {
        receiving: statuses.filter((s) => s.badge === 'receiving').length,
        preparing: statuses.filter((s) => s.badge === 'preparing').length,
        action: statuses.filter((s) => s.badge === 'action').length,
      },
    };
  }, [connected, needsAction, bySource]);
}
