# 04 한줄전단AI 압도적 1위 마스터 플랜 (hanjulDM)

> **작성일:** 2026-05-12 (D152)
> **작성자:** 비토 (Opus 4.7) + Harold
> **기준 자료:**
>   - `01_market_research_master_prompt.md`
>   - `02_current_features.md` (한줄전단 현재 코드 정독)
>   - `03_consolidated_analysis.md` (GPT 기획안 + Gemini 리서치 통합 1차)
>   - GPT 기획안 PDF (`한줄전단AI_압도적_1위_기술업그레이드_기획안.pdf`, 18p)
>   - Gemini 리서치 PDF (`마트 AI 솔루션 시장 리서치.pdf`, 13p)
>   - grep 5차 결과 (분리 범위 100% 식별)
> **목적:** 한줄전단AI를 마트·정육·식자재·과일·수산 시장에서 절대 1위로 만들 90일 + 12개월 실행 계획

---

## 0. 비토 결론 — 전단 결과물이 모든 무기의 전제

GPT 기획안 12티켓 + Gemini 검증 + Harold님 5강점 통합 결과:

1. **"괴물 한줄전단AI" 정의** = 사장님이 처음 받는 결과물(URL 페이지 + AI 자동 전단)이 외주 디자이너보다 압도적으로 예쁘다 + POS Agent가 점주 동의 하나로 어떤 POS든 직접 연결 + 30억 건 발송로그·Outside DB로 매장 밖 잠재고객까지 도달 + POS 매출 귀속으로 ROI 폐회로 증명 + 한줄로 본진 6,000사 GTM으로 영업 비용 0원에 가까운 초기 50사 확보
2. **PHASE 0 (D153~D157, 14일)** = 전단 결과물 압도. 이게 안 되면 POS Agent·RFM·ROI·Outside DB 다 무의미.
3. **PHASE 1 (D158+, 60일)** = 7대 무기 본격 진입. PHASE 0 통과 후만.
4. **분리 작업** = D153~D154 인프라 작업으로 동시 진입. PHASE 0 트랙 A와 충돌 0건.

**1위 포지셔닝 문장 (GPT 기획안 14-1 채택)**:
> "전단은 누구나 만들 수 있습니다. 하지만 한줄전단AI는 실제로 팔릴 상품을 고르고, 팔릴 고객에게 보내고, 팔렸는지 POS로 증명합니다."

---

## 1. ★ PHASE 0 — 전단 결과물 압도 (D153~D157, 14일 집중)

다른 모든 작업 정지. PHASE 0 완료 정의 통과 못하면 PHASE 1 진입 X.

### 1-1. 트랙 A: `hanjul-flyer.kr/{code}` URL 페이지 퀄리티

**대상:** 고객이 카톡/문자로 받아 첫 0.5초에 보는 것. 사장님이 발송 전 "이거 진짜 멋있다" 느끼는 것.

**현재 상태:** `utils/flyer/product/flyer-templates.ts` + `flyer-pop-templates.ts` 기반 React JSX 정적 21종 템플릿(grid/magazine/editorial/showcase/highlight + 시즌5 + 행사4 + 마트4 + 정육3). 1차원적 슬롯 채움.

**목표 작업:**
- Claude Design 통합 디자인 시스템으로 무한 동적 생성
- 모바일 풀스크린 + 애니메이션(Framer Motion) + 인터랙션 + 시즌/업종/이벤트별 다이나믹 레이아웃
- 카톡 첫 0.5초 임팩트: 히어로 비주얼 + 가격 강조 + CTA 명확
- 단축 URL 메타태그(og:image, og:title, og:description) 자동 생성으로 카톡 인박스 미리보기 압도

**구현 위치:** `hanjulDM/backend/src/utils/flyer/product/print/renderer/template-registry.ts` 확장 + 신규 `claude-design-renderer.ts`

### 1-2. 트랙 B: AI 자동 생성 전단 퀄리티

**대상:** 엑셀/POS/사진 1개 입력 → 즉시 디자이너급 결과물 생성.

**현재 상태:** 21종 중 1개 선택 + 슬롯 채움. 매번 비슷한 결과.

**목표 작업:**
- Claude Design + Opus 4.7 동적 생성
- 매번 다른 디자인 — 업종·시즌·상품·가격대·이벤트 조합별 최적 레이아웃·컬러·타이포 자동 선택
- 네이버 쇼핑 이미지 자동 매칭(현재 CT-F17) + 자동 보정(rembg + 색 보정) + 시즌 컬러 시그널 자동 + AI 카피 4종 자동 통합

**구현 위치:** `hanjulDM/backend/src/utils/flyer/product/flyer-templates.ts` 동적 분기 + `flyer-ai-copy.ts` 통합 호출

### 1-3. 6매체 동일 디자인 토큰

**대상 매체 6개:**
1. 디지털 URL 페이지 (`hanjul-flyer.kr/{code}`)
2. 인쇄 A3 PDF (CT-F14 + D129 V2 `paged-pdf.ts`)
3. POP 3종 (price/multi/promo)
4. MMS 이미지
5. 카카오 알림톡 첨부 이미지
6. 카카오 브랜드메시지 랜딩 페이지

**원칙:** 같은 디자인 토큰(color hex, spacing scale, typography, brand voice)을 6개 매체에 동일 적용. 사장님이 인쇄해서 매장 벽에 붙여도 디지털과 일관된 디자이너급.

**구현 위치:** `hanjulDM/backend/src/utils/flyer/design-tokens.ts` 신규 + 6개 렌더러에서 동일 토큰 import

### 1-4. 현장 검증 기준

PHASE 0 완료 검증 = 다음 5점 척도 모두 4.0 이상:

| 검증자 | 검증 항목 | 통과 기준 |
|--------|---------|---------|
| Harold | 첫 0.5초 임팩트 | 4.0/5.0 이상 |
| 비토 | 6매체 일관성 | 4.0/5.0 이상 |
| 인비토 직원 3인 | 디자이너급 인식도 | 평균 4.0/5.0 이상 |
| 실제 마트 사장 1인 (블라인드) | "외주보다 낫다" 인식 | "그렇다" 명시 |
| 실제 마트 고객 5인 (블라인드) | "전단지 클릭해서 보고 싶다" | 5인 중 4인 이상 "예" |

### 1-5. PHASE 0 완료 정의

위 5건 모두 통과 + 빌드 100% 정상 + 발송 검증 완료 = PHASE 0 완료. 이후 PHASE 1 진입.

---

## 2. 분리 작업 (D153~D154 인프라 작업, PHASE 0와 동시 진입)

### 2-1. Harold님 확정 5건 (2026-05-12)

| # | 항목 | 확정 |
|---|------|------|
| 1 | DM Builder 처리 | 한줄AI 본진에 남기고 `hanjul.ai/d/{code}` 별도 단축 도메인. `hanjul-flyer.kr/{code}`는 flyer 전용 |
| 2 | hanjulDM 폴더 위치 | `C:\Users\ceo\projects\hanjulDM\` (한줄로 형제 폴더, git 별도 레포) |
| 3 | 백엔드 + 빌드 + 배포 완전 독립 | 같은 서버 다른 포트(3000/3001) + 별도 safe-build + 별도 PM2 프로세스명 + 별도 PowerShell 함수(`tp-push` vs `hdm-push`) + 별도 nginx config + 별도 서버 디렉토리 + 별도 .env + 별도 monitor-dist cron + internal-alert SMS 메시지 접두사 구분 |
| 4 | 슈퍼관리자 분리 | `sys.hanjullo.com` (한줄AI, 그대로) + `admin.hanjuldm.kr` (hanjulDM 신규). 별도 로그인. SSO 없음 |
| 5 | DB 분리 정책 | 같은 PG 인스턴스 유지. `flyer_*` 테이블 그대로 (마이그레이션 0). 영역만 격리. QTmsg MySQL·카카오 IMC·결제 PG도 동일 인스턴스 영역만 격리 |

### 2-2. 분리 핵심 원칙

**"코드는 복제로 영구 완전 독립. 인프라는 같은 인스턴스, 영역만 격리."**

- 한줄전단AI 작업 → 한줄AI 상용 서비스 영향 0건
- 한줄AI 작업 → 한줄전단AI 영향 0건
- 1년/3년 후 두 코드 완전 독립 진화. sync 시도 = 분리 목적 깨는 것 = 0건
- 비토와 Harold님이 hanjulDM을 매일 손대도 한줄AI 6,000사+ 상용 서비스 흔들림 0건

### 2-3. 폴더 구조

```
C:\Users\ceo\projects\hanjulDM\
├── .claude/                              # 자체 settings.json + permissions
├── .gitignore
├── package.json (workspaces: backend, frontend, admin-frontend, pos-agent)
├── tsconfig.json
├── safe-build.sh                         # atomic 안전망 자체 작성
├── monitor-dist.sh                       # 1분 cron 자체 작성
├── ecosystem.config.js                   # PM2 자체 (프로세스명: hanjuldm-api)
├── status/                               # 자체 status 문서
│   ├── CLAUDE.md                         # hanjulDM 전용 끌로드원칙
│   ├── LESSONS_LEARNED.md
│   ├── STATUS.md
│   ├── BUGS.md
│   ├── OPS.md
│   ├── SCHEMA.md
│   └── hanjul-flyer-revamp/              # 본 04 마스터 플랜 이전
├── packages/
│   ├── backend/                          # Node + Express + flyer 라우트/CT-F
│   │   └── src/
│   │       ├── app.ts                    # 신규 작성 (flyer만 마운트, port 3001)
│   │       ├── config/
│   │       │   ├── database.ts           # 본진 복제
│   │       │   └── defaults.ts           # 본진 복제
│   │       ├── middlewares/
│   │       │   └── flyer-auth.ts         # 본진에서 이전 (flyer 전용)
│   │       ├── services/
│   │       │   └── ai.ts                 # 본진 복제 (callAIWithFallback)
│   │       ├── utils/
│   │       │   ├── normalize-phone.ts    # 본진 복제
│   │       │   ├── product-images.ts     # 본진 복제
│   │       │   └── flyer/                # 한줄AI utils/flyer 이전 (37개)
│   │       └── routes/
│   │           ├── flyer/                # 한줄AI routes/flyer 이전 (17개)
│   │           └── admin/
│   │               └── flyer-admin.ts    # 한줄AI에서 이전
│   ├── frontend/                         # flyer-frontend 이전 (24개)
│   ├── admin-frontend/                   # FlyerAdminDashboard.tsx 이전 + 신규 골격
│   └── pos-agent/                        # 한줄AI pos-agent 이전 (9개 모듈)
└── nginx-config/
    └── hanjuldm                          # nginx site config
```

### 2-4. 빌드·배포 완전 독립 매트릭스

| 영역 | 한줄AI (그대로) | hanjulDM (신규) |
|------|-------------|---------------|
| 소스 git 레포 | targetup | hanjulDM (별도) |
| 빌드 스크립트 | `safe-build.sh` (3패키지) | `safe-build.sh` 자체 (4패키지: backend, frontend, admin-frontend, pos-agent) |
| npm 빌드 명령 | `npm run build:safe` | `npm run build:safe` 자체 |
| dist 폴더 | `packages/*/dist` | `hanjulDM/packages/*/dist` 격리 |
| monitor-dist cron | 1분 cron (한줄AI dist만 감시) | 1분 cron 별도 (hanjulDM dist만 감시) |
| PM2 프로세스명 | `targetup-api` | `hanjuldm-api` |
| PM2 ecosystem | targetup-app/ecosystem.config.js | hanjulDM/ecosystem.config.js |
| 포트 | 3000 | 3001 |
| PowerShell 배포 함수 | `tp-push` | `hdm-push` 신규 |
| internal-alert SMS | 한줄AI 배포 알림 | 같은 번호, 메시지에 `[hanjulDM]` 접두사 |
| nginx config | `/etc/nginx/sites-enabled/targetup` | `/etc/nginx/sites-enabled/hanjuldm` |
| 서버 디렉토리 | `/home/administrator/targetup-app/` | `/home/administrator/hanjuldm-app/` |
| 로그 폴더 | targetup-app/logs/ | hanjuldm-app/logs/ |
| .env | targetup-app/.env | hanjuldm-app/.env |
| atomic 안전망 사전테스트 SMS 라인 | 한줄AI SMSQ_SEND_10 | hanjulDM 자체 |

**결과 보장:**
- `hdm-push` 실행 = hanjulDM 빌드·배포 = `targetup-api` 흔들림 0건, 한줄AI dist 변동 0건
- `tp-push` 실행 = 한줄AI 빌드·배포 = `hanjuldm-api` 흔들림 0건, hanjulDM dist 변동 0건
- 한쪽 빌드 실패 = 다른 쪽 100% 정상

### 2-5. 분리 실행 순서 (D153~D154)

**Step 1 (D153 오전)**: `hanjulDM/` 폴더 골격 생성
- 폴더 구조, package.json (workspaces), tsconfig, .gitignore, .claude/, status/
- safe-build.sh, ecosystem.config.js, monitor-dist.sh 신규 작성

**Step 2 (D153 오전)**: flyer 코드 복사 (한줄AI 본진은 그대로 유지)
- `packages/backend/src/routes/flyer/` 17개 → `hanjulDM/packages/backend/src/routes/flyer/`
- `packages/backend/src/utils/flyer/` 37개 → `hanjulDM/packages/backend/src/utils/flyer/`
- `packages/backend/src/middlewares/flyer-auth.ts` → `hanjulDM/.../middlewares/flyer-auth.ts`
- `packages/backend/src/routes/admin/flyer-admin.ts` → `hanjulDM/.../routes/admin/flyer-admin.ts`
- `packages/frontend/src/pages/FlyerAdminDashboard.tsx` → `hanjulDM/packages/admin-frontend/src/pages/`
- `packages/flyer-frontend/` 전체 → `hanjulDM/packages/frontend/`
- `packages/pos-agent/` 전체 → `hanjulDM/packages/pos-agent/`

**Step 3 (D153 오후)**: 한줄AI 본진 의존 4건 복제
- `services/ai.ts` (callAIWithFallback) → `hanjulDM/.../services/ai.ts`
- `utils/normalize-phone.ts` → `hanjulDM/.../utils/normalize-phone.ts`
- `utils/product-images.ts` → `hanjulDM/.../utils/product-images.ts`
- `config/database.ts` + `config/defaults.ts` → `hanjulDM/.../config/`
- (참고) `utils/dm/dm-builder.ts` + `dm-viewer.ts` = 복제 X (한줄AI 본진에만 남김)

**Step 4 (D153 오후)**: hanjulDM `short-urls.ts` 정정
- DM Builder import 라인 13~14 제거
- 단축 URL은 flyer 전단지만 처리

**Step 5 (D154 오전)**: hanjulDM `app.ts` 신규 작성
- flyer 라우트 17개 + flyer-admin 1개만 마운트
- port 3001
- helmet 전 공개 라우트 마운트 그대로
- POS auto worker 시작

**Step 6 (D154 오전)**: hanjulDM 빌드 검증
- npm install
- safe-build.sh 실행
- dist 생성 확인
- TS error 0 확인

**Step 7 (D154 오후)**: hanjulDM 로컬 실행 검증
- pm2 start (port 3001)
- /api/flyer/auth 등 핵심 엔드포인트 헬스체크
- DB 연결 확인 (`flyer_companies` SELECT 1건)

**Step 8 (D154 오후)**: 한줄AI 본진에서 flyer 라인 제거
- `app.ts`: flyer 30+ 라인 제거 + 빌드 검증
- `routes/admin/flyer-admin.ts` 삭제
- `routes/admin/switch-service.ts` 삭제
- `middlewares/flyer-auth.ts` 삭제
- `middlewares/super-service-guard.ts` 삭제
- `frontend/src/pages/FlyerAdminDashboard.tsx` + 라우터 등록 삭제
- 한줄AI 빌드 100% 정상 확인

**Step 9 (D154 저녁)**: nginx config + 배포
- hanjulDM nginx site 추가
- 서버 디렉토리 생성
- `hdm-push` PowerShell 함수 신규
- 1차 배포 + 운영 검증

### 2-6. 분리 작업 위험 + 대응

| 위험 | 대응 |
|------|------|
| 한줄AI 빌드 깨짐 | Step 8 분리 전 atomic safe-build 1번 더 사전 검증 + dist 백업 |
| hanjulDM 빌드 실패 | atomic 안전망 = 옛 dist 유지 (이번엔 첫 빌드라 백업 dist 없음 → Step 6 빌드 성공 후만 다음 진입) |
| nginx 충돌 | hanjul-flyer.kr 도메인은 hanjulDM nginx로, 그 외 도메인은 한줄AI nginx로. 도메인 기준 분기라 충돌 0 |
| DB 영역 침범 | Step 5 app.ts에서 `flyer_*` 외 테이블 접근 0건 검증 |
| 카카오 IMC 충돌 | 같은 API 키지만 hanjulDM은 자기 회사 발신프로필만 호출 (코드 검증) |
| QTmsg 충돌 | 같은 11라인. hanjulDM 회사 ID 기준 라인그룹 분배 (CT-F01 그대로) |
| 슈퍼관리자 로그인 깨짐 | sys.hanjullo.com은 한줄AI 슈퍼관리자 그대로. admin.hanjuldm.kr 신규 별도 |

---

## 3. PHASE 1 — 7대 무기 (D158+, PHASE 0 통과 후만)

### 3-1. 7대 무기 우선순위 (Harold 5강점 + GPT 5모듈 통합)

| # | 무기 | 핵심 기능 | 우선순위 | 출처 |
|---|------|---------|-------|------|
| 1 | **POS Agent 직접연결** (협조 X) | pos-agent 1.5.4 패턴 강화 + CT-F16 AI 스키마 자동 매핑 + 어떤 POS여도 점주 동의 하나로 즉시 연결 | P0 (D158~) | Harold 1 + GPT B |
| 2 | **CT-F10 RFM 실구현** | rfm_segment 자동 계산 + 휴면·VIP·단골 자동 분류 + 스케줄러 | P0 (D158~) | GPT P0-01 |
| 3 | **One-Input Creative Factory + Campaign Autopilot** | 엑셀/POS/사진 통합 입력 + AI 캠페인 마법사 + 목표 기반 추천 + 한줄로 본진 6,000사 GTM | P0~P1 | GPT A+C + Harold 4 |
| 4 | **ROI Closed Loop** | 캠페인-클릭-쿠폰-주문-POS 매출 귀속 + ROAS 대시보드 | P0 (D161~) | GPT D |
| 5 | **Outside DB Local Ads** | POPPON·TargetUP 연동 매장 밖 잠재고객 발굴 | P2 (D183+) | GPT E + Gemini |
| 6 | **정부 스마트상점 결제 모듈** | 70~100% 지원금 500만원 한도 결제 모듈 | P1 (D175+) | Gemini |
| 7 | **한줄로 ↔ 한줄전단 분리** | (본 문서 §2에서 D153~D154 완료) | 완료 | Harold 5 |

### 3-2. GPT 12티켓 D-시리즈 매핑

PHASE 0 (D153~D157) 동안 분리(D153~D154) + PHASE 0 트랙 A/B (D153~D157). 이후 PHASE 1:

| 티켓 | 작업명 | D-시리즈 | 위치 |
|------|------|---------|------|
| P0-01 | CT-F10 RFM 구현 | D158 (14일) | `analytics/flyer-rfm.ts` |
| P0-02 | 캠페인 이벤트 표준화 | D158 (14일) | `analytics/flyer-stats.ts` + 신규 `flyer_events` |
| P0-03 | 쿠폰 클릭·스캔 연동 | D161 (7일) | `coupon/flyer-coupons.ts` |
| P0-04 | POS 매출 매칭 MVP | D161 (21일) | `pos/flyer-pos-ingest.ts` + 신규 attribution |
| P0-05 | 상품 카탈로그 완성 | D158 (10일) | `product/flyer-catalog.ts` |
| P1-06 | AI 주간 행사 추천 API | D170 (14일) | 신규 `ai/weekly-plan` |
| P1-07 | AI 타겟 추천 API | D170 (14일) | `analytics` + `send` |
| P1-08 | ResultsPage ROI 개편 | D175 (10일) | `flyer-frontend` |
| P1-09 | Campaign Wizard | D175 (14일) | `flyer-frontend` |
| P2-10 | 모바일 현장컷 PWA | D183 (14일) | `flyer-frontend` PWA 화 |
| P2-11 | Outside DB 캠페인 | D190 (14일) | TargetUP/POPPON 연동 |
| P2-12 | 월간 자동 리포트 | D200 (10일) | `stats` + PDF/report |

### 3-3. 신규 테이블 6개 (GPT 부록 A 채택)

| 테이블 | 역할 | 주요 필드 |
|--------|------|---------|
| flyer_events | 모든 행동 이벤트 통합 | event_type, campaign_id, customer_id, flyer_id, product_id, occurred_at |
| flyer_attributions | 성과 귀속 결과 | campaign_id, customer_id, pos_sale_id, attribution_type, amount |
| flyer_customer_features | 고객 AI 피처 | rfm_score, segment, category_pref, last_purchase_at |
| flyer_product_features | 상품 AI 피처 | sales_velocity, margin_hint, seasonality, campaign_response |
| flyer_ai_recommendations | AI 추천 이력 | recommendation_type, input_hash, output_json, accepted, outcome |
| flyer_experiments | A/B 테스트와 홀드아웃 | campaign_id, group_type, customer_id, result |

### 3-4. 신규 CT-F 5개

| CT | 모듈 | 상태 | 역할 |
|----|------|------|------|
| CT-F10 | flyer-rfm | 스켈레톤 → 실구현 | RFM·세그먼트 갱신 |
| CT-F18 | flyer-attribution | 신규 | 캠페인 성과 귀속 (4단계: 직접/쿠폰/매칭/홀드아웃) |
| CT-F19 | flyer-retail-brain | 신규 | 매장·상품·고객 AI 피처 계산 |
| CT-F20 | flyer-campaign-autopilot | 신규 | 캠페인 초안·추천 |
| CT-F21 | flyer-send-optimizer | 신규 | 채널·시간 추천 (30억 발송로그 기반) |
| CT-F22 | flyer-report | 신규 | 월간 성과 리포트 자동 생성 |

### 3-5. 신규 API 6개

| API | 목적 |
|------|------|
| POST /api/flyer/ai/weekly-plan | 매장별 주간 행사 추천 |
| POST /api/flyer/ai/campaign-draft | AI 캠페인 초안 생성 |
| POST /api/flyer/ai/target-audience | 상품별 타겟 고객 추천 |
| GET /api/flyer/analytics/campaigns/:id/roi | 캠페인 ROI 조회 |
| POST /api/flyer/attribution/rebuild | 성과 귀속 재계산 |
| GET /api/flyer/ai/store-health | 매장 상태 진단 |

---

## 4. D-시리즈 5주 매핑 (D153~D157 PHASE 0 + 분리)

| D | 작업 | 트랙 |
|---|------|------|
| **D153 (월)** | hanjulDM 폴더 골격 + 파일 복사(Step 1~4) + PHASE 0 트랙 A 진입 | 분리 인프라 + PHASE 0-A |
| **D154 (화)** | hanjulDM app.ts + 빌드·실행 검증 + 한줄AI 본진 flyer 제거 + 배포(Step 5~9) + PHASE 0 트랙 A 계속 | 분리 완료 + PHASE 0-A |
| **D155 (수)** | PHASE 0 트랙 B 진입 (AI 동적 생성) + 6매체 디자인 토큰 신규 | PHASE 0-B + 6매체 |
| **D156 (목)** | PHASE 0 6매체 통합 + 직원 3인 검증 + 실제 마트 사장 1인 블라인드 | PHASE 0 검증 |
| **D157 (금)** | PHASE 0 마무리 + 통과 정의 5건 모두 확인 + PHASE 1 진입 준비 | PHASE 0 완료 |

---

## 5. 한줄로 본진 67사 funnel과 작업 배분 룰

**현재 한줄로 본진 작업 (병행):**
- 67사 무료체험 funnel (D144 시작, 만료 6/4)
- 알림톡·브랜드메시지 후속 검증
- 자동발송·캠페인 워커 안정화

**작업 배분 룰 (D153~D157 동안):**
- **한줄AI 본진 작업** = Harold + 본진 비토 세션. tp-push 사용. PHASE 0와 무관.
- **hanjulDM 작업** = Harold + hanjulDM 비토 세션. hdm-push 사용. PHASE 0 + 분리.
- 동시 작업 시 atomic safe-build 양쪽 독립 의존 보장 = 한쪽 사고가 다른 쪽 전파 0건.

**비토 권장:** D153~D154 분리 인프라 작업 중에는 한줄AI 본진에 큰 변경 0건 권장 (충돌 방지). 분리 후 D155부터는 양쪽 완전 독립이라 동시 작업 OK.

---

## 6. PoC 마트 1곳 확보 전략

**비토 시각:** PHASE 0 + PHASE 1 완료해도 PoC 마트 1곳 90일 폐회로 검증 없으면 "괴물"은 그림.

**확보 후보:**
1. 한줄로 본진 6,000사+ 중 마트/식자재/정육/과일/수산 비중 → 즉시 푸시
2. Harold님 개인 네트워크 우호 마트
3. 인비토 외부 영업 (지방 농협 윈백, Gemini Phase 1 권고)

**90일 폐회로 검증 항목:**
- POS Agent 직접연결 → 자동 데이터 수집 30일 검증
- AI 주간 행사 추천 → 사장님 채택률 50% 이상
- 1탭 발송 → 일주일 4회 이상 사용
- POS 매출 귀속 → ROAS 100% 이상
- 다음 주 자동 학습 → 추천 정확도 회차마다 개선

**Harold님 결정 대기:** PoC 마트 1곳 후보 명시 (D155 이후 명시 시 가능).

---

## 부록 A. 가격 모델 (GPT 채택)

| 플랜 | 가격 | 핵심 제공 | 대상 |
|------|------|---------|------|
| Starter | 월 99,000원 + 발송비 | 전단·POP·인쇄·기본 발송·기본 쿠폰 | 소규모 마트·정육점 |
| Pro | 월 199,000원 + 발송비 | RFM, AI 상품추천, ROI 대시보드, 자동 리포트 | 중소형 마트 |
| Autopilot | 월 299,000~499,000원 + 성과 옵션 | AI 캠페인 마법사, 발송시간·채널 추천, A/B 테스트 | 식자재·중대형 마트 |
| Outside DB | 캠페인 단위 과금 | 지역 잠재고객 쿠폰·전단 발송 | 신규 고객 유입 필요 매장 |
| Enterprise | 협의 | 본부 콘솔, 다점포 관리, POS/ESL/사이니지 연동 | 프랜차이즈·농협·SSM |

---

## 부록 B. KPI 9개 (GPT 채택)

| 영역 | KPI | 목표 |
|------|-----|------|
| 제품 사용성 | 첫 전단 생성 시간 | 10분 이하 |
| 제품 사용성 | 캠페인 생성 클릭 수 | 5단계 이하 |
| 활성화 | 주간 활성 매장률 | 70% 이상 |
| 성과 | 캠페인별 ROAS 표시율 | 80% 이상 |
| 성과 | 쿠폰 claim→redeem 전환율 | 10% 이상 |
| 데이터 | POS 연동 성공률 | 80% 이상 |
| AI | AI 추천 캠페인 채택률 | 50% 이상 |
| 사업 | 유료 전환율 | 무료체험 30% 이상 |
| 사업 | 월간 이탈률 | 5% 이하 |

---

## 부록 C. 리스크 6개 + 대응 (GPT 채택)

| 리스크 | 대응 |
|--------|------|
| POS 연동 실패 | CT-F16 스키마 AI 분석 + 수동 매핑 백업 + POS별 템플릿 축적 |
| 성과 귀속 과장 | 직접 주문/쿠폰/회원 매칭/홀드아웃 4단계 구분 표시 |
| 개인정보 이슈 | 동의 목적별 분리 + 수신거부 + 최소 수집 + Audit log + 마케팅 동의 증빙 |
| AI 추천 불신 | 추천 이유를 쉬운 문장으로 설명 + 승인형 자동화부터 시작 |
| 경쟁사 추격 | POS ROI 데이터와 발송로그 기반 추천으로 진입장벽 구축 |
| 운영 장애 | CT-F 원칙 유지 + idempotency + atomic safe-build + 장애 격리 |

---

## 부록 D. 데모 시나리오 (GPT 14 채택)

영업·투자·포상 제출용 데모는 "사장님이 실제로 매출을 만드는 장면"으로 구성:

1. A 마트 POS Agent가 지난 30일 판매 데이터 자동 수집
2. AI가 이번 주 토요일 정육 카테고리 매출 상승 가능성 높다고 판단 + 삼겹살·목살·쌈채소 묶음 행사 추천
3. AI가 최근 60일 내 정육 구매 이력 있으나 14일간 방문하지 않은 고객 1,200명 타겟 추천
4. AI가 전단·POP·MMS 이미지·알림톡 문구·쿠폰을 1분 안에 생성 (Claude Design 6매체 동일 토큰)
5. 사장님이 가격만 수정하고 승인
6. 한줄전단AI가 금요일 오후 4시에 알림톡·문자 최적 조합으로 발송 (CT-F21)
7. 토요일 매출 발생 시 쿠폰·주문·POS 결제를 캠페인에 귀속 (CT-F18)
8. 월요일 아침 점주 화면에 "이번 캠페인 매출 기여 추정, 반응 고객군, 다음 주 추천" 표시

---

## 부록 E. 영업 메시지 (GPT 10-2 채택)

- **기존 전단 업체 대비**: "전단 제작비를 줄이는 것에서 끝나지 않고, 전단이 매출로 이어졌는지 보여드립니다."
- **템플리 대비**: "만드는 속도는 빠르게, 보내는 대상은 더 똑똑하게, 결과는 POS로 증명합니다."
- **POS 업체 대비**: "POS는 매출을 보여주지만, 한줄전단AI는 매출을 만들 캠페인을 실행합니다."
- **정부지원 대비**: "스마트상점 지원금으로 도입 가능한 마트 매출 자동화 SaaS 패키지"

---

## 부록 F. 시장 검증 (Gemini)

- 시장 매력도 4.4/5.0 = "Golden Time"
- 국내 도소매 사업체 103만 개 + SSM 1,464개
- 리테일테크 마케팅 SaaS 시장 2026년 3조 614억원 (CAGR 15.5%)
- 정부 스마트상점 지원금 최대 500만원 (70~100%)
- 마트 점주 광고비 월 30~250만원 vs 지불의향 월 15~25만원
- 페인포인트 Top 5: 제작시간 / 디자인 인력 부재 / 통합관리 / 고객데이터 활용 / AI 도입 두려움
- 템플리 검증: 부에노컴퍼니, 2021년, 경남 창원, 월 9~25만원, 농협 PoC, 업무시간 -61.4%, 비용 -37~55%, 매출 +44%

---

## 결론 — 90일 후 한줄전단AI 상태

- 매장 사장님은 상품 정보만 올리면 AI가 전단·POP·발송·쿠폰·주문·결과 분석까지 자동 처리
- 매번 매번 다른 디자이너급 결과물 (Claude Design 동적 생성)
- POS 매출 귀속으로 "지난주 캠페인 ROAS 220%" 증명
- 관리자는 매장별 성과·업종별 템플릿 성과·발송 채널 성과·POS 연동 상태를 한 화면에서 본다
- 영업팀은 "전단 만들 수 있습니다"가 아니라 "지난달 A 마트는 한줄전단AI로 주말 정육 캠페인 ROAS를 확인했습니다" 실증 영업
- 사장님은 한줄전단AI를 단순 비용이 아니라 매출을 만드는 시스템으로 인식 → lock-in

---

> **본 문서는 한줄전단AI 절대 1위 전략의 단일 진실 원천(Single Source of Truth)이다.**
> **업데이트 시점:** PHASE 0 완료 시 / PHASE 1 각 P0/P1/P2 완료 시 / 분리 완료 시 / PoC 마트 확보 시
