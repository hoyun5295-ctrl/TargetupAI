# 이메일 브레이즈급 Phase 1 — 구현 계획

> **For agentic workers:** 이 계획은 인라인 순차 실행(superpowers:executing-plans). CLAUDE.md `no_parallel_tasks`로 서브에이전트 병렬 금지. 각 태스크 끝의 검증(tsc/vitest)은 비토가 실행, **git commit/배포는 비토가 실행하지 않고 주인님이 tp-push로 종결**(no_system_modification). Step은 체크박스(`- [ ]`).

**Goal:** 한줄로 이메일을 브레이즈급으로 — 드래그앤드롭 비주얼 에디터 강화 + 즉시·무료 템플릿 갤러리 + 수신자별 개인화(변수+조건부)를, 편리함과 AI 풍부 활용을 동시에 담아 구현.

**Architecture:** 기존 `Section[]` 모델·백엔드 단일 렌더러·발송 인프라 위에 얹는다. 개인화는 신규 인라인 치환을 만들지 않고 기존 컨트롤타워(`liquid-templating` CT-50, `inapp-personalization` CT-79)를 재사용한다. 발송 시 섹션 캠페인은 수신자별로 `Section[]`을 치환·필터해 렌더(수동 HTML 캠페인은 기존 경로 무회귀). 조건부는 사용자가 Liquid를 직접 쓰지 않고 구조화 `display_condition`을 UI로 지정 → 리졸버가 평가.

**Tech Stack:** Node/Express + React/TS, PostgreSQL(`email_campaigns.sections` jsonb), vitest, 네이티브 HTML5 드래그(라이브러리 추가 금지).

---

## File Structure

**신규**
- `packages/backend/src/utils/email/email-personalization.ts` — `resolveEmailSectionsForCustomer(sections, customer)` + `evalDisplayCondition(cond, customer)`. 순수(고객 객체 입력, DB 0). `renderTextForCustomer`(inapp CT) 재사용.
- `packages/backend/src/utils/email/__tests__/email-personalization.verify.ts` — vitest.
- `packages/frontend/src/utils/email-templates.ts` — `EMAIL_TEMPLATES: { key, label, hint, icon, gradient, industry, sections: Section[] }[]` 6~8종. 혜택은 `[직접 작성해주세요]` placeholder.
- `packages/frontend/src/components/email/EmailTemplateGalleryModal.tsx` — 갤러리 모달(카드 그리드 + AI 추천 상단 + 미리보기).

**수정**
- `packages/backend/src/utils/dm/dm-section-registry.ts:422` + `packages/frontend/src/utils/dm-section-defaults.ts` — `Section`에 optional `display_condition` 추가.
- `packages/backend/src/utils/email-channel.ts` — `resolveCustomerRecipients` 고객 필드 동봉 + `sendEmailCampaign` 섹션 캠페인 수신자별 렌더 분기(★승인 게이트).
- `packages/backend/src/utils/email-send-sweeper.ts` — 예약 발송 동일 분기(★승인 게이트).
- `packages/backend/src/routes/email.ts` — `render-preview`에 optional `sampleCustomer` + 샘플 고객 조회 endpoint + (선택) 템플릿 AI 추천 endpoint.
- `packages/frontend/src/components/email/EmailVisualEditor.tsx` — 드래그앤드롭 순서변경 + 블록 복제 + 변수 칩 + 조건부 토글 + 샘플 고객 미리보기 토글 + 1클릭 "AI 개선".
- `packages/frontend/src/pages/EmailCampaignsPage.tsx` — "템플릿에서 시작" 버튼 + 갤러리 모달 연결.

---

## Phase A — 비주얼 에디터 강화 (frontend, 발송·돈 무관)

### Task A1: 좌측 블록 리스트 드래그앤드롭 순서 변경
**Files:** Modify `packages/frontend/src/components/email/EmailVisualEditor.tsx`

- [ ] **Step 1:** `SectionList.tsx`의 네이티브 드래그 패턴 확인(읽기) — `draggable`/`onDragStart`/`onDragOver`/`onDrop`/`dataTransfer` 사용법.
- [ ] **Step 2:** EmailVisualEditor에 `dragIndex` state + `reorder(from, to)` 추가. `reorder`는 `ordered` 배열에서 from→to 이동 후 `normalizeOrder`로 order 재부여, `setSections(normalizeOrder(arr))`.
- [ ] **Step 3:** 좌측 블록 항목 `<div>`에 `draggable onDragStart={() => setDragIndex(i)} onDragOver={(e)=>e.preventDefault()} onDrop={() => { if(dragIndex!==null) reorder(dragIndex, i); setDragIndex(null); }}` + 드래그 핸들 아이콘(GripVertical) + 드래그 중 `opacity-50`. 위/아래 화살표는 모바일 대비 유지.
- [ ] **Step 4 (검증):** `cd 절대경로 && node node_modules/typescript/lib/tsc.js --noEmit -p tsconfig.json` → 0 errors. 자가 grep(모델명/native dialog/박-단어 0).

### Task A2: 선택 블록 복제
**Files:** Modify `EmailVisualEditor.tsx`

- [ ] **Step 1:** `duplicateBlock(id)` 추가 — 대상 섹션 deep copy(JSON.parse(JSON.stringify)) + 새 `id`(`'dup-'+order+'-'+type`) + 대상 바로 뒤 삽입 후 `normalizeOrder`. 선택을 복제본으로 이동.
- [ ] **Step 2:** 선택 블록 속성 패널 헤더에 복제 버튼(Copy 아이콘) 추가.
- [ ] **Step 3 (검증):** tsc 0 + grep.

---

## Phase B — 템플릿 갤러리 (frontend; AI 추천은 기존 재사용)

### Task B1: 템플릿 프리셋 정의
**Files:** Create `packages/frontend/src/utils/email-templates.ts`

- [ ] **Step 1:** `EMAIL_TEMPLATES` 6~8종 작성. 각: `{ key, label, hint, industry?, icon, gradient, sections: Section[] }`. 시나리오=장바구니·휴면·VIP 감사·신상·재구매·생일·뉴스레터. sections는 header+hero+text_card+(coupon/cta)+footer 골격, 텍스트는 일반 문구 + 혜택은 `[직접 작성해주세요]`(임의 혜택 금지). id/order/visible 부여.
- [ ] **Step 2 (검증):** tsc 0. `Section` 타입 일치 확인.

### Task B2: 갤러리 모달 + 페이지 버튼
**Files:** Create `packages/frontend/src/components/email/EmailTemplateGalleryModal.tsx`; Modify `EmailCampaignsPage.tsx`

- [ ] **Step 1:** `EmailTemplateGalleryModal` — 커스텀 다크 모달(`bg-slate-900 border-white/10 rounded-2xl`, native dialog 0). 카드 그리드(2~3열, 가로 긴 띠 X). 각 카드 아이콘+이름+한 줄. 클릭 → `onPick(template.sections, template.label)`.
- [ ] **Step 2:** EmailCampaignsPage 헤더에 "템플릿에서 시작" 버튼(`smtpConfigured` 게이팅) + 모달 state. onPick → `setVisualEditor({ sections, name: label, isAd: true, aiGenerated: false })`(크레딧 0, 즉시 에디터). 
- [ ] **Step 3 (승리 공식 — AI 추천):** 모달 상단에 "이 회사에 맞는 추천" 영역 — 기존 회사 brand voice/업종 신호로 1~2개 프리셋을 먼저 노출(industry 매칭, 신호 없으면 인기순 폴백). 추가 입력 0.
- [ ] **Step 4 (검증):** tsc 0 + grep.

---

## Phase C — 개인화 (변수 + 조건부)

### Task C1: Section 타입 `display_condition` 추가
**Files:** Modify `packages/backend/src/utils/dm/dm-section-registry.ts:422`; `packages/frontend/src/utils/dm-section-defaults.ts`

- [ ] **Step 1:** 두 `Section` 타입에 추가:
```ts
display_condition?: {
  field: string;                                   // customer 키 (name/grade/points/region/...)
  op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains';
  value: string;
};
```
- [ ] **Step 2 (검증):** backend tsc 0 + frontend tsc 0. (jsonb 보관이라 DB ALTER 불필요 — `sections` 컬럼 그대로.)

### Task C2: email-personalization 컨트롤타워 + TDD
**Files:** Create `email-personalization.ts` + `__tests__/email-personalization.verify.ts`

- [ ] **Step 1 (실패 테스트 작성):** `email-personalization.verify.ts`
```ts
import { describe, it, expect } from 'vitest';
import { evalDisplayCondition, resolveEmailSectionsForCustomer } from '../email-personalization';
import type { Section } from '../../dm/dm-section-registry';

const vip = { name: '김민수', grade: 'VIP', points: 12000 };
const normal = { name: '이서연', grade: '일반', points: 0 };

describe('evalDisplayCondition', () => {
  it('eq 통과/탈락', () => {
    expect(evalDisplayCondition({ field: 'grade', op: 'eq', value: 'VIP' }, vip)).toBe(true);
    expect(evalDisplayCondition({ field: 'grade', op: 'eq', value: 'VIP' }, normal)).toBe(false);
  });
  it('gt 숫자 비교', () => {
    expect(evalDisplayCondition({ field: 'points', op: 'gt', value: '1000' }, vip)).toBe(true);
    expect(evalDisplayCondition({ field: 'points', op: 'gt', value: '1000' }, normal)).toBe(false);
  });
  it('조건 없으면 항상 true(상위에서 처리) / 빈 고객 안전', () => {
    expect(evalDisplayCondition({ field: 'grade', op: 'eq', value: 'VIP' }, {} as any)).toBe(false);
  });
});

describe('resolveEmailSectionsForCustomer', () => {
  const base = (over: Partial<Section>): Section => ({ id: 'x', type: 'text_card', order: 0, visible: true, props: {} as any, ...over });
  it('변수 치환 — Liquid + 옛 %', () => {
    const secs = [base({ props: { headline: '{{ customer.name }}님', body: '%등급% 고객님' } as any })];
    const out = resolveEmailSectionsForCustomer(secs, vip);
    expect((out[0].props as any).headline).toContain('김민수');
    expect((out[0].props as any).body).toContain('VIP');
  });
  it('display_condition 불충족 섹션 제외', () => {
    const secs = [
      base({ id: 'a', display_condition: { field: 'grade', op: 'eq', value: 'VIP' }, props: { body: 'VIP only' } as any }),
      base({ id: 'b', order: 1, props: { body: '모두' } as any }),
    ];
    expect(resolveEmailSectionsForCustomer(secs, normal).map(s => s.id)).toEqual(['b']);
    expect(resolveEmailSectionsForCustomer(secs, vip).map(s => s.id)).toEqual(['a', 'b']);
  });
  it('visible=false 제외', () => {
    const secs = [base({ id: 'a', visible: false, props: {} as any }), base({ id: 'b', order: 1, props: {} as any })];
    expect(resolveEmailSectionsForCustomer(secs, vip).map(s => s.id)).toEqual(['b']);
  });
});
```
- [ ] **Step 2 (실패 확인):** `cd 절대경로 && node node_modules/vitest/vitest.mjs run src/utils/email/__tests__/email-personalization.verify.ts` → FAIL(모듈 없음).
- [ ] **Step 3 (구현):** `email-personalization.ts`
```ts
import { renderTextForCustomer } from '../inapp-personalization';
import type { Section } from '../dm/dm-section-registry';

// 이메일 화이트리스트 섹션의 치환 대상 string 필드.
const STRING_FIELD_KEYS: Record<string, string[]> = {
  header: ['brand_name'],
  hero: ['headline', 'sub_copy'],
  text_card: ['tag', 'headline', 'body'],
  coupon: ['discount_label', 'usage_condition'],
  promo_code: ['description', 'instructions'],
  cta: [],
  store_info: ['address', 'business_hours'],
  footer: ['notes', 'legal_text'],
};

export function evalDisplayCondition(
  cond: NonNullable<Section['display_condition']>,
  customer: Record<string, any>,
): boolean {
  const raw = customer ? customer[cond.field] : undefined;
  const a = raw === undefined || raw === null ? '' : String(raw);
  const b = cond.value ?? '';
  switch (cond.op) {
    case 'eq': return a === b;
    case 'ne': return a !== b;
    case 'gt': return Number(a) > Number(b);
    case 'gte': return Number(a) >= Number(b);
    case 'lt': return Number(a) < Number(b);
    case 'lte': return Number(a) <= Number(b);
    case 'contains': return a.includes(b);
    default: return true;
  }
}

export function resolveEmailSectionsForCustomer(
  sections: Section[],
  customer: Record<string, any>,
): Section[] {
  const out: Section[] = [];
  for (const s of sections || []) {
    if (s.visible === false) continue;
    if (s.display_condition && !evalDisplayCondition(s.display_condition, customer)) continue;
    const keys = STRING_FIELD_KEYS[s.type] || [];
    const props: any = { ...(s.props as any) };
    for (const k of keys) {
      if (typeof props[k] === 'string' && props[k]) {
        props[k] = renderTextForCustomer(props[k], customer).rendered;
      }
    }
    // CTA 버튼 라벨
    if (s.type === 'cta' && Array.isArray(props.buttons)) {
      props.buttons = props.buttons.map((b: any) => ({ ...b, label: b?.label ? renderTextForCustomer(b.label, customer).rendered : b?.label }));
    }
    out.push({ ...s, props });
  }
  return out;
}
```
- [ ] **Step 4 (통과 확인):** vitest run → PASS.
- [ ] **Step 5 (검증):** backend tsc 0 + 자가 grep.

### Task C3: render-preview 샘플 고객 개인화 + 샘플 조회 endpoint
**Files:** Modify `packages/backend/src/routes/email.ts`

- [ ] **Step 1:** `render-preview` 핸들러에 optional `sampleCustomer`(body) 수신. 있으면 `resolveEmailSectionsForCustomer(sections, sampleCustomer)` 후 렌더, 없으면 기존대로.
- [ ] **Step 2:** `GET /api/email/preview-customers` — `buildPreviewCustomers(companyId)`(inapp CT 재사용) 반환(VIP/일반/신규). 회사 격리.
- [ ] **Step 3 (검증):** backend tsc 0. (발송 무관 — 미리보기만.)

### Task C4: 에디터 변수 칩 + 조건부 토글 + 샘플 미리보기 토글 + 1클릭 AI 개선
**Files:** Modify `EmailVisualEditor.tsx`

- [ ] **Step 1:** 변수 칩 팔레트 — `GET /api/email/preview-customers` 로드 + 변수 목록(`{{ customer.name }}` 등, inapp `listAvailableVariables` 미러 상수). 텍스트 필드 포커스 시 칩 클릭 = 커서 위치 토큰 삽입.
- [ ] **Step 2:** 조건부 표시 — 선택 블록에 "조건부 표시" 토글 → field(select)/op(select)/value(input) → `updateSelectedSection({ display_condition })`. 사용자는 Liquid를 안 쓴다.
- [ ] **Step 3:** 미리보기 샘플 토글 — 미리보기 상단 VIP/일반/신규 + "변수 그대로". 선택 시 render-preview에 `sampleCustomer` 동봉.
- [ ] **Step 4 (승리 공식 — 1클릭 AI 개선):** 에디터 상단 "AI로 개선" 버튼 → 기존 email-ai 다듬기 재사용(제목·본문 다듬기, 혜택 placeholder 유지). 발송 전 AI 자율 진단(스팸·길이·가독성)은 기존 진단 흐름 노출.
- [ ] **Step 5 (검증):** frontend tsc 0 + 자가 grep(모델명/native dialog/박-단어 0).

### Task C5 ★승인 게이트★ — 발송 경로 수신자별 렌더 (발송·돈, 0611 6원칙)
> 이 태스크는 **수정 전 주인님 명시 승인 의무**. 승인 전 코드 편집 금지. 승인 시 6원칙 ① 전수 grep(즉시+예약 두 경로)+증거 ② 효과 검증(샘플 1건 치환 확인) ⑤ 실측 1건 시나리오 보고.

**Files:** Modify `email-channel.ts`, `email-send-sweeper.ts`

- [ ] **Step 1:** `resolveCustomerRecipients` 확장 — 기존 `{email, name}` + `customer`(화이트리스트 필드: name/grade/points/region/recent_purchase_store/total_purchase_amount/purchase_count, inapp 화이트리스트 미러). SELECT 컬럼은 `buildPreviewCustomers`와 동일 집합(검증된 컬럼) 사용.
- [ ] **Step 2:** `sendEmailCampaign` 발송 루프 분기 — `campaign.sections?.length`이면 수신자별: `resolveEmailSectionsForCustomer(sections, recipient.customer)` → `renderEmailSections(resolved, ctx)` → 광고 footer 합성 → `applyTracking` → send. 섹션 없으면 **기존 html_body+substitutions 경로 그대로**(무회귀). 제목 개인화는 `renderTextForCustomer(finalSubject, customer)`.
- [ ] **Step 3:** `email-send-sweeper.ts` 예약 발송도 동일 분기(전 경로 영향표 — 즉시/예약 일치).
- [ ] **Step 4 (검증):** backend tsc 0 + vitest(가능 범위) + 전수 grep 결과 보고 + 테스트 발송 1건 치환 시나리오를 보고에 포함.

---

## 종결

- 전 Phase 후: backend tsc 0 + frontend tsc 0 + vitest GREEN + 자가 grep(모델명/native dialog/박-단어/AI 임의 혜택 0).
- 배포는 주인님 tp-push(backend `pm2 restart all` ts-node + frontend `build:safe`). C5는 실측 1건 확인 후.

## Self-Review (계획 ↔ 스펙 대조)
- 스펙 3기능(에디터 강화/갤러리/개인화) 전부 태스크 존재 — A(에디터), B(갤러리), C(개인화). ✓
- 승리 공식(편리함+AI 풍부) — B3(AI 추천), C4-4(1클릭 AI 개선·진단) 반영. ✓
- 발송·돈 경로 6원칙 — C5 승인 게이트 + 실측 1건. ✓
- 재사용(인라인 치환 신설 0) — renderTextForCustomer/buildPreviewCustomers/liquid. ✓
- DB ALTER 불필요(display_condition은 sections jsonb 내부). ✓
