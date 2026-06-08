# CDP 페이지 재설계 — 구현 Plan

> **For agentic workers:** 이 세션에서 executing-plans inline으로 task별 구현(CLAUDE.md no_parallel — subagent 병렬 금지). 체크박스로 추적. 각 모달은 기존 섹션 JSX를 그대로 옮기고 데이터/state를 재사용한다(신규 데이터 0).

**Goal:** `CdpSettingsPage.tsx`(1596줄·13섹션)를 메인 요약 + 4개 상세 모달로 단순화하고, 게이팅을 전 유료(STARTER+)로 일치, "지원 자사몰 매트릭스" 나열을 "어떤 자사몰이든 연동" 안내로 교체한다.

**Architecture:** 단일 파일 재배치. 기존 state(usage/diagnostics/funnel/timeline/activeCustomers/channelDist/explanation/cafe24/naver/providers/customInfo 등)·API(`loadAll` 10 fetch)·헬퍼(issueKey/addOrigin 등)는 전부 보존. PerformancePage의 모달 패턴(`activeModal` state + 칩 클릭 → `CdpModal`) 도입. 신규 백엔드 0 — 게이팅은 `usage.plan_code`(이미 존재) 프론트 판정.

**Tech Stack:** React + TS, lucide-react, 기존 ConfirmModal/useToast(native dialog 금지), createPortal(모달은 헤더 backdrop-filter 밖 렌더 — 성과리포트 교훈).

**절대 전제:** 데이터 목업 → frontend tsc 0 + grep 0 + 모달 동작만 검증. 모델명/native/박-단어 0. 다크 톤(slate-950+violet). 모바일 반응형.

---

## File Structure

- **Modify:** `packages/frontend/src/pages/CdpSettingsPage.tsx` (메인 + 인라인 모달 — PerformancePage와 동일 단일파일 패턴)

현재 섹션 line: ①헤더 738 / ②게이팅 766 / ③데이터부족 777 / ④AI진단 816 / ⑤1-click 843 / ⑥5metric 870 / ⑦자세히분석 884(funnel 900·24h 921·매핑률 939·격차 963·webhook 978·채널 999) / ⑨영향요인 1043 / ⑩활성customer 1081 / ⑪Provider매트릭스 1135 / ⑫키발급 1318 / ⑫-0 도메인 1367 / ⑫-1 SDK스니펫 1411 / ⑫-2 검증 1441 / ⑬컴퓨팅시점 1485.

---

## Task 1: 게이팅 판정 전 유료 일치 (FREE만 차단)

**Files:** Modify `CdpSettingsPage.tsx`

- [ ] **Step 1:** 컴포넌트 본문(usage state 근처)에 판정 헬퍼 추가. `usage.cdp_enabled`(plans 플래그, BUSINESS+) 의존을 제거하고 `plan_code`로 판정.

```tsx
// CDP 진입 가능 = FREE(미가입)만 차단 (백엔드 cdp-auth.isCdpEnabledForPlan = plan_code !== 'FREE'와 일치)
const cdpLocked = !!usage && usage.plan_code === 'FREE';
```

- [ ] **Step 2:** `!usage?.cdp_enabled`(섹션 ② 767) → `cdpLocked`, `usage?.cdp_enabled`(섹션 ④ 817 등) → `!cdpLocked`로 전수 교체. grep `cdp_enabled` in CdpSettingsPage.tsx로 사용처 전부 확인 후 일괄.

- [ ] **Step 3:** 게이팅 안내 문구(771~772) 교체 — "비즈니스 요금제 의무" 제거.

```tsx
<div className="font-bold text-amber-100 mb-1">CDP는 유료 요금제부터 이용 가능합니다</div>
<div className="text-sm text-amber-200">스타터 요금제 이상에서 자사몰 연동(SDK·webhook)이 모두 열립니다. 현재: {usage?.plan_name || '미가입'}.</div>
```

- [ ] **Step 4:** 검증 `cd packages/frontend && npx tsc --noEmit` → EXIT 0. grep `cdp_enabled` 잔존이 의도(usage 타입 필드)만인지 확인.

---

## Task 2: "지원 자사몰 매트릭스" 제거 + "어떤 자사몰이든 연동" 안내 카드

**Files:** Modify `CdpSettingsPage.tsx` (섹션 ⑪ 1135~1317 영역 중 매트릭스 나열 카드)

- [ ] **Step 1:** 섹션 ⑪ Provider 매트릭스의 **나열 카드**(Shopify·메이크샵·imweb·식스샵·WooCommerce "Phase 2 예정" + 카페24·네이버·자체호스팅 그리드)를 제거. 실제 연동 동작(cafe24/naver/custom 연동 버튼·키·도메인)은 Task 5 Provider 모달로 이동하므로 여기선 나열 그리드만 삭제.

- [ ] **Step 2:** 메인에 안내 카드 신규(게이팅 안내 아래). 연락처는 미결 → 구현 중 Harold 제공값으로 치환(임시 placeholder 표기).

```tsx
<div className="bg-white/5 border border-white/10 rounded-xl p-5 flex items-start gap-3">
  <Database className="w-5 h-5 text-violet-300 mt-0.5 shrink-0" />
  <div>
    <div className="font-semibold text-white mb-1">어떤 자사몰이든 연동해 드립니다</div>
    <div className="text-sm text-white/70 leading-relaxed">표준 SDK·webhook로 대부분 바로 연동됩니다. 특수한 환경이라 연동이 막히면 개발 담당자가 <span className="text-violet-200">[문의 연락처]</span>로 문의 주시면 직접 맞춤 연동을 도와드립니다.</div>
  </div>
</div>
```

- [ ] **Step 3:** tsc 0 + grep `Phase 2|식스샵|메이크샵|WooCommerce` 잔존 0 확인.

---

## Task 3: 모달 인프라 (CdpModal + activeModal + 요약 칩 바)

**Files:** Modify `CdpSettingsPage.tsx`

- [ ] **Step 1:** `activeModal` state + 타입 추가.

```tsx
type CdpModalKey = null | 'diagnosis' | 'analytics' | 'provider' | 'customers';
const [activeModal, setActiveModal] = useState<CdpModalKey>(null);
const closeModal = () => setActiveModal(null);
```

- [ ] **Step 2:** `CdpModal` 인라인 컴포넌트 신설(PerfModal 패턴 — createPortal로 body 렌더, 다크 톤). 파일 상단 import에 `import { createPortal } from 'react-dom';` 추가.

```tsx
function CdpModal({ open, onClose, title, icon, children }: { open: boolean; onClose: () => void; title: string; icon: React.ReactNode; children: React.ReactNode }) {
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 py-8 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-3xl bg-slate-900 border border-white/10 rounded-2xl shadow-2xl my-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10 sticky top-0 bg-slate-900 rounded-t-2xl">
          <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">{icon}</div>
          <div className="text-sm font-semibold text-white">{title}</div>
          <button onClick={onClose} className="ml-auto p-1 hover:bg-white/10 rounded-lg" aria-label="닫기"><X className="w-4 h-4 text-white/40" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 3:** 메인 요약 칩 바 추가(5 metric 아래). 각 칩 클릭 → `setActiveModal`.

```tsx
<div className="flex gap-2 flex-wrap">
  {[
    { k: 'diagnosis', label: 'AI 진단', icon: <Sparkles className="w-3.5 h-3.5" /> },
    { k: 'analytics', label: '데이터 분석', icon: <BarChart3 className="w-3.5 h-3.5" /> },
    { k: 'provider', label: '자사몰 연동', icon: <Database className="w-3.5 h-3.5" /> },
    { k: 'customers', label: '활성 고객', icon: <Users className="w-3.5 h-3.5" /> },
  ].map((c) => (
    <button key={c.k} onClick={() => setActiveModal(c.k as CdpModalKey)} disabled={cdpLocked}
      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[12px] text-white/70 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
      {c.icon}{c.label}
    </button>
  ))}
</div>
```

- [ ] **Step 4:** tsc 0.

---

## Task 4: AI 진단 모달 (섹션 ④ + ⑨ 이동)

**Files:** Modify `CdpSettingsPage.tsx`

- [ ] **Step 1:** 섹션 ④(AI 진단 816~842)·⑨(영향요인 1043~1080) JSX를 `<CdpModal open={activeModal==='diagnosis'} ... title="AI 진단">` 안으로 이동. `loadExplanation`은 모달 open 시 호출(useEffect: `if (activeModal==='diagnosis') loadExplanation();`).
- [ ] **Step 2:** 메인의 옛 ④·⑨ 인라인 제거.
- [ ] **Step 3:** tsc 0 + 모델명 grep 0(AI 진단 텍스트 — 추상 명칭만).

---

## Task 5: Provider 연동 모달 (섹션 ⑪ 연동부 + ⑫·⑫-0·⑫-1·⑫-2 이동)

**Files:** Modify `CdpSettingsPage.tsx`

- [ ] **Step 1:** `<CdpModal open={activeModal==='provider'} title="자사몰 연동">` 안에 순서대로 이동: 자체호스팅 webhook 연동(custom)·카페24 OAuth·네이버 OAuth 연동 버튼/상태(섹션 ⑪의 실제 동작부) → 키 발급(⑫)·도메인 등록(⑫-0)·SDK 스니펫(⑫-1)·설치 검증(⑫-2).
- [ ] **Step 2:** 메인의 옛 ⑫~⑫-2 인라인 제거(이미 ⑪ 나열은 Task 2에서 삭제).
- [ ] **Step 3:** tsc 0 + native dialog grep 0(키 재발급은 기존 ConfirmModal 유지).

---

## Task 6: 데이터 분석 모달 (섹션 ⑦ + ⑬ 이동) + 활성 customer 모달 (섹션 ⑩ 이동)

**Files:** Modify `CdpSettingsPage.tsx`

- [ ] **Step 1:** `<CdpModal open={activeModal==='analytics'} title="데이터 분석">`에 섹션 ⑦(funnel 900·24h 921·매핑률 939·격차 963·webhook 978·채널 999)·⑬(컴퓨팅 시점 1485) 이동. 기존 `detailsExpanded` 토글 제거(모달이 대체).
- [ ] **Step 2:** `<CdpModal open={activeModal==='customers'} title="활성 고객">`에 섹션 ⑩(활성 customer 1081) 이동.
- [ ] **Step 3:** 메인의 옛 ⑦·⑩·⑬ 인라인 + `detailsExpanded` state·토글 제거.
- [ ] **Step 4:** tsc 0.

---

## Task 7: 메인 정리 + 죽은 코드 제거

**Files:** Modify `CdpSettingsPage.tsx`

- [ ] **Step 1:** 메인 최종 순서 확인: 헤더 → 게이팅 안내(Task1) → "어떤 자사몰이든 연동" 안내(Task2) → 데이터부족 critical 카드(③ 축약) → 연동 1-click 3(⑤) → 5 metric(⑥) → 요약 칩 바(Task3). 모달은 return 말미(헤더 밖).
- [ ] **Step 2:** 미사용 state(`detailsExpanded` 등)·import·죽은 JSX grep으로 잔존 0 확인.
- [ ] **Step 3:** frontend tsc 0.

---

## Task 8: 통합 검증

- [ ] **Step 1:** `cd packages/frontend && npx tsc --noEmit` → EXIT 0.
- [ ] **Step 2:** 자가 grep 0: `박[음힘는을힌지혀힙히혔힐았]|Opus|Sonnet|Haiku|Claude|Anthropic|alert\(|confirm\(|prompt\(` in CdpSettingsPage.tsx.
- [ ] **Step 3:** grep `cdp_enabled` 잔존 = usage 타입 필드/주석만(게이팅 판정은 plan_code).
- [ ] **Step 4:** 모달 동작 — 칩 4개 클릭 시 각 모달 open/close(배포 후 Harold 확인, 코드상 activeModal 분기 일관).

---

## Task 9: SDK 자사몰 연동 소스 재점검 (UI 완료 후 별도 — Harold 명시)

**Files:** Read/점검 `routes/cdp.ts`·`utils/cdp-auth.ts`·`routes/cafe24.ts`·`routes/naver-commerce.ts`·SDK 스니펫·webhook 수신부

- [ ] **Step 1:** `cdp.ts` 점검 — usage·키 발급·allowed-origins·install-status·explain·diagnostics·funnel 등 endpoint: 게이팅 일관(plan_code≠FREE), DB ALTER 컬럼 `does not exist` 503 분기, 에러 처리.
- [ ] **Step 2:** `cdp-auth.ts` — 이벤트 월 한도·격리·서명 검증.
- [ ] **Step 3:** Provider webhook(카페24·네이버·자체호스팅) — 외부 응답 raw 검증(추측 차용 X·`feedback_external_api_response_verification`), 중복(idempotent) 처리.
- [ ] **Step 4:** SDK 스니펫 — public key 주입·Origin allowlist·이벤트 전송 안전.
- [ ] **Step 5:** 발견 이슈를 Harold께 보고 → 동의 후 fix(별도 task).

---

## 배포 (Task 8 통과 후)

```
tp-push "CDP 페이지 재설계 — 메인 요약+4 모달, 게이팅 전 유료(STARTER+) 일치, 지원 자사몰 매트릭스 제거→안내 카드"
cd /home/administrator/targetup-app && git pull
cd /home/administrator/targetup-app/packages/frontend && npm run build:safe
```

(usage API 무수정 → backend 빌드 불요. Task 9에서 backend fix 발생 시 backend build:safe + pm2 restart all 동반.)
