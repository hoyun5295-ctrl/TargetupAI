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
} from '../utils/cdp-provider-keys';

/** 배지 5종 — 설계서 §5-1-1과 1:1. */
export type CdpIntegrationBadge =
  | 'receiving'    // emerald — 데이터 수신 중
  | 'awaiting'     // amber   — 설치만 남음(고객사 개발자 차례)
  | 'preparing'    // violet  — 연결 완료·우리 쪽 매핑 준비 중
  | 'action'       // rose    — 인증 끊김(고객사 담당자 차례)
  | 'disconnected';// white/40— 아직 연결 전

/** 다음 행동의 주체 — 카드 버튼 문구를 이 값이 정한다(§5-1). */
export type CdpNextActor = 'none' | 'merchant' | 'merchant_dev' | 'hanjul';

export interface CdpProviderStatus {
  key: CdpProviderKey;
  badge: CdpIntegrationBadge;
  /** 화면 문구 — 형용사가 아니라 문장(§5-5 문구 규율) */
  label: string;
  nextActor: CdpNextActor;
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
  /** 몰별 인증 만료 등 조치 필요 신호. 근거 컬럼 확정 전까지 화면이 넘기지 않으면 undefined(§9-6). */
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
  };

  if (!connected) {
    return { ...base, badge: 'disconnected', label: '아직 연결 전', nextActor: 'merchant' };
  }
  // 연결된 뒤에는 인증 문제가 다른 무엇보다 앞선다 — 끊긴 채로 "수신 중"을 보여주면 안 된다.
  if (needsAction) {
    return { ...base, badge: 'action', label: '인증이 끊겼어요 · 재연결 필요', nextActor: 'merchant' };
  }
  // 매핑 보류 몰 — 이벤트가 0인 것이 정상이다. 고객에게 "설치하세요"라고 하면 거짓이다.
  if (eventsUnavailable) {
    return { ...base, badge: 'preparing', label: '연결 완료 · 데이터 연동 준비 중', nextActor: 'hanjul' };
  }
  if (count24h > 0) {
    return { ...base, badge: 'receiving', label: `데이터 수신 중 · 24시간 ${count24h.toLocaleString()}건`, nextActor: 'none' };
  }
  // 과거 수신 이력은 있으나 최근 24시간 0건 — '수신 끊김'은 임계값 확정 전까지 판정하지 않는다(§6-4).
  if (total > 0) {
    return { ...base, badge: 'receiving', label: `연결됨 · 누적 ${total.toLocaleString()}건`, nextActor: 'none' };
  }
  return { ...base, badge: 'awaiting', label: '설치만 남았어요', nextActor: 'merchant_dev' };
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
