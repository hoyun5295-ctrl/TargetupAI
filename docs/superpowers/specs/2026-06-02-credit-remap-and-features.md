# AI 크레딧 재매핑 + 성과 리포트 PDF + 예측 온오프 + 여정 수정 — 설계

> Harold 토론 확정 (2026-06-02). 1크레딧 = 500원. CREDIT_COST_MAP(backend) ↔ frontend credit.ts 1:1 동기화 의무.

## 배경

- 'AI Operator 한줄 입력'이 코드 함수명 `orchestrate`(풀분석)로 명명돼 300크레딧(15만원) 차감 중. 실제 사용자 경험은 '타겟+문안 일회성 제안' = 문안·분석(5).
- '풀분석 300'은 별도 기능이어야 함 — 기간(7/14/30/90일) 정해 매출·ROI·채널 마케팅 성과를 종합 분석하는 '성과 리포트' + PDF 보고서. 상위 플랜(비즈 2,500/엔터 5,500)은 매주 풀분석(월 1,200)도 널널.
- 여정 생성은 현재 `generateJourneyPackage` 호출(돌려보기)마다 150 차감 = 과함. 돌려보기 3 + 저장(활성화) 150으로 분리.
- 예측(predictive-worker)은 매시간 전체 무료. 연동(싱크에이전트/SDK) 회사만 매일 3크레딧 + 온/오프.
- 저장된 여정에 수정 진입 버튼 없음.

## 플랜 월 크레딧 (실 화면 기준 — SCHEMA.md 옛값 폐기)

실제 plans 화면: 스타터 300(15만원) / 베이직 750(35만원, +7%) / 프로 2,400(100만원, +20%) / 비즈 7,800(300만원, +30%) / 엔터 16,500(550만원, +50%).
- 프로(100만원) = 매주 풀분석(월 4회 × 300 = 1,200) 쓰고 1,200 잔여 = Harold '1,200 남아 널널' 정확.
- ⚠️ SCHEMA.md `ai_credits_per_month`(스타터50 등)는 stale — 신뢰 금지. 구현 시 plans row(SQL)로 확정.

## 작업당 크레딧 (협의 확정 — 두 번째 스샷 그대로)

풀분석 300 / 여정 설계 150 / 자동 마케팅 200 / 모바일 DM 30 / 인앱 생성 15 / 문안·분석 5 / 다듬기·질문 1.
이 금액표는 변경 없음. 본 작업은 '어느 기능이 어느 항목에 매핑되냐'만 바꾼다(한줄입력→문안·분석 5, 풀분석 300→성과 리포트).

## 작업

### 1. AI Operator 한줄 입력 → 문안·분석 5 [이번 세션 완료]
- 구현: `CREDIT_COST_MAP`에 `'ai-operator-propose': 5` 신규(orchestrate 300은 성과 리포트용 보존). propose endpoint가 `orchestratorFn(ctx, { source:'ai-operator-propose', cost:5 })`로 5 차감. frontend credit.ts CREDIT_SOURCE_LABELS에 `'ai-operator-propose': '문안·분석'` 추가.
- 검증: backend·frontend tsc 0, ai-credit-calc.verify.ts ok, 박-단어/모델명 0.

### 2. 풀분석 300 = 성과 리포트 + PDF
- 성과 리포트(기간 성과분석) 실행에 풀분석 source 300 차감 신설(idempotent — 기간+회사+날짜 키).
- PDF 분석보고서 출력: pdfkit으로 매출·ROI·채널·시간대·AI 진단을 보고서 PDF 생성 endpoint.
- 구현 1단계에서 성과 리포트 분석 endpoint(self-diagnosis 등) 정확 위치 확정 후 차감 부착.

### 3. 여정 돌려보기 3 + 저장 150
- 현재 `generateJourneyPackage`(생성) 시 150 → 생성 시 3(journey-ai-generate=3), 저장/활성화 시 150(신규 source) 분리.
- 구현 1단계에서 여정 150 현재 차감 호출 위치(journey-ai-generator 내부인지 route인지) 확정.

### 4. 예측 자동 연동 매일 3 + 온오프
- predictive-worker: 매시간 → 매일 1회(오전 9시 KST) + 차감 추가.
- 대상 = 연동 회사만: `sync_agents` 등록 OR `cdp_events.source='custom_sdk'` 존재. (정밀화: 최근 24h 신규 데이터 있을 때만 — 추후)
- companies ALTER: `predictive_enabled BOOLEAN DEFAULT true` 신설. endpoint catch에 `column does not exist` → 503 DB_MIGRATION_PENDING 분기.
- 성과 리포트/예측 페이지에 온/오프 토글 UI.
- 차감 idempotent: 회사+YYYYMMDD 키 (하루 1회 보장).

### 5. 여정 수정 버튼
- JourneysPage 저장 여정 목록에 수정 진입 버튼 추가.
- 저장 여정 편집 화면(step 수정 재사용). 활성 여정 수정 시 진행 중 execution 영향 검토(수정=새 버전/draft 저장).

## 안전망 (LESSONS_DB)

- 모든 차감 = `ai-credit.ts` checkCredit/deductCredit CT 경유, SELECT FOR UPDATE + idempotency_key + 차감은 성공 후.
- DB ALTER 새 컬럼 활용 endpoint = `column does not exist` catch 분기 의무.
- SCHEMA.md 추측 X — 신규 컬럼/차감 위치는 information_schema·실코드로 확정 후 작성.

## 미확정 (구현 1단계 확정)

- 성과 리포트 분석 endpoint 정확 위치 + 현재 차감 유무
- 여정 150 현재 차감 호출 위치
- 100만원 플랜 = 비즈/엔터 어느 쪽인지 (plans.price SQL)
- 활성 여정 수정 시 execution 처리 정책
