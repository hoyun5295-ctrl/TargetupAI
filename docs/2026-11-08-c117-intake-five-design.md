# C117 오류접수 다섯 설계서(2026-11-08)

> 흐름 표 · 결함 장부 = [2026-11-08-c117-intake-five-flow-ledger.md](2026-11-08-c117-intake-five-flow-ledger.md)(D1 ~ D11) · 플레이북 = `status/DEFECT-PLAYBOOK.md` · 카드 = `status/STATUS-FEED.md` C117
> 범위 = 흐름 표 전체(접수 증상 자리만 X). DDL 0 · 발송 · 차감 · 적재 경로 변경 0(줄 이름 · 화면 · 검사 등록 이름표만).

## §0 결정(Harold 1108)

| # | 물음 | 결정 |
|---|---|---|
| H1 | 브랜드 목록 이름 | **대상 이름 + 번호별 친구** — 캠페인 이름 = 고른 대상(채널 친구 · 비친구만 · 마수동 전체) · 수신번호별 줄 = 카카오가 알려 준 실제 친구 여부 · 정산서 · 관리 통계 내보내기 = 청구 이름 그대로 |
| H2 | 브랜드 받는 사람 칸 | **이름 칸 함께 보기** — 번호 옆 이름(파일 이름 칸 · 주소록 · 타겟추출 고객명) · 발송 글은 그대로(개인화 변수 0) |
| H3 | 체크리스트 B-3 | **적는 요구 빼기** |

## §1 J1 여정 A/B 스팸 검사(D1 · D2)

### 처방
- D1: 여정 칸 검사(`enqueueStepSpamCheck` · `runStepSpamTest`)는 `spam_filter_tests.variant_id` 에 **아무것도 싣지 않는다**(두 자리에서 `variantId:` 줄 삭제). 그 칸 = 자동마케팅 묶음 안 문안 이름표(`spam-test-queue.ts:1211` 만 읽음)이고 여정은 묶음 하나 = 검사 하나라 이름표를 읽는 곳이 없다. 여정 쪽 식별자(`StepSpamParams.variantId` = 변이 행 id)는 판 찾기 · 실패 칸 표시에 그대로 쓴다.
- D2: `enqueueSpamTest` catch 의 화면 문장 = 「스팸 검사를 시작하지 못했어요. 잠시 뒤 다시 시도해 주세요.」 + `errorCode: 'ENQUEUE_FAILED'` · DB 원문은 로그만(지금 로그 줄 그대로). 소비처 = 칸 검사 라우트(`ai.ts:4476` 문장 그대로 전달) · 켜기 검증(`error` 칸 → 「검사 장애」 · 판정은 errorCode) · AI 한 줄(`ai-line-spam.ts:136` 이미 자기 문장) · 자동마케팅 runOneTest(enqueued false) — 문장만 바뀌고 판정 변화 0.

### 뿌리 R84(새) — 같은 이름(variantId)의 다른 식별자가 이름표 칸에 들어간다
- 판정 기준: 검사 등록(`enqueueSpamTest`)에 싣는 `variantId` = 묶음 안 문안 이름표(runOneTest 매개변수)만. 다른 축의 id(행 id · uuid)를 같은 이름으로 넘기지 않는다.
- 같은 뿌리 전수: `enqueueSpamTest(` 호출 5 자리 · runOneTest 값 원천 10 자리(흐름 표 §1 뽑은 패턴) — 여정 2 자리만 다른 축.

### 계약 시험 `c117-intake-contract-1108` J1
- J1-a(기계 추출): backend src 전체에서 `enqueueSpamTest(` 호출 인자 덩어리를 뽑아 `variantId` 를 싣는 곳 = `spam-test-queue.ts` runOneTest 한 곳뿐(새 호출이 싣으면 실패).
- J1-b: `enqueueSpamTest` 가 DB 오류에 던진 원문을 `error` 에 싣지 않는다(가짜 pool 로 오류 → error 에 원문 0 · errorCode ENQUEUE_FAILED).
- 변이: 여정 자리에 `variantId: params.variantId` 를 되돌리면 J1-a 빨간불 · catch 문장에 원문을 되돌리면 J1-b 빨간불.

### 직원 지시문 초안(시트 = 로드맵 묶음 끝에 한 번 · 메모리 `feedback_staff_sheets_after_roadmap`)
| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 테스트계정으로 여정 하나를 초안으로 만들고 1번째 칸에서 [A/B] 를 눌러 A안 · B안을 저장한다 | 칸 오른쪽 점검에 「A안 검사」 · 「B안 검사」 단추 |
| 2 | 「A안 검사」를 누른다 | 검사 창에 SKT · KT · LG U+ 줄이 「대기」에서 진행으로 바뀐다(「검사를 시작하지 못했어요」가 아니다) |
| 3 | 결과가 나올 때까지 기다린 뒤 「B안 검사」도 누른다 | 같은 모양으로 검사가 시작된다 |
| 4 | 오른쪽 위 [켜기] 를 누른다 | 「자동 검증 통과: 모든 칸이 보낼 준비가 됐어요」 |

## §2 J2 체크리스트 B-3(D3)

### 처방
- `docs/2026-11-03-journey-automarketing-checklist.xlsx` B 시트 6행 맞음 기준 끝 문장 「비웠다면 이유를 메모에 적었다」 → 「비웠다면 켜기 창에 「비우면 제한 없이 보내요」 안내가 보이는 것을 확인했다」. 다른 칸 · 시트 변경 0(파일 안 그 글자만 바꾸는 스크립트 · 줄바꿈 · 서식 보존).
- 뿌리: 없음(문서 문구 · 제품 변경 0). 시험: 바꾼 뒤 그 칸 글자를 다시 읽어 대조(스크립트 출력).
- 직원 지시문: 고친 체크리스트를 남지현 님께 다시 전달(Harold).

## §3 B1 수신거부 인증번호 칸(D4)

### 처방
- `BrandMessageEditor.tsx` 인증번호 입력 칸 · `unsubAuth` 상태 · payload `unsubscribeAuth` 줄 삭제. 서버(`brand-message.ts:466 · 512`)는 그대로(빈 값 = 지금 대부분의 발송과 같은 전문 · API 직접 호출 호환).
- 영향: 프론트 소비처 = 이 파일 3 줄뿐(`grep unsubscribeAuth|unsubAuth` · 흐름 표 §3). 080 번호 칸 · 안내 글 그대로.
- 뿌리: 없음(접수 = 칸 삭제). 시험: 계약 B1 = 편집기 소스에 인증번호 입력 0 · payload 키 0.

### 직원 지시문 초안
| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 5 | 브랜드메시지 발송을 연다 | 「수신거부 080」 줄에 번호와 「설정값」만 있고 「인증번호」 칸이 없다 |

## §4 B2 발송 창(D5 · D6 · D7 · D8)

### D5 열 폭
- 브랜드 창 넓은 폭 = 작성 열 고정(무한 1fr 폐기): **1440 이상** `600px 380px minmax(0, 1fr)` · 바 `981px 1px minmax(0, 1fr)` / **1280 ~ 1439** `520px 380px minmax(0, 1fr)` · 바 `901px 1px minmax(0, 1fr)`(알림톡 창과 같은 열) / **1100 ~ 1279** `460px 320px minmax(0, 1fr)` · 바 `781px 1px minmax(0, 1fr)`. 바 왼쪽 = 작성 + 받는 화면 + 경계 1 → 본문 경계와 바 세로줄이 맞는다. 1099 이하 = 공용 반응형 그대로.

### D6 스크롤 열 — 뿌리 R85(새)
- `.ks-body > section.ks-compose > *` · `.ks-body > section.ks-preview > *` = `flex-shrink: 0`(자식은 줄지 않고 열이 스크롤). 알림톡 창도 같은 열이라 함께 닫힌다.
- R85 — 칸 안에 들어갈 것의 최소 크기(높이 · 폭)를 그릇이 받지 못한다(스크롤 열 자식이 줄어 잘림 · 고정 폭 칸보다 넓은 내용이 옆 칸을 덮음 · 칩 글자 꺾임). 판정 기준 = 스크롤 열의 자식은 줄지 않는다 · 바 · 칩 내용은 칸 폭 안에서 줄바꿈 · 줄임 규칙을 가진다.

### D7 발송 바 겹침(R85)
- `.ks-foot .ds-foot-send { flex-wrap: wrap; row-gap: 8px; }` · `.ks-foot .ks-sender { min-width: 120px; flex: 0 1 280px; }`(이름은 지금처럼 줄임표) · 단추는 줄지 않음. 칸이 모자라면 발신 프로필이 윗줄 · 단추가 아랫줄(넘쳐 덮지 않는다). 알림톡 바도 같은 규칙.
- 실측: 1100 · 1280 · 1366 · 1440 · 1920 폭에서 바 오른쪽 내용의 왼쪽 끝 ≥ 세로줄 x · 작성 열 scrollHeight > clientHeight 일 때 스크롤 가능(메모리 `feedback_layout_css_needs_rendered_measurement`).

### D8 받는 사람 이름(H2)
- `BrandSendModal` = `phones: string[]`(유일 진실 · 발송 · 중복 · 세대 규칙 그대로) + 보기용 `names: Map<번호, 이름>`(열 때 비움).
  - 파일: 이름 칸 = CT `pickNameColumn(headers)`(`utils/recipient-paste.ts` · 머리 이름이 표준 필드 name 의 이름 목록 = 「고객명」 · 「이름」 · 「성함」 · 「name」과 같으면 · 백엔드 `standard-field-map.ts` FIELD_MAP name 미러 · 일치 = 계약 B2-c) → 같은 행 번호(`phonesFromColumn` 과 같은 읽기)와 짝.
  - 주소록: 불러온 줄의 `name`. 타겟추출: 행 `name`(표준 필드 키).
  - 붙여넣기: 이름 없음(번호만 · 지금과 같음).
  - 창 밖에서 들고 오는 명단(Codex 설계 1R #2 · 2R #1 = 구조): `initialRecipients` 의 꼴을 `string[]` → `Array<{ phone: string; name?: string }>` 로 바꾼다(번호와 이름이 한 행 · 짝이 따로 어긋날 길 0). Dashboard 상태 `brandInitialRecipients` 도 같은 행 꼴 · 넘기는 세 자리 = 직접 타겟 발송(`Dashboard.tsx:3013` 행 `phone` · `name`) · 직접발송 창 인계(`:3217` directRecipients 행) · 알림톡 창 전환(`:3358` rows 가 있으면 그 `name`) · 비우기 자리 = `[]` 하나(이름도 함께 비워짐). 창은 열 때 번호 목록 · `names` 를 이 행에서 만든다. 이름 없는 번호 = 「-」.
- 목록 = 「수신번호 · 이름」 두 칸(이름 없으면 「-」) · 검색 = 번호 또는 이름. 발송 payload 에 이름 0(계약 B2-d).

### D11 채널 칩 줄바꿈(R85)
- CT `resolveChannelChipClass` 반환에 `whitespace-nowrap` → 칩을 그리는 두 화면(발송결과 PC · 모바일 · 캠페인 상세) 함께.

### 계약 시험 B2
- B2-a(기계 추출 · R85): `direct-send.css` 에서 `.ks-body > section.*` 중 `overflow-y: auto` 인 선택자마다 `<선택자> > * { … flex-shrink: 0 }` 규칙이 있다.
- B2-b(R85): `.ks-foot .ds-foot-send` 에 `flex-wrap: wrap` · `resolveChannelChipClass` 모든 반환에 `whitespace-nowrap`.
- B2-c: 프론트 이름 칸 목록 = 백엔드 FIELD_MAP name 의 displayName + aliases + fieldKey.
- B2-d: `BrandSendModal` 의 `onSend` payload 키에 이름 0(소스).
- 변이: 스크롤 규칙 삭제 → B2-a 빨강 · 칩 nowrap 삭제 → B2-b 빨강.

### 직원 지시문 초안
| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 6 | 넓은 모니터(가로 1920)에서 브랜드메시지 발송을 연다 | 왼쪽 작성 칸이 화면 3분의 1쯤이고 오른쪽 받는 사람 칸이 더 넓다 |
| 7 | [버튼 추가] 로 버튼 2개 · 쿠폰 「사용」을 펼친다 | 작성 칸 오른쪽에 스크롤이 생기고 굴리면 쿠폰 「할인 금액」 칸까지 다 보인다 |
| 8 | 아래 바를 본다 | 「광고 표기」 칸과 「발신 프로필」 상자가 겹치지 않는다 |
| 9 | 「이름」 · 「휴대폰」 두 칸이 있는 엑셀(직원 본인 번호 1줄 · 이름 = 본인 이름)을 [파일등록] 으로 올린다 | 목록에 번호와 본인 이름이 한 줄에 보인다 |
| 10 | [타겟추출] 로 고객 몇 명을 담는다 | 목록에 번호 옆 고객 이름이 보인다 |

## §5 B3 발송결과 브랜드 이름 · 줄(D9 · D10)

### D9 캠페인 이름 = 대상 이름(H1)
- 서버 CT `brandTargetingLabel(t)`(`sms-result-map.ts`): I · F → 「브랜드메시지(채널 친구)」 · N → 「브랜드메시지(비친구만)」 · M → 「브랜드메시지(마수동 전체)」 · 그 밖(빈 값 · 옛 행) → 「브랜드메시지」. 이름 원천 = `brand-message.ts TARGETING_OPTIONS` label(F = 전체 채널 친구 = 「채널 친구」) · 일치 = 계약 B3-a.
- `getCampaignChannelLabel` · `channelPlainLabel` 의 브랜드 갈래 = `brandTargetingLabel`. `brandAudienceLabel` 삭제(쓰는 곳 0 = R80).
- 관리 통계 내보내기(`admin.ts:6545 · 6551`) = 청구 칸이므로 이름 = `billingTypeLabelOf(kakaoKey)`(알림톡 = 「알림톡」) · 친구 몫 칸 = `billingTypeLabelOf('BRAND')`. 칸 키 · 수 그대로(정산서와 같은 줄).
- 프론트 미러 `campaign-axis.ts resolveChannelLabel` = 같은 표(`BRAND_TARGETING_LABELS`) · `BRAND_AUDIENCE_LABELS` 삭제 · 일치 = 계약 B3-a(백엔드 · 프론트 · 편집기 TARGETING_OPTIONS 셋).
- 영향(소비처 = 흐름 표 §6): 프론트 13 화면 = 브랜드 캠페인 이름 글자만 바뀜 · CSV(`results.ts:518`) 같은 글자 · next-action-advisor(대상 인자 없음) 무변화 · 정산서 · 거래내역서 · 청구 = 이름 원천이 billing-types 라 무변화.

### D10 수신번호별 친구(R65 넓힘)
- CT `smsFriendYnField(table, friendTables)`(`sms-queue.ts` · 칸 있는 표 = `IFNULL(k_friend_yn, '') AS friend_yn` · 없는 표 = `'' AS friend_yn`).
- `getSendTypeLabel(msgType, kOriseq, statusCode, friendYn)` — **넷째 인자 필수**(빠뜨리면 tsc 실패 = 소비처 전수 강제). 브랜드 원본(F · 대체 아님): Y → `billingTypeLabelOf('BRAND')`(「브랜드메시지(친구)」) · N → `billingTypeLabelOf('BRAND_NF')`(「브랜드메시지(비친구)」) · 빈 값 → 「브랜드메시지」. 그 밖 유형 = 지금 그대로.
- 소비처 9 자리 모두 조회에 친구 칸을 싣고 넘긴다: results.ts 상세(UI 두 길 · 엑셀) · campaign-sms-export · admin 캠페인 상세 · 관리 시험 발송 상세 · campaigns 시험 발송 목록 · manage-stats 시험 목록 · customer-timeline. 표 묶음 조회 CT(`smsSelectAll` · `smsSelectPagedAll`)는 필드 인자를 `string | ((table) => string)` 로(C108 `smsBatchAggByGroup` 과 같은 꼴 · 별칭 순서 같음).
- 대기 · 실패 · C108 전 행 · 칸 없는 표 = 빈 값 = 「브랜드메시지」(모르는 것을 친구 · 비친구로 단정하지 않음).

### 계약 시험 B3
- B3-a: 대상 이름 표 셋 일치(백엔드 `brandTargetingLabel` · 프론트 `BRAND_TARGETING_LABELS` · 편집기 TARGETING_OPTIONS label) · M → 「…(마수동 전체)」.
- B3-b(기계 추출 · R65): backend src 의 `getSendTypeLabel(` 호출마다 인자 4개 · 넷째 인자는 `.friend_yn` 을 읽는다. **줄 조회 문장마다**(Codex 설계 1R #1) — results.ts 일반 조회 · LIVE 재시도 · CSV, campaign-sms-export, admin 두 곳, campaigns, manage-stats, customer-timeline — SMSQ 줄 필드를 넘기는 자리(`SMS_DETAIL_FIELDS` · `SMS_EXPORT_FIELDS` · `SEND_FIELDS` · smsSelectAll / smsSelectPagedAll 필드 인자 · 단일 표 SELECT)가 친구 필드 CT(`withFriendYnField`)를 거친다. 계약은 필드 상수를 직접 쓰는 줄 조회 자리 0 을 소스에서 뽑아 센다.
- B3-b'(혼합 스키마): 친구 칸 있는 표 · 없는 표를 함께 넘긴 smsSelectAll · smsSelectPagedAll 가 만든 SQL = UNION 각 갈래 열 개수 · 별칭 순서 같음 · ORDER BY 재작성이 별칭으로 동작(가짜 mysqlQuery 로 SQL 문자열 확인).
- B3-c: `getSendTypeLabel('F', 0, 1800, 'Y')` = 청구 이름 BRAND · 'N' = BRAND_NF · '' = 「브랜드메시지」 · 대체 행은 친구 값과 무관하게 「대체 SMS / LMS」.
- B3-d: 관리 통계 내보내기 브랜드 칸 이름 = 청구 이름(소스 = `billingTypeLabelOf(kakaoKey)`).
- 변이: 넷째 인자 무시 → B3-c 빨강 · results.ts LIVE 재시도 갈래만 옛 필드 상수로 되돌리기 → B3-b 빨강 · CSV 갈래만 되돌리기 → B3-b 빨강.
- D8 계약 B2-e: `BrandSendModalProps.initialRecipients` 꼴 = 행 배열(번호 · 이름) · 창 열기 effect 가 `names` 를 그 행으로만 만든다(소스) · Dashboard 에 이름 전용 상태 · setter 0(기계 추출 · 따로 두면 실패).
- 기존 시험 정정: `c107-brand-contract-1105.test.ts:151 ~ 155`(옛 결정 D-11 = 이름 = 청구) · `c107f-contract-1106.test.ts:206`(내보내기 글자) — 1108 Harold H1 로 기대값을 바꾸고 줄에 이유.

### 직원 지시문 초안(테스트계정 · 직원 본인 휴대폰 = 테스트 채널 친구)
| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 11 | 브랜드메시지 대상 「마수동 전체」로 본인 번호 1명에게 보낸다 | 「발송했어요」 |
| 12 | 발송결과 목록을 연다 | 그 줄 채널 칸 = 「브랜드메시지(마수동 전체)」 한 줄 |
| 13 | 그 줄 [상세] → 발송 내역 | 본인 번호 줄 유형 = 「브랜드메시지(친구)」 |
| 14 | 발송 내역 [엑셀 다운로드] | 엑셀 그 번호 줄 유형 = 「브랜드메시지(친구)」 |
| 15 | 관리자 계정으로 같은 발송결과를 연다 | 채널 칸 글자가 한 줄(꺾이지 않음) |

## §6 배포 · 확인
- 한 묶음 = 백엔드 + 프론트(DDL 0 · 게이트웨이 · 에이전트 0). 원장 카드 C117.
- 운영 확인(Harold · 배포 뒤): 칸 길이 근거 = `information_schema.columns` spam_filter_tests.variant_id(설계 전제 = 10 · 접수 캡처 원문) — 바뀐 코드는 여정에서 칸에 싣지 않으므로 길이와 무관하게 성립.

## §7 범위 밖(기록만)
- 브랜드메시지 개인화 변수(H2 에서 뺌 · 별도 설계).
- 체크리스트 PDF 매뉴얼(`2026-11-03-journey-automarketing-staff-manual.pdf`)에 같은 문장 유무 = 미확인(엑셀 원본만 접수 근거).

## §8 구현 기록(1108)
- 백엔드 = journey-pretest-validator(D1) · spam-test-queue(D2) · sms-result-map(getSendTypeLabel 넷째 인자 · brandTargetingLabel · brandAudienceLabel 삭제) · sms-queue(withFriendYnField · smsSelectAll / PagedAll 필드 함수) · results · campaign-sms-export · admin(줄 2 · 내보내기 청구 이름) · campaigns · manage-stats · customer-timeline · campaign-list-csv.
- 프론트 = campaign-axis(대상 이름 · 칩 nowrap) · BrandMessageEditor(인증번호 삭제) · BrandSendModal(이름 · 행 꼴 인계) · recipient-paste(pickNameColumn · namesByPhone) · Dashboard(인계 세 자리) · direct-send.css(D5 ~ D7).
- 문서 = 체크리스트 xlsx B-3 문장 1 곳(숫자 문자 참조 꼴 그대로 교체 · 압축 무결성 확인) · ROOT-LEDGER R84 · R85 · R65 넓힘.
- D7 실측으로 처방 조정 = 발신 프로필 기본 폭 280 → 140(1440 · 1366 에서도 두 줄로 내려가던 것 · 고친 뒤 1366 이상 한 줄 · 1280 · 1100 두 줄 · 다섯 폭 겹침 0).
- 옛 시험 기대값 정정(이유 줄 포함) = c107-brand-contract-1105(인자 4 · 캠페인 이름 = 고른 대상 · addFromColumn 머리 인자) · c107f-contract-1106 · alimtalk-fallback-inrow-1003 · billing-test-brand-0926 · kakao-send-windows-0925.
- Codex 구현 1R(medium 2 · 수용) = ① 친구 칸 목록 읽기 실패가 줄 조회 전체를 막음 → withFriendYnField 만 빈 값 폴백(청구 쪽은 그대로 던짐 · 시험 c117-friend-fallback-1108) ② 이름이 번호와 따로라 칸 바꾸기 · 삭제 뒤 어긋남 → 구조 = 명단에 없는 번호 이름 걷기 effect + 있는 이름 덮지 않기. 2R approve.
