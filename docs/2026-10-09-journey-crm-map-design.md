# 고객 관계 여정 지도 설계서 (2026-10-09)

> 호출어: **"고객 관계 지도" · "여정 지도 개편" · "AI 진단"**. 여정 V2(`2026-09-29-journey-v2-master-design.md`)의 1단 생애 지도를 다시 그린다.
> 여정 기능 상설 SoT = [FEATURE-JOURNEY.md](FEATURE-JOURNEY.md). 여기는 이번 변경분만 적는다.

## 0) 발단 · 경위

- Harold(1009): 지도가 볼품없고 유기적이지 않다. 가입 여정 1·2·3통이 이어지다 중간에 사면 첫 구매 여정으로, 첫 구매도 리마인드 2~3회 뒤 재구매로, 특정 상품 구매 여정으로 이어지는 도식. 칸을 누르면 모달로 편집. 실제 고객사 여정에도 적용. AI 가 DB 를 읽어 추천. 시연 데이터도 같은 흐름으로. "가입부터 구매·재구매·특정 제품 구매까지 고객과 회사가 함께하는 관계 여정의 완벽함". 순서 = 브레인스토밍 → 설계 → 구현 → Codex 적대 리뷰(닫힐 때까지) → 배포 명령.
- COLLAB §1 회의(기획 · 프론트엔드 · 디자이너 · 백엔드 · 회의론자): 1차 의견 → 교차 토론 1회 → 회의론자 최종 검증 = **조건부 통과 → 조건 전부 반영**.
- 지금 화면이 비어 보인 원인(코드 확인): ①칸은 카드를 펼쳐야 보임(`MapJourneyCard.tsx:179` · 펼침 초기값 빈 집합) ②선이 카드 머리끼리만(`LifecycleMapCanvas.tsx:51-54`) ③"비어 있음" 선 색이 흰색 35%라 흰 판에서 안 보임(`journey-map.ts:94`) ④시연 회사에 받는 여정(첫 구매 · 상품 · 휴면 복귀)이 없어 선이 전부 빈 점선.

## 1) 불변 (V2 그대로)

- 다른 여정으로 고객을 옮겨 넣지 않는다. 넘어가는 선 = A 목표 종료 + B 자기 시작 사건 진입(FEATURE-JOURNEY §2-9).
- 선은 계약 간선에서만 · 화면은 의미를 추론하지 않는다(그리기만) · 좌표 저장 0 · 새 의존성 0.
- 상품 여정은 엔진에서 **같은 구매로 동시에 시작**한다(`journey-trigger-capability.ts:233 · 234 · 237` · `journey-trigger-watcher.ts:340-346`). 순차 화살로 그리지 않는다.

## 2) 지도 문법

| 무엇 | 그림 |
|---|---|
| 축 | 단계 열 왼→오 · 여정 칸 위→아래 척추. **아래로 = 기다림 · 오른쪽으로 = 샀다** |
| 열 | 가입 · 첫 구매 · 재구매 · 이탈·복귀(4열). 상품 여정 = 첫 구매·재구매 열 아래에 걸친 **상품 띠**(카드 가로 나열) |
| 여정 문 | 카드 머리 알약: 시작 사건 · 상태 점 · "최근 W일 진입 N" |
| 문자 칸 | 높이 고정 · 번호 · 채널 · D+N · 미리보기 1줄(1280 이상) · "지금 n명"(0이면 숨김) |
| 대기 | 노드 아님. 칸 사이 척추 위 라벨("3일 뒤") |
| 갈림 | 마름모 칸 · 아니면 갈래 문구(서버 그래프 간선) |
| 구매 출구 | 서버 출구 자리에만 카드 오른쪽 초록 눈금 "구매 확인 N" → 레일 → ◆ 하나. 같은 보내는 여정의 선은 ◆ 공유(포크) |
| 바닥 줄 | 서버가 정한 끝 문구(목표 종료 꺼짐 = "구매해도 끝까지 보냅니다" · 상품 목표 = "같은 상품을 다시 사면 끝나요" · 나머지 = "구매가 확인되면 여기서 끝나요") + "끝까지 받음 M" |
| 상품 카드 | `entryReplace` 참일 때만 "같은 상품을 다시 사면 처음부터" 고리 표기 |
| 선 | 켜진 받는 여정에만 실선/호박 점선 · 받는 여정 없음·초안·멈춤 = 점선 1가닥(대표 1개) · 라벨 "이어받음 M / 전체 X(최근 W일)" · 굵기 고정 · "보냄·넘어감" 동사 금지 |
| 겹침 | rose 배지 "같은 구매로 함께 시작 · 지금 N명"(서버 overlaps) |
| 열 높이 | 다른 열의 높이는 시간을 뜻하지 않는다(문을 출구 높이에 맞추지 않음) · 열마다 고정 계단 오프셋만 |
| 범례 | 상시 1줄: "아래로 기다림 · 오른쪽으로 구매 · ━ 이어짐 ┅ 손봐야 함 ┄ 비어 있음 · 구매한 고객은 다음 여정이 자기 시작 사건으로 맞이합니다" |

- 레인마다 켜짐·멈춤 여정 앞 2개 척추 펼침(순서 = 서버: 켜짐 → 멈춤 → 지금 진행 중 많은 순) · 나머지 "+n개 · 진행 중 m명" 한 줄 · 초안·끝남은 기존대로 접힘.
- 색: amber = 손봐야 함 전용 · rose = 겹침 · emerald = 구매 확인 · slate = 대기 · cyan = 갈림 · 이어짐 선 = slate-700 실선(+최근 7일 이어받음이 있으면 violet 흐름 점, 움직임 줄이기면 정지) · 비어 있음 선 = slate-400 점선.
- 숫자 0: 구매 확인 · 이어받음 0 = "아직 없음"(숨기지 않음) · null = "측정 전" · 칸 대기 0만 숨김 · 칸 누적 D+N 이 창 W 를 넘으면 "측정 창 밖".
- 좌표 = 순수 배치 함수 `frontend/src/utils/journey-map-layout.ts`(DOM 측정 · 칸마다 ResizeObserver 폐기) · 백엔드 vitest 가 불러 단언(끝점 누락 0 · 노드 겹침 0).
- 폭: 1280 이상 = 4열 + SVG · 768~1279 = 같은 배치 + 가로 스크롤(열 머리 고정) · 768 미만 = SVG 없음 · 여정 카드 세로 목록(척추 그대로) + "구매하면 → ○○ 여정" 줄.

## 3) 서버 · 생애 지도 응답(`journey-lifecycle-map.ts`) · DDL 0

1. **받는 쪽**: 같은 시작 사건의 끝나지 않은 마케팅 여정 중 **켜진 것 전부**에 선. 켜진 것이 없으면 대표 1개(멈춤 > 초안)에 점선 1가닥(지금과 같음).
2. **`sender_off`**: 보내는 여정이 켜짐이 아니면 실선 금지 · tier = empty(비어 있음) · 빈 곳 찾기 숫자에서 빠짐 · 고치기 = 보내는 여정 켜기.
3. 선 판정은 순수 함수 `computeMapLines`(지도 · 이어붙이기 점검이 같이 읽음).
4. **숫자 한 벌** — 여정마다 창 `W = clamp(max(30, 마지막 칸 누적 최대 일수 + 7), 30, 180)`일. 누적 숫자(진입 · 칸 도달 · 칸 뒤 구매 확인 · 끝까지 받음 · 이어받음 · 받는 쪽 전체 X)는 같은 창 · 같은 코호트(`entered_at > NOW() - W`, holdout 제외)에서. 상태 숫자(지금 진행 중 · 칸 대기 · 칸별 빠질 예정)는 지금 시점. `counts.entered30d · goalMet30d · completed30d` 필드는 **삭제**(tsc 가 잔존 사용처를 잡는다). 빠질 예정은 구매 목표 켜진 여정만 · 그 밖은 null("판정 안 함").
5. 칸마다 `edit`(아래 §4 정책 결과) · 여정마다 `endNote` · `entryReplace` · `windowDays`. `lockOf` 삭제(문구도 정책에서).
6. 가입 여정 안내문: 회사 구매 문이 매장 원장(싱크)이면 "같은 날 가입하고 산 고객은 환영 문자와 첫 구매 문자를 둘 다 받아요"(구매일이 진입 시각보다 앞서 목표 판정이 안 됨 · `journey-executor.ts:1654-1681`) · 자사몰 문이면 기존 문구.
7. 휴면 전환 → 휴면 복귀 선: 두 여정의 `dormant_days`(기본 30)가 다르면 호박 "기준일이 달라요"(`dormant_mismatch` · 사유에 두 값).

## 4) 칸 클릭 → 편집 창

- `MapStepEditModal`(MapStepDrawer 대체) = JourneyModalShell max-w-4xl · 왼쪽 미니 척추(칸 이동 · 창 유지) · 오른쪽 숫자판 3(지금 이 칸 · 구매 확인 · 도달) + Source caption("최근 W일 들어온 고객 · HH:MM 기준") + JourneyStepStudio `single`·`bare`(SMS/LMS/MMS 만). 알림톡 · 이메일 · 대기 · 갈림 = 읽기 전용 + [여정 자세히 보기]. 모바일 = 아래 시트 + 칸 번호 줄.
- 서버 `stepEditPolicy(status, inProgress)` 한 함수(`utils/journey-step-edit-policy.ts`)를 지도 응답과 `updateJourneyStep` 게이트가 같이 쓴다. 키 4묶음:

| 묶음 | 키 | draft | paused · 진행 중 0 | paused · 진행 중 있음 | active | ended |
|---|---|---|---|---|---|---|
| 문안 | messageTemplate · subject | O | O | O | O(allowActiveMessageEdit) | X |
| 간격 | delayHours · delayMode · targetHourKst | O | O | O(이미 잡힌 다음 발송 시각은 그대로 · 확인 창 고지) | X | X |
| 구조 | channel · isAd · stepType · conditionJsonb · 알림톡 · mmsImagePaths | O | O | **X(새 판)** | X | X |
| 운영 표시 | notifyManagerOnPretest | O | O | O | **O** | X |

  - 동작 변경 2(의도): ①멈춤 + 진행 중 여정의 구조 키 거부(지금 허용 · 기존 화면 3곳은 이 키를 보내지 않음) ②켜진 여정의 담당자 알림 토글 허용(지금 500).
  - 진행 중 수는 여정 잠금 안에서 센다(`withJourneyValidationReset` 안) · 거절 = `JourneyStepGateError('STEP_EDIT_LOCKED')` → 409.
  - 켜진 여정 이미지 = 구조(지금과 같음 · 스냅숏에 이미지가 없어 사전검사 없이 나감 · `journey-builder.ts:1169`).
- 저장 = 칸 하나씩 · 켜진 여정 문안 저장 확인 = 고정 사실("발송 2시간 전 다시 검사 · 걸리면 자동 고쳐 쓰기 1크레딧 · 그래도 걸리면 자동 일시정지").
- 덤: 서랍 응답 읽기 결함(`d.detail.steps` → `d.steps` · `routes/ai.ts:3862`) · PATCH 에 `delayMode` · `targetHourKst` 전달.

## 5) AI 진단(빈 곳 찾기 확장 · 같은 CT · 같은 라우트 · AI 0 · 차감 0)

- **구매 리듬 실측**(`journey-opportunities.ts` · 회사 **현역 문 하나**(`currentPurchaseDoor`)만 · 730일 · 회사당 24시간 캐시는 리듬 사실만): 첫→둘째 구매 간격 p25/p50/p75 + 표본 · 구매 간격 p50/p75/p90 + 표본 · 구매자 · 재구매자. 상품별 주기 = `journey-product` CT(`listObservedProducts` 상위 + `suggestUsagePeriod`) 재사용(새 SQL 0).
- 이탈 기준일 = 구매 간격 p90 clamp 30~365(표본 ≥ 5) — 기존 "마지막 구매 후 경과일" 분포 기준을 대체(두 벌 금지). 표본 미달이면 휴면 · 재구매 주기 카드를 내지 않고 "표본 부족"을 적는다.
- **flowPlan**: 레인마다 시작 사건(계약) · 제목 · 칸 수(1~4) · 측정 간격(D+N) · 근거 줄 · 표본 · 계산 시각. 상품 후보(키 · 이름 · 측정 주기 · 표본). 견적(초안 단가 × n · 켜기 단가 × n). 연동 잠금 · 표본 미달 · 관측 0 = 상태 문구(숨기지 않음). 출처 줄 "숫자는 구매 원장 실측".
- 간격 규칙(순수 함수 · 근거 노출): 가입 = 0 · 2 · 5일(가입일 칸이 없어 측정 불가 → 고정 · "참고 간격"으로 표기) · 첫 구매 = 1일 · 첫→둘째 p50 · p75 · 재구매 = 3일 · 간격 p50 · 휴면 = 0 · 7일 + dormant_days = p90 · 휴면 복귀 = 1일(같은 dormant_days).
- **[이대로 초안 만들기]**: 흐름 = 새 라우트 `POST /operator/journeys-reco/design {recoId, triggerEvent}` → 서버가 flowPlan 을 다시 계산해 그 계획으로 `designJourneyFromInterview`(같은 차감 · 같은 멱등 · 요청 키 = recoId) · 생성기 입력 `timing` = 간격 · 칸 수를 프롬프트에 싣고, 프리셋 고정 **뒤**에서 같은 값으로 다시 덮음(순서 테스트) · 휴면 2종은 같은 dormant_days. 상품 = 기존 `product/create`(키 · 주기 미리 채움 · 관측 목록 밖 거부 · 첫 문자 = 사용 기간 그대로). 만든 뒤 기존 모두 켜기 창(겹침 해소 필수 · 자동 켜기 0). AI 는 문안 · 이름만 · 혜택 비움.
- 화면에 본 간격과 저장 간격이 다르면(캐시 갱신) 결과 줄에 "다시 계산되어 바뀜".
- 지도 위 점선 미리보기 체인은 하지 않는다(창 안에 칸 줄로 미리보기).

## 6) 시연 회사 재구성 — 새 시연 회사(`setup-demo-company.ts --rebuild`)

- 이유: 오늘 만든 회사라 예열 손실 0 · 되돌릴 수 없는 삭제 0 · v1 무작위 이력 섞임 0 · 고객 재적재 · 결과 테이블 쓰기 0.
- 순서(단계마다 다시 실행해도 같은 결과):
  - ⓪ 판정: hanjulai 소속 회사가 is_demo 이고 v1 구매 키(`demo-seed-%`)가 있고 v2 키(`demo-v2-%`)가 없을 때만 은퇴. 아니면 은퇴를 건너뛰고 이어 간다(다시 쳐도 새 회사를 은퇴시키지 않음).
  - ① 한 트랜잭션: 옛 사용자 login_id → `hanjulai_<옛 회사 id 앞 6자>` · 옛 회사 company_code → `HJDEMO_<같은 6자>`(20자 안) · 바뀐 행 1 · 'hanjulai' 0 확인.
  - ② 옛 회사 세션 끊기(`invalidateCompanySessions`).
  - ③ 옛 회사 여정 멈춤(`pauseJourney`) · 자동마케팅 보관(`archiveOperator` · 예약 제안 취소) — 은퇴 표식 회사 대상으로 매번 다시.
  - ④ 기존 시드 흐름(새 회사 · hanjulai · 첫 로그인 비밀번호 변경).
- 시크릿 파일: 키 줄이 이 회사 api_key 와 같을 때만 비밀 채택 · 파일 쓰기를 해시 저장보다 앞에.
- **demo-data v2**: 상품 `cycleDays`(소모품만) · 고객마다 결정적 타임라인(가입일 · 첫 구매까지 = 같은 날 25% · 1~6일 25% · 7~20일 15% · 60일 안 없음 35% · 주력 상품 1~2개 · 주기 ±15% · 회차마다 이탈 15% · 일부 복귀) · 시드 이력 끝 = **어제** · 매일 워커 = 전 번호 타임라인에서 그날 구매만 · source_row_key `demo-v2-…` · 고객 누적값 = 원장 재계산 · 여정 소속을 읽고 구매자를 고르지 않음 · journey_* 직접 쓰기 0. 같은 날 가입 구매 25% 는 그대로(§3-6 안내문이 사실을 말함 · 데이터로 감추면 목업).
- 시드 여정 7(고정 문안 · AI 0 · 간격 = §5 실측 CT 를 시연 데이터로 돌린 값 · 표본 미달이면 §5 기본): 가입 환영 3 · 첫 구매 감사 3 · 단골 재구매 2(`exclude_first_purchase` = 옵션 정규화 경로) · 상품 2(관측 상위 소모품 · `journey-product` 키 대조 · 안 맞으면 시드 중단 · 첫 문자 = 사용 기간) · 휴면 2 + 휴면 복귀 1(같은 dormant_days) · 생일 자동마케팅 유지. 켜기 = `activateJourneysInOrder`. 주문 완료 ↔ 상품 겹침 배지는 숨기지 않음.
- 회신번호: 시드만 `callback_numbers` 에 DEMO_CALLBACK(0100 도달 불가) 1행(is_default · 없을 때만) · sender_numbers 미사용 · 사람 입구 demoBlock 그대로 · 최후 방어 CT throw 그대로.
- 운영: 새 싱크 키 → `~/demo-sync.env`(600) → Harold 가 .env 두 줄 교체(값 출력 없이) + 재기동. 예열: 휴면 레인은 이관 유예 7일 뒤부터 · 지도 숫자는 2~4주.

## 7) 범위 밖(기록)

- 상품 여정 고객을 주문 완료에서 빼는 워커 키(엔진 동작 확장 · 별도 안건).
- 싱크 회사: 고객과 구매가 같은 묶음 · 구매일이 진입 시각보다 앞 → 환영 + 첫 구매 둘 다(BUGS).
- 사전검사 스캔 창 밖(next_run_at ≤ NOW) 발송(BUGS).
- 겹침 해소 "필수"가 화면에만 있음 · `activateJourneysInOrder` 에 검사 없음(BUGS).
- 단계별 관계 공백 숫자 · 가입↔첫 구매 겹침 계약 등재.

## 8) 구현 기록

- 1009 코드 완료 · DDL 0. 파일 = 서버 `journey-step-edit-policy.ts`(신규) · `journey-builder.ts`(updateJourneyStep 게이트 · countInProgressExecutions) · `journey-lifecycle-map.ts`(숫자 한 벌 · computeMapLines · endNote · 안내문) · `journey-opportunities.ts`(AI 진단 · buildFlowPlan · recoRequestId · 기회 카드 기준) · `journey-product.ts`(loadPurchaseRhythm · loadProductCycles) · `journey-ai-generator.ts`(timing · applyRecoTiming) · `journey-interview-ai.ts`(timing 전달) · `routes/ai.ts`(PATCH delayMode · targetHourKst · GET journeys-diagnosis · POST journeys-reco/design) · `demo-data.ts`(v2) · `scripts/setup-demo-company.ts`(--rebuild · 여정 7) / 화면 `journey-map-layout.ts`(신규 · 순수) · `LifecycleMapCanvas.tsx`(재작성) · `MapStepEditModal.tsx`(신규 · MapStepDrawer 삭제) · `JourneyDiagnosisPanel.tsx`(신규) · `GapFinderModal.tsx` · `MapJourneyCard.tsx` · `JourneyStepStudio.tsx`(single · bare · stacked · lock 선택 속성) · `JourneyMapPage.tsx` · `journey-map.ts`.
- 설계와 다르게 한 것: 상품 띠는 첫 구매 열부터 오른쪽으로 가로 배치 · 칸 노드 종류는 왼쪽 굵은 색 테두리 대신 아이콘 색(디자인 점검 · "AI 티" 신호) · 추천 요청 키 = 내용에서 결정적(아래).
- 시연 데이터 실측(로컬 생성기 · 시드 기준): 고객 3,000 · 구매 10,855 · 첫→둘째 p50 40일 · 재구매 간격 p50 38 · p90 54일 · 상품 중앙값 토너 47 · 선크림 42 · 시트 마스크 22 · 클렌징 폼 31일.
- Codex 적대(gpt-6-astra) 5라운드 — 1R high 1 · medium 3(늦은 AI 응답이 다른 칸 덮어씀 · 통신 오류 시 부분 성공 유실 · 회사 생성 직후 실패 시 재실행 차단 · 365일 몰래 자름) → 2R medium 3(창 언마운트로 요청 키 소멸 · 본문 파싱 실패 우회 · 시스템 싱크 계정이 빈 회사 판정 막음) → 3R high 1(페이지 재진입 시 요청 키 새로 생김) = **같은 부류 세 번째 → 구조 정정: 요청 키를 화면 무작위 값이 아니라 요청 내용에서 결정적으로**(추천 = 서버 recoRequestId · 상품 = 화면 해시 · 2R 페이지 보관 장치 걷어냄) → 4R medium 1(날짜를 키에 넣어 자정 넘긴 재시도가 다른 요청) → 키에서 날짜 제거 → **5R approve(지적 0)**.
- 검증: backend tsc 0 · frontend tsc 0 · vitest 597파일 8,421건 · vite build · 변이 2건(sender_off · 편집 정책)에서 테스트 실패 확인 · 회귀 = `journey-crm-map-1009.test.ts`.
