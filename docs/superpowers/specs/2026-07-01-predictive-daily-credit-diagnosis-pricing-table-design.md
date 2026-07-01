# 예측분석 일일 차감 진단·조치 + 요금제 차감표 설계서

> 작성일 2026-07-01. Harold 지시(비-문자 개인화 배포 후 이연). **다음 세션 구현용.**
> 핵심: "매일 오전 9시 일괄 차감 + 분석" 로직은 **이미 구현돼 있음** → 미작동 원인 진단이 1단계(추측 금지, 0번 원칙).

---

## 1. 배경 / 요구 (Harold 명시 2026-07-01)

- DB 수량에 따라 매일 크레딧을 차등 차감(예측분석)하기로 했는데 제대로 작동 안 함.
- 테스트계정(유호윤) = 월 기본분 리셋(750)됐는데 **오늘 예측분석 차감이 없음**.
- 매일 오전 9시(KST)에 일괄 차감 + 분석되는 로직이 있어야 함.
- 요금제 안내 하단에 "DB 수량에 따른 매일 분석 차감 얼마씩인지" 표로 정리해 게시.

관련 = [[project_2026_0630_credit_model_v2]] · `docs/superpowers/specs/2026-06-30-credit-model-v2-design.md`.

---

## 2. 현황 확정 (코드 그라운딩 — 로직은 이미 존재)

- `utils/predictive-worker.ts`: 30분 주기로 깨어 **KST 오전 9시대 하루 1회** 실행(`lastBatchDateKst` 가드 + `kstHour===9`). 연동 회사 예측 점수 갱신 + `dailyDbAnalysisCredits(고객수)` 차감. source=`predictive-daily`, 멱등키 `predictive-daily:companyId:YYYYMMDD`(서버 재시작·재진입 중복 차감 0). `app.ts:395 startPredictiveWorker()` 등록.
- 대상 = **연동 회사만**: `EXISTS sync_agents(company) OR EXISTS cdp_events(company, source='custom_sdk')`. 미연동 = 차감 0 (v2 정책 "연동=항상, on/off 토글 폐지").
- 공식 `ai-credit-calc.dailyDbAnalysisCredits(n)` = `n=0 → 0`, `blocks = ceil(n / 100000)`, `round(3 + (blocks − 1) × 1.5)`.

→ **"매일 9시 일괄 차감 + 분석" 로직은 이미 있음.** 미작동은 §3 세 후보 중 하나이며, 추측 없이 검증부터 한다.

---

## 3. 원인 후보 + 검증 (다음 세션 1단계 · no_guess)

`$C` = 테스트계정(유호윤) company_id. 순서대로 검증한다.

- **후보 A — credit-model-v2 미배포** (predictive-daily 차감이 서버 실행 코드에 아직 없음)
  - 검증: `SELECT COUNT(*) AS n, MAX(created_at) AS last FROM ai_credit_transactions WHERE source = 'predictive-daily';`
  - 전사 0건 / last 오래됨 = 미배포 또는 worker 미실행 → 후보 C 병행.

- **후보 B — Harold 계정 미연동 (차감 0이 설계상 정상)**
  - 검증: `SELECT (SELECT COUNT(*) FROM sync_agents WHERE company_id = $C) AS sync, (SELECT COUNT(*) FROM cdp_events WHERE company_id = $C AND source = 'custom_sdk') AS cdp;`
  - 둘 다 0 = 미연동 → 매일 차감 0이 정상(버그 아님). 시연/테스트하려면 §4-B.

- **후보 C — 배포 + 연동인데 worker 미실행 / 오류 / 서버 TZ**
  - 검증: `pm2 logs targetup-backend --nostream | grep PredictiveWorker` — 9시 실행 로그·오류·서버 TZ(`kstHour` 계산) 확인.

---

## 4. 조치 설계 (원인별)

- **A 미배포**: credit-model-v2 배포로 해결(코드는 존재). 배포 후 다음 9시 batch 자동. 배포 여부부터 git log + `ai_credit_transactions` predictive-daily 존재로 확정.
- **B 미연동 테스트 계정**: 실운영은 연동 회사만 차감이 맞음(정책). 시연/테스트 목적이면 = 슈퍼관리자 **수동 트리거**(아래 신설) 또는 테스트 계정에 연동 조건 1건 부여. "미연동도 차감"으로 바꾸는 건 정책 변경 = 별도 Harold 결정.
- **C worker 이슈**: 미실행 원인 수정(서버 TZ / 시작 누락 / 예외 삼킴).
- **공통 신설(권고) — 슈퍼관리자 수동 실행 버튼**: `POST /api/admin/predictive/run-now` = `runPredictiveBatch()` 즉시 1회(멱등키 유지 → 하루 1회 상한 보존). 9시 대기 없이 검증·복구·시연. 슈퍼관리자 대시보드 크레딧 탭에 배치.

---

## 5. 요금제 안내 차감표 (PricingPage 하단)

`dailyDbAnalysisCredits` 실공식 기준(하드코딩 X — 공식 재사용 권장):

| 고객 DB | 일일 차감 | 월 환산(×30) |
|---|---|---|
| 10만 이하 | 3 | 90 |
| 20만 | 5 | 150 |
| 30만 | 6 | 180 |
| 50만 | 9 | 270 |
| 100만 | 17 | 510 |
| 200만 | 32 | 960 |
| 300만 | 47 | 1,410 |

- 캡션: "싱크에이전트·SDK 연동 시 매일 오전 9시 DB 규모 기준 자동 분석·차감. 미연동은 0. 1크레딧 = 500원."
- 위치 = PricingPage 하단 크레딧 안내부. **프론트만**(신규 SQL·마이그레이션 0). 표 값은 dailyDbAnalysisCredits로 계산해 노출(공식 단일 진실).

---

## 6. 구현 순서 (다음 세션)

- P1 진단(§3) → 원인 1개 확정.
- P2 원인별 조치(§4) + 슈퍼관리자 수동 트리거 신설.
- P3 요금제 차감표(§5, 프론트).
- 마이그레이션 0 예상(기존 컬럼·워커 재사용).

---

## 7. 주의 (돈 영역)

- 크레딧 = 배포 전 실측 1건: 연동 테스트 계정 9시 차감 또는 수동 트리거 1회 → `ai_credit_transactions` predictive-daily 1건·멱등(같은 날 재실행 시 중복 0) 확인.
- 멱등키(회사+날짜) 불변식 보존 — 수동 트리거·재시작이 중복 차감을 만들지 않아야 한다.
- 진단 없이 "로직이 없다" 단정 금지 — 로직은 있으므로 배포/연동/실행 상태부터 데이터로 확정.
