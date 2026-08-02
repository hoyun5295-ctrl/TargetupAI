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
