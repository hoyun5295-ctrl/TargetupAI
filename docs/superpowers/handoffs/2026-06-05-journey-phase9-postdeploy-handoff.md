# 2026-06-05 핸드오프 — 여정 Phase 9 완료 + 배포후 map 누락 fix

## 이번 세션 결과
- **Phase 9 전부 구현·배포**: 미리보기=실발송 통일(시뮬 `matchTriggerCustomers` 폐기→`selectJourneyTargetCustomerIds` 재사용 + `countJourneyTargetCustomers`), 실데이터 예측(임의 상수 제거, `avg_order_value`·`purchase_likelihood`·`companies.cost_per_*`), 시점 N일+시각(`relative_at_hour`), 여정 옵션 PATCH, 타임라인 라벨.
- **배포후 운영 실측 버그 1건 발견·수정(203b55f5)**: 발송 시각 저장 안 됨 = `journey-builder.ts:246` `createJourneyFromTemplate`의 `input.steps.map`이 step 재생성 시 `delayMode`·`targetHourKst`·알림톡 6필드·`mmsImagePaths`를 안 담음. 9필드 보존 + 일 상한 720h→8760h.
- 상세 = `memory/project_2026_0605_journey_phase9_done.md`, 교훈 = `LESSONS_BACKEND.md` 2026-06-05 블록.

## 운영에서 실측 확인됨 (신뢰 높음)
- **신규가입 baseline anti-blast**: baseline 20,000 = 회사 고객 20,000, entered 0. → 과거 "2만 명 일괄 폭발" 사고가 운영에서 차단됨이 입증(가장 큰 위험 = 대량 오발송 = 막힘).
- **발송 시각 저장**: 새 여정 3 step `relative_at_hour`/`target_hour_kst=10` 정상.
- **생일 trigger 추출 규모**: 생일 여정(975db109) active 59 = 2026-06-05 하루치 D-7 코호트(고객 2만 / 365 ≈ 55와 일치). 한 날짜 정상 규모 진입 = 폭발 아님 입증. (단 일시정지로 실제 step1 발송은 미실행 — 발송 한 방은 미검증.)

## 코드만 검증, 운영 미실측 (다음에 스모크 테스트 필요)
- **실제 발송 흐름**: 신규 가입자(진입 원장에 없는 새 번호) 1건 추가 → 5분 워처 → step1 실제 발송 + 시각/본문/(광고)/무료거부 정상? — 아직 0건이라 미확인.
- 시뮬레이터 실데이터(매칭 수·등급·객단가·전환·비용), `countJourneyTargetCustomers` 화면 표시.
- 여정 옵션 PATCH(임계·예산·포인트 저장/반영).
- 타임라인 라벨(`getJourneyDetail` timingLabel/conditionLabel) 화면.
- cdp(재구매·예약·장바구니)·휴면·생일·포인트 trigger 추출·발송.
- 묶음 발송(Phase 5 staging)·조건평가 안전분기(Phase 7)·스팸 2h 전(Phase 6B).

## 다음 세션 권장 — de-risk 스모크 테스트 (Harold/직원 직접)
1. 테스트 회사에 새 번호 가입자 1건 추가 → 신규가입 여정 step1 실제 발송 + 시각·본문 확인.
2. cdp.purchase 이벤트 1건 발생 → 재구매 여정 진입·발송 확인.
3. 여정 옵션 패널 저장 → DB 반영 확인.
4. 시뮬레이션/미리보기 숫자 = 실제 추출 일치 확인.

## 남은 개발 (선택)
- 저장된 여정 발송 시각 편집 컨트롤 — `JourneyMessageEditModal`에 현재 없음(백엔드 PATCH·target_hour_kst는 지원). 기존 여정은 시각 변경하려면 재생성 필요.
- 기존 2개 여정(재구매·신규가입)은 버그 상태로 저장됨 → 재생성해야 발송 시각 반영.
- cdp 미리보기 "추정" 배지(minor).

## 솔직한 현황 평가
- 가장 무서운 사고(조건 안 맞는 대량 오발송)는 baseline anti-blast로 **운영 입증**됨 — 그 위험은 막혔다.
- 이번 시간 버그는 "발송이 안 되거나 시각이 누락"되는 쪽 = 사고가 아니라 불편/누락 계열. PM2 로그 + 생성→DB 왕복 실측으로 빠르게 잡힘.
- 다만 Phase 9·엔진 상당 부분이 "코드 검증"만 됐고 실제 발송 흐름은 미실측 → 옵셔널 필드/통합 경로에 숨은 누락이 더 있을 수 있음(이번 map 누락처럼). "완료 선언"보다 위 스모크 테스트로 실발송 1건씩 확인하며 신뢰를 쌓는 단계가 맞다.
