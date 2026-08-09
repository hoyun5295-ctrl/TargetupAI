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

export interface CdpProviderKeyEntry {
  /** 화면 카드 키 */
  key: CdpProviderKey;
  /** DB company_integrations.provider 실값 */
  dbProvider: string;
  /** cdp_events.source 실값 — 한 몰이 여러 출처를 가질 수 있다(custom = webhook + sdk) */
  eventSources: string[];
  /** 이벤트 축으로 상태를 판정할 수 있는가 */
  ingest: CdpIngestKind;
}

export const CDP_PROVIDER_KEYS: readonly CdpProviderKeyEntry[] = [
  { key: 'cafe24',   dbProvider: 'cafe24',            eventSources: ['cafe24'],            ingest: 'events' },
  { key: 'naver',    dbProvider: 'naver_smart_store', eventSources: ['naver_smart_store'], ingest: 'pending_mapping' },
  { key: 'godo',     dbProvider: 'godo',              eventSources: ['godo'],              ingest: 'events' },
  { key: 'imweb',    dbProvider: 'imweb',             eventSources: ['imweb'],             ingest: 'events' },
  { key: 'makeshop', dbProvider: 'makeshop',          eventSources: [],                    ingest: 'pending_mapping' },
  { key: 'custom',   dbProvider: 'custom',            eventSources: ['custom', 'sdk'],     ingest: 'events' },
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
