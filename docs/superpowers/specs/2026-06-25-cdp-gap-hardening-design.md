# CDP(자사몰 연동) 갭 보강 설계서

- 작성일: 2026-06-25
- 상태: 설계 확정(브레인스토밍 완료) — **다음 세션 구현 대상**
- 작성: 비토 (브레인스토밍 스킬 경유)
- 선행: 2026-06-25 CDP 전 경로 심층 감사(이 세션)

---

## 0. 배경 / 감사 결론

CDP 전 경로(인증·식별·이벤트·주문·환불·멱등·webhook재시도·여정커서·provider레지스트리·엔드포인트·bulk·프론트·SDK)를 직접 정독했다. **뼈대는 성숙하고 견고**하다: 멱등(키 갱신통과·중복차단), 환불/취소 매출 차감(revenue_applied/reversed 마커), 익명→회원 소급(stitching), webhook 3회 재시도 + payload 30일 정리, 월 한도/CORS/앱ID 인증, SDK auto-capture(PII 마스킹·배치). 죽은 기능은 없다.

다만 보강할 갭 8건 + 문서 드리프트 1건이 있다. 이 설계서는 그 전부를 5 phase로 묶어 다음 세션에 순서대로(A→B→C→D→E) 구현하기 위한 것이다.

### 결정사항 (Harold 2026-06-25)
- 범위: **발견된 전부 (8갭 + 문서)**
- 전화번호 변경: **자동 갱신 + 충돌 안전 규칙**
- provider 불일치: **백엔드 단일 출처화**(프론트가 listProvidersForUI 구동 + 가비아/고도몰 정식 등록)
- Phase 2 신규 몰(Shopify 등): **이번 범위 아님**(기존 갭 보강 집중)

### 공통 원칙
- 가능한 모든 판정 로직은 순수 함수로 분리 + `*.verify.ts`(DB import 0) TDD.
- 컨트롤타워 내부 수정만 — 라우트 인라인 헬퍼 금지.
- 돈/발송에 닿는 Phase A·D는 실측 1건 시나리오를 구현 보고에 포함.
- 각 phase 종료 시 backend tsc 0 + vitest 회귀 통과.

---

## Phase A — 발송 정확도 (사용자 직결)

### A1. 회원 전화번호 변경 자동 동기화 (gap 2)
**문제**: 자사몰에서 회원 phone이 바뀌어도 `cdp-identity.ts`가 `customers.phone` 갱신을 skip(`syncCustomerFields` 끝 주석 — UNIQUE `(company_id, store_code, phone)` 충돌 우려). 번호 변경 회원은 옛 번호로 남아 발송 실패.

**설계**:
- 순수 함수 `decidePhoneUpdate(p: { currentPhone: string|null; incomingPhone: string|null; conflictHolderId: string|null; selfId: string }): 'update' | 'skip_conflict' | 'noop'`
  - incoming 없음 또는 current와 동일 → `noop`
  - 그 번호를 같은 회사 **다른 활성 고객**(`conflictHolderId && conflictHolderId !== selfId`)이 보유 → `skip_conflict`(자동변경 금지)
  - 그 외 → `update`
- 새 파일 `utils/cdp-phone-sync.ts`(순수) + `__tests__/cdp-phone-sync.verify.ts`.
- `cdp-identity.ts` 배선: 기존 link 경로(L107~)와 `syncCustomerFields` 모두에서, 갱신 직전 `SELECT id FROM customers WHERE company_id=$ AND phone=$normalized AND is_active=true AND id<>$self`로 conflictHolderId 조회 → `decidePhoneUpdate` 판정.
  - `update`: `UPDATE customers SET phone=$ ...` (normalizePhone 경유).
  - `skip_conflict`: 변경 안 함 + 검수 플래그(A4와 공용 테이블/로그, 아래 참조) 기록 + `console.warn`.
- 적재 경로(`syncCustomerFields` 시그니처에 `customerId`, `companyId` 이미 있음 — phone 인자 활용).

**테스트**: 동일번호 noop / 빈값 noop / 자유번호 update / 타고객 점유 skip_conflict.
**실측 1건**: 자사몰 identify로 기존 회원 phone 변경 전송 → customers.phone 갱신 확인 / 타고객 점유 케이스는 미변경 + 플래그 확인.
**리스크**: customers UNIQUE 충돌 → conflict 조회로 사전 차단. 트랜잭션 불필요(단일 UPDATE).

### A4. identity 충돌(email=A, phone=B 다른 고객) 안전 처리 (gap 4)
**문제**: `identifyCustomer`가 email 매칭(2단계) 우선이라, email은 고객 A인데 phone은 다른 고객 B면 A로 연결하고 B는 무시(병합/경고 없음).

**설계**: 자동 병합 금지(위험). 2·3단계에서 email 매칭 결과와 phone 매칭 결과가 **서로 다른 customer_id**면 충돌로 감지 → 검수 플래그 기록 + `console.warn`(A로 진행은 유지). 자동 병합은 별도 운영 도구로 후일.
- 검수 플래그 저장소: 신규 경량 테이블 `cdp_identity_review`(company_id, customer_id, kind: 'phone_conflict'|'merge_candidate', detail jsonb, created_at, resolved bool). **DB 마이그레이션 필요 — 구현 세션에 information_schema 확인 후 CREATE.**
- A1의 skip_conflict도 같은 테이블에 kind='phone_conflict'로 적재.

**테스트**: email/phone 동일고객 → 충돌 없음 / 다른고객 → 플래그 1건.
**리스크**: 낮음(읽기+로그+플래그, 기존 흐름 불변).

---

## Phase B — provider 백엔드 단일 출처화 (gap 3 + gap 7)

**문제**:
- 프론트 `CdpSettingsPage.tsx` PROVIDER_CARDS(카페24·네이버·고도몰·가비아·자체호스팅)가 하드코딩 — 백엔드 registry(cafe24·naver·custom 실구현 + shopify/makeshop/imweb/sixshop/woocommerce 스켈레톤)와 불일치.
- 가비아는 전용 백엔드 없이 custom webhook로 동작. 고도몰은 `/api/godo`(폴링) 별도 라우터라 registry에 없음.
- `listProvidersForUI` status 추론(`oauth || (webhook&&sig)`)이 폴링형(고도몰)을 표현 못 함.
- registry 등록이 routes/cdp.ts import 부수효과 의존(gap 7 로드 순서 취약).

**설계**:
1. `IProviderAdapter`에 명시 필드 추가: `readonly connectMethod: 'oauth' | 'webhook' | 'polling' | 'none'`, `readonly available: boolean`. `listProvidersForUI`는 추론 폐기 → `available` 직접 사용. status = `available ? 'available' : 'coming_soon'`.
2. 고도몰 어댑터: `connectMethod:'polling'`, `available:true`. OAuth/webhook 메서드는 "고도몰은 폴링 연동 — `/api/godo` 사용" 안내 throw. 실제 연동 로직은 기존 `routes/godo.ts`/`godo-client.ts` 유지(어댑터는 UI 노출·메타용).
3. 가비아 어댑터: custom-self-hosted webhook 재사용 — `connectMethod:'webhook'`, `available:true`. verifyWebhookSignature/processWebhookEvent를 customSelfHostedAdapter에 위임.
4. 신규 `utils/register-providers.ts`: cafe24·naver·custom·gabia·godo + 스켈레톤 5종을 한 곳에서 register. `app.ts` 부팅 시 import(routes/cdp.ts 부수효과 의존 제거 → gap 7 해결). routes/cdp.ts의 개별 client import는 제거 또는 register-providers 경유.
5. 신규 `GET /api/cdp/providers`(authenticate) → `listProvidersForUI()` 반환.
6. 프론트 `CdpSettingsPage.tsx`: PROVIDER_CARDS 하드코딩 폐기 → 마운트 시 `GET /api/cdp/providers` 로드해 카드 렌더. 카드 클릭 모달은 `connectMethod`로 분기(oauth=cafe24/naver, polling=godo, webhook=gabia/custom). coming_soon 카드는 "곧 출시" 비활성 표시. **메모리 feedback_ui_simplify_not_empty 정합 — 카드 그리드 + 업체별 모달 유지.**

**테스트**: listProvidersForUI가 available/coming_soon 정확 분류(고도몰 available, 스켈레톤 coming_soon) verify.
**리스크**: 프론트 동적 로딩 전환 — 로드 실패 시 빈 화면 방지(폴백: 최소 카페24·네이버 표시 또는 에러 배너). 기존 모달 분기 로직 보존.

---

## Phase C — 데이터 정합 / 하드닝 (낮음 갭)

### C8. bulk-import truncation 경고 (gap 8)
**문제**: `cdp-orders.ts bulkImport`가 `customers/orders`를 `.slice(0, 1000)`로 조용히 자름 — 초과분 무경고 드롭.
**설계**: `BulkImportResult`에 `customersTruncated: boolean`, `ordersTruncated: boolean`, `droppedCustomers: number`, `droppedOrders: number` 추가. 라우트 응답에 노출 + 1000 초과 시 경고 메시지(`warning` 필드). silent drop 폐기.
**테스트**: 1000 이하 truncated=false / 초과 truncated=true + dropped 수.

### C5. occurred_at 클램프 (gap 5)
**문제**: `cdp-events.ts` trackEvent/ingestBrowserEvents가 자사몰 전송 시각을 그대로 신뢰 — 미래/먼 과거 미보정 → 커서·통계 왜곡 가능.
**설계**: 순수 함수 `clampOccurredAt(raw: string|Date|undefined, now: Date): Date`
  - 파싱 실패 → now
  - now+5분 초과(미래) → now (시계 오차 허용 5분)
  - now-365일 미만(먼 과거) → 그대로 두되 로그(과거 마이그레이션 정상 케이스라 차단 X) — 미래만 클램프
- 새 파일 `utils/cdp-occurred-at.ts`(순수) + verify. trackEvent + ingestBrowserEvents 적용.
**테스트**: 정상 통과 / 미래 클램프 / 파싱 실패 now / 과거 통과.

### C6. 버스트 rate limit (gap 6)
**문제**: 월 한도만 통제 — 초당/분당 폭주 방어 없음.
**설계**: 회사별 슬라이딩 윈도우(프로세스 메모리) 미들웨어 `cdpBurstLimit(maxPerWindow, windowMs)` — CDP write(identify/event/order/ingest)에 적용. 초과 시 429 `code:'RATE_LIMITED'`. 기본값 예: 회사당 50req/10초(구현 시 보수적 시작). 메모리 기반이라 pm2 인스턴스별이지만 폭주 1차 방어로 충분. 순수 카운터 로직 분리 + verify.
**리스크**: 정상 bulk/대량 sync가 막히지 않게 한도 보수 설정 + bulk-import는 제외(이미 월 한도/1000건 캡).

---

## Phase D — 여정 트리거 변수 확장 (gap 1)

**문제**: `journey-cdp-cursor.ts resolveCdpCursorEventName`의 커서 경로(진입 이벤트 properties를 알림톡/문자 변수로 동봉, D232 정확히 1회)가 `purchase`·`reservation_created`·`custom_order_shipped` 3종 + cart_abandon(별도 보강)만. 그 외 트리거는 enqueueCandidates(properties NULL).

**설계**:
1. 여정 트리거 전수 분류표 작성(구현 첫 단계): 각 trigger가 **이벤트성**(진입 cdp_event + 치환 가치 있는 properties 보유)인지 **상태성**(휴면/생일/포인트 등 — 진입 이벤트 없음)인지.
2. 이벤트성인데 커서 경로 밖인 trigger만 `resolveCdpCursorEventName`에 추가(event_name 매핑) + extractor case + 게이팅. D232 "정확히 1회 + 커서 전진" 의미 보존.
3. 상태성 trigger는 진입 이벤트 변수가 원천적으로 없음 → 한계를 문서에 명시(설계상 정상).
**리스크**: 여정 엔진(journey-trigger-watcher/executor) 회귀가 가장 큰 위험 → phase D는 별도 회귀 검증(여정 vitest + 실측 1건) 단계 포함. 분류 결과 추가 대상이 0건이면 "현행이 이미 충분"으로 종결(문서만).

---

## Phase E — 문서 정합 (gap 9)

- `docs/AI_OPERATOR_기능정의서.md` §8-2 자사몰 통합 매트릭스: 실제(cafe24 OAuth · naver OAuth · 고도몰 폴링 · 자체호스팅 webhook · 가비아 webhook + 스켈레톤 5종)로 갱신.
- `provider-registry.ts` 상단 주석(등록된 Provider 목록) 실제와 일치.
- `status/SCHEMA.md`: A4의 `cdp_identity_review` 신규 테이블 기록(생성 시).

---

## 구현 순서 / 검증

1. **A → B → C → D → E** 순서. A·B가 사용자 영향 큼.
2. 각 순수 함수는 RED→GREEN verify 먼저. DB 마이그레이션(A4 cdp_identity_review)은 information_schema 확인 후 CREATE(0번 원칙).
3. phase 종료마다 backend tsc 0 + 전체 vitest 회귀. 프론트(B) tsc 0 + 모델명/native dialog 자가 grep.
4. 돈/발송 닿는 A1·D는 실측 1건 시나리오 보고.
5. provider 추가(B)·DB 변경(A4)은 codex adversarial-review 권장.

## 범위 밖 (이번 X)
- Shopify/메이크샵/imweb/식스샵/우커머스 실제 어댑터 구현(Phase 2 — 실 도입 고객 생기면 별도).
- identity 자동 병합 도구(충돌은 플래그만, 병합 UI는 후일).
- CDP 분산(다중 PM2) 공유 rate limit(메모리 1차 방어로 시작).

## 파일 맵 (예상 변경)
- 신규: `utils/cdp-phone-sync.ts`, `utils/cdp-occurred-at.ts`, `utils/register-providers.ts`, 각 `__tests__/*.verify.ts`
- 수정: `utils/cdp-identity.ts`, `utils/cdp-events.ts`, `utils/cdp-orders.ts`, `utils/provider-registry.ts`, `utils/cafe24-client.ts`/`naver-commerce-client.ts`/`custom-self-hosted-adapter.ts`(connectMethod/available 필드), `routes/cdp.ts`(GET /providers + burst limit), `routes/godo.ts`(어댑터 연계), `app.ts`(register-providers import), `packages/frontend/src/pages/CdpSettingsPage.tsx`
- DB: `cdp_identity_review` CREATE(A4)
- 문서: 기능정의서 §8-2, provider-registry 주석, SCHEMA.md
