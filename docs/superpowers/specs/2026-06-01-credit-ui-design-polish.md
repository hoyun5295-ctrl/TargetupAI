# 종량제 크레딧 UI 디자인 폴리시 (다음 세션 전용 — 완료 후 본 파일 제거)

> 2026-06-01 작성. 종량제 크레딧 시스템(Phase 3 plan-guard + Phase 4/5 backend·endpoint + 슈퍼관리자 크레딧 패널 + PricingPage 크레딧 + Dashboard 크레딧 + plans UPDATE + reason ALTER)은 **구현·배포 완료, 정상 작동**(엔터프라이즈 7,000 크레딧 표시 확인).
> 이 문서 = 남은 **디자인 균형/현대화 폴리시**만. 다음 세션이 그대로 구현 → tsc → 자가 grep → tp-push 통합 배포 → **완료 후 본 .md 삭제.**
> ★ 진행 원칙: 화면을 직접 못 보니, 코드로 균형 잡고 Harold님이 스샷으로 최종 확인하는 반복. 한 번에 다 고친 뒤 배포 1회.

---

## 0. 아키텍처 (★ 패키지 혼동 방지 — 이번 세션 최대 삽질 지점)

- **`packages/frontend`** = 메인 대시보드 + 서비스 사용자 + 슈퍼관리자 (hanjul.ai, sys.hanjullo.com). **고객사 관리자든 사용자든 다 여기서 일함.** `Dashboard.tsx` / `PricingPage.tsx` / `AiOperatorPage.tsx` / `AdminDashboard.tsx` 전부 여기. 크레딧 UI = 전부 이 패키지.
- **`packages/company-frontend`** = 메인 헤더의 **"관리" 링크로 들어가는 고객사 관리자 전용 페이지만** (app.hanjul.ai, `CompanyDashboard.tsx` 단일 + 탭). **크레딧 UI 대상 아님.**
- nginx: hanjul.ai·sys.hanjullo.com → `frontend/dist` / app.hanjul.ai → `company-frontend/dist`.
- ★ 번들 난독화(`vite-plugin-javascript-obfuscator`) — 빌드 산출물을 grep해도 URL/한글 문자열이 인코딩돼 안 잡힘. **배포 반영 확인은 화면(시크릿창) 또는 raw 문자열(`/api/plans` 등)로만.** "grep 0건 = 미배포" 오판 금지.
- ★ Harold님 보고(안 보인다 등)는 단어 그대로 인정 — 번들 grep으로 반박 금지(user_truth_acceptance).

---

## 1. 이미 코드 완료 (로컬 미배포 — 다음 세션이 배포 + 폴리시)

- **Dashboard.tsx**: 맨 위 큰 CreditGauge 카드 제거 → **발송 현황 카드 안 "AI 크레딧 잔여 N (기본/구매/이번달 사용)" 한 줄**(compact, 클릭 시 `/pricing`). 선불·후불 모두 표시. CreditGauge import 제거. tsc 0.
- **AdminDashboard.tsx**: 고객사 상세 모달 **"AI설정" 탭 → "크레딧 💳" 탭** 전환 + 크레딧 패널(현황·지급/차감·이력·후불 한도) 그 탭 최상단 이동, 기존 AI 타겟 전략은 하단 "AI 타겟 전략 (고급)"으로 보존. tsc 0.

→ 이 두 개 + 아래 2번 폴리시를 **한 번에** tp-push + frontend build:safe.

---

## 2. 디자인 폴리시 태스크 (다음 세션 구현)

### 2-1. AI Operator 페이지 우측 상단 크레딧 (Harold 명시)
- `AiOperatorPage.tsx` 히어로/헤더 **우측 상단**에 컴팩트 크레딧 표시 추가. **다크/violet 색감 일치**(bg-white/10 + border-white/10).
- `GET /api/companies/my-credit` fetch → `CreditGauge variant="dark" compact` 또는 간결 chip("AI 크레딧 7,000 · 이번달 N · 충전 문의").
- 위치: "Enterprise Beta · Production 검증 중" 배지 줄 우측, 또는 헤더 absolute top-right. 과하지 않게.

### 2-2. PricingPage 상단 크레딧 영역 컴팩트화
- 현재: CreditGauge(큰 게이지) + "작업당 크레딧" 카드 2개 grid = **과하게 큼**(Harold 지적).
- 목표: **한 줄 컴팩트 요약 바** — 좌측 "AI 크레딧 7,000 (기본 N · 구매 N · 이번달 N)" + 우측 인라인 "작업당 풀분석20·여정10·DM5·생성3·문안2·다듬기1" + 작은 "충전 문의" 버튼. 높이 절반 이하. CreditGauge 큰 변형 대신 인라인 바.

### 2-3. 요금제별 기능 재정리 (PricingPage `getPlanFeatures`)
- 종량제 = AI 기능 **전 플랜 공통(크레딧으로 통제)**. "AI 타겟 추천=베이직부터" 같은 기존 tier 차등 표기 제거(이제 틀림).
- 각 카드: "월 AI 크레딧 N (만원당 M)" 유지 + 공통 **"AI 전 기능 — 크레딧으로 사용"** 1줄 + **플랜 고유 차이만** 표기:
  - 스타터: 관리 DB 10만 · 기본 SMS/LMS/MMS · 엑셀 AI매핑 · 스팸필터
  - 베이직: 30만 · 대행발송 서비스
  - 프로: 100만 · 자동마케팅 + 성과분석·리타겟팅 + 모바일 DM
  - 비즈니스: 300만 · 자동마케팅 다수 + 고급 분석 + 전담매니저
  - 엔터프라이즈: 무제한 · 온프레미스 + SLA + 커스텀·24/7
- ★ 위 문구는 案 — Harold님 최종 확정/수정 후 적용.

### 2-4. 슈퍼관리자 크레딧 패널 현대화 (AdminDashboard 크레딧 탭)
- 현재 보라 박스 = 기본형. 톤 정리: 총 잔여 큰 숫자 + 게이지 바 + 지급/차감/이력/후불 한도 깔끔 배치. CreditGauge 재사용 검토.

### 2-5. 전체 균형
- 크레딧 카드/모달이 과하게 크지 않게 — 기존 카드들과 높이·여백·색감 균형. AI 여정(Journey Builder) 동급 + 다크/violet 일관. native dialog 0.

---

## 3. 검증 / 배포 (다음 세션 종결)
- frontend tsc 0 + 자가 grep (`박[음힘는을힌지혀힙히혔힐았혀]|옛|진정|정합|매트릭스|영영|본격`, 모델명, native dialog) 0건.
- tp-push + frontend `build:safe` + pm2 restart all. (백엔드 미변경이면 frontend만.)
- 시크릿창으로 확인(캐시 우회).
- 완료 후 **본 .md 삭제** + STATUS/메모리 최종 갱신.

---

## 4. 참고 (이번 세션 종결 상태)
- 배포 완료·작동: plan-guard 전 유료 개방 + cdp-auth 전 유료 + 크레딧 차감 엔진 + my-credit/admin credit endpoint + 슈퍼관리자 크레딧 패널 + PricingPage 크레딧(게이지·작업당·요금제별 월크레딧) + plans.ai_credits_per_month 값 + ai_credit_transactions.reason ALTER.
- 미배포 로컬(1번): Dashboard 컴팩트 + AdminDashboard 크레딧 탭.
