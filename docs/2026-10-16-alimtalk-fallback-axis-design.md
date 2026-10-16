# 알림톡 대체발송 축 설계 (2026-10-16 · B-1016-1)

> 접수 = 서수란 그룹웨어 `cmvaear5e1hyajnn445hdnx59`(크로커다일 피에르가르뎅(플러스) · 10/13 알림톡 실패 → LMS 대체 1건).
> 같은 부류 세 번째: B-1003-1(청구 단가) → 1007 박성용(캠페인 목록) → 이번(통계 엑셀 · 정산서 표기).
> 결정 경로 = 비토 구조체크(후보 1~4) → 브레인스토밍(기획·백엔드·프론트엔드·회의론자 · 교차 1라운드 · 회의론자 최종 검증 5건 반영) → Harold 승인(1016).

## 1. 접수와 원인

| 접수 | 증상 | 원인(코드) |
|---|---|---|
| ① 슈퍼관리자 통계 엑셀 | 알림톡 0/0/0/0 · 알림톡대체발송(LMS) 1/1/0/0 | 엑셀은 `tallySmsChannelCounts`(행 1 = 채널 1)라 비토 K+7831 행이 대체로만 간다. 목록은 `tallyAlimtalkFallback`(알림톡 실패 1 + 대체 1). 같은 조회에 세는 규칙 두 벌 |
| ② 정산서 | 1·2페이지 모두 「LMS」 | 청구 집계 식이 대체를 L·S 로 접는다(웹 비토 K+7830/7831 · 웹 옛 L/S+k_oriseq · 에이전트 KS/KL 별칭). 대체 여부가 집계 단계에서 사라진다. 게다가 표시명이 세 벌(축 · PDF 2쪽 사본 · 관리자 모달 사본) |

뿌리 = 「알림톡 실패 → 문자 대체」 판정이 한 곳에 없다. 접수마다 표면 하나만 고쳐졌다.

## 2. 처방

### ① 판정 한 곳 (`utils/sms-result-map.ts`)
- `fallbackOf(msgType, kOriseq, statusCode)` → `'S' | 'L' | null`. 두 모양: 비토 K+7830(S)/7831(L) · 옛 S/L + k_oriseq>0. 브랜드 F 행은 넣지 않는다(B-1003-1 추가 과제 ①).
- 같은 상수에서 SQL 조각: `SMS_SUB_ROW_SQL`(sms-queue 에서 이동) · `FALLBACK_BILLING_CODE_WHEN_SQL`(청구 식) · `SUBSTITUTE_ROW_SQL`(결과 필터 · 문자열 불변).
- `tallyAlimtalkFallback` · `getSendTypeLabel` · 관리자 상세 `isFallback` 이 `fallbackOf` 를 쓴다.
- 삭제: `classifyMsgChannel` · `tallySmsChannelCounts` · `SmsChannel` · `alimtalkFallbackMsgType` · `ALIMTALK_FALLBACK_TYPE_WHEN_SQL` · `aggregateSmsChannelSplitByCampaign`.
- 슈퍼관리자 통계 엑셀 = `aggregateAlimtalkFallbackByCampaign`(상한 없는 쪽 · 목록용 4초 상한 함수 금지). 알림톡 행 = 시도 전체(대상건수 귀속) · 대체 행 이름 = 청구 유형 표시명.

### ② 청구 유형 (`utils/billing-types.ts`)
- `SMS_FB`·`LMS_FB` 신설(KAKAO 뒤). 이름 「SMS(대체발송)」·「LMS(대체발송)」 · 짧은 이름 「SMS(대체)」·「LMS(대체)」 · 집계 코드 `KS`·`KL`(웹 smsqCode = 에이전트 agentCode) · 에이전트 단가 칸 cost_per_sms·cost_per_lms · 회사 단가 칸 없음 · `inheritFrom` SMS·LMS.
- SMS·LMS 의 `agentCodeAliases`(KS·KL) 삭제 → 필드 자체 삭제.
- `inheritFrom` 한 칸이 파생하는 곳: 단가(`resolveBillingUnitPricesDetailed`) · 미설정 게이트 · 무료 배분 키·대상 필터(`allocateFreeToRows`) · 무료 사용량 조회(`REMAINING_EXPR`) · 헤더 수량(`billings.sms_success`·`lms_success`) · 미리보기 요약 · 매장별 미리보기 · 에이전트 단가 미설정 목록.
- 무료 LMS 는 대체 LMS 에 계속 공제(현행 유지). 배분 순서 = 일자 → 상속원 → 계정 → 유형(계정별 장 공제가 종전과 같게).
- 테스트 축: 상세축도 일자축과 같은 청구 식 · `testBillingTypeKey` 가 KS → 테스트 SMS · KL → 테스트 LMS.
- 헤더 금액 항등식은 표 순회로 파생(손 나열 삭제).

### ③ 표시명 (`utils/billing-invoice-lines.ts`)
- `billingTypeLabel(key)`(긴 이름) · `billingDetailTypeLabel(item)`(2쪽·모달 짧은 이름: 요금제 PLAN_ 제거 → 추가 항목 item_label → 짧은 이름 → 긴 이름 → 키).
- 상세 응답 `type_label` 신설(`scope_label` 옆). PDF 2쪽 · 관리자 정산 모달의 라벨표 사본 삭제.
- 차단 문구(단가 미설정 · 에이전트 단가 미설정)도 표시명으로.
- 에이전트 통계 KS·KL 표시명도 청구 유형 표시명에서 파생(`pay-stats` · 고객사 통계 「카카오(LMS대체)」→「LMS(대체발송)」).

### ②-1 배포 전 수량 조정(Codex 1R~3R)
- 배포 전 「LMS」 조정은 대체분까지 포함한 LMS 를 뜻했다. 조정 줄 판정 = `billing-qty-adjust adjustmentLineType` 하나: 범위(채널 · 조정에 발송ID 가 있으면 그 발송ID) 안에서 같은 유형 줄 → 없으면 같은 상속원 줄이 하나뿐일 때 그 줄 → 그 밖은 null(줄 없음 · fail-closed).
- 발행(`buildAdjustmentBillingItems` · 조정 행 유형 = 빌린 줄의 유형) · 조정 화면(줄별 원래 수량 · null 이면 어느 줄에도 안 묶음) · 재발행 사전 검사가 이 함수만 부른다.
- 일반 LMS 와 LMS(대체발송)이 둘 다 있으면 옛 LMS 조정은 LMS 줄. 감액이 그 줄보다 크면 발행 422(롤백 · 원 정산 보존) → 조정 삭제 · 재발행 · 새 줄에 재등록. 한 조정을 여러 줄로 쪼개는 배분은 넣지 않았다(화면 원래 수량과 다음 델타가 틀어진다).

### ④ 고정핀
- 「같은 행 = 같은 분류」: 비토 K+7831 · K+7830 · 옛 K 실패 + L sub · L sub 실패 · K 1800 · 에이전트 KL.
- 유형 커버리지: 모든 유형키 단가 유한 · 상속원 미설정이면 함께 미설정 · 표시명 존재 · 청구 식 출력 코드 ⊂ 유형키 맵.
- 소스 스캔: 7830·7831 숫자와 k_oriseq 판정식은 `sms-result-map` 안만 · PDF·화면 유형 라벨표 0.

## 3. 영향표 (소비처 전수)

| 소비처 | 바뀌는 것 | 금액 |
|---|---|---|
| 슈퍼관리자 통계 엑셀 `admin.ts /stats/export` | 알림톡 행 = 시도 전체 · 대체 행 이름 「LMS(대체발송)」 | 없음 |
| 캠페인 목록(관리자 · 고객사) | 없음(같은 함수 · 판정만 공용) | 없음 |
| 발송결과·엑셀 행 라벨 「대체 LMS」 · 대체 필터 | 없음(문자열 불변) | 없음 |
| 관리자 발송 상세 `isFallback` | 없음(판정 공용) | 없음 |
| 선불 결과별 정산 `smsAlimtalkResultAgg` | 숫자를 상수로(만들어지는 SQL 동일) | 없음 |
| 청구 일자축·상세축 | 대체분이 SMS_FB·LMS_FB 로 | 단가 상속이라 같음 · 단 항목줄이 하나 늘어 원 미만 절사가 줄마다 → 최대 1원 감소(고객 유리) |
| 정산서 1쪽 · 메일 첨부 · 일괄발급 첨부 | 「LMS(대체발송)」 줄 추가 | 위와 같음 |
| 정산서 2쪽 · 관리자 정산 모달 | 유형 칸 「LMS(대체)」 · 모달 알림톡 「카카오알림톡」→「카카오」 · 080 「080 번호 이용료」→「080 이용료」(PDF 기준) · PDF 브랜드 줄 원문 키 → 「브랜드메시지」 | 없음 |
| 무료 제공 공제 | 대체 LMS 도 LMS 무료로 공제(현행) · 사용량 조회도 같은 상속원 | 없음 |
| `billings` 헤더 sms/lms_success | 상속원 합산(종전 값 유지) | 없음 |
| 미리보기 요약 · 매장별 미리보기 | 상속원 합산(종전 값 유지) | 없음 |
| 에이전트 단가 미설정 목록 | 상속원 기준(종전 결과 유지) | 없음 |
| 고객사 발송통계 화면·엑셀(웹) | 「LMS(대체발송)」 행 추가 · LMS 행은 그만큼 감소(합계 같음) | 없음 |
| 고객사·관리자 에이전트 통계 | 「카카오(LMS대체)」→「LMS(대체발송)」 | 없음 |
| 일일 인사이트 메일 | 없음(전 유형 합) | 없음 |
| 수량 조정 | 새 줄 단가는 같은 유형 줄에서 빌림 · 기존 'LMS' 조정은 LMS 줄에만 붙음 | 재발행 전 그 기간 조정 행 조회 |
| 이미 발행된 정산서 | 그대로(스냅샷) | 없음 |
| 세금계산서 | 품목 한 줄(금액) | 위 절사와 같음 |

DDL 0(`billing_items.message_type` varchar · 'EXTRA_BASE_FEE' 14자 저장 중).

## 4. 배포 전 실측(Harold · 하나씩)
1. MySQL: msg_type 칸이 있는 SMSQ 테이블 중 k_oriseq 칸이 없는 테이블 = 0(테스트·LOG 포함). 0 이 아니면 배포 중단(청구 식이 그 테이블에서 1054).
2. PG: `billing_items.message_type` CHECK 제약 없음.
3. 크로커다일 10월 초안 재생성 전 그 기간 수량 조정 행 조회.
4. 배포 뒤: 크로커다일 10월 미리보기에 「LMS(대체발송)」 1건 × LMS 단가 · 슈퍼관리자 통계 엑셀 10/13 알림톡 1/0/1/0 + LMS(대체발송) 1/1/0/0.

## 5. 범위 밖(BUGS 기록만)
- 선불 직접발송 알림톡이 알림톡 성공분까지 LMS 무료를 쓰는 문제(`campaigns.ts:2697`).
- 사용자별 비용 추정이 알림톡 캠페인 성공을 LMS 단가로 셈(`stats-aggregation.ts:796`).
- 정산서 어디에도 무료 공제 수량이 그려지지 않음(1쪽 수량 < 2쪽 성공이 설명 없이 보임).
- TEST·SPAM·BRAND_NF 단가 상속을 `inheritFrom` 으로 옮기는 일.
- 브랜드 F 행 대체 · 대체 문자까지 실패한 경우의 구분(B-1003-1 추가 과제).
