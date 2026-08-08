/**
 * 프론트 트리거 카탈로그 ↔ 백엔드 실동작 대조 (2026-07-28)
 *
 * 왜 있나
 *   `selectJourneyTargetCustomerIds`의 switch에 없는 trigger_event는 `default: return []`로
 *   **조용히 0건**이 된다. 에러도 경고도 없다. 그래서 프론트가 백엔드에 없는 트리거를 열면
 *   사용자는 여정을 만들고 활성화까지 했는데 아무에게도 안 나가는 상태가 된다.
 *
 *   반대로 이벤트 변수(`#{주문번호}`)를 채워주는 트리거 목록이 어긋나면, 변수만 빈 채로
 *   실제 발송이 나간다 — 이쪽이 더 나쁘다.
 *
 *   둘 다 타입으로 못 막는다(문자열이라서). 그래서 소스 대조로 고정한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// ★ 2026-08-08 이어달리기 — 간선·템플릿 코드는 문자열 대조가 아니라 **실제 값**으로 맞춘다.
//   (정규식은 형태가 조금만 달라도 통과한다 — 2026-07-31 표시 축 교훈)
import { TRIGGER_CONTRACTS, getTriggerContract, isRegisteredTriggerEvent } from './journey-trigger-capability';
import { TRIGGER_EVENTS } from '../../../frontend/src/utils/journey-trigger-catalog';

const CATALOG = resolve(process.cwd(), '../frontend/src/utils/journey-trigger-catalog.ts');
const EXTRACTOR = resolve(process.cwd(), 'src/utils/journey-target-extractor.ts');
const CURSOR = resolve(process.cwd(), 'src/utils/journey-cdp-cursor.ts');
const WATCHER = resolve(process.cwd(), 'src/utils/journey-trigger-watcher.ts');

/** 카탈로그가 여는 trigger_event 문자열. */
function catalogTriggers(): string[] {
  const src = readFileSync(CATALOG, 'utf8');
  return Array.from(src.matchAll(/triggerEvent:\s*'([^']+)'/g)).map((m) => m[1]);
}

/** 카탈로그가 "이벤트 변수를 채워준다"고 선언한 trigger_event 문자열. */
function catalogEventPropTriggers(): string[] {
  const src = readFileSync(CATALOG, 'utf8');
  const block = src.slice(
    src.indexOf('TRIGGERS_WITH_EVENT_PROPS'),
    src.indexOf('] as const'),
  );
  return Array.from(block.matchAll(/'([a-z_]+\.[a-z_]+|custom_[a-z_]+)'/g)).map((m) => m[1]);
}

describe('여정 트리거 카탈로그 ↔ 백엔드 실동작', () => {
  it('카탈로그가 여는 트리거는 전부 extractor switch에 있다 (없으면 조용히 0건)', () => {
    const extractor = readFileSync(EXTRACTOR, 'utf8');
    const missing = catalogTriggers().filter((t) => !extractor.includes(`case '${t}':`));
    expect(
      missing,
      `extractor switch에 없는 트리거를 화면에서 열고 있다 — 여정을 만들어도 대상 0건으로 조용히 죽는다: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('카탈로그 트리거 8종이 중복 없이 정확히 그 8종이다', () => {
    // 개수만 세면 하나를 중복 정의하고 다른 하나를 빠뜨려도 통과한다 — 집합으로 못 박는다. (Codex 1R 지적)
    const triggers = catalogTriggers();
    expect(new Set(triggers).size, `중복 정의된 트리거가 있다: ${triggers.join(', ')}`).toBe(triggers.length);
    expect([...triggers].sort()).toEqual([
      'cdp.browse_no_purchase',
      'cdp.cart_abandon',
      'cdp.purchase',
      'cdp.reservation_created',
      'custom_order_shipped',
      'customer.birthday_approaching',
      'customer.created',
      'customer.cycle_lapsed',
      'customer.dormant',
      'customer.dormant_return',
      'customer.grade_changed',
      'customer.points_expiring',
      'purchase.first',
    ]);
  });

  it('서버 화이트리스트가 카탈로그 key와 같다 (제안 단계에서 조용히 빠지는 트리거가 없게)', () => {
    const catalogSrc = readFileSync(CATALOG, 'utf8');
    const catalogKeys = Array.from(catalogSrc.matchAll(/^\s*key:\s*'([a-z_]+)',/gm)).map((m) => m[1]);
    const suggestSrc = readFileSync(resolve(process.cwd(), 'src/utils/journey-trigger-suggest.ts'), 'utf8');
    const block = suggestSrc.slice(suggestSrc.indexOf('SERVER_TRIGGER_KEYS'), suggestSrc.indexOf('])'));
    const serverKeys = Array.from(block.matchAll(/'([a-z_]+)'/g)).map((m) => m[1]);
    expect(
      [...new Set(serverKeys)].sort(),
      '서버 화이트리스트와 카탈로그 key가 어긋나면 화면엔 보이는데 AI 추천에서만 빠진다',
    ).toEqual([...new Set(catalogKeys)].sort());
  });

  it('이벤트 properties를 싣는 트리거 목록이 백엔드 두 경로와 일치한다', () => {
    // 경로 ①: 커서 경로 — resolveCdpCursorEventName이 이벤트명을 돌려주는 트리거
    const cursorSrc = readFileSync(CURSOR, 'utf8');
    const cursorBlock = cursorSrc.slice(cursorSrc.indexOf('export function resolveCdpCursorEventName'));
    const cursorTriggers = Array.from(cursorBlock.matchAll(/case '([^']+)':\s*return '/g)).map((m) => m[1]);

    // 경로 ②: 장바구니 전용 — selectCartAbandonProperties로 properties를 실어 보낸다
    const watcherSrc = readFileSync(WATCHER, 'utf8');
    const cartCarries = /trigger_event === 'cdp\.cart_abandon'/.test(watcherSrc)
      && /selectCartAbandonProperties/.test(watcherSrc);

    const backend = new Set(cursorTriggers);
    if (cartCarries) backend.add('cdp.cart_abandon');

    expect(
      [...catalogEventPropTriggers()].sort(),
      '카탈로그가 선언한 "이벤트 변수 사용 가능" 목록이 백엔드와 어긋났다 — 변수가 빈 채로 실발송된다',
    ).toEqual([...backend].sort());
  });

  it('extractor의 default는 빈 배열을 돌려준다 (미지원 트리거가 발송으로 새지 않는다)', () => {
    const extractor = readFileSync(EXTRACTOR, 'utf8');
    const tail = extractor.slice(extractor.indexOf('    default:'));
    expect(tail.startsWith('    default:\n      return [];')).toBe(true);
  });
});

/**
 * ★ 2026-08-08 이어달리기 — 후속 간선은 계약(백엔드)이 소유하고 카탈로그(프론트)가 미러한다.
 *   둘이 어긋나면 화면은 "다음 수"를 권하는데 서버는 그 트리거를 모르는 상태가 된다.
 *   간선·템플릿 코드를 세 번째 자리에 복사하지 않기 위해 여기서 두 자리를 못 박는다.
 */
describe('이어달리기 간선 — 계약 ↔ 카탈로그', () => {
  /** 카탈로그 key → trigger_event (카탈로그가 소유한 유일한 매핑). */
  const eventOfKey = new Map(TRIGGER_EVENTS.map((t) => [t.key, t.triggerEvent]));

  it('nextEvents 값은 전부 등록된 트리거다 (없는 값이면 추천이 만들 수 없는 여정을 권한다)', () => {
    const unknown = TRIGGER_CONTRACTS.flatMap((c) => (c.nextEvents || []))
      .filter((e) => !isRegisteredTriggerEvent(e));
    expect(unknown, `등록되지 않은 후속 트리거: ${unknown.join(', ')}`).toEqual([]);
  });

  it('후속 트리거는 구현된 것만이다 (implemented=false면 저장이 거부된다)', () => {
    const notImplemented = TRIGGER_CONTRACTS.flatMap((c) => (c.nextEvents || []))
      .filter((e) => getTriggerContract(e)?.implemented !== true);
    expect(notImplemented, `구현되지 않은 후속 트리거를 권하고 있다: ${notImplemented.join(', ')}`).toEqual([]);
  });

  it('간선의 출발 트리거는 exit가 steps_done이 아니다 (전환 사건이 없으면 "전환했어요" 추천이 성립하지 않는다)', () => {
    const bad = TRIGGER_CONTRACTS.filter((c) => (c.nextEvents || []).length > 0 && c.exit === 'steps_done')
      .map((c) => c.event);
    expect(bad, `전환 신호가 없는 트리거에 간선이 달렸다: ${bad.join(', ')}`).toEqual([]);
  });

  it('프론트 nextKeys ↔ 백엔드 nextEvents 가 1:1이다', () => {
    const fromCatalog = TRIGGER_EVENTS
      .filter((t) => (t.nextKeys || []).length > 0)
      .map((t) => `${t.triggerEvent} → ${(t.nextKeys || []).map((k) => eventOfKey.get(k) || `(미등록 key: ${k})`).sort().join(',')}`)
      .sort();
    const fromContract = TRIGGER_CONTRACTS
      .filter((c) => (c.nextEvents || []).length > 0)
      .map((c) => `${c.event} → ${[...(c.nextEvents || [])].sort().join(',')}`)
      .sort();
    expect(fromCatalog, '카탈로그와 계약의 간선이 어긋나면 화면이 권한 트리거로 만들어지지 않는다').toEqual(fromContract);
  });

  it('프론트 overlapKeys ↔ 백엔드 overlapEvents 가 1:1이고 대칭이다', () => {
    const fromCatalog = TRIGGER_EVENTS
      .filter((t) => (t.overlapKeys || []).length > 0)
      .map((t) => `${t.triggerEvent} ↔ ${(t.overlapKeys || []).map((k) => eventOfKey.get(k) || `(미등록 key: ${k})`).sort().join(',')}`)
      .sort();
    const fromContract = TRIGGER_CONTRACTS
      .filter((c) => (c.overlapEvents || []).length > 0)
      .map((c) => `${c.event} ↔ ${[...(c.overlapEvents || [])].sort().join(',')}`)
      .sort();
    expect(fromCatalog).toEqual(fromContract);

    // 겹침은 한쪽만 적으면 반대편 화면에서 안내가 사라진다.
    for (const c of TRIGGER_CONTRACTS) {
      for (const other of c.overlapEvents || []) {
        expect(
          getTriggerContract(other)?.overlapEvents || [],
          `${other} 쪽에 ${c.event} 겹침이 안 적혀 있다 — 안내가 한 방향에서만 뜬다`,
        ).toContain(c.event);
      }
    }
  });

  it('templateCode는 카탈로그와 계약이 같다 (추천 카드 모양·프리셋 저장값의 단일 출처)', () => {
    const fromCatalog = TRIGGER_EVENTS.map((t) => `${t.triggerEvent}=${t.templateCode}`).sort();
    const fromContract = TRIGGER_CONTRACTS
      .filter((c) => c.key !== null)
      .map((c) => `${c.event}=${c.templateCode}`)
      .sort();
    expect(fromCatalog, '화면에 보이는 트리거는 전부 계약에 templateCode가 있어야 한다').toEqual(fromContract);
  });
});
