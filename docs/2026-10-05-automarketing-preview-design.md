# 자동 마케팅 [제안 받기] = 미리보기 설계서 (2026-10-05)

> 호출어 **"자동 마케팅 미리보기"**. 상태 = **설계 확정(Harold 승인 2026-10-05 「추천대로 5로 하고 설계서 작성해서 구현까지」) · 코드 완료 · Codex 적대 3R approve(gpt-6-astra) · 커밋 `bac94caf` · 미배포 · DDL 0** · 구현 기록 = §7.
> ⛔ 같은 날 [자동 마케팅 신뢰 설계](2026-10-05-automarketing-trust-design.md)가 이 위에 얹혔다 — 대상(번역 · 계약) · 창(승인 창 목업) · 시작 판정(문안 생성 0) · 등록 경로(`resolveRegistrationSegment` 삭제)는 그 설계서 §2 · §9 가 소유한다. 여기 계약 중 그것과 다른 부분은 그쪽이 맞다.
> 접수 = Harold 실측(2026-10-05 · 테스트 계정): 한 줄을 넣고 [제안 받기]를 누르자 제안을 보기도 전에 「자동 마케팅 사용으로 200 크레딧」 확인 창.
> 관련 = [FEATURE-AUTOMARKETING.md](FEATURE-AUTOMARKETING.md)(§2 불변 원칙 · §3 구조) · [한줄로 시그니처](2026-10-05-hanjul-signature-design.md)(완성본을 먼저 보여 주고, 돈이 나가는 일은 그다음).

---

## §0 30초 요약

- **[제안 받기] = 미리보기.** 등록 · 가동 없이 첫 제안(대상 · 문안 3안 · 발송 시각 · 1회 예상 비용)만 만든다. **5크레딧**(허브 [생성]과 같은 키 `ai-operator-propose` · 같은 분석) · 문안이 안 나오면(대상 0명) 0.
- **[이대로 자동 마케팅 시작 · 200] = 등록.** 서버가 보관한 미리보기 입력 그대로 등록(200 · 기존 멱등)하고, **방금 본 제안을 첫 회차로 저장**한다(다시 만들지 않는다 · 추가 차감 0).
- 미리보기 보관 = 서버 메모리 30분. 만료 · 서버 재시작이면 시작 요청은 차감 없이 410 → 화면이 「다시 제안 받기」를 안내한다.
- 시나리오 · 세부 설정 · 오늘의 추천 경로는 바꾸지 않는다. **DDL 0 · 신규 크레딧 키 0.**

---

## §1 출발점 (코드 실측)

| 사실 | 근거 |
|---|---|
| 200 = 자동 마케팅 저장(활성화) 1회 · 매일 제안 0 · 발송 1건 10 | `ai-credit-calc.ts:104-106` |
| 한 줄 [제안 받기] = 기본값으로 바로 등록(200) → 첫 초안(run-now · 0) | `ContinuousOperatorPage.tsx:191-223 · 272-275` · `continuous-operator.ts:282-355` |
| 등록 때 목표를 축(계약)으로 옮기는 AI 매핑이 1회 돈다(축을 안 고른 등록만) | `routes/ai.ts:2173-2208` |
| 여정은 만들어 보기 3 → 확인 → 활성화 200 | `ai-credit-calc.ts:96-100` |

---

## §2 계약

1. **미리보기 = 첫 회차와 같은 계산.** 축 매핑은 등록과 같은 함수(`resolveRegistrationSegment` 로 추출 · 등록 라우트도 이것을 부른다), 오케스트레이터 문맥은 회차 생성과 같은 함수(`buildOperatorOrchestrateContext` · `loadOperatorCompanyContext` 로 추출 · 회차 생성도 이것을 부른다), 채널 · 혜택 정규화도 등록과 같은 함수(`normalizeOperatorChannel` · `normalizeOperatorBenefit`).
2. **미리보기 과금** = 오케스트레이터 `{ source: 'ai-operator-propose', cost: getCreditCost('ai-operator-propose') }`(문안이 1개 이상 나왔을 때만 · 기존 규칙). 같은 회사 · 같은 사람의 동시 미리보기는 409(메모리 잠금).
3. **변화 축(기준선이 필요한 축)으로 매핑되면** 미리보기는 AI 를 부르지 않고 「첫 회차는 비교 기준을 잡고 다음 회차부터 보냅니다」만 돌려준다(0크레딧). 시작하면 기존 run-now 경로(기준선 기록).
4. **시작 요청은 미리보기 id 하나만 받는다.** 서버가 보관한 입력(+ 매핑된 축)으로 등록한다 — 화면 값으로 다시 만들지 않는다(본 것 = 등록한 것). 다른 회사 · 다른 사용자 · 만료 = 410(차감 0). 꺼내는 순간 지운다(같은 미리보기로 두 번 등록 금지). **되돌림은 잔액 부족일 때만** — INSERT 전 사전 확인에서만 나는 오류라 행이 없음이 증명된다(충전 뒤 다시 누르기). 그 밖 실패는 INSERT 커밋 여부를 모르므로 되돌리지 않는다(다시 [제안 받기] · Codex 1R high).
5. **첫 회차 저장** = `generateProposalForOperator(id, { precomputed })` — 오케스트레이터 호출만 건너뛰고 그 뒤 판정(0명 · 예약 중복 · 스팸 · 통지 · 통계)은 지금 함수 그대로. **단 자율 발송 판정에서는 뺀다** — 대상 수 · 비용이 최대 30분 묵은 값이라 그 값으로 자동 예약하지 않는다(승인 대기로 저장 · 승인 발송은 발송 직전 대상을 다시 뽑아 기록 · Codex 1R). `precomputed` 가 없으면 문자 단위로 지금과 같다.
5-1. **시작 응답의 안내 = 저장 상태로 판정.** 반환값 null 은 사유를 담지 않고, 제안 INSERT 뒤 후속 단계가 던져도 행은 남는다. 저장된 열린 회차를 다시 읽고(`findOpenProposalForOperator`), 없으면 run-now 와 같은 사유 함수(`explainEmptyRound` · run-now 라우트 블록을 그대로 옮김)로 안내한다(Codex 1R).
6. 0명 미리보기는 차감 0 · 화면은 사유와 [세부 설정에서 고치기]만 보인다(0건 자동완화 금지 · 시작 버튼 없음).

---

## §3 화면 (`ContinuousOperatorPage`)

- 명령 카드 한 줄 · 「자연어로 시작」 화면 두 입구가 같은 함수(`handleNaturalSubmit`)를 쓴다 → 둘 다 미리보기로.
- 버튼 = [제안 받기 · 5크레딧](20 미만이라 확인 창 없이 버튼에 금액 · 기존 규칙) → 진행 표시 → **미리보기 창**(흰 판 · 모바일 아래로 쌓임 · 백드롭 닫힘 없음).
- 미리보기 창 = 대상 N명 + 기준 · 채널 · 문안 3안 탭(안 이름) · 주기와 발송 시각 · 1회 예상 비용 · Source caption.
- 버튼: [닫기] · [세부 설정에서 고치기](이 값으로 세부 설정 창 → 저장 = 기존 등록 경로) · [이대로 자동 마케팅 시작 · 200크레딧](기존 크레딧 확인 창 200 → 시작 요청).
- 시작 성공 = 기존과 같이 추천 화면으로 · 410 = 「미리보기가 만료됐어요. 다시 [제안 받기]를 눌러 주세요」.

---

## §4 영향표

| 대상 | 소비처 | 영향 |
|---|---|---|
| `POST /operator/continuous`(등록) | 세부 설정 · 시나리오 · 오늘의 추천 · 캘린더 · (옛) 자연어 | 축 매핑 블록을 함수로 뺀 것뿐 · 동작 동일 |
| `POST /operator/continuous/preview`(신설) | 자연어 입구 2곳 | 5크레딧 · 등록 0 |
| `POST /operator/continuous/from-preview`(신설) | 미리보기 창 [시작] | 200 · 첫 회차 = 미리보기 |
| `generateProposalForOperator` | 워커 · run-now · from-preview | `precomputed` 선택 인자 · 없으면 동일 · 있으면 자율 발송 판정 제외(승인 대기) |
| `POST /operator/continuous/:id/run-now` | 실행 중 목록 [지금 추천 받기] | 빈 회차 사유 블록을 CT `explainEmptyRound` 로 옮긴 것뿐 · 동작 동일 |
| `createOperator` | 등록 · from-preview | 채널 · 혜택 정규화를 함수로 뺀 것뿐 · 동작 동일 |
| `ContinuousOperatorPage.handleNaturalSubmit` | 명령 카드 · 자연어 시작 | 미리보기로 · 그 밖 입구 무변경 |

---

## §5 하지 않는 것

- 오늘의 추천 [시작](1클릭 시작 = 시작이 명시된 버튼) · 시나리오 · 세부 설정 경로 — 그대로(200 확인 창).
- 미리보기 영속 저장(DDL) · 미리보기 재생성 할인.

---

## §6 검증 · 출고

- 백 · 프 tsc 0 · 백엔드 vitest 전량 · 계약 테스트(precomputed 없음 = 동일 · 미리보기 = 같은 함수 · 시작 = id 만 · 410 차감 0 · 되돌림 · 잠금 · 0명 차감 0).
- Codex 적대 검토(돈 경로) — 닫힐 때까지.
- 배포 = 백엔드 → 프론트(새 엔드포인트를 화면이 부른다).

---

## §7 구현 기록 (2026-10-05)

### 7-1. 바뀐 파일

| 층 | 파일 | 몫 |
|---|---|---|
| 미리보기 CT(신설) | `backend/src/utils/automarketing-preview.ts` | `resolveRegistrationSegment` · `createOperatorInputFromBody` · `operatorSaveErrorResponse`(등록 라우트에서 잘라 옮김 · 등록 · 미리보기 · 시작 공용) / 보관(메모리 30분 · 500개 · 꺼내면 지움 · 남의 것 안 지움) · 잠금(회사 + 사용자) / `runOperatorPreview` · `startOperatorFromPreview` |
| 회차 · 등록 공용 함수 | `backend/src/utils/continuous-operator.ts` | `validateOperatorInput` · `normalizeOperatorSegment`(createOperator 첫머리 · 축 정규화를 그대로 옮김) · `operatorContextFields`(저장 뒤 다시 읽힌 값과 같은 정규화) · `loadOperatorCompanyContext` · `buildOperatorOrchestrateContext` · `normalizeOperatorChannel` · `normalizeOperatorBenefit` · `generateProposalForOperator(id, { precomputed })` |
| 빈 회차 사유 | `backend/src/utils/continuous-operator.ts` | `explainEmptyRound`(run-now 라우트 블록을 그대로 옮김 · run-now · 시작 공용) · `findOpenProposalForOperator`(열린 회차 최신 1건 · 리마인드 제외 · 회사 결합) · 자율 판정 `!opts?.precomputed` |
| 과금 조건 | `backend/src/services/ai-orchestrator.ts` | `orchestrate` 선택 인자 `chargeOnlyWithTarget` — 지정한 호출만 대상 0명이면 차감 0(허브 제안 · 회차 생성은 지정 안 함 = 그대로) |
| 라우트 | `backend/src/routes/ai.ts` | 등록 = 옮긴 함수 호출(동작 동일) · `POST /operator/continuous/preview`(요금제 게이트 · 409 잠금 · 400 입력 · 402 잔액) · `POST /operator/continuous/from-preview`(요금제 게이트 · preview_id 만 · 410 만료 · 등록과 같은 오류 응답) |
| 화면 | `frontend/src/pages/ContinuousOperatorPage.tsx` · `components/automarketing/OperatorPreviewModal.tsx`(신설) · `NaturalLanguageStart.tsx` · `constants/credit.ts` | 한 줄 · 자세히 쓰기 = 미리보기 · 버튼 「제안 받기 · 5크레딧」 · 미리보기 창(대상 · 채널 · 주기 · 1회 예상 비용 · 문안 3안 탭 · 고정 축 안내 · Source) · [닫기] · [세부 설정에서 고치기] · [이대로 자동 마케팅 시작 · 200크레딧] → 확인 창 → 시작 · 만드는 중 닫기 = 늦은 결과 버림(세대) |

### 7-2. 구현 중 정한 것

- **0명 차감 0은 orchestrate 안에서.** 미리보기 쪽에서 따로 확인 · 차감하면 과금 코드가 두 곳이 된다. 선택 인자 하나로 차감 자리는 그대로 한 곳.
- **등록이 거절할 입력은 미리보기에서 돈을 쓰기 전에 거른다** — 등록과 같은 검증 함수(`validateOperatorInput`)로 400. 모르는 축도 400(AI 0).
- **첫 회차 저장이 실패해도 시작 응답은 성공**(등록 · 200 은 끝났다). 500 을 주면 다시 눌러 두 번 등록된다. 회차는 정해진 시간에 다시 만든다(문구로 알림).
- **변화 축 Source 문구** — 등록 축 매핑은 AI 를 쓰므로(차감 0) 「AI 미호출」이라 적지 않는다.
- **모르는 상태를 「없음」으로 접지 않는다(Codex 1R · 2R 같은 뿌리)** — 되돌림 = 행이 없음이 증명되는 잔액 부족만 · 시작 안내 = 저장된 열린 회차를 다시 읽고(`findOpenProposalForOperator`), 재조회 실패는 「확인하지 못했다」 · 0행일 때만 run-now 와 같은 사유 함수(`explainEmptyRound`).
- **미리보기로 만든 첫 회차 = 승인 대기**(자율 발송 판정 제외 · 묵은 대상 수로 자동 예약 금지). 동작 변화 = 자율 실행을 켠 회사도 이 경로의 첫 회차는 한 번 승인한다(화면 문구 「승인하면 발송돼요」).

### 7-3. 검증

- backend tsc 0 · frontend tsc 0 · backend vitest 569파일 8,048건 전부 통과(3라운드 수정 뒤) · 계약 테스트 `utils/__tests__/automarketing-preview-1005.test.ts` 27건.
- 결함 주입 11종 → 전부 테스트가 잡음 · 매번 원복 확인. 1차 6종(대상 0명 과금 조건 제거 · 0명 미리보기 시작 허용 · 등록 실패 되돌림 제거 · 꺼낼 때 안 지움 · 한 줄 = 바로 200 확인 창 · 미리보기 과금 0) · 1R 수정분 4종(되돌림을 모든 오류로 · 미리보기 첫 회차 자율 판정 포함 · 저장 상태 판정 제거 · 시작 사유 고정 문구) · 2R 수정분 1종(재조회 실패를 「없음」으로 접기).
- 직접 확인: 미리보기 문맥의 `operatorId = null` 은 변화 축 술어(`automarketing-segment.ts cycleCompare`)에서만 쓰인다 → 상태 축 대상 수 · 게이트는 첫 회차와 같다(변화 축은 미리보기에서 AI 를 부르지 않는다).
- 화면 확인은 하지 않았다(preview 도구 금지 규칙 · 운영 검증 = Harold). 배포 뒤 실측 = 7-5.

### 7-4. Codex 적대 검토(gpt-6-astra)

- **1R needs-attention** — high 1: 등록 결과가 불명확한 실패(INSERT 커밋 뒤 연결 끊김)에도 미리보기를 되돌려 같은 미리보기로 두 번째 활성 등록 가능 → 수용(되돌림 = 잔액 부족만 · 미리보기 단위 고정 ID + DB 중복 차단 제안은 불수용: 되돌림을 증명 가능한 오류로 좁히면 두 번째 등록 길 자체가 없고, 고정 ID 는 INSERT 문 · 등록 라우트까지 바꾸는 더 큰 변경) · medium 1: 최대 30분 묵은 대상 수 · 비용으로 자율 발송 자격 판정 → 수용(미리보기 첫 회차 = 자율 판정 제외 · 재계산 제안은 불수용: 오케스트레이터 대상 산출 블록 복제가 필요하고 승인 발송은 발송 직전 재추출) · medium 1: 회차 생성 실패를 저장 상태와 다르게 안내(제안 INSERT 뒤 후속 단계 실패 · 기준선 실패를 「기준을 잡았습니다」로) → 수용(run-now 사유 블록을 CT `explainEmptyRound` 로 옮겨 공유 · 저장된 열린 회차 재조회).
- **2R needs-attention** — 1R 판정 (a) 잔액 부족은 INSERT 뒤 전파 없음 · (c) precomputed 회차의 자동 예약 길 없음 · (d) run-now 동작 동일 확인. medium 1: 재조회 실패를 미생성으로 단정 → 수용(같은 부류 두 번째 = 뿌리 「모르는 상태를 없음으로 접기」 · 재조회 실패 = 「확인하지 못했다」 · 0행일 때만 「만들지 못했다」).
- **3R approve** — 지적 0. critical · high 0 · medium 전부 반영으로 닫힘.

### 7-5. 배포 뒤 실측

1. 자동 마케팅 한 줄 「90일 넘게 안 산 고객을 매주 월요일에 다시 불러와줘」 → [제안 받기 · 5크레딧] → 미리보기 창(등록 0 · `continuous_operators` 행 증가 0).
2. `ai_credit_transactions` 그 회사 최근 행 = `ai-operator-propose` 5 한 줄(대상이 있을 때) · `continuous-operator` 0줄.
3. [이대로 자동 마케팅 시작 · 200크레딧] → 확인 → 승인할 제안에 방금 본 문안 그대로 · 원장 `continuous-operator` 200 한 줄 · 미리보기 추가 차감 0.
4. 대상 0명이 나오는 한 줄 → 창에 사유 · 시작 버튼 없음 · 원장 차감 0.
