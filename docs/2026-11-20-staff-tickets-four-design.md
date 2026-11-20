# 그룹웨어 오류접수 넷 + AI 한줄로 접수 설계서(2026-11-20)

> 흐름 표 = [2026-11-20-staff-tickets-four-flow-ledger.md](2026-11-20-staff-tickets-four-flow-ledger.md)(범위 = 그 표 전체 · 결함 D1 ~ D15 · 개선 E1 · E2-1 · E2-2 · E4)
> 플레이북 = `status/DEFECT-PLAYBOOK.md` 3단계 · 카드 = 구현 뒤 STATUS-FEED 등재 · 뿌리 대장 줄 = 구현 커밋에 등재(번호가 그 사이 쓰이면 다음 번호)
> Harold 1120 「결함은 다신 반복적인 문제가 일어나지 않도록 뿌리까지 뽑도록」 → 「이것까지 수정(T5)」 → 「완벽한 설계서 · 닫힐 때까지 코덱스 · 구현 · 구현 코덱스 닫힐 때까지 · 보고」

## §0 미가입 · 직접발송만 쓰는 회사 = 동작 변화 0 증명

| 바뀌는 자리 | 그 회사가 닿나 | 변화 |
|---|---|---|
| 공용 변환기 · 날짜 · 숫자 · 나이 · 회사 칸의 **표 밖 기준** = 조건 빠짐 → `AND FALSE`(P2-1) | 직접 타겟 화면이 만드는 기준 = `customerFilterBuild.ts` 전부(나이 gte · lte · between · 숫자 gte · lte · between · 날짜 birth_month · days_within · 선택 칸 eq · in · 참거짓 eq · 글자 contains) = 모두 표 안 | SQL 0 바뀜 |
| 변환기 새 기준 `days_passed` · 회사 날짜 칸 `days_within` · `days_passed`(P1-2) | 고르지 않으면 쓰이지 않음 | 0 |
| 직접 타겟 날짜 칸 기준 토글(P1-5) | 보이는 것 = 날짜 칸 위 「최근 N일 안 · N일 이상 지남」 토글 하나 · **기본값 = 지금 그대로(최근 N일 안)** · 칩 · 값 꼴 · 요약 글 그대로 | 고르지 않으면 보내는 조건 · 대상 수 0 바뀜 |
| 조건 모양 판정 CT(P2) | 쓰는 자리 = 자동마케팅 · 자동발송 · 세그먼트 · AI 한줄로(직접 타겟 화면 · 직접발송 발송 길 무접촉) | 0 |
| AI 문자 글 꼴 정리 CT(P6) | AI 가 쓴 글의 출구 셋에서만(생성 · 다듬기 · `sanitizeForSms` = AI 출력만 받음 · 소비처 전수 §3) · 사람이 쓴 직접발송 글 · 대행 원문 · 알림 문자 무접촉 | 직접발송에서 「AI 다듬기」를 누르면 그 결과의 꼴만 |
| 혜택 칸 답 채우기(P5) | AI 한줄로 생성 결과에서 자리표 자리만(판정 무변경 · 사람 글 무접촉) | 자리표 대신 사람이 적은 혜택 글자 · 조사 맞춤(자동마케팅 · 플래너 채운 글에도) |
| 브랜드 학습 예시 글(E1) | 기본정보 칸이 빈 회사 | 예시 글자 둘 |
| 발송 핵심 다섯 파일(`routes/campaigns.ts` · `spam-filter.ts` · `results.ts` · `billing.ts` · `utils/messageUtils.ts`) | 무수정 · `campaigns.ts` 는 변환기를 부름 → 바뀌는 것 = 표 밖 기준이 든 깨진 조건뿐(지금 = 그 조건이 빠진 넓은 대상 · 뒤 = 0명 차단) | 깨진 조건이 있을 때만 |

## §1 뿌리

| 뿌리 | 한 줄 | 결함 |
|---|---|---|
| **R100(새)** | 반복해서 쓰는 날짜 조건에 상대 기준(「N일 이상 지남」 · 회사 날짜 칸의 「최근 N일 안」)이 공용 조건 계약에 없어, 표현을 못 하거나(막힘) 등록일 고정 날짜로 굳는다 | D1 · D4 · D6 · D7 |
| **R101(새)** | 대상 조건의 모양(칸 · 기준 · 값) 판정이 한 곳에 없다 — 쓰는 자리마다 일부만 보고, 공용 변환기는 깨진 조건을 0명(값) 또는 말없이 뺌(기준)으로 닫는다 | D2 · D5 · D8 · D10 · D11 |
| **R102(새)** | AI 가 쓴 문자 글의 꼴(마크다운 · 가리킴 표시 · 강조 표시 자리 · 줄 머리 공백)을 정리하는 출구가 없다 — 사실(숫자 · 혜택 · 주소 있음)만 본다 | D13 · D14 · D15 |
| R33(넓힘) | 혜택 판정(값 · 종류 짝)은 지어낸 짝을 자리표로 바꾼다 — 사람 혜택 칸 답이 있는 생성 길 가운데 AI 한줄로만 그 자리를 답으로 채우지 않는다(자동마케팅 · 플래너는 채움 · 채우는 CT 가 길마다 손으로 걸림) | D12 |
| R1(넓힘) | 칸을 고른 뒤 기준을 정하는 규칙 두 벌 · 조건 문구 표 네 벌 · 날짜 프리셋 두 벌 | D3 · D9 · P1-5 |

## §2 처방(결함마다 1)

### P1 · R100 상대 날짜 기준(D1 · D4 · D6 · D7)

- **P1-1 기준 문구 표 한 곳**: `utils/customer-filter.ts` 에 `FILTER_OPERATOR_TEXT`(기준 → 사람 말 · days_within = 「최근 N일 안」 · **days_passed = 「N일 이상 지남」** · gte 이상 · lte 이하 · date_gte 이후 · date_lte 이전 · between 사이 · in 중 하나 · contains 포함 · birth_month 월 · eq 빈 글). 서버 문구 자리 둘이 이 표를 읽고(P4) 화면 표 셋은 계약 시험이 대조한다.
- **P1-2 변환 갈래(두 입력 형식 모두)**:
  - 표준 날짜 칸(structured `customer-filter.ts:326-365` · mixed `:544-583`): `days_passed` = `칸 <= kstDateMinusDays(new Date(), N)`(days_within 과 같은 함수 · 같은 N 판정 `/^\d{1,4}$/` · 아니면 `AND FALSE`) → **회차마다 그날(KST) 기준으로 다시 셈**. 칸이 빈 고객(NULL) = 빠짐(여정 `journey-target-extractor.ts:1203` · AI 한줄로와 같은 규칙).
  - 회사 날짜 칸(structured `:383-430` · mixed `:640-675`): `days_within` · `days_passed` = `customDateKeyExpr(칸)` 과 `YYYYMMDD`(kstDateMinusDays 의 하이픈을 뗀 값) 비교.
- **P1-3 자동마케팅**: 허용(`audience-translate.ts:66-71`)에 `days_passed` · 회사 칸 허용에 `days_within` · `days_passed` · 값 검사(`:154`)가 둘을 정수로 · 회사 칸 표본이 모두 날짜 모양이면 `dataType: 'date'`(지금 숫자 · 글자만 `:105-108` · 판정 = 변환기의 `isDateLikeValue` 와 같은 함수를 내보내 씀). 번역 지시(`services/ai.ts:1815-1829`)에 규칙 한 줄: 「날짜 칸 기간 말 = 최근 N일 안 · N일 이내 = days_within N · N일 이상 · N일 넘게 · 최근 N일 ~가 없는 = days_passed N · 반복 발송이라 기간 말을 오늘 날짜로 계산한 고정 날짜(gte · lte · date_gte · date_lte)로 쓰지 않는다 · 회사 날짜 칸도 같다 · unexpressed 도 같은 꼴」.
- **P1-4 자동발송 · 세그먼트 생산자**: 추천 주소 몸에 `recurring: true`(`AutoSendFormModal.tsx:377` 만 보냄) → `routes/ai.ts:368` → `recommendTarget` 옵션 `recurring` → 위 규칙 한 줄을 붙임(AI 한줄로 · AI 캠페인 = 한 번 발송 = 지시 글자 무변경). 세그먼트 생성기(`ai-segment-generator.ts:101-102 · 171 · 188`) = 허용에 days_passed · 규칙 9 를 「회사 날짜 칸도 days_within · days_passed(일수) · 기간 말은 고정 날짜로 쓰지 않는다」로.
- **P1-5 직접 타겟 날짜 칸**: 생일 아닌 날짜 칸 위에 「최근 N일 안 · N일 이상 지남」 두 칸 토글(기본 = 최근 N일 안 · 고른 값이 있으면 같은 N 으로 갈아 끼움) · 값 꼴 = `N`(지금) · `over:N`(새) → `customerFilterBuild.ts:107-116` 이 `over:` 를 `days_passed` 로. 프리셋(지금 두 벌 `DirectTargetFilterModal.tsx:196-200` · `TargetDirectPickPanel.tsx:53-57`) · 날짜 값 글을 `customerFilterBuild.ts` 상수 · 함수(`dateFilterValueText(v)` = `N` → 최근 N일 안 · `over:N` → N일 이상 지남 · `month:N` → N월) 하나로 · **소비처 = 날짜 값을 글로 그리는 자리 전부**(`TargetDirectPickPanel.tsx:185-189` 요약 · `customerFilterBuild.ts:286-288` `conditionChipLabel` 「… 이내」(Codex 설계 1R #4) · 소스 grep `startsWith('month:')` 로 뽑음). AI 한줄로로 넘기는 `toLineAudienceFilters`(`:300-322`)는 조건 객체를 그대로 넘기므로 days_passed 가 mixed 변환기로 간다(P1-2).

### P2 · R101 조건 모양 판정 한 곳(D2 · D5 · D8 · D10 · D11)

- **P2-1 변환기 = 판정의 원천 · 표 밖 기준 = 0건**(값이 틀린 조건과 같은 0건 차단 정책 · 2026-08-14 · 지금 = SQL 0 = 조건 빠짐 = 대상이 넓어짐):
  - structured 기본 칸(`customer-filter.ts:233-272` 성별 · 등급 · 지역 · 수신동의 = eq · in 만) · 나이(`:293-308`) · 숫자 · 날짜(`:310-365`) · 회사 칸(`:383-430`)의 표 밖 기준 → `AND FALSE`.
  - mixed 나이(`:451-469`) = 지금 배열 `[최소, 최대]` · minAge · maxAge 만 받고 `{operator: gte|lte|eq, value}` 를 말없이 뺌(AI 칸 안내 `services/ai.ts:1670` 이 숫자 칸 = gte · lte 라고 알려 실제로 나오는 꼴) → structured 와 같은 기준(eq · gte · lte · between)을 받고 그 밖 = `AND FALSE`. mixed 숫자 · 날짜(`:528-583`) · 회사 칸(`:619-680`)의 표 밖 기준 → `AND FALSE`.
  - 글자 칸(마지막 갈래가 모든 기준을 받음) · mixed 등급 · 지역 · 성별(in 밖은 eq 로 읽음) = 무변경. 모르는 칸(키)의 변환 = 무변경(호출부가 판정 CT 로 막는다 · 일부 호출부가 일부러 넘기는 키가 있음).
- **P2-2 판정 CT**: `customer-filter.ts` `filterConditionIssues(filters, { format })` = 키마다 그 키 하나만 같은 변환기(같은 입력 형식 · 같은 store_code 모드 · mixed 는 `buildFilterWhereClauseCompat` 의 성별 정규화를 지난 값)로 바꿔 본다. 판정(Codex 설계 1R #1 = 「알려진 칸 + 값 + SQL 0」도 걸림):
  - `empty` = 값이 비어 변환이 건너뜀.
  - `invalid` = 값이 있는데 ① 변환이 던짐 ② `AND FALSE` 가 나옴 ③ 매개변수에 null · NaN(회사 날짜 칸의 달력에 없는 날짜) ④ **SQL 이 0**(알려진 칸의 표 밖 기준 · 모르는 칸 모두).
  - 판정 밖 = 그 형식이 일부러 건너뛰는 키만(mixed `phone` · `sms_opt_in` = 기본 WHERE 가 소유 · 표로 적고 계약 시험이 변환기 `SPECIAL_FIELDS` 와 대조).
  - 결과 = `{ field, reason }` · 칸 이름은 부르는 쪽이 붙인다(표준 = `displayName` · 회사 칸 = 라벨).
  - 계약 = 지금 거절되는 사례가 계속 거절(structured 성별 gte + 등급 eq · mixed 나이 표 밖 기준(contains) · 세그먼트 생성기 unapplied 옛 시험 기대값). mixed 나이 gte · lte · eq 는 P2-1 로 옮겨지므로 거절 사례에서 빠진다(구현 때 정정).
- **P2-3 「못 옮김」을 빈 조각으로 재던 자리 → 판정 CT**: 자동마케팅 `audience-translate.ts:207-211`(conditionsToFilters · 글자 값이 이제 `invalid` → AI 조건 = 고르기 · 사람 조건 = 400) · AI 한줄로 `services/ai-line.ts:136`(describeLineFilters → 「옮기지 못한 조건」) · 세그먼트 `ai-segment-generator.ts:313-326`(unapplied). `validateCondition` 의 날짜 이상 · 이하 「아무 글자 통과」(`:157-160`)는 남기되(값 꼴 검사는 변환기 한 곳) 판정 CT 가 뒤에서 거른다. 전체 고객 신호(`all-customers-signal.ts:58`)는 무변경(표 밖 기준 = 이제 빈 조건이 아니라 0명 = 0건 차단).
- **P2-4 쓰는 자리**: 자동발송 새로 · 수정(`routes/auto-campaigns.ts:386-390 · 631-632`) · 세그먼트 저장(`routes/saved-segments.ts:36-57 · 75-79`) = 판정에 걸리면 400 `TARGET_CONDITION_INVALID` · 「「{칸 이름}」 조건을 쓸 수 없어요. 대상 조건을 다시 만들어 주세요.」(칸 이름 = 표시 이름 · 내부 키 0).
- **P2-5 실행 자리**: 자동발송 워커 발송 갈래(`auto-campaign-worker.ts:783-789` 빈 조건 갈래 바로 뒤) = 판정에 걸리면 `markFailed`(같은 꼴 · 5회 누적 = 자동 일시정지 · 운영 화면에 보임). 자동마케팅 회차 = 등록 판정 + 변환기 0건 차단(옛 행 0 = 흐름 표 M1).

### P3 · R1 칸 고른 뒤 기준 = 서버 한 곳(D3)

- 서버 CT(`audience-translate.ts`): `pickKindsFor(src)` = 그 말(unresolved 또는 앞 조건)의 기준 · 값이 받는 칸 종류(날짜 전용 기준 = date · gte/lte/between + 숫자 값 = number · 날짜 꼴 값 = date · eq/in/contains = string · number · **기준 없음 = number · string**(날짜는 방향을 짐작하지 않는다)) · `conditionForPick(src, option)` = 맞으면 `{ term, field, operator, value }`(기준 없음 = 숫자 gte 1 · 글자 eq 표본 · 지금 그대로) · 안 맞으면 null.
- `translateAudience` 의 사람 조건 중 **기준이 없는 것**(화면이 칸만 보냄) = 보관본(carry)에서 같은 말의 unresolved · 앞 조건을 찾아 `conditionForPick` · null 이면 `AudienceConditionError`(「「말」은(는) 「칸」 칸으로 볼 수 없어요. …」).
- 고르기 목록 = 그 말과 안 맞는 칸은 잠금 + 사유: 인터뷰 질문(`automarketing-interview.ts:78-91` · 서버가 바로 판정) · 승인 창(`OperatorPreviewModal.tsx:460-484` · 미리보기 응답 `audience.pickKinds`(말 → 종류 목록 · `automarketing-preview.ts:518-525`)를 읽음).
- 화면 `applyPick`(`OperatorPreviewModal.tsx:210-220`) = `{ term, field }` 만 보냄(기준 · 값 규칙 삭제) · 서버 `applyAnswers`(`automarketing-preview.ts:750-757`) = CT.
- 승인 창 기준 숫자 칸(`OperatorPreviewModal.tsx:424`) = `days_within` · `days_passed` 포함(일수를 고쳐 다시 세기).

### P4 · R1 조건 문구 한 벌(D9)

- 서버 = `describeConditions`(`audience-translate.ts:216-228`) · `filterChipText`(`ai-line.ts:300-322`) 가 P1-1 표를 읽음.
- 화면 표 셋(`OperatorPreviewModal.tsx:78` · `AutoSendFormModal.tsx:638` · 직접 타겟 요약 = P1-5 CT) = 계약 시험이 표의 모든 기준을 가졌는지 기계 대조(화면은 백엔드를 부르지 못함). `AutoSendFormModal.tsx:639` 의 `|| val.operator`(내부 키 노출) = 「기준 확인 필요」.

### P5 · R33 넓힘 · 혜택 칸 답으로 채움(D12)

> ★ Codex 설계 2R — 1R 의 「수단 짝」(사람 글에서 쿠폰을 주려는 뜻을 낱말 목록으로 읽기)은 1R #2 · 2R #1 · #2 로 같은 부류가 두 번 나왔다. 자유 문장에서 뜻을 추측하는 규칙은 반례가 끝이 없다(금지형 「보내지 마세요」 · 혜택 아닌 금액 「평균 구매금액 3만원」) → **판정을 넓히지 않는다.** 구조 처방 = 지어낸 혜택 자리를 사람이 혜택 칸에 적은 답 글자 그대로 채운다(이미 자동마케팅 · 플래너가 쓰는 길).

- **판정 무변경**: `copy-benefit-detector.ts` 값 · 종류 짝 판정 · 자리표 바꾸기 그대로(「30% 할인 쿠폰」 = 지어낸 짝 = 자리표).
- **혜택 칸 답 채우기 CT = `autosend-policy.ts:404-414` `applyBenefitToBody` 하나**(지금 소비처 = 자동마케팅 `ai-orchestrator.ts:621` · `operator-final-copy.ts:89-90` · 플래너 `planner-copy.ts:204-248`): AI 한줄로 생성(`services/ai-line.ts` 카드 본문 · 제목 = 생성 출구 뒤)이 `input.facts.benefit`(사람이 혜택 칸에 적은 답 · 비면 지금처럼 자리표 = 발송 길목이 막음)으로 같은 CT 를 지난다. 결과 = 「30% 할인 쿠폰을 드려요」 → 자리표 → 「30% 할인행사를 드려요」(사람 글자 그대로 · 쿠폰 짝은 남지 않음 · 지어낸 값이 들어갈 길 0).
- **채우는 자리 = 시스템이 만드는 혜택 값 자리표 정확한 목록만**(Codex 설계 3R #1): `copy-benefit-detector.ts` 가 소유하는 `BENEFIT_VALUE_PLACEHOLDERS` = `BENEFIT_PLACEHOLDER`(`[혜택 안내: 직접 수정해주세요]` · 지어낸 혜택 바꾸기 · 목소리 뼈대 혜택 칸) · `[혜택 내용을 입력해주세요]`(AI 실패 비상 문안 · `services/ai.ts:2184`) — 문자 생성 길이 만드는 혜택 값 자리표는 이 둘뿐(소스 grep · 문자 생성 지시문에 다른 혜택 자리표 문구 0). 대괄호 안 공백 차이만 허용. 그 밖 `[혜택…]`(「[혜택 적용 기한: 직접 입력해주세요]」 같은 다른 입력 자리 · 「[혜택몰]」 같은 정상 표기)은 그대로 둔다(다른 입력 자리는 발송 길목 `AI_FILL_DIRECT_PATTERN` 이 계속 막는다). `applyBenefitToBody` 의 옛 넓은 꼴(`/\[혜택[^\]]*\]/`)을 이 목록으로 좁힌다 = 자동마케팅 · 플래너도 같은 범위(목록 밖 꼴은 이제 채우지 않고 발송 길목이 막는다 = 덜 보내는 쪽).
- **조사 맞춤**(같은 CT 안 · 소비처 전부 같이): 채운 자리 바로 뒤에 붙은 짝 조사(을/를 · 이/가 · 은/는 · 과/와 · 으로/로 · 그 뒤가 한글이 아닐 때만 = 「이번」 같은 낱말은 조사 아님)면 채운 글의 마지막 글자 받침으로 고른다(한글 음절만 · 숫자 · 영문 · 기호로 끝나면 그대로 · ㄹ 받침 + 으로 = 로).
- **바이트 칸 = 마지막 본문으로 다시 셈**(Codex 설계 3R #2 · 같은 뿌리 = 글을 바꾼 뒤 파생 값을 옛 값으로 둠): 글을 바꾸는 자리 둘 다.
  - AI 한줄로 카드 `byteCount` = 채우기 · 꾸미기(`services/ai-line.ts:653-675`)가 모두 끝난 마지막 본문으로.
  - 자동마케팅 제안(`services/ai-orchestrator.ts:601-621`) `byteCount` · `byteWarning` = 채우기(`:619-621`) 뒤 본문으로.
  - 계산 = 문자 길이 판정 CT `message-byte.ts` `eucKrByteLength`(코드 포인트마다 128 미만 1 · 그 밖 2). 광고 합계 = **실제 발송 합성 문자열**(`messageUtils.ts:450` `buildAdMessage(본문, 'SMS', true, 080 번호)` = 발송 길이 쓰는 그 함수 · 부르기만 · 보호 파일 무수정)의 `eucKrByteLength`(Codex 설계 5R) — 지금 `services/ai.ts:1441-1446` 의 손 계산식(6 + 1 + 8 + 번호 자리)은 버리고 생성기 · 제안이 이 한 함수를 부른다(같은 결과 = 보통 꼴 · 다른 결과 = 본문에 이미 (광고) · 꼬리가 있거나 끝 줄바꿈이 여럿인 꼴 = 합성 함수가 맞음). 생성기의 옛 `calculateKoreanBytes`(UTF-16 단위마다 127 초과 2)와 다른 글자 = 한 쌍 대리 글자(이모지 · 문자 채널에서 정리 단계가 이미 지움)뿐.
  - SMS 만 값을 내는 지금 꼴 유지 · SMS 90바이트 넘는 카드 = 화면 경고 · 발송 전 확인 · 발송 길(C143 길이 CT)이 막는다(새 갈래 0).
  - **AI 한줄로 화면의 SMS 길이 = 실제 합성 길이**(Codex 설계 6R): 지금 화면 경고(`AiLinePage.tsx:1575-1589 · 1894`)는 자체 꼴(「(광고)\n본문\n무료거부 080-…」)로 세고 080 번호가 비면 합성을 건너뛰어 본문만 세며(경고 누락 → 발송 길에서 통째로 제외), 발송 전 확인(`:988-993`)은 본문만 센다 → 둘 다 화면의 광고 합성 미러 `formatDate.ts:1043` `buildAdMessageFront(본문, 'SMS', isAd, 번호)`(다른 화면 다섯이 이미 쓰는 서버 `buildAdMessage` 미러)의 결과를 `calculateSmsBytes` 로 센다. **카드에 보이는 글(`activeBody` 표시)은 그대로**(셈만 바꿈). 미러 일치 = 계약 시험(같은 입력 표에서 `buildAdMessageFront` = `buildAdMessage`).
- 혜택 칸 답이 없는 생성 길(AI 캠페인 · 견본 · 여정 등) = 지금처럼 자리표(사람이 채움 · 발송 길목이 막음). DM · 이메일 한 줄 = 혜택 값을 코드가 놓는 길(`line-template-run.ts:64` · `one-line-ct/index.ts:235`)이라 해당 없음.
- 계약 = 「사람 혜택 칸 답을 받는 문자 생성 길은 모두 `applyBenefitToBody` 를 지난다」(소스에서 `facts.benefit` · `benefitContent` · `benefitText` 를 생성에 넘기는 자리 추출) · 1R · 2R 반례 셋(「쿠폰은 사용하지 마세요」 · 「쿠폰 보내지 마세요」 · 「평균 구매금액은 3만원」)에서 판정이 지금과 같음(넓힘 0).

### P6 · R102 AI 문자 글 꼴 정리(D13 · D14 · D15)

- **새 CT** `utils/ai-sms-layout.ts` `tidyAiSmsLayout(text)`(순수 · DB 무의존):
  1. 마크다운 링크 `[글](주소)` → **실제 목적지(주소 = href)는 글자 그대로 보존**(Codex 설계 1R #3): 글이 주소와 글자 그대로 같거나 주소에서 `https://` · `http://` 만 뗀 것과 글자 그대로 같으면 → **주소**, 글이 링크 모양이 아니면 → `글 주소`, 글이 다른 링크면 → **주소**(표시 글을 버리고 목적지를 남김). 대소문자 · 경로 · 질의는 바꾸지 않는다.
  2. 짝 맞은 굵게 `**글**` · `__글__` → 글(단독 `*` 은 그대로 = 주석 표시로 씀).
  3. 줄 끝 가리킴 표시(▶ ▷ ☞ ➜ ➡ → »)가 있고 다음 빈 아닌 줄이 링크로 시작하면 → 표시를 그 링크 줄 앞으로(`…확인해 보세요 ▶` + `주소` → `…확인해 보세요` + `▶ 주소`).
  4. 문장 끝(요 · 다 · 죠 · 니다 뒤 [.!?~]* · 또는 [.!?]) 뒤 공백 + 강조 표시(★ ☆ ● ○ ◆ ◇ ■ □ ※ ♥ ♡ ▶ ▷) + 공백 = 표시 앞을 줄바꿈으로(`알려드려요 ★ 이번 주말` → `알려드려요` + `★ 이번 주말`). 문장 끝이 아니면 그대로(「만족도 ★★★★★」).
  5. 줄 머리 공백 · 탭 지움 · 줄 안 겹 공백 하나로(이모지가 지워진 자리 · D14).
  - 규칙 2 ~ 5 는 **링크 구간(`voice-form-slots.ts` `linkSpans` · 한 곳) 밖에서만** 바꾼다(`/__VIP__/` 같은 경로 · 질의 무접촉 · Codex 설계 1R #3). 규칙 1 이 먼저(마크다운이 풀린 뒤 링크 구간을 잡는다).
- **출구 셋(AI 글만)** · 순서:
  - 생성 출구 `copy-exit-guards.ts` = 링크 되돌림 · 생략 · 정해진 링크(`ensureOnceLink`) · 브랜드 링크(`:211-226`) **뒤** · 전송자 이름 앞(링크가 다 놓인 뒤라 같은 주소를 두 번 붙이지 않음 · 규칙 1 이 href = 정해진 링크 글자를 남긴다).
  - 다듬기 `services/ai.ts:2627` `stripIncompatibleEmojis` 바로 뒤 · 주소 빠짐 판정(`rewriteDropsLinks`)의 원문 쪽 = **원문의 실제 목적지**(원문에 마크다운이 있으면 규칙 1 만 적용한 글 = href 보존) · 결과 쪽 = 정리한 글(목적지가 원문과 글자 그대로 다르면 그 후보를 뺀다 = 지금처럼).
  - `sanitizeForSms`(`message-sanitizer.ts:289` · 소비처 = 여정 생성 · 수정 · 운영자 꾸미기 · 변형 = AI 출력만 · §3) 맨 앞.
- 사람이 쓴 글(직접발송 · 대행 원문 · 알림 · 회사 리마인드 입력 = `stripIncompatibleEmojis` 다른 소비처)은 무접촉.

### 개선(원문 그대로 1안)

- **E1**: `BrandBasicInfoTab.tsx:92` 「예: 한줄로」 · `:93` 「예: 주식회사 인비토」.
- **E2-1**: `InterviewModal.tsx:344-360` 번호 칸 = 서버가 기본 번호를 정하지 못할 때만(`prepared.callback.defaultPhone` 이 빔 = 등록 2개 이상 · 기본 없음 · `journey-draft-save.ts:26-30` · 상품 창 `ProductJourneyModal.tsx:118` 과 같은 판정) · 등록 0 안내 그대로 · 서버 무변경. **보내는 번호 = 칸이 숨으면 `defaultPhone` 하나**(세션 복원 `:94-112` 의 옛 `callbackPhone` · 재시도는 숨은 칸에서 번호를 정하지 않는다 · Codex 설계 1R #5) · 칸이 보이면 고른 번호 · `canBuild` 도 같은 값으로.
- **E2-2**: 만든 직후 「작업 화면 열기」(`:490`) · 계획 「열기」(`:407`) → `JourneysPage.tsx:2851` 가 `openWorkspace(id, 'start')` · `JourneyWorkspace.tsx:364-371` 첫 칸 규칙에 「주소 칸 = start = 그 여정을 처음 열 때 한 번 시작 칸」(같은 여정에서 다시 읽을 때 사람이 고른 칸을 덮지 않음). 다른 길 · 지도 창 무변경. 계약 `c103-intake-contract-1105.test.ts:64-74` 기대값을 새 판정으로.
- **E4**: 코드 0. 근거 = 충전 원장 칸 8개에 반영 뒤 잔액 없음(Harold 1120 서버 출력) · C · D · B 발송ID 반영 순간 잔액은 중계 서버 PAY 엔진 안에만 · 같은 탭 맨 위 「발송ID 잔액」 카드(`AgentChargeRequestTab.tsx:228-`)가 지금 잔액을 이미 보임(앞서 추천한 「충전 내역 머리에 지금 잔액」은 같은 값을 한 번 더 보이는 것이라 거둠). 직원 회신 = §5 시트 4.

## §3 영향표

**공용 변환기(P1-2 · P2-1) 를 부르는 자리 = 소스 grep 21곳**

| 부르는 자리 | 깨진 조건(표 밖 기준) 지금 → 뒤 | 정상 조건 |
|---|---|---|
| `routes/campaigns.ts` ×3 · `utils/campaign-split.ts` · `target-count.ts` ×2 · `target-sample.ts` · `routes/targets.ts` · `routes/dm.ts` · `email-channel.ts` · `inapp-segment-matcher.ts` | 빠진 넓은 대상 → 0명(차단) | 0 변화 |
| `auto-campaign-worker.ts` ×3 · `routes/auto-campaigns.ts` ×2 | 빠진 넓은 대상 매 회차 → 저장 400 · 발송 markFailed | 0 변화 |
| `operator-recipients.ts` ×5 · `operator-audience.ts` · `operator-performance-estimator.ts` · `audience-translate.ts` | 0명(등록 판정에서 먼저 거절) | 0 변화 |
| `services/ai-line.ts` ×2 · `services/ai.ts` · `routes/ai.ts` ×4 | 「옮기지 못한 조건」 같음 · 값이 틀린 조건 = 0명 → 「옮기지 못한 조건」 | 0 변화 |
| `ai-segment-generator.ts` ×2 | unapplied 같음 | 0 변화 |
| `all-customers-signal.ts` ×2 | 빈 조건(막힘) → 0명(막힘) | 0 변화 |
| `customers.ts`(structured · 직접 타겟 목록 · 수 세기) | 화면이 표 밖 기준을 만들지 않음 | 0 변화 |

**꼴 정리 CT(P6)를 지나는 자리**: 생성 출구(AI 한줄로 · AI 캠페인 · 자동마케팅 · 견본) · 다듬기(AI 한줄로 · 직접발송 · DM 의 「AI 다듬기」) · `sanitizeForSms`(`journey-ai-editor.ts:115-116` · `journey-ai-generator.ts:662-663 · 974 · 1088-1089 · 1257` · `operator-message-decorator.ts:110-111 · 122` · `variant-generator.ts:177`).
**혜택 칸 답 채우기(P5)**: 판정 소비처 무변경 · `applyBenefitToBody` 소비처 = 자동마케팅 둘 · 플래너 넷 + AI 한줄로(새) · 조사 맞춤은 다섯 모두.

배포 전 실측 = 켜진 자동발송 · 세그먼트 · 자동마케팅 가운데 판정에 걸리는 행 수(§6 M4 · 그 행은 배포 뒤 다음 회차부터 markFailed · 담당자 안내 대상).

## §4 계약 시험(뿌리마다 소스에서 기계로 뽑음 · 변이로 빨간불)

| 뿌리 | 시험 | 변이 |
|---|---|---|
| R100 | `FILTER_OPERATOR_TEXT` 의 날짜 기준마다 × 두 형식 × 표준 · 회사 칸 = SQL 이 나오고, 기준 시각을 하루 옮기면 매개변수가 하루 옮겨짐 · 반복 생산자 지시문 셋(자동마케팅 번역 · 추천 recurring · 세그먼트)에 상대 기준 규칙이 있고, 한 번 발송 지시(recurring 아님)는 글자 무변경 · 직접 타겟 프리셋 · 요약 = CT 한 곳(화면 두 파일에 프리셋 배열 0) | days_passed 갈래 끔 · 지시 줄 지움 · 프리셋 한 벌 되살림 |
| R101 | 두 형식 × 칸 종류(기본 · 나이 · 숫자 · 날짜 · 회사 · 글자) × (표 밖 기준 · 틀린 값 · 빈 값 · 모르는 칸) = 변환 결과가 「그 조건이 빠진 SQL」이 아님 + 판정 CT 가 그 키를 짚음 · 지금 거절되는 사례 계속 거절(structured 성별 gte + 등급 eq · mixed 나이 gte → 이제 mixed 나이 gte 는 SQL · 세그먼트 생성기 unapplied 옛 기대값) · 판정 밖 키 표 = 변환기 `SPECIAL_FIELDS` 의 기본 WHERE 키와 같음 · **쓰는 자리 전수**(소스에서 `target_filter` · `filter_jsonb` 를 INSERT · UPDATE 하는 라우트 추출)마다 판정 CT 를 부름 · 워커 발송 갈래가 판정 CT 를 부름 · `sql.trim()` 으로 못 옮김을 재는 자리 = 전체 고객 신호 둘만 | AND FALSE 를 빈 조각으로 되돌림 · 판정 ④(SQL 0) 끔 · 쓰는 자리 하나에서 판정 지움 |
| R102 | 꼴 정리 표(마크다운 링크 = 글 = 주소 · 글 = 주소에서 scheme 뗀 것 · 글 = 다른 링크 · 글 = 링크 아님 · 대소문자 · 경로 · 질의가 다른 주소 · 굵게 · 단독 * · URL 안의 `__` · 가리킴 줄 끝 + 링크 줄 · 문장 끝 강조 · 문장 끝 아닌 강조 · 줄 머리 공백) · 정리 뒤 링크 = 정리 전 실제 목적지 글자 그대로(뺀 · 바뀐 목적지 0) · 출구 셋이 CT 를 부름(소스 추출) · 생성 출구에서 CT 가 링크 단계 뒤 · `sanitizeForSms` 소비처 = AI 출력 파일만(허용 목록 · 낡으면 실패) | 출구 하나에서 CT 지움 · 규칙 3 · 4 끔 · 링크 구간 보호 끔 |
| R33 | 판정 무변경(흐름 표 §4-2 실측 표 · Codex 1R · 2R 반례 셋 = 지금과 같은 결과) · 채우기 = 목록 자리표 둘 → 혜택 칸 답 글자 그대로 · **목록 밖 보존**(「[혜택 적용 기한: 직접 입력해주세요]」 · 「[혜택몰]」 · 둘이 섞인 글 · Codex 설계 3R #1) · 조사 표(받침 있음 · 없음 · ㄹ + 으로 · 숫자 · 영문 끝 = 그대로 · 「이번」 = 조사 아님) · 문자 생성 지시문 속 혜택 자리표 문구 = 목록 안(소스 스캔) · **혜택 칸 답을 받는 문자 생성 길 전수**(소스 추출)가 `applyBenefitToBody` 를 지남 · AI 한줄로 카드 본문 · 제목 · 카드 `byteCount` = 마지막 본문 `eucKrByteLength`(채우기 · 꾸미기 뒤 · Codex 설계 3R #2) · 광고 합계 = `buildAdMessage` 결과 길이(손 계산식 0 · 5R) · AI 한줄로 화면 SMS 경고 · 발송 전 확인 = `buildAdMessageFront` 결과 길이(080 번호 없음 · 기존 (광고) · 꼬리 · 끝 줄바꿈 여럿 · 6R) · `buildAdMessageFront` = `buildAdMessage`(같은 입력 표) | AI 한줄로 채우기 지움 · 조사 맞춤 끔 · 넓은 꼴 되살림 · 바이트 옛 값 · 화면 셈 자체 꼴 되살림 |
| R1(D3) | 「기준 기본값」 규칙 자리 = `conditionForPick` 한 곳(화면 applyPick 에 operator 규칙 0) · 날짜 칸 + 기준 없음 = 잠금 | 화면 applyPick 규칙 되살림 |
| R1(D9) | 기준 표의 기준마다 화면 문구 표 둘 · 서버 둘이 그 키를 가짐 · `|| val.operator` 0 · 직접 타겟 날짜 값 `N` · `over:N` · `month:N` 의 글 = 변환 결과 뜻과 같음(요약 · `conditionChipLabel` 모두 CT · 화면 파일에 「이내」 · 「최근 N일」 손 글 0 · Codex 설계 1R #4) | 화면 표 하나에서 days_passed 지움 · 칩 글 손 글 되살림 |
| 실 PG | days_passed(표준 · 회사 칸 · NULL 빠짐 · KST 경계) · 표 밖 기준 AND FALSE · 자동발송 저장 400 · 워커 판정 | |

개선 계약: E1 = 고객 화면 소스에 고객사 이름(backfill 목록) 0 · E2-1 = 번호 칸 조건 = `defaultPhone` 없음(상품 창과 같은 판정) · 칸이 숨으면 요청 번호 = `defaultPhone`(복원된 옛 선택 무시) · E2-2 = 만든 직후 길만 start · 한 번만.

## §9 Codex 설계 기록

- 1R needs-attention 5(전부 수용): #1 high 알려진 칸 + 값 + SQL 0 도 invalid(structured 성별 gte · mixed 나이 gte · P2-1 · P2-2 판정 ④ · 지금 거절 사례 계속 거절 계약) · #2 high 수단 짝이 부정 절 · 같은 값의 다른 혜택에도 붙음(P5 넷 조건) · #3 medium 마크다운을 풀 때 목적지가 바뀔 수 있음 · URL 안 서식 제거(P6 규칙 1 href 보존 · 링크 구간 보호 · 다듬기 대조 = 원문 실제 목적지) · #4 medium `conditionChipLabel` 이 over:N 을 「이내」로(P1-5 소비처) · #5 medium 세션 복원 번호가 숨은 채 실림(E2-1 = 숨으면 기본 번호). 같은 뿌리 판정 = 첫 라운드(직전 없음) · #1 = R101 · #3 = R102 · #4 = R1 · 각자 다른 자리.
- 2R needs-attention 2(둘 다 P5 · high): #1 금지형 「쿠폰 보내지 마세요」가 네 조건 통과 · #2 혜택 아닌 금액 「평균 구매금액은 3만원」이 쿠폰 금액으로. **1R #2 와 같은 부류 두 번째 → 개별 보완 금지 · 구조 처방**: 반복 원인 = 사람 자유 문장에서 뜻을 낱말 목록으로 추측(반례 무한) → 판정은 넓히지 않고, 지어낸 혜택 자리를 사람 혜택 칸 답 글자 그대로 채우는 이미 있는 CT(`applyBenefitToBody` · 자동마케팅 · 플래너)를 빠진 길(AI 한줄로)에 건다 + 조사 맞춤. 덧댄 네 조건 · 주는 말 · 부정 말 목록은 설계에서 걷었다(장치가 늘지 않고 줄었다). [범위 밖] 확인 = `routes/ai.ts:1862` · `automarketing-preview.ts:716 · 943` = 기준 없는 조건이 오면 AudienceConditionError(설계 그대로 · 943 은 저장된 조건 = 기준이 늘 있음).
- 3R needs-attention 2(전부 수용): #1 high 채우기 CT 가 모든 `[혜택…]` 을 덮음(다른 입력 자리 · 정상 표기) → 시스템이 만드는 혜택 값 자리표 목록 둘만 · #2 medium 채운 뒤 바이트 칸 옛 값 → 마지막 본문으로 다시 셈 · SMS 초과 = 지금 정책(C143). 같은 뿌리 판정 = 1R · 2R 과 다른 부류(#1 = 재사용 CT 의 맞춤 범위 · #2 = 바뀐 글의 파생 값).
- 4R needs-attention · 확정 결함 0(바이트 정의 · 화면 경고 · 생성 지시문 구간을 주지 않아 미판정) → 5R 에 구간을 준다. 같은 뿌리 전수 = 자동마케팅 제안도 채우기 뒤 바이트 칸 옛 값(`ai-orchestrator.ts:610-621`) → P5 바이트 항목에 더함 · 광고 합계 손 계산을 CT 로.
- 5R needs-attention 1 medium = 광고 합계를 손 계산식이 아니라 실제 합성 문자열로(수용 = `buildAdMessage` 결과의 `eucKrByteLength`). 반례의 87 / 91 차이 확인 = 서버 손 계산식(87)은 실제 발송 합성(SMS = 「(광고)」 + 본문 + 줄바꿈 + 「무료거부」 + 번호 숫자 = 87)과 같고 화면(91)이 줄바꿈 · 공백 · 하이픈을 더한 다른 꼴 → 화면 일치는 불수용(근거 = 화면 경고가 실제보다 보수적 · 접수 밖 · §7 기록). 같은 뿌리 판정 = 4R 에서 더한 바이트 항목의 정의 보완(새 부류 아님 · 장치 수 그대로).
- 6R needs-attention 1 medium = 5R 불수용 근거(「화면은 늘 보수적」)가 틀림 — 080 번호가 비면 화면이 합성을 건너뛰어 본문만 셈(ASCII 85자 = 화면 85 · 실제 합성 100) → 경고 없이 발송 길에서 통째로 제외. 수용 = 근거를 고치는 대신 화면 셈 두 자리(경고 · 발송 전 확인)를 실제 합성 미러 `buildAdMessageFront` 로(표시 글 무변경) + 미러 일치 계약. 손 계산식 동등 조건(번호 없음 10 가산 · 기존 표기 · 꼬리 중복 가산 · 끝 줄바꿈)은 손 계산식을 버리므로 해당 없음. 같은 뿌리 판정 = 「같은 글의 길이를 자리마다 다르게 셈」(R68 길이 축 · 5R 과 같은 항목) → 자리마다 따로 맞추지 않고 셈 셋(서버 생성기 · 제안 · 화면)을 합성 함수 하나(서버 `buildAdMessage` · 화면 미러)로 모음.
- **7R approve**(입력 출처 · 합성 미러 · 허용 문자 바이트 · 표시 바이트 = 실질 결함 0) → 설계 닫힘 · 구현 착수(Harold 1120 「닫히면 바로 구현」).

## §5 직원 지시문 초안(구현 전 고정 · 서식 = 플레이북 §3)

**시트 1 자동마케팅 · 최근구매일(서수란)**

| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 테스트계정으로 로그인 → AI 오퍼레이터 → 자동마케팅 | 자동마케팅 화면 |
| 2 | 위 한 줄에 「VIP 등급 고객 중 최근 90일 구매가 없는 고객에게 재구매를 유도」 넣고 만들기 | 「최근구매일 90일 이상 지남」 조건 줄 · 오류 창 없음 |
| 3 | 같은 날 AI 한줄로에 같은 문장 → 「받는 사람」 수를 적는다 | 2의 대상 수와 같은 수 |
| 4 | 조건 줄 「다른 칸 고르기」 | 「구매횟수」 등 숫자 칸이 잠겨 있고 사유 글이 보임 |
| 5 | 일수 칸에 120 넣고 「기준 적용하고 다시 세기」 | 「최근구매일 120일 이상 지남」 · 수가 바뀜 |

**시트 2 직접 타겟(서수란)** — ★ 구현 때 정정: 옛 1번 줄 「자동발송 만들기」는 지움(자동발송 = 2026-05-21 폐기 · 만들기 창이 화면에 없음 · §10)

| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 직접발송 → 직접 타겟 → 최근구매일 → 「N일 이상 지남」 → 90일 | 칩 「90일 이상 지남」 · 대상 수가 시트 1-3 의 수와 같음 |
| 2 | 같은 화면에서 토글을 「최근 N일 안」으로 | 칩 「90일 이내」 · 지금과 같은 「최근 90일」 수 |

**시트 3 여정 만들기(임은지)**

| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 여정 → 문장으로 여정 만들기 → 「구매 직후 감사 인사」 | 「어느 번호로 보낼까요?」 칸이 없음 |
| 2 | 만들기 → 「작업 화면 열기」 | 왼쪽 [시작]이 골라져 있고 「보내는 번호 1800-8125 · 기본」이 보임 |
| 3 | 여정 목록에서 다른 여정 하나를 연다 | 지금처럼 1번째 칸이 열림 |

**시트 4 브랜드 학습 · 충전(서수란 · 박성용)**

| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 브랜드 학습 → 기본정보 · 브랜드명 칸을 비운다(저장하지 않음) | 「예: 한줄로」 |
| 2 | 상호 칸을 비운다(저장하지 않음) | 「예: 주식회사 인비토」 |
| 3 | (회신만) 충전 내역 행마다 충전 · 차감 뒤 잔액은 원장에 남지 않아 표기할 수 없음 · 지금 잔액 = 같은 탭 맨 위 「발송ID 잔액」 | 회신 확인 |

**시트 5 AI 한줄로 혜택 · 다듬기(테스트계정)**

| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | AI 한줄로에 「최근 30일 미구매 VIP에게 재구매 쿠폰 보내줘」 → 혜택 칸에 「30% 할인행사」 → 기간 · 링크 주소 넣고 다음 | 문안 카드가 나옴 |
| 2 | 카드 세 개 본문을 다 본다 | 「[혜택 안내: 직접 수정해주세요]」 글자가 없음 · 링크가 `[`·`](` 없이 주소 글자로 |
| 3 | 한 카드에서 「AI로 다듬기」 → 시즌 풍성 → 적용 → 다시 「AI로 다듬기」 → 최신 트렌드 → 적용 | 「▶」 와 주소가 같은 줄 · ★ 는 줄 첫머리에만 · 줄이 공백으로 시작하지 않음 |

## §6 실측(배포 전 · 하나씩)

| # | 무엇 | 쓰임 |
|---|---|---|
| M4 | 켜진 자동마케팅 · 자동발송 · 세그먼트 가운데 판정 CT 에 걸리는 행 수(표 밖 기준 · 빈 값 · 모르는 칸) | 배포 뒤 멈추는 회차 · 담당자 안내 |
| M2 | 고객사 이름 전체 목록 → 화면 소스 대조 | E1 전수 |

## §7 범위 밖(기록만)

- V 발송ID 행 반영 뒤 잔액(게이트웨이 `billing_ledger` 읽는 길) = E4 가)안 · Harold 선택 시 별도.
- 모르는 칸(키)을 변환기가 건너뛰는 동작 = 판정 CT 가 쓰는 자리 · 자동발송 발송에서 막음 · 변환기 자체는 무변경.
- 자리표 뒤 조사(「[…]을 드려요」) = 사람이 채우는 자리라 채운 말에 따라 맞음 · 손대지 않음.
- 생성 링크 붙이기(`voice-form-slots.ts:333-340`) = 이번 출처 아님(서버 실측 · 원문 주소 제 줄).
- (6R 에 범위 안으로 옮김) AI 한줄로 화면 SMS 길이 셈 = P5 바이트 항목.
- ★ 구현 때 발견: 옛 AI 한줄로 제안 길(`/api/ai/operator/propose` → `services/ai-orchestrator.ts` orchestrate · orchestrateWithAI)은 사람 혜택 칸 답(`lineFacts.benefit`)으로 자리표를 채우지 않는다(같은 R33 꼴). 화면에서는 닿지 않음 = `AiLinePage.tsx:702` 가 답 없이 들어오면 새 확인 창으로 보내고, 답을 싣는 창(`LineFactsAskModal`)은 그 길의 응답으로만 열린다(2026-10-19 「옛 제안 흐름은 여기서 돌지 않는다」). 주소는 살아 있음 · 추가 과제.
- ★ 구현 때 발견: 배포 원장 `C145-DDL-1` 블록이 커밋본(e07005f0)에서 `DO $ BEGIN … END $;` 로 깨져 실 PG 시험 준비가 멈췄다 → 두 줄만 `$$` 로 되돌림(실 PG 시험을 돌리려면 필요 · 서버 실행 결과 「DO」 = 실행 당시 정상).
- 「평균 구매금액은 3만원」 같은 혜택 아닌 금액도 판정이 자리표로 바꾼다(지금 그대로 · 판정 무변경) → AI 한줄로에서 이제 그 자리에 혜택 칸 답이 들어간다(자동마케팅 · 플래너와 같은 동작 · 카드는 사람이 보고 보냄). 판정 정밀화는 2R 구조 처방대로 손대지 않음.

## §10 구현 기록(1120)

**바뀐 파일**
- 서버 새 파일: `utils/audience-condition.ts`(칸 조건 하나의 검사 + 칸 고른 뒤 조건 = 한 곳 · 순수 · Codex 구현 1R #3 에서 옛 audience-pick.ts 를 대신함) · `utils/ai-sms-layout.ts`(꼴 정리 CT · 순수) · `utils/sms-ad-bytes.ts`(광고 SMS 합계 = `buildAdMessage` 부르기만) · `utils/link-segments.ts`(링크 조각 CT 를 `one-line-steps.ts` 에서 옮김 = 꼴 정리 CT 가 DB 모듈을 끌어오지 않게 · 옛 이름은 다시 내보냄).
- 서버 고침: `customer-filter.ts`(days_passed · 회사 칸 days_* · 표 밖 기준 AND FALSE · mixed 나이 기준 · `filterConditionIssues` · `filterConditionIssueMessage` · `FILTER_OPERATOR_TEXT` · `MIXED_BASE_WHERE_KEYS` · `RECURRING_RELATIVE_DATE_RULE`) · `audience-translate.ts` · `automarketing-interview.ts` · `automarketing-preview.ts` · `services/ai.ts`(번역 규칙 7 · SMS 바이트 · 다듬기 꼴 정리) · `ai-segment-generator.ts` · `saved-segments.ts` · `routes/auto-campaigns.ts` · `auto-campaign-worker.ts` · `services/ai-line.ts` · `utils/ai-line.ts` · `copy-benefit-detector.ts`(목록 상수 하나) · `autosend-policy.ts`(채우는 자리 목록 · 조사) · `ai-orchestrator.ts`(채운 뒤 바이트) · `message-sanitizer.ts` · `copy-exit-guards.ts` · `one-line-steps.ts` · `voice-form-slots.ts`.
- 화면: `utils/customerFilterBuild.ts` · 새 `components/DateDayChips.tsx` · `DirectTargetFilterModal.tsx` · `TargetDirectPickPanel.tsx` · `automarketing/OperatorPreviewModal.tsx` · `pages/AiLinePage.tsx` · `journey/map/InterviewModal.tsx` · `pages/JourneysPage.tsx` · `journey/workspace/JourneyWorkspace.tsx` · `AiMemory/BrandBasicInfoTab.tsx`.
- 발송 핵심 다섯 파일 무수정(`routes/campaigns.ts` · `spam-filter.ts` · `results.ts` · `billing.ts` · `messageUtils.ts`). DDL 0 · ENV 0.

**설계와 다른 세부**
- **자동발송(auto-campaigns) = 2026-05-21 폐기**(생성 `POST /` 410 · `AutoSendPage` 는 여정 안내만 · `AutoSendFormModal` 은 어디서도 그리지 않음 · 워커 2026-06-11 `AUTO_CAMPAIGN_RETIRED` 봉인). 흐름 표가 생산자로 적은 `AutoSendFormModal` 은 죽은 부품이라 P1-4 의 추천 `recurring` 배선(`routes/ai.ts` · `recommendTarget` 옵션 · 창의 몸)과 P4 의 그 창 요약 표 변경은 **되돌렸다**(쓰이지 않는 코드 0). 반복 생산자 = 자동마케팅 번역 · 저장 세그먼트 생성 둘. 자동발송 수정(`PUT /:id` · 살아 있음) · 워커의 판정은 남김(봉인이 풀려도 깨진 조건은 막는 쪽). 직원 시트 2 의 자동발송 줄 삭제.
- `RECURRING_RELATIVE_DATE_RULE` 자리 = `customer-filter.ts`(변환기 기준 옆 · 순수) · `services/ai.ts` 는 다시 내보냄.
- 꼴 정리 = 카카오 채널 글은 건너뜀(`copy-exit-guards.ts` · 알림톡 · 친구톡 틀 글은 문자 꼴 규칙 밖).
- 직접 타겟 패널 요약 글 = 「최근 N일 안」 → 「N일 이내」(CT 한 곳 `dateFilterValueText` · 칩 글 `conditionChipLabel` 과 같은 글).
- mixed 나이 gte · lte · eq 는 P2-1 로 옮겨지므로 P2-2 계약의 거절 사례는 「mixed 나이 표 밖 기준(contains)」로 정정.

**옮긴 옛 시험 기대값(이유)**
- `autosend-policy.test.ts` · `automarketing-oneline-1024` · `c109-chars-contract-1106` = 채우는 자리가 목록 둘로 좁아짐(P5 · 3R #1) → 자료의 `[혜택 내용]` · `[혜택]` 을 목록 자리표로 · 목록 밖은 남고 관문이 막는다는 단언 추가.
- `ai-line-1018` = mixed 나이 gte 가 이제 옮겨짐 → 「버리는 칸」 예를 표 밖 기준(contains)으로.
- `automarketing-preview-1005` = 답 = 칸만(P3) · `automarketing-trust-ui-1005` = 잠금 = 값 없음 또는 서버 pickLocks.
- `ai-segment-all-guard-0926` = 생성기가 같은 모듈의 판정 CT · 규칙 상수를 씀 → 부분 모의.
- `bug-1031-link` = 다듬기 링크 대조 원문 = 마크다운 푼 글(P6) · `operator-subject-1015` = 같은 import 줄에 이름이 늘어 이름 목록 무관 정규식으로 · `tier2-rest-0927` = KST 기준일 자리 셋(회사 칸 CT) · `c103-intake-contract-1105` = 번호 칸 = 기본 번호 없을 때만(E2-1).

**계약 시험** = `utils/__tests__/staff-tickets-1120.test.ts`(R100 · R101 · R102 · R33 · R1 D3 · D9 · E1 · E2-1 · E2-2 · 소스 기계 추출 = 조건 쓰는 자리 · generateMessages 부르는 자리 · 꼴 정리 · sanitizeForSms 소비처 · sql.trim 자리 · 키별 변환 자리).
변이 21 전부 빨간불: R100 셋(days_passed 갈래 · 지시 줄 · 프리셋 되살림) · R101 넷(AND FALSE → 빈 조각 · 판정 ④ · 쓰는 자리 판정 · 워커 판정) · R102 넷(출구 CT · 규칙 3 · 규칙 4 · 링크 구간 보호) · R33 다섯(AI 한줄로 채우기 · 조사 · 넓은 꼴 · 바이트 옛 값 · 화면 셈 자체 꼴) · R1 셋(applyPick 규칙 · 화면 표 days_passed · 칩 손 글) · E2-1 · E2-2.
**실 PG** = `utils/__tests__/staff-tickets-1120.pg.test.ts` 14건(days_passed · days_within 두 형식 × 표준 · 회사 칸(글자 꼴 셋) · 그날 포함 · 빈 칸 빠짐 · VIP + 90일 이상 · 표 밖 기준 0명 · mixed 나이 · 세그먼트 저장 400 · 행 0) · 변이 둘(days_passed 방향 · AND FALSE) 빨간불.

**구현 중 더 닫은 것(같은 R101)** = 자동마케팅 허용 표(`OPS_BY_TYPE.date`)는 표준 날짜 칸에 date_gte · date_lte 를 허용하는데 변환기 표준 날짜 칸은 gte · lte 만 받아 0건(이번 AND FALSE 뒤) → 칸을 다시 골라도 같은 기준이 돌아와 막다른 길 → 변환기 두 형식 표준 날짜 칸이 date_gte · date_lte 를 gte · lte 와 같은 뜻으로 받음 + 계약 「허용 표 = 변환기 표」(허용 표의 기준마다 변환이 0건 · 빈 조각이 아님 · 고치기 전 빨간불 확인).

**화면 확인** = 개발 서버에 실제 부품(`DateDayChips` · 두 화면의 칩 모양 그대로 · 임시 틀은 확인 뒤 지움): 「90일」 → 「90일 이내」 · days_within 90 / 토글 「N일 이상 지남」 → 「90일 이상 지남」 · days_passed 90(고른 일수 유지) / 기준을 먼저 고른 뒤 칩 = 같은 결과 / 폭 320 넘침 0 · 콘솔 오류 0.

**구현 Codex**
- 1R needs-attention 3(전부 수용): #1 high 배열 꼴 조건이 판정 CT 를 「조건 없음」으로 통과해 대상이 전체로 → CT 머리에서 최상위 꼴 판정(null · undefined = 조건 없음 · 배열 · 글자 = 깨진 조건) · 세그먼트 저장 판정도 같은 CT 로 · #2 medium 마크다운 링크 풀기가 괄호 든 목적지를 바꾸고 조사가 주소에 붙음 → 목적지 짝 괄호 한 겹 · 경계 · CT 안 목적지 보존 확인 · 감춤 글자 섞임 막음 · #3 medium 회사 숫자 칸의 「중 하나」까지 잠금 → 뿌리 = 잠금이 번역기와 다른 허용 표를 따로 가짐(R1 두 벌) → 칸 조건 검사(`AudienceConditionError` · 허용 표 · `validateCondition` · `conditionsToFilters`)와 칸 고르기를 `utils/audience-condition.ts` 한 순수 파일로 옮기고(글자 그대로 · 번역기는 다시 내보냄) 잠금 = 번역기가 받는 검사 그대로 · 옛 `audience-pick.ts` 지움. 같은 뿌리 판정 = 셋 다 다른 부류(최상위 꼴 · 링크 경계 · 허용 표 두 벌). 변이 일곱 빨간불.
- 2R needs-attention 1 medium = 링크 뒤 쉼표 · 굵게 표시가 붙으면 판정기가 주소로 읽는데 보존 확인(부분 글자)이 통과 → **1R #2 와 같은 부류 두 번째 → 구조 처방**: 왜 되풀이됐나 = 주소 경계를 링크 판정기와 따로 짐작했고(「글자 · 숫자면 띄움」) 보존도 판정기가 아니라 글자 포함으로 봤다 → 경계 · 보존 확인을 둘 다 같은 링크 판정기(`linkSpans` · 한 곳)에 묻는다 · 짐작 규칙 지움 · 규칙 5 에 줄 끝 공백 지움(띄움 뒤 굵게가 풀려 남는 공백). 변이 둘 빨간불.
- 3R needs-attention 1 medium = 다듬기 후보 거름에서 후보 쪽(꼴 정리 CT · 원문으로 돌아오는 꼴 포함)과 원문 쪽(마크다운 풀기만)의 링크 읽기가 달라 같은 목적지를 지킨 후보가 빠짐 → **같은 부류 세 번째**: 왜 되풀이됐나 = 한 비교의 두 쪽에 다른 변환을 걸었다 → 처방 = 두 쪽 모두 같은 꼴 정리 CT 하나(`rewriteDropsLinks(text, tidyAiSmsLayout(originalMessage))` · 마크다운 풀기는 CT 안으로만 · 덧댄 호출 하나가 사라짐). 변이 빨간불.
- 4R needs-attention 1 medium = 원문 정리가 원문 그대로 돌아오면 판정기가 마크다운에 싼 scheme 없는 주소를 못 읽어 비교 목적지 0 → 링크를 지운 후보 통과 → **같은 부류 네 번째**: 왜 되풀이됐나 = 목적지를 읽는 함수가 둘(꼴 정리 CT 의 마크다운 목적지 · 대조의 판정기)이라 그 사이를 변환으로 이을 때마다 샜다 → 처방 = 목적지 읽기를 `voice-form-slots.ts` `textLinks` 한 곳으로(마크다운 목적지를 판정기로 읽은 값 + 마크다운 밖 글의 판정기 읽기 · 마크다운 정규식도 이 파일 한 곳) · 다시 쓰기 대조 · 꼴 정리 보존 확인이 모두 그 함수 · 3R 에서 대조에 덧댄 변환은 걷음(`rewriteDropsLinks(text, originalMessage)` = 옛 꼴로 돌아감 · 마크다운 없는 글의 읽기 = 옛 그대로). 변이 둘 빨간불.
- 5R needs-attention 1 medium = 판정기가 scheme 없는 주소 바로 뒤 `?` 를 못 읽어 안쪽 https 주소만 목적지로 → 감춤이 일부만 덮어 굵게 규칙이 질의 값의 `__` 를 지움 · 보존 확인도 통과 → **같은 부류 다섯 번째**: 왜 되풀이됐나 = 덩어리(공백으로 갈린 글) 안 글자를 바꾸는 규칙(굵게 지우기)이 있었고 주소 보호를 판정기 정확도(감춤)에 맡겨, 판정기가 잘못 읽는 꼴마다 새 반례가 났다 → 처방 = **덩어리 안 글자를 바꾸는 규칙을 없앰**(굵게 표시는 낱말 경계에서만 지움 · 규칙 2 ~ 5 = 공백 · 줄바꿈 · 덩어리 경계 표시만) → 감춤 장치(U+E300 · 256 · 섞임 막음) 통째로 걷음 · 목적지 읽기 = 마크다운 목적지를 맨 글로 둔 것과 같은 한 읽기(4R 의 「못 읽으면 글자 그대로」 갈림 지움) · 규칙 3 「링크로 시작하는 줄」 = 판정기. 장치가 늘지 않고 줄었다. 변이 넷 빨간불.
- 6R needs-attention 1 medium = 닫는 굵게 표시 뒤 문장 부호를 허용해 「__sale__.png」 의 「__」 를 닫는 표시로 먹음(덩어리 안 글자 지움) → 5R 구조 처방의 경계 정의가 덜 엄격했다 → 닫는 표시 = 바로 뒤가 공백 · 줄 끝(덩어리 끝)일 때만 · 「**할인**!」 = 정리하지 않음(덜 바꾸는 쪽 · 새 장치 없음). 회귀 표본 고정 · 변이 빨간불.
- **7R approve**(6R 에서 고친 굵게 경계 한 줄 · 지운 표시 = 덩어리 처음 · 끝 두 글자뿐 · 실질 결함 0) → 구현 닫힘.
- 같은 부류(링크 목적지 처리)가 1R #2 ~ 6R 다섯 번 나온 까닭 정리 = ① 경계를 판정기와 따로 짐작 ② 비교 두 쪽에 다른 변환 ③ 목적지 읽는 함수가 둘 ④ 덩어리 안 글자를 바꾸는 규칙 + 판정기 정확도 의존. 마지막 꼴 = 덩어리 안 글자를 바꾸는 규칙 0 · 목적지 읽기 한 곳(`textLinks`) · 경계 · 보존 = 같은 판정기 — 장치는 처음보다 줄었다(감춤 · 섞임 막음 · 마크다운 목적지 따로 읽기 · 대조용 변환 걷음).
