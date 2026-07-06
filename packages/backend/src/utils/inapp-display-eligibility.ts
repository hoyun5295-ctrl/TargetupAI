/**
 * ★ CT: 인앱 메시지 표시 가능성 판정 — 2026-07-06 (Harold 확정)
 *
 * 🎯 목적
 *   인앱(웹) 메시지는 스토어프론트에 SDK(hanjul.min.js)가 실제 설치돼야 표시된다.
 *   데이터 연동(주문·회원 동기화)과 "표시 가능"은 별개 — 네이버 스마트스토어는 데이터 연동만 가능하고
 *   스토어 페이지에 커스텀 스크립트를 넣을 수 없어 인앱 표시가 영구 불가(폐쇄형).
 *   표시할 곳이 없는 고객이 인앱을 만들어 크레딧(게시 15·AI 생성)을 낭비하지 않도록
 *   생성/게시/AI 생성 게이트가 이 CT를 소비한다.
 *
 * 📋 판정 재료 (전부 기존 테이블·기존 컬럼 — 신규 DDL 0)
 *   - company_integrations(provider, status, connected_at): 연동 상태. connected = status='active'
 *     (0703 영구 룰 — 검증 성공 시에만 active. 저장만 한 pending/revoked = 미연동)
 *   - cdp_events(source='sdk', occurred_at): SDK 실제 생존 신호 (웹 + 웹뷰앱 + 네이티브 REST 공통 적재 경로)
 */

import { query } from '../config/database';

export type InAppDisplaySupport = 'auto' | 'manual' | 'unsupported';

/**
 * provider별 인앱(웹) 표시 지원 매트릭스 — 단일 정의(프론트 표기는 이 응답을 소비, 하드코딩 분산 금지).
 *   auto        = 연동만 하면 SDK 자동 주입 (카페24 scripttags API)
 *   manual      = 데이터 연동과 별개로 스토어에 SDK 스크립트 수동 설치 필요
 *   unsupported = 스토어프론트에 스크립트 주입 자체가 불가 — 인앱 표시 영구 불가 (데이터 연동만)
 */
export const INAPP_DISPLAY_SUPPORT: Record<string, InAppDisplaySupport> = {
  cafe24: 'auto',
  godo: 'manual',
  makeshop: 'manual',
  imweb: 'manual',
  custom: 'manual',
  naver_smart_store: 'unsupported',
};

export const INAPP_PROVIDER_LABEL: Record<string, string> = {
  cafe24: '카페24',
  godo: '고도몰',
  makeshop: '메이크샵',
  imweb: '아임웹',
  custom: '자체 쇼핑몰',
  naver_smart_store: '네이버 스마트스토어',
};

/** SDK 생존 신호 인정 윈도우 — 최근 30일 내 source='sdk' 이벤트가 있으면 "설치돼 살아있음"으로 본다. */
const SDK_SIGNAL_WINDOW_DAYS = 30;

export interface InAppDisplayEligibility {
  /** 연동된 플랫폼별 상태 (연동 안 된 provider는 목록에 없음) */
  platforms: Array<{
    provider: string;
    label: string;
    support: InAppDisplaySupport;
  }>;
  /** SDK 신호 최근 시각 (없으면 null) */
  webSdkLastSeenAt: string | null;
  /** 최근 30일 내 SDK 신호 존재 */
  webSdkDetected: boolean;
  /** 웹 인앱 생성/게시 허용 여부 — SDK 신호 or 표시 지원 플랫폼 연동 중 하나라도 있으면 true */
  canCreateWeb: boolean;
  /** 허용이지만 SDK 신호 미감지 (수동 설치 미완 가능성) — 경고 배너 대상 */
  warnWeb: boolean;
  /** canCreateWeb=false일 때 사용자 안내 문구 (네이버 단독이면 네이버 특정 안내) */
  blockReasonWeb: string | null;
}

/** 회사의 인앱(웹) 표시 가능성 판정 — 생성/게시/AI 생성 게이트 + 화면 상태 패널 공용. */
export async function getInAppDisplayEligibility(companyId: string): Promise<InAppDisplayEligibility> {
  // 1) 연동 상태 — 검증된(active) 연동만 (0703 영구 룰)
  const integRes = await query(
    `SELECT provider, status FROM company_integrations WHERE company_id = $1::uuid`,
    [companyId],
  );
  const connected = integRes.rows
    .filter((r: any) => r.status === 'active')
    .map((r: any) => String(r.provider))
    .filter((p: string, i: number, arr: string[]) => arr.indexOf(p) === i); // provider 중복 제거(멀티 몰)

  const platforms = connected.map((p: string) => ({
    provider: p,
    label: INAPP_PROVIDER_LABEL[p] || p,
    support: INAPP_DISPLAY_SUPPORT[p] || ('manual' as InAppDisplaySupport), // 미지의 신규 provider = manual(보수적 허용)
  }));

  // 2) SDK 생존 신호 — cdp_events source='sdk' 최근 30일
  const sdkRes = await query(
    `SELECT MAX(occurred_at) AS last FROM cdp_events WHERE company_id = $1::uuid AND source = 'sdk'`,
    [companyId],
  );
  const last = sdkRes.rows[0]?.last ? new Date(sdkRes.rows[0].last) : null;
  const webSdkDetected = !!last && Date.now() - last.getTime() < SDK_SIGNAL_WINDOW_DAYS * 24 * 3600 * 1000;

  // 3) 판정 — SDK 신호가 있으면 무조건 허용(어딘가에 실제 설치됨).
  //    신호가 없어도 표시 지원(auto/manual) 플랫폼이 연동돼 있으면 허용 + 경고(설치 안내).
  const displayCapable = platforms.filter((p) => p.support !== 'unsupported');
  const canCreateWeb = webSdkDetected || displayCapable.length > 0;
  const warnWeb = canCreateWeb && !webSdkDetected;

  let blockReasonWeb: string | null = null;
  if (!canCreateWeb) {
    const naverOnly = platforms.length > 0 && platforms.every((p) => p.support === 'unsupported');
    blockReasonWeb = naverOnly
      ? '네이버 스마트스토어는 스토어 페이지에 스크립트를 설치할 수 없어 인앱 메시지 표시가 불가능합니다(주문·고객 데이터 연동만 지원). 인앱 메시지는 카페24·고도몰·메이크샵·아임웹 연동 또는 자체 쇼핑몰 SDK 설치 후 이용할 수 있습니다.'
      : '인앱 메시지를 표시할 수 있는 쇼핑몰 연동이 없습니다. 카페24·고도몰·메이크샵·아임웹 연동 또는 자체 쇼핑몰에 SDK 설치 후 이용할 수 있습니다.';
  }

  return {
    platforms,
    webSdkLastSeenAt: last ? last.toISOString() : null,
    webSdkDetected,
    canCreateWeb,
    warnWeb,
    blockReasonWeb,
  };
}
