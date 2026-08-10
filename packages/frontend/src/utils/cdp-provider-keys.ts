/**
 * utils/cdp-provider-keys.ts — 자사몰 식별자 정규화 CT (★2026-08-10 신설)
 *
 * ⛔ 이 파일이 자사몰 식별자 매핑의 **유일한 출처**다. 화면·훅에 같은 매핑을 다시 쓰지 않는다.
 *
 * 왜 필요한가 — 같은 자사몰이 층마다 다른 이름을 쓴다(2026-08-10 운영 실측으로 확인):
 *   ① 화면 카드 키(PROVIDER_CARDS)       : 'naver'
 *   ② DB company_integrations.provider   : 'naver_smart_store'   ← ①과 다르다
 *   ③ cdp_events.source                  : 'naver_smart_store'
 * 그대로 대조하면 네이버는 영원히 "연결 안 됨"으로 보인다(설계서 §2-3-1).
 *
 * 그리고 자체 호스팅은 이벤트 출처가 **둘**이다:
 *   webhook 수신분 = 'custom' / 브라우저 SDK 수집분 = 'sdk'(backend cdp-events.ts)
 *   SDK만 설치한 몰이 가장 흔하므로 'custom' 하나만 세면 정상 동작 중인 몰이 "설치 대기"로 남는다.
 *
 * 근거(전부 코드 실측): cafe24-client(source 'cafe24') · imweb-client('imweb') ·
 *   godo-parse(GODO_SOURCE='godo') · naver-commerce-client('naver_smart_store') ·
 *   custom-self-hosted-adapter('custom') · cdp-events(브라우저 수집 'sdk')
 */

export type CdpProviderKey = 'cafe24' | 'naver' | 'godo' | 'imweb' | 'makeshop' | 'custom';

/** 이벤트 적재 상태(설계서 §2-3). 'pending_mapping' = 인증·조회는 되나 CDP 매핑이 아직(의도된 보류). */
export type CdpIngestKind = 'events' | 'pending_mapping';

/**
 * 데이터가 들어오게 하려면 **누가 무엇을 해야 하는가** (★2026-08-10 신설 — 0810 실측 발견).
 *
 *   'auto'      = 우리가 가져온다. 고객사가 설치할 것이 없다.
 *                 카페24·아임웹은 웹훅 수신, 고도몰은 주기 수집(backend godo-sync-worker, 30분).
 *   'developer' = 고객사 개발자가 스크립트·웹훅을 넣어야 들어온다(자체 호스팅).
 *   null        = 수집 경로가 아직 없다(매핑 보류 몰). 이 축으로 문구를 만들지 않는다 — 배지가 '준비 중'이다.
 *
 * 왜 필요한가 — 이 축이 없어서 화면이 몰마다 반대로 거짓말을 했다:
 *   ① 훅은 전 몰을 'developer'로 가정해 고도몰에도 "설치만 남았어요"를 띄웠고,
 *   ② 스테퍼는 전 몰을 'auto'로 가정해 자체 호스팅에도 "따로 설치할 것은 없습니다"를 띄웠다.
 * 판정은 한 곳에서만 한다 — 화면이 각자 가정하면 그 가정이 서로 어긋난다.
 *
 * 백엔드 어댑터 `connectMethod`와 1:1로 맞물린다(webhook=developer / oauth·polling=auto).
 * 계약 테스트가 그 대응과 고도몰 수집 호출부를 함께 고정한다.
 */
export type CdpCollectKind = 'auto' | 'developer';

export interface CdpProviderKeyEntry {
  /** 화면 카드 키 */
  key: CdpProviderKey;
  /** DB company_integrations.provider 실값 */
  dbProvider: string;
  /** cdp_events.source 실값 — 한 몰이 여러 출처를 가질 수 있다(custom = webhook + sdk) */
  eventSources: string[];
  /** 이벤트 축으로 상태를 판정할 수 있는가 */
  ingest: CdpIngestKind;
  /** 데이터가 들어오게 하려면 누가 무엇을 해야 하는가 — 화면 문구·버튼 노출이 전부 이 값에서 나온다 */
  collect: CdpCollectKind | null;
}

export const CDP_PROVIDER_KEYS: readonly CdpProviderKeyEntry[] = [
  { key: 'cafe24',   dbProvider: 'cafe24',            eventSources: ['cafe24'],            ingest: 'events',          collect: 'auto' },
  { key: 'naver',    dbProvider: 'naver_smart_store', eventSources: ['naver_smart_store'], ingest: 'pending_mapping', collect: null },
  { key: 'godo',     dbProvider: 'godo',              eventSources: ['godo'],              ingest: 'events',          collect: 'auto' },
  { key: 'imweb',    dbProvider: 'imweb',             eventSources: ['imweb'],             ingest: 'events',          collect: 'auto' },
  { key: 'makeshop', dbProvider: 'makeshop',          eventSources: [],                    ingest: 'pending_mapping', collect: null },
  { key: 'custom',   dbProvider: 'custom',            eventSources: ['custom', 'sdk'],     ingest: 'events',          collect: 'developer' },
] as const;

const BY_KEY = new Map<CdpProviderKey, CdpProviderKeyEntry>(CDP_PROVIDER_KEYS.map((e) => [e.key, e]));

/** 화면 카드 키 → 매핑 엔트리. 모르는 키는 undefined(호출부가 잠근다 — 임의 기본값 금지). */
export function getProviderKeyEntry(key: CdpProviderKey): CdpProviderKeyEntry | undefined {
  return BY_KEY.get(key);
}

/** 이 몰의 이벤트 출처 전부를 합산한다. 출처가 없으면(매핑 보류) null — 0건과 구분해야 한다. */
export function sumEventsForProvider<T extends { total: number; count24h: number; firstEventAt: string | null; lastEventAt: string | null }>(
  key: CdpProviderKey,
  bySource: Record<string, T> | null | undefined,
): { total: number; count24h: number; firstEventAt: string | null; lastEventAt: string | null } | null {
  const entry = BY_KEY.get(key);
  if (!entry || entry.eventSources.length === 0) return null;
  if (!bySource) return null;
  let total = 0;
  let count24h = 0;
  let firstEventAt: string | null = null;
  let lastEventAt: string | null = null;
  for (const src of entry.eventSources) {
    const row = bySource[src];
    if (!row) continue;
    total += row.total || 0;
    count24h += row.count24h || 0;
    if (row.firstEventAt && (!firstEventAt || row.firstEventAt < firstEventAt)) firstEventAt = row.firstEventAt;
    if (row.lastEventAt && (!lastEventAt || row.lastEventAt > lastEventAt)) lastEventAt = row.lastEventAt;
  }
  return { total, count24h, firstEventAt, lastEventAt };
}
