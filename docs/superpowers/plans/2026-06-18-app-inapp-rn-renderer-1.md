# 앱 인앱 — React Native 렌더러 1단계 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 팝폰(React Native·Expo) 앱에서 한줄로 앱 채널 인앱 메시지가 네이티브 바텀시트/모달로 실제로 뜨고, 노출·클릭·닫기가 `/track`으로 집계되는 것을 실기기에서 확인한다.

**Architecture:** 한줄로 백엔드는 이미 `GET /api/cdp/inapp/active?channel=app` + `POST /api/cdp/inapp/track`를 제공한다(변경 0). 팝폰에 순수 JS 클라이언트(`src/lib/hanjul/`)를 새로 만들어 active 조회→네이티브 렌더→track 전송한다. 핵심 로직(URL 빌드·메시지 정규화·빈도 제한)은 프레임워크 무관 순수 함수로 분리해 jest로 단위 검증하고, UI(바텀시트)는 실기기로 검증한다.

**Tech Stack:** React Native 0.81 / Expo SDK 54 / expo-router / RN 내장 `Modal`·`Animated` / `expo-image`·`react-native-reanimated`(이미 설치됨, 새 네이티브 모듈 0) / jest-expo(신규 devDep, 단위 테스트용) / AsyncStorage(빈도 제한 저장).

**구현 레포:** `C:\Users\ceo\projects\poppon-workspace\poppon-app` (한줄로 본체 아님). 한줄로 백엔드는 1단계에서 코드 변경 없음.

---

## 검토용 결정 사항 (착수 전 Harold 확인)

1. **앱 인증 = 등록 도메인 Origin 헤더(스톱갭)**: RN fetch에 `Origin: https://<팝폰 등록도메인>`을 직접 실어 기존 `requireCdpBrowserOrigin`을 통과한다. 백엔드 변경 0, 시크릿 노출 0.
   - **선행 조건**: 팝폰 도메인이 한줄로 회사 설정 `cdp_allowed_origins`에 등록돼 있어야 한다(관리자 화면에서 1회 등록, 코드 변경 없음).
   - **불확실성**: RN 네트워킹이 수동 `Origin` 헤더를 실제로 전송하는지는 Task 1에서 먼저 실측한다. 막히면 같은 dev 빌드 한정으로 `X-Hanjullo-Secret` 폴백(공개 출시본엔 넣지 않음).
   - **정식 인증(②)**: 네이티브 앱 키 인증(`companies.cdp_allowed_app_ids` 허용목록 + 번들ID 검증)은 출시 전 별도 단계(2단계). 시크릿을 앱에 넣지 않는 브레이즈·세일즈포스급 방식.
2. **첫 표면 = 바텀시트 + 중앙 모달**. `template`이 `center_modal`이면 모달, 그 외(`full_screen`/배너 등)는 바텀시트로 렌더(1단계는 표면 2종으로 단순화, 표면 확장은 2단계).
3. **신원**: 로그인 시 `external_id = supabase user.id`, 항상 `anonymous_id = getSessionId()`(팝폰 `ppn_sid`). 별도 매핑 없음.
4. **백엔드/DB 변경 0** — 1단계는 팝폰 프론트만. 관리자가 만든 앱 채널 메시지를 표시.
5. **git 커밋·배포는 Harold 직접** — 본 계획의 commit 단계는 체크포인트 안내이며 AI가 실행하지 않는다.

---

## File Structure

**신규 (poppon-app):**
- `src/lib/hanjul/config.ts` — 키·엔드포인트·Origin 상수 (env에서 읽음)
- `src/lib/hanjul/types.ts` — 정규화된 `InAppMessage` 타입
- `src/lib/hanjul/inapp-core.ts` — 순수 함수: `buildActiveUrl` · `normalizeMessage` · 빈도 제한(`canDisplay`/`markSeen`, KV 주입)
- `src/lib/hanjul/inapp-client.ts` — 네트워크: `fetchActiveMessages` · `trackEvent` (config + AsyncStorage + 신원)
- `src/lib/hanjul/InAppBottomSheet.tsx` — 바텀시트/모달 UI (RN Modal + reanimated)
- `src/lib/hanjul/InAppHost.tsx` — 마운트·오케스트레이션 (앱 active 시 조회→렌더→track)
- `src/lib/hanjul/__tests__/inapp-core.test.ts` — 순수 로직 단위 테스트

**수정 (poppon-app):**
- `app/_layout.tsx` — `<AuthProvider>` 안에 `<InAppHost/>` 오버레이 마운트
- `.env` — `EXPO_PUBLIC_HANJUL_KEY`, `EXPO_PUBLIC_HANJUL_ORIGIN` 추가
- `package.json` — jest-expo devDep + `test` 스크립트 + jest preset

---

## Task 1: 인증 실측 스파이크 (작동 먼저)

**목적:** UI를 만들기 전, RN에서 active 호출이 200 + 메시지를 받는지 먼저 확인한다.

**Files:**
- Create(임시): `src/lib/hanjul/__spike__/auth-check.ts`

- [ ] **Step 1: 임시 스파이크 스크립트 작성**

```ts
// src/lib/hanjul/__spike__/auth-check.ts
// 임시 — Task 1 종료 후 삭제. 앱 임의 화면에서 1회 호출해 콘솔 확인.
export async function authСheckSpike(): Promise<void> {
  const KEY = process.env.EXPO_PUBLIC_HANJUL_KEY!;
  const ORIGIN = process.env.EXPO_PUBLIC_HANJUL_ORIGIN!; // 예: https://poppon.co.kr
  const url = 'https://app.hanjul.ai/api/cdp/inapp/active?trigger=page_load&channel=app';
  const res = await fetch(url, { headers: { 'X-Hanjullo-Key': KEY, 'Origin': ORIGIN } });
  console.log('[hanjul auth spike] status:', res.status);
  const json = await res.json().catch(() => null);
  console.log('[hanjul auth spike] body:', JSON.stringify(json));
}
```

- [ ] **Step 2: `.env`에 키·Origin 추가**

```
EXPO_PUBLIC_HANJUL_KEY=hjl_f1f3664172c56653200fb917e72964221bdd37b00985eb5be597bd653a871f14
EXPO_PUBLIC_HANJUL_ORIGIN=https://poppon.co.kr
```
(실제 등록 도메인은 한줄로 회사 설정 `cdp_allowed_origins` 등록값과 일치해야 함 — Harold 확인.)

- [ ] **Step 3: 실기기에서 1회 호출 후 콘솔 확인 (Harold/비토)**

`expo start` → dev client → 임의 화면에서 `authCheckSpike()` 호출 → Metro 콘솔 관찰.
- 기대: `status: 200` + `body.success: true` (+ messages 배열; 앱 채널 메시지 없으면 빈 배열).
- `status: 403`이면 RN이 Origin 미전송 → 결정 사항 1의 폴백(시크릿 헤더, dev 한정)으로 Step 1·2 보정 후 재확인.

- [ ] **Step 4: 스파이크 삭제** (`__spike__` 폴더 제거). 커밋 없음.

---

## Task 2: config 모듈

**Files:**
- Create: `src/lib/hanjul/config.ts`

- [ ] **Step 1: config 작성**

```ts
// src/lib/hanjul/config.ts
export const HANJUL_BASE = 'https://app.hanjul.ai/api/cdp';
export const HANJUL_KEY = process.env.EXPO_PUBLIC_HANJUL_KEY ?? '';
export const HANJUL_ORIGIN = process.env.EXPO_PUBLIC_HANJUL_ORIGIN ?? '';
export const HANJUL_CHANNEL = 'app' as const;
```

- [ ] **Step 2: 커밋 (Harold)** — `feat(hanjul): add inapp config`

---

## Task 3: 타입

**Files:**
- Create: `src/lib/hanjul/types.ts`

- [ ] **Step 1: 정규화 타입 작성** (SDK `InAppMessageSdk`의 앱 필요분만)

```ts
// src/lib/hanjul/types.ts
export interface InAppButton {
  id: string;
  label: string;
  actionUrl: string | null;
  style: 'primary' | 'secondary' | 'tertiary';
  backgroundColor: string;
  textColor: string;
}

export type DisplayFrequency = 'once_per_session' | 'once_per_day' | 'always';

export interface InAppMessage {
  id: string;
  title: string;
  body: string;
  template: string;            // center_modal / full_screen / ... (1단계는 modal vs sheet로만 매핑)
  imageUrl: string | null;
  badgeText: string | null;
  backgroundColor: string;
  textColor: string;
  buttons: InAppButton[];
  displayFrequency: DisplayFrequency;
  autoDismissSeconds: number | null;
  maxDisplaysPerUser: number | null;
}
```

- [ ] **Step 2: 커밋 (Harold)** — `feat(hanjul): add inapp types`

---

## Task 4: 순수 로직 (TDD) — URL 빌드

**Files:**
- Create: `src/lib/hanjul/inapp-core.ts`
- Test: `src/lib/hanjul/__tests__/inapp-core.test.ts`
- Modify: `package.json` (jest)

- [ ] **Step 1: jest-expo 설치 + 스크립트** (Harold 실행)

```bash
cd C:/Users/ceo/projects/poppon-workspace/poppon-app
npx expo install jest-expo jest @types/jest --dev
```
`package.json` scripts에 추가:
```json
"test": "jest"
```
`package.json`에 jest preset 추가:
```json
"jest": { "preset": "jest-expo" }
```

- [ ] **Step 2: 실패 테스트 작성 (buildActiveUrl)**

```ts
// src/lib/hanjul/__tests__/inapp-core.test.ts
import { buildActiveUrl } from '../inapp-core';

describe('buildActiveUrl', () => {
  it('channel=app과 신원·trigger를 쿼리로 붙인다', () => {
    const url = buildActiveUrl('https://app.hanjul.ai/api/cdp', {
      trigger: 'page_load', channel: 'app', externalId: 'u1', anonymousId: 'a1', seen: ['m1', 'm2'],
    });
    expect(url).toContain('/inapp/active?');
    expect(url).toContain('trigger=page_load');
    expect(url).toContain('channel=app');
    expect(url).toContain('external_id=u1');
    expect(url).toContain('anonymous_id=a1');
    expect(url).toContain('seen=m1%2Cm2');
  });

  it('빈 신원은 쿼리에서 생략한다', () => {
    const url = buildActiveUrl('https://app.hanjul.ai/api/cdp', { trigger: 'page_load', channel: 'app' });
    expect(url).not.toContain('external_id=');
    expect(url).not.toContain('seen=');
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `cd C:/Users/ceo/projects/poppon-workspace/poppon-app && npx jest inapp-core -t buildActiveUrl`
Expected: FAIL — `buildActiveUrl is not a function`

- [ ] **Step 4: 최소 구현**

```ts
// src/lib/hanjul/inapp-core.ts (이어서 Task 5·6에서 추가)
export interface ActiveParams {
  trigger: string;
  channel: 'app' | 'web';
  externalId?: string;
  anonymousId?: string;
  seen?: string[];
}

export function buildActiveUrl(base: string, p: ActiveParams): string {
  const q = new URLSearchParams({ trigger: p.trigger, channel: p.channel });
  if (p.externalId) q.set('external_id', p.externalId);
  if (p.anonymousId) q.set('anonymous_id', p.anonymousId);
  if (p.seen && p.seen.length) q.set('seen', p.seen.join(','));
  return `${base}/inapp/active?${q.toString()}`;
}
```

- [ ] **Step 5: 통과 확인** — Run 동일. Expected: PASS

- [ ] **Step 6: 커밋 (Harold)** — `test+feat(hanjul): buildActiveUrl`

---

## Task 5: 순수 로직 (TDD) — 메시지 정규화

**Files:**
- Modify: `src/lib/hanjul/inapp-core.ts`
- Test: `src/lib/hanjul/__tests__/inapp-core.test.ts`

- [ ] **Step 1: 실패 테스트 (normalizeMessage)** — 서버가 camel/snake 섞어 보내도 흡수

```ts
import { normalizeMessage } from '../inapp-core';

describe('normalizeMessage', () => {
  it('snake/camel 혼용 + 기본값을 정규화한다', () => {
    const m = normalizeMessage({
      id: 'm1', title: '제목', body: '본문', template: 'center_modal',
      image_url: '/u/a.png', backgroundColor: '#111', textColor: '#fff',
      buttons: [{ id: 'b1', label: '보기', action_url: 'poppon://d/1', style: 'primary', background_color: '#4f46e5', text_color: '#fff' }],
      displayFrequency: 'once_per_session', auto_dismiss_seconds: null, max_displays_per_user: 3,
    });
    expect(m.imageUrl).toBe('/u/a.png');
    expect(m.buttons[0].actionUrl).toBe('poppon://d/1');
    expect(m.maxDisplaysPerUser).toBe(3);
    expect(m.backgroundColor).toBe('#111');
  });

  it('필수 누락 시 안전 기본값', () => {
    const m = normalizeMessage({ id: 'm2', title: 'T', template: 'full_screen' });
    expect(m.body).toBe('');
    expect(m.buttons).toEqual([]);
    expect(m.displayFrequency).toBe('always');
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx jest inapp-core -t normalizeMessage` → FAIL

- [ ] **Step 3: 구현 추가**

```ts
// src/lib/hanjul/inapp-core.ts 에 추가
import type { InAppMessage, InAppButton, DisplayFrequency } from './types';

export function normalizeMessage(raw: any): InAppMessage {
  const buttons: InAppButton[] = Array.isArray(raw?.buttons)
    ? raw.buttons.map((b: any) => ({
        id: String(b?.id ?? ''),
        label: String(b?.label ?? ''),
        actionUrl: b?.action_url ?? b?.actionUrl ?? null,
        style: (b?.style ?? 'primary') as InAppButton['style'],
        backgroundColor: b?.background_color ?? b?.backgroundColor ?? 'rgba(255,255,255,0.16)',
        textColor: b?.text_color ?? b?.textColor ?? '#ffffff',
      }))
    : [];
  return {
    id: String(raw?.id ?? ''),
    title: String(raw?.title ?? ''),
    body: String(raw?.body ?? ''),
    template: String(raw?.template ?? raw?.position ?? 'center_modal'),
    imageUrl: raw?.image_url ?? raw?.imageUrl ?? null,
    badgeText: raw?.badge_text ?? raw?.badgeText ?? null,
    backgroundColor: raw?.backgroundColor ?? raw?.background_color ?? '#1f1f29',
    textColor: raw?.textColor ?? raw?.text_color ?? '#ffffff',
    buttons,
    displayFrequency: (raw?.displayFrequency ?? raw?.display_frequency ?? 'always') as DisplayFrequency,
    autoDismissSeconds: raw?.auto_dismiss_seconds ?? raw?.autoDismissSeconds ?? null,
    maxDisplaysPerUser: raw?.max_displays_per_user ?? raw?.maxDisplaysPerUser ?? null,
  };
}
```

- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: 커밋 (Harold)** — `test+feat(hanjul): normalizeMessage`

---

## Task 6: 순수 로직 (TDD) — 빈도 제한

**Files:**
- Modify: `src/lib/hanjul/inapp-core.ts`
- Test: `src/lib/hanjul/__tests__/inapp-core.test.ts`

- [ ] **Step 1: 실패 테스트 (canDisplay/markSeen, KV 주입)**

```ts
import { canDisplay, markSeen, type SeenStore } from '../inapp-core';

function fakeStore(init: Record<string, number> = {}): SeenStore & { data: Record<string, number> } {
  const data = { ...init };
  return { data, get: (k) => (k in data ? data[k] : null), set: (k, v) => { data[k] = v; } };
}

describe('frequency cap', () => {
  it('once_per_session: 본 메시지는 다시 표시 안 함', () => {
    const s = fakeStore();
    const msg = { id: 'm1', displayFrequency: 'once_per_session' } as any;
    expect(canDisplay(msg, s, 1000)).toBe(true);
    markSeen(msg, s, 1000);
    expect(canDisplay(msg, s, 1000)).toBe(false);
  });

  it('once_per_day: 24h 지나면 다시 표시', () => {
    const s = fakeStore();
    const msg = { id: 'm2', displayFrequency: 'once_per_day' } as any;
    markSeen(msg, s, 0);
    expect(canDisplay(msg, s, 1000)).toBe(false);
    expect(canDisplay(msg, s, 25 * 3600 * 1000)).toBe(true);
  });

  it('maxDisplaysPerUser 초과 시 차단', () => {
    const s = fakeStore({ 'count:m3': 2 });
    const msg = { id: 'm3', displayFrequency: 'always', maxDisplaysPerUser: 2 } as any;
    expect(canDisplay(msg, s, 1000)).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인** → FAIL

- [ ] **Step 3: 구현 추가**

```ts
// src/lib/hanjul/inapp-core.ts 에 추가
export interface SeenStore {
  get(key: string): number | null;
  set(key: string, value: number): void;
}
const DAY_MS = 24 * 60 * 60 * 1000;

export function canDisplay(msg: { id: string; displayFrequency: string; maxDisplaysPerUser?: number | null }, store: SeenStore, now: number): boolean {
  const max = msg.maxDisplaysPerUser ?? 0;
  if (max > 0 && (store.get(`count:${msg.id}`) ?? 0) >= max) return false;
  if (msg.displayFrequency === 'once_per_session') return store.get(`session:${msg.id}`) === null;
  if (msg.displayFrequency === 'once_per_day') {
    const last = store.get(`day:${msg.id}`);
    return last === null || now - last >= DAY_MS;
  }
  return true;
}

export function markSeen(msg: { id: string; displayFrequency: string }, store: SeenStore, now: number): void {
  store.set(`count:${msg.id}`, (store.get(`count:${msg.id}`) ?? 0) + 1);
  if (msg.displayFrequency === 'once_per_session') store.set(`session:${msg.id}`, now);
  if (msg.displayFrequency === 'once_per_day') store.set(`day:${msg.id}`, now);
}

export function pickFirstDisplayable(messages: { id: string; displayFrequency: string; maxDisplaysPerUser?: number | null }[], store: SeenStore, now: number) {
  return messages.find((m) => canDisplay(m as any, store, now)) ?? null;
}
```

- [ ] **Step 4: 통과 확인** → PASS (전체 `npx jest inapp-core` 그린)
- [ ] **Step 5: 커밋 (Harold)** — `test+feat(hanjul): frequency cap`

---

## Task 7: 네트워크 클라이언트

**Files:**
- Create: `src/lib/hanjul/inapp-client.ts`

- [ ] **Step 1: 클라이언트 작성** (AsyncStorage 기반 SeenStore + 신원 + Origin 헤더)

```ts
// src/lib/hanjul/inapp-client.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/src/lib/supabase/client';
import { getSessionId } from '@/src/lib/tracking';
import { HANJUL_BASE, HANJUL_KEY, HANJUL_ORIGIN, HANJUL_CHANNEL } from './config';
import { buildActiveUrl, normalizeMessage, type SeenStore } from './inapp-core';
import type { InAppMessage } from './types';

const SEEN_KEY = 'hjl_inapp_seen_v1';

// AsyncStorage를 동기 SeenStore로 감싸기 — init 시 1회 로드, 변경 시 비동기 flush (fire-and-forget)
export async function loadSeenStore(): Promise<SeenStore & { flush: () => void }> {
  let data: Record<string, number> = {};
  try { const raw = await AsyncStorage.getItem(SEEN_KEY); if (raw) data = JSON.parse(raw); } catch {}
  return {
    get: (k) => (k in data ? data[k] : null),
    set: (k, v) => { data[k] = v; AsyncStorage.setItem(SEEN_KEY, JSON.stringify(data)).catch(() => {}); },
    flush: () => { AsyncStorage.setItem(SEEN_KEY, JSON.stringify(data)).catch(() => {}); },
  };
}

async function resolveIdentity(): Promise<{ externalId?: string; anonymousId: string }> {
  const anonymousId = await getSessionId();
  try {
    const { data } = await supabase.auth.getSession();
    const externalId = data.session?.user?.id;
    return externalId ? { externalId, anonymousId } : { anonymousId };
  } catch {
    return { anonymousId };
  }
}

const headers = () => ({ 'X-Hanjullo-Key': HANJUL_KEY, 'Origin': HANJUL_ORIGIN });

export async function fetchActiveMessages(trigger = 'page_load'): Promise<InAppMessage[]> {
  if (!HANJUL_KEY) return [];
  const id = await resolveIdentity();
  const url = buildActiveUrl(HANJUL_BASE, { trigger, channel: HANJUL_CHANNEL, externalId: id.externalId, anonymousId: id.anonymousId });
  try {
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) return [];
    const json: any = await res.json();
    if (!json?.success || !Array.isArray(json.messages)) return [];
    return json.messages.map(normalizeMessage);
  } catch { return []; }
}

export async function trackEvent(messageId: string, eventType: 'impression' | 'click' | 'dismiss', buttonId?: string): Promise<void> {
  if (!HANJUL_KEY) return;
  const id = await resolveIdentity();
  try {
    await fetch(`${HANJUL_BASE}/inapp/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers() },
      body: JSON.stringify({ message_id: messageId, event_type: eventType, external_id: id.externalId, anonymous_id: id.anonymousId, button_id: buttonId }),
    });
  } catch { /* fire-and-forget */ }
}
```

- [ ] **Step 2: tsc 확인** — Run: `cd C:/Users/ceo/projects/poppon-workspace/poppon-app && npx tsc --noEmit` → 0 errors
- [ ] **Step 3: 커밋 (Harold)** — `feat(hanjul): inapp network client`

---

## Task 8: 바텀시트/모달 UI

**Files:**
- Create: `src/lib/hanjul/InAppBottomSheet.tsx`

- [ ] **Step 1: UI 작성** (RN Modal + reanimated slide-up, expo-image, 다크 톤, native dialog 미사용)

```tsx
// src/lib/hanjul/InAppBottomSheet.tsx
import React, { useEffect } from 'react';
import { Modal, View, Text, Pressable, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, runOnJS } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { InAppMessage, InAppButton } from './types';

interface Props {
  message: InAppMessage;
  variant: 'sheet' | 'modal';
  onClose: () => void;
  onButton: (b: InAppButton) => void;
}

export function InAppBottomSheet({ message, variant, onClose, onButton }: Props) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const translateY = useSharedValue(height);
  const backdrop = useSharedValue(0);

  useEffect(() => {
    translateY.value = withTiming(0, { duration: 280 });
    backdrop.value = withTiming(1, { duration: 280 });
  }, []);

  const dismiss = () => {
    backdrop.value = withTiming(0, { duration: 200 });
    translateY.value = withTiming(height, { duration: 220 }, (done) => { if (done) runOnJS(onClose)(); });
  };

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));

  const containerBase = variant === 'modal'
    ? { alignSelf: 'center' as const, marginHorizontal: 20, borderRadius: 22, maxWidth: 420, width: '100%' as const }
    : { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: insets.bottom + 8 };

  return (
    <Modal transparent visible animationType="none" onRequestClose={dismiss} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: variant === 'modal' ? 'center' : 'flex-end' }}>
        <Animated.View style={[{ position: 'absolute', inset: 0, backgroundColor: 'rgba(10,10,15,0.6)' }, backdropStyle]}>
          <Pressable style={{ flex: 1 }} onPress={dismiss} accessibilityLabel="닫기" />
        </Animated.View>

        <Animated.View style={[{ backgroundColor: message.backgroundColor, overflow: 'hidden' }, containerBase, sheetStyle]}>
          {message.imageUrl ? (
            <Image source={{ uri: toAbsolute(message.imageUrl) }} style={{ width: '100%', height: 200 }} contentFit="cover" transition={150} />
          ) : null}
          <View style={{ padding: 22, gap: 10 }}>
            {message.badgeText ? (
              <View style={{ alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 4 }}>
                <Text style={{ color: message.textColor, fontSize: 11, fontWeight: '700' }}>{message.badgeText}</Text>
              </View>
            ) : null}
            <Text style={{ color: message.textColor, fontSize: 19, fontWeight: '800' }}>{message.title}</Text>
            {message.body ? <Text style={{ color: message.textColor, opacity: 0.82, fontSize: 14, lineHeight: 21 }}>{message.body}</Text> : null}

            <View style={{ gap: 8, marginTop: 8 }}>
              {message.buttons.slice(0, 3).map((b) => (
                <Pressable key={b.id} onPress={() => onButton(b)}
                  style={{ backgroundColor: b.backgroundColor, borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}>
                  <Text style={{ color: b.textColor, fontSize: 15, fontWeight: '700' }}>{b.label}</Text>
                </Pressable>
              ))}
              <Pressable onPress={dismiss} style={{ alignItems: 'center', paddingVertical: 10 }}>
                <Text style={{ color: message.textColor, opacity: 0.5, fontSize: 13 }}>닫기</Text>
              </Pressable>
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function toAbsolute(url: string): string {
  if (/^(https?:)?\/\//i.test(url) || url.startsWith('data:')) return url;
  const origin = 'https://app.hanjul.ai';
  return url.startsWith('/') ? origin + url : `${origin}/${url}`;
}
```

- [ ] **Step 2: tsc 확인** → 0 errors
- [ ] **Step 3: 커밋 (Harold)** — `feat(hanjul): InAppBottomSheet UI`

---

## Task 9: 호스트(마운트·오케스트레이션)

**Files:**
- Create: `src/lib/hanjul/InAppHost.tsx`

- [ ] **Step 1: 호스트 작성** (앱 active 시 1회 조회 → 첫 표시가능 메시지 → 렌더 → track)

```tsx
// src/lib/hanjul/InAppHost.tsx
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { AppState, AppStateStatus, Linking } from 'react-native';
import { fetchActiveMessages, trackEvent, loadSeenStore } from './inapp-client';
import { pickFirstDisplayable, markSeen } from './inapp-core';
import { InAppBottomSheet } from './InAppBottomSheet';
import type { InAppMessage, InAppButton } from './types';

export function InAppHost() {
  const [current, setCurrent] = useState<InAppMessage | null>(null);
  const busy = useRef(false);

  const run = useCallback(async () => {
    if (busy.current || current) return;
    busy.current = true;
    try {
      const [messages, store] = await Promise.all([fetchActiveMessages('page_load'), loadSeenStore()]);
      const now = Date.now();
      const pick = pickFirstDisplayable(messages, store, now) as InAppMessage | null;
      if (pick) {
        markSeen(pick, store, now);
        setCurrent(pick);
        trackEvent(pick.id, 'impression');
      }
    } finally { busy.current = false; }
  }, [current]);

  useEffect(() => {
    run();
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => { if (s === 'active') run(); });
    return () => sub.remove();
  }, [run]);

  if (!current) return null;

  const variant = current.template === 'center_modal' ? 'modal' : 'sheet';
  const handleButton = (b: InAppButton) => {
    trackEvent(current.id, 'click', b.id);
    setCurrent(null);
    if (b.actionUrl && !b.actionUrl.startsWith('[')) Linking.openURL(b.actionUrl).catch(() => {});
  };
  const handleClose = () => { trackEvent(current.id, 'dismiss'); setCurrent(null); };

  return <InAppBottomSheet message={current} variant={variant} onClose={handleClose} onButton={handleButton} />;
}
```

- [ ] **Step 2: tsc 확인** → 0 errors
- [ ] **Step 3: 커밋 (Harold)** — `feat(hanjul): InAppHost orchestration`

---

## Task 10: _layout 마운트 + 자가 grep

**Files:**
- Modify: `app/_layout.tsx`

- [ ] **Step 1: `<InAppHost/>` 마운트** — `import { InAppHost } from '@/src/lib/hanjul/InAppHost';` 추가 후, `<AuthProvider>` 안 `</Stack>` 다음(스플래시/잠금 오버레이와 같은 계층)에 삽입:

```tsx
      </Stack>

      {/* 한줄로 앱 인앱 메시지 — 모든 화면 위 오버레이 */}
      <InAppHost />
```

- [ ] **Step 2: 자가 grep (영구 룰)**

```bash
cd C:/Users/ceo/projects/poppon-workspace/poppon-app
npx grep -rn "Alert.alert\|Opus\|Sonnet\|GPT\|Claude" src/lib/hanjul app/_layout.tsx || echo "0건"
```
Expected: native Alert·모델명 0건. (RN 기본 `Alert` 미사용 — 커스텀 모달만.)

- [ ] **Step 3: 커밋 (Harold)** — `feat(hanjul): mount InAppHost in root layout`

---

## Task 11: 실기기 검증 (verification-before-completion)

**검증 주체:** Harold/비토 (운영 검증 아님 — dev 빌드 실측).

- [ ] **Step 1: 한줄로 관리자에서 앱 채널 인앱 메시지 1건 생성** — 인앱 메시지 → 앱 채널 → 제목·본문·이미지·CTA 입력 → 발행. (장바구니 이탈 카피 골격으로 시연.)
- [ ] **Step 2: 단위 테스트 그린** — Run: `cd C:/Users/ceo/projects/poppon-workspace/poppon-app && npx jest` → 전체 PASS
- [ ] **Step 3: 타입 0** — Run: `npx tsc --noEmit` → 0 errors
- [ ] **Step 4: 실기기 표시 확인** — `expo start` → dev client → 앱 진입(또는 백그라운드→복귀) 시 바텀시트/모달 표시 → CTA·닫기 동작.
- [ ] **Step 5: 집계 확인** — 한줄로 통계(앱 채널 필터)에서 노출·클릭 잡히는지 확인.
- [ ] **Step 6: 배포** — Harold 직접 (dev client/EAS).

---

## Self-Review

**Spec coverage:** 스펙 10절 1단계 상세(RN 렌더러·active?channel=app·track·식별 브리지·앱 실행 노출·바텀시트)를 Task 1~11이 모두 덮음. 스펙 5절 전달 구조(공유 코어 재사용·렌더러만 신규)와 일치. 2·3단계(이벤트 트리거·푸시 연계·AI 운영·정식 앱 인증)는 본 계획 범위 밖으로 명시.

**Placeholder scan:** TBD/TODO 없음. 모든 코드 단계에 실제 코드 포함. `[직접 작성해주세요]`는 제품 placeholder(혜택 미창작)라 의도된 것.

**Type consistency:** `InAppMessage`/`InAppButton`(types.ts) ↔ `normalizeMessage`(Task 5) ↔ `InAppBottomSheet`/`InAppHost`(Task 8·9) 필드명 일치(`imageUrl`/`backgroundColor`/`actionUrl`/`displayFrequency`/`maxDisplaysPerUser`). `SeenStore`(Task 6) ↔ `loadSeenStore`(Task 7) 시그니처 일치. `buildActiveUrl`/`pickFirstDisplayable`/`markSeen` 동일 이름 사용.

**영구 룰:** native dialog 0(커스텀 모달) · 모델명 0 · 임의 혜택 0(메시지는 관리자 작성) · 박-단어 0 · 백엔드/DB 변경 0(1단계) · 커밋은 Harold.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-18-app-inapp-rn-renderer-1.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Task별 fresh subagent + 사이 리뷰. 단, 구현 대상이 별도 레포(poppon-app)라 작업 디렉터리 전환 주의.

**2. Inline Execution** — 현 세션에서 Task 순서대로 실행, 체크포인트마다 멈춤.

**어느 쪽으로 진행할까요?** (그 전에 위 "검토용 결정 사항" 1번 인증 방식만 확인해 주시면 Task 1부터 정확히 들어갑니다.)
