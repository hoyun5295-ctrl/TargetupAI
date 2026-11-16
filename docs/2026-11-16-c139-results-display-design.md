# C139 설계서 · 발송결과 메시지 창 제목 + 여정 발송 건 변수 자리 표기

> 접수 · 흐름 표 · 판정 = `docs/2026-11-16-c139-results-display-flow-ledger.md`(이 설계의 범위 = 그 표 전체)
> Harold 1116 「단 하나의 결함도 남지 않도록 완벽한 설계서 · 코덱스 리뷰 닫힐 때까지 · 구현 · 구현 코덱스 닫힐 때까지 · 보고」
> 운영 실측(1116 Harold · 서버 .62)
> - 인비토 합성 회사(c7c97996) 연결 있는 여정 캠페인 4행 = 저장 본문 「(광고) [주식회사 인비토] 박지민님, 저희를 믿고」 · 그 칸 원문 「[주식회사 인비토] %고객명%님, 저희를 믿고 선택」(최수아 · 송혜원 · 임건우 같은 꼴) → 결함 확인
> - 여정 캠페인 전체 55행 · 회사 2(c7c97996 54 · d284960d 1) · 칸 연결 없는 행 50(전부 c7c97996 · 단계 기록 0 · 살아 있는 칸 0 = 여정을 지워 연결 · 기록이 함께 지워짐 · journey_step_campaigns FK → journeys CASCADE) · A/B 칸 행 0 · 알림톡 행 1(템플릿 연결 있음) · 원문이 괄호로 시작 0 · 첫 날 2026-08-20
> - C134 때 보던 998900e1 = 연결 없는 50행 중 하나(별도 결함 아님 · C134 원장에 기록)
> - spam_filter_tests.subject = information_schema 에 있음 · MySQL = msg_contents 를 가진 표 138 모두 title_str 있음(없는 표 0)
> - MySQL = msg_contents 를 가진 표 138 모두 k_next_contents 있음(없는 표 0 · 1116 Harold 출력) · k_next_type 은 지금 발송 내역 UNION 이 이미 읽는다
> Codex 설계 1R(needs-attention 3건 · 전부 수용) = ① 지난 행 고침이 칸 지금 원문으로 대신하면 발송 이력을 바꾼다 ② 080 꼬리를 걷어 저장하면 화면이 지금 080 으로 다시 붙여 과거 번호가 바뀐다 → 2절 보낸 꼴(광고 · 080 그대로 · 변수 자리만 남김) ③ 알림톡 줄 안 장문 대체는 제목을 받아도 알림톡 모양 창이라 안 그린다 → 1절 받은 모양(deliveredViewOf) + 다음 할 일 「상세 미리보기의 실제 첫 줄 우선 경로」 → 2-4.
> Codex 설계 3R(needs-attention 1건 · 수용) = 알림톡 칸이면 렌더 공유 값 `shared` 가 null(:879)인데 080 을 그 값에서 읽으면 알림톡 묶음이 전부 멈춘다 → 2-2 = 알림톡은 080 빈 값 · 문자 갈래에서만 shared 를 읽음 · 실 PG 에 알림톡 칸.
> Codex 설계 2R(needs-attention 3건 · 전부 수용 · 1-1 · 1-5 · 2-4 지적 없음) = ① 글자 조각 일치로는 그때 쓴 원문을 특정할 수 없다(변수 값 안의 글자를 고정 글자로 오인 · 판 조회 :586 과 캠페인 만들기 :1053 이 떨어져 「만든 시각까지 최신 판」도 근거가 아니다) → 3절 지난 행은 고치지 않는다(그때 쓴 판 · 변이를 기록한 곳이 없다) ② 추천 자리 안 글자 · 변수 값이 머리 · 꼬리 판정을 바꾸는 꼴 → 2-1 대표 본문을 렌더 모듈 안에서 렌더와 같은 차례(추천 자리 가림 → 글자 정리 → 광고 머리 · 꼬리)로 만들고 판정 기준을 명시 ③ 채널별 글자 정리 차례 → 2-1 문자 = 정리한 원문 · 알림톡 = 정리하지 않은 원문(렌더와 같음).

## 0. 미가입 · 직접발송만 쓰는 회사 변화 0

| 바뀌는 곳 | 미가입 · 직접발송 회사에서 | 증명 시험 |
|---|---|---|
| 1-2 · 1-3 응답에 보기 칸(view_type · subject · view_contents) 더함 · 읽는 칸 title_str · k_next_contents 더함 | 기존 칸 값 그대로 · 큐 · 차감 · 발송 무접촉 · 그 표에 칸이 있음 = 관문 | 단위 = 옛 칸 · 새 칸 리터럴 |
| 1-4 메시지 내용 창 | **접수가 요청한 변화** = 장문 · 그림으로 받은 줄 · 캠페인에 제목 한 줄 · 알림톡 · 브랜드가 문자로 대체돼 나간 줄은 받은 모양(문자 창 · 받은 글 · 제목) · 그 밖 줄의 창 모양 · 본문 변화 0 | 화면 실측 + 계약 A-1 · A-2 |
| 1-5 상세 창(CampaignDetailModal) 제목 두 자리 | 같은 식을 CT 로 옮김 = 값 같음 | 계약 A-4 |
| 2-4 상세 미리보기의 첫 줄 실제 글 우선 | 여정 캠페인만 끈다 · 직접발송 등은 그대로 | 계약 A-5 |
| 2 여정 단계 캠페인 행 본문 | 여정 행(`send_type = 'journey'`)만 | 실 PG = 여정 아닌 행 본문 그대로 |
| 3 지난 행 | 고치지 않는다(DB 쓰기 0) | 해당 없음 |

## 1. 처방 A · 메시지 내용 창에 제목(접수 원문 1안 「내용 클릭 시 제목도 함께 표시」)

창(ResultsModal.tsx:1412 ~ 1501)이 한 부품이라 여는 네 자리가 같이 받는다(테스트발송내역 두 목록 · 채널통합조회 · 발송 내역 줄).

1-1 큐 줄 하나를 「받은 사람이 받은 모양」으로 읽는 판정 한 곳 = `utils/sms-result-map.ts` 에 `deliveredViewOf(row)` 신설(줄 이름 `getSendTypeLabel` 옆 · 대체 판정 = `fallbackOf` 하나 · 입력 = msg_type · k_oriseq · status_code · title_str · k_next_type · k_next_contents · msg_contents).
| 줄 | viewType | subject | viewContents |
|---|---|---|---|
| L · M(대체 아님) | null(창은 옛 유형 그대로) | 제목(앞뒤 공백 정리) | null(옛 본문 그대로) |
| S(대체 아님) | null | 빈 값(단문은 제목이 없다) | null |
| K · F 이고 대체 'L'(7831) | 'LMS' | 제목 | 대체 유형 A · B(대체 문안) = k_next_contents · 그 밖(원문 그대로 L · S) = null |
| K · F 이고 대체 'S'(7830) | 'SMS' | 빈 값 | 같은 규칙 |
| K · F 대체 아님 | null | 빈 값 | null |
| 옛 분리 대체 줄(S · L + k_oriseq > 0) | 'SMS' · 'LMS' | L 이면 제목 | null(그 줄 본문이 대체 글) |
| 알 수 없는 유형 · null 칸 | null | 빈 값 | null |
- 대체 유형 A · B 판정 = `utils/alimtalk-fallback.ts` 의 「대체문안을 쓰는 타입인가」(:81) CT 를 그대로 쓴다(글자 비교 새로 쓰지 않음).
- 브랜드(F) 본문 = 지금처럼 `getDisplayContents` 가 JSON 에서 꺼낸 글(viewContents null 이면 창은 그 글).

1-2 `routes/campaigns.ts` GET /test-stats
- 담당자 테스트 목록 읽는 칸(:1647)에 `title_str` · `k_next_type` · `k_next_contents` · 줄(:1690)에 `viewType` · `subject` · `viewContent`(deliveredViewOf 결과 · 원 칸은 응답에 싣지 않음).
- 스팸 목록 SELECT(:1745)에 `t.subject` · 줄(:1759)에 `subject: msgType === 'LMS' ? (r.subject || '') : ''`(저장된 그대로 · 손 검사는 저장 칸이 비어 빈 값).

1-3 `routes/results.ts` 발송 내역 줄 칸 `SMS_DETAIL_FIELDS`(:58)에 `title_str` · `k_next_contents` · 응답 줄(:911)에 `view_type` · `subject` · `view_contents`(원 칸 title_str · k_next_contents 는 응답에서 뺀다).
- ⚠ 이 칸은 회사 라인 · 이력 표(`_YYYYMM`) · 비토 라인 표를 UNION ALL 로 읽는다 · 한 표라도 칸이 없으면 전체 실패(본 경로는 LIVE 만 다시 · 테스트 목록은 500). title_str = 확인 끝(없는 표 0) · **k_next_contents = MySQL 출력으로 없는 표 0 확인 뒤에만 쓴다**(k_next_type 은 지금도 같은 UNION 이 읽는다 = 있음).
- 엑셀(SMS_EXPORT_FIELDS)은 범위 밖(엑셀에 제목 칸 요청 없음 · 7절).

1-4 화면 `ResultsModal.tsx`
- 창 상태(:139)에 `subject?: string` · 문자 모양 창(:1458 ~)의 말풍선 맨 위에 제목 한 줄(굵게 · 아래 줄 · CampaignDetailModal.tsx:185 와 같은 모양 · `break-all`) · `subject` 가 빈 값이면 줄 없음 · 바이트 칸은 본문 기준(옛 그대로) · 알림톡 모양 창(:1415)은 그대로(알림톡으로 받은 줄만 이 창으로 온다).
- 제목 유무 · 창 유형은 서버 · CT 가 정한다(창은 받은 값을 그린다 · 유형 글자로 다시 가르지 않는다).

1-5 여는 네 자리
| 자리 | msgType | content | subject |
|---|---|---|---|
| 담당자 테스트 이력(:994) | `t.viewType ?? t.type`(옛 그대로 + 대체 줄만 문자 유형) | `t.viewContent ?? t.content` | `t.subject` |
| 스팸필터 테스트 이력(:1059) | 옛 그대로 | 옛 그대로 | `t.subject` |
| 발송 내역 줄(:1227) | `m.view_type ?? m.msg_type` | `m.view_contents ?? m.msg_contents` | `m.subject` |
| 채널통합조회(:714) | 옛 그대로 | 옛 그대로 | 새 CT `campaignSubjectForDisplay(c)` · 단 알림톡 · 브랜드 전용 캠페인(`isAlimtalkChannel` · `isBrandOnlyChannel`)은 빈 값(그 캠페인의 제목 칸은 대체 문자 제목 · 창 본문은 알림톡 · 브랜드 글) |
- 목록 칸의 미리보기 글(MessageCell 표시)은 옛 그대로(대체 줄도 목록에는 지금 글 · 창만 받은 모양 · 7절).
- 새 CT `utils/formatDate.ts` `campaignSubjectForDisplay(campaign)` = 장문 · 그림 캠페인(message_type LMS · MMS · L · M)이고 `subject || message_subject` 가 있으면 `buildAdSubjectFront(제목, message_type, adTextOnFront(is_ad, ad_text))` · 아니면 빈 값. CampaignDetailModal 의 같은 식 두 자리(:81 정보 줄 · :185 미리보기)를 이 CT 로 바꾼다(옛 식 `isLmsType && subject ? buildAdSubjectFront(…) : 없음` 과 같은 값 · 알림톡 캠페인 정보 줄도 옛 그대로 제목 · 알림톡 제외는 채널통합조회 호출부에서만).

값 범위(제목)
- 손 스팸 검사 = 저장된 제목 없음(spam-filter.ts:231 · :258) → 줄 없음(7절).
- 옛 테스트 · 발송 줄 = 큐에 제목이 있으면 그대로 보인다(고침 없이 지난 것도).

## 2. 처방 B · 여정 단계 캠페인 행 본문 = 보낸 꼴 그대로 · 변수 자리만 남김

옛 = 첫 고객에게 보낸 글 그대로(변수 채움 · (광고) · 080 꼬리 · 보낼 수 없는 글자 정리 · 추천 자리 채움). 새 = 그 글에서 **변수 · 추천 자리만 채우지 않은 글**. 광고 머리 · 080 꼬리 · 개행은 보낸 때 그대로 저장된다(화면 CT `formatCampaignMessageForDisplay` 는 머리 · 꼬리가 있으면 다시 붙이지 않는다 = formatDate.ts:1059 · :1060 → 지금 080 설정이 바뀌어도 과거 행은 보낸 번호).

2-1 대표 본문 만들기 = 두 함수.
- 문자 칸 = `utils/journey-message-render.ts` 에 `journeySmsDisplayCopy({ template, channel, isAd, opt080Number })` 신설 · **렌더(renderJourneySmsMessage)와 같은 모듈 · 같은 차례에서 고객 값만 넣지 않는다**: ① 추천 자리 가림(렌더 :112 maskRecoSlot · 추천 자리가 있는 판에서만 · 이 모듈 머리의 「미리보기 = 검사 = 실발송」 원칙) ② 글자 정리(:145 sanitizeUnsendableForSms) ③ 광고 머리 · 080 꼬리(buildAdMessage · prepareSendMessage :642 와 같은 함수 · 같은 인자) ④ 추천 자리 표식을 원래 글로 되돌림(가림 표식 → 원문의 추천 자리 글). 변수 치환(:632 replaceVariables) · Liquid · 외부 값 · 예측 값 · 추천 고르기는 하지 않는다(DB · 망 호출 0 · 동기 함수).
- 알림톡 칸 = 템플릿 원문 그대로(`#{변수}` · 글자 정리 없음 · 광고 표기 없음 = 렌더 :894 fillAlimtalkVarMap 이 원문에 변수만 채우는 것과 같은 꼴).
- 고르는 자리 = `utils/journey-step-campaign.ts` `stepCampaignDisplayCopy({ isKakao, kakaoTemplateContent, template, channel, isAd, opt080Number })` 신설(알림톡 = 원문 · 문자 = journeySmsDisplayCopy · 원문 빈 값 · null = 빈 값).
- 인자 = 유형 `journeySmsType(칸 채널)` · 광고 = 렌더에 넘기는 값(`rowStep.is_ad` → resolveJourneyAdFlag · 렌더 :108 과 같은 판정) · 080 = 그 묶음이 렌더에 쓴 `shared.opt080Number`(loadJourneyRenderShared :60 · 같은 값).
- 판정 기준(명시) = 광고 머리 · 꼬리를 붙이는가는 **원문(변수 자리 · 추천 자리는 가린 채)의 고정 글자**로 판정한다. 변수 값이 머리 · 꼬리 판정을 바꾸는 꼴(변수 값이 「(광고)」로 시작 · 「무료수신거부」를 담음)은 고객마다 받은 글이 다르다 → 대표 본문은 원문 기준을 따르고 그 고객의 글과 같지 않다(대표 본문은 한 고객의 글이 아니다 · 시험 R98-3 반례로 못 박음). 추천 자리 안 글자는 렌더처럼 가린 채 판정하므로 렌더와 같은 결정.
- 커밋 겹침 = journey-message-render.ts 에는 다른 카드(C133)의 미커밋 덩어리(추천 자리 도입 · :16 ~ :166)가 있다. 서버 배포본(HEAD)에는 추천 자리가 없다 → C139 커밋 = HEAD 판에 ②③ 만 있는 함수(추천 자리 없음 = 가림 단계가 할 일 없음) · 작업 트리의 C133 덩어리에 ①④ 줄을 둔다(C133 커밋이 그 줄을 싣는다 · STATUS-FEED C133 카드에 한 줄).
- `StepCampaignSpec.representativeMessage` 설명(:21)을 「보낸 꼴에서 변수 · 추천 자리를 채우지 않은 글(stepCampaignDisplayCopy) · 고객에게 채운 글을 넣지 않는다」로.
- D103(campaigns.message_content = 순수 본문)의 예외를 같은 자리 주석으로: 여정 행은 다시 보내는 입력이 아니고(:1190 재발송 경로를 타지 않음) 보낸 꼴을 보존하는 기록이다(옛 여정 행도 머리 · 꼬리가 든 글).

2-2 `journey-executor.ts`
- 묶음 발송이 `sendUnits` 를 부르는 자리(:967 · 렌더 블록 안 = `shared` · `variants` · `variantByExec` · `kakaoTemplateRow` 가 보인다): 첫 보낼 줄(`sendRows[0]`)이 받은 판 = `variantByExec` 의 그 줄 변이 id → `variants`(:762)에서 찾은 변이를 칸에 덮은 판(`applyVariantToStep` · 렌더 :888 과 같은 함수) · 변이 없음 = 그 칸(:586 최신 판 적용된 step) → `stepCampaignDisplayCopy({ isKakao, kakaoTemplateContent: kakaoTemplateRow?.content, template: 그 판.message_template, channel: 그 판.channel, isAd: 그 판.is_ad, opt080Number: isKakao ? '' : shared!.opt080Number })`(렌더 :900 ~ :901 이 그 줄에 넘긴 값과 같은 값 · ★ Codex 3R = 알림톡이면 `shared` 가 null(:879) → 080 은 문자 갈래에서만 읽는다 · 알림톡은 080 을 쓰지 않는다) → `c.displayMessage`.
- `sendUnits`(:1048 c 형 · :1055) = `representativeMessage: c.displayMessage`. 제목은 그대로 `rows[0].subject`(제목 변수가 남은 판은 보내기 전에 보류 = :769 · 고객마다 같다).
- 겹침 = 다른 카드(C133)의 미커밋 덩어리(:877 ~ :949)와 겹치지 않는다 → 이 카드 줄만 부분 커밋(C134 와 같은 방식).

2-3 화면 결과(여정 행) = 채널통합조회 · 상세 · 캘린더 · 슈퍼관리자 통계 상세 · 관리 통계 상세 · 엑셀 = 「(광고) [주식회사 인비토]\n%고객명%님, …\n무료수신거부 080-…」(보낸 꼴 · 이름 자리만 변수) · AI 참고 글(citations) · 스팸 규칙 모의 · 글 길이 분포 = 같은 글(한 고객 이름이 AI 에 들어가지 않음).

2-4 상세 미리보기(CampaignDetailModal.tsx:69)는 발송 내역을 연 뒤 첫 줄의 실제 글(firstMessageContent)을 캠페인 본문보다 앞에 둔다(D137 = 목록과 상세의 광고 표기 일치용). 여정 캠페인은 저장 본문이 이미 보낸 꼴이라 그 이유가 없고, 첫 줄 실제 글 = 한 고객 이름 → **여정 캠페인(send_type journey)이면 첫 줄 글을 넘기지 않는다**(그 밖 캠페인은 옛 그대로 = 직접발송 변화 0).

값 범위(여정 대표 본문)
| 경우 | 결과 |
|---|---|
| 문자 칸 · 변이 없음 | 그 칸 최신 판 본문의 보낸 꼴 |
| 문자 칸 · A/B | 첫 보낼 줄이 받은 변이 판(지금 운영 0) |
| 알림톡 칸 | 템플릿 원문 |
| 원문에 (광고) · 080 꼬리가 이미 있음 | buildAdMessage 가 다시 붙이지 않음(렌더와 같음) |
| 보낼 수 없는 글자 | 렌더와 같이 정리된 글 |
| 광고 아닌 칸(문자 칸은 늘 광고 · resolveJourneyAdFlag) | 머리 · 꼬리 없음 |
| 같은 날 이어 붙이는 행(seq + 1) | 그 행을 만든 묶음의 첫 줄 판 |
| 추천 자리가 든 판(C133 배포 뒤) | 추천 자리 글은 표식 글 그대로 · 머리 · 꼬리 판정은 가린 채(렌더와 같음) |
| 변수 값이 머리 · 꼬리 판정을 바꾸는 고객 | 대표 본문 = 원문 기준(그 고객 글과 다름 · 판정 기준 명시) |
| 배포 전에 만든 오늘 행 · 지난 행 | 고치지 않는다(3절) |
| 시연 회사 | 캠페인 행을 만들지 않음(:951 demo) |

## 3. 지난 여정 행 = 고치지 않는다(DB 쓰기 0)

- 배포 전 여정 캠페인 행 55(1116 실측)는 첫 고객에게 채운 글을 담고 있다. 그 글이 **어느 판 · 어느 변이에서 나왔는지 기록한 곳이 없다**: 실행기가 읽은 판 id(snapshotId)는 보낼 수 있는지 판정(stepSendableSql · journey-executor.ts:1160)에만 쓰이고 저장되지 않는다 · 변이는 단계 기록에 칸이 없다 · 판 조회(:586)와 캠페인 만들기(:1053)가 떨어져 있어 「만든 시각까지 최신 판」도 그때 쓴 판이라는 근거가 아니다 · 글자 조각 대조는 변수 값 안의 글자를 고정 글자로 오인한다(Codex 2R ①).
- 그래서 원문을 특정할 수 없다 → 지어낸 원문으로 덮지 않는다(고객 문안 불변 원칙 · 발송 기록 보존). 55행(합성 회사 54 · d284960d 1 · 칸 연결 없는 50 포함)은 옛 글 그대로 두고 원장 · BUGS 에 수와 이유를 적는다.
- 앞으로의 행은 2절이 그 행을 만든 묶음의 첫 줄 판에서 바로 대표 본문을 만들므로 판 기록이 필요 없다.

## 4. 뿌리 R98(신설) · 계약 시험

R98 = 「공용 표의 같은 칸을 생산자마다 다른 뜻으로 쓴다 · campaigns.message_content 를 다섯 생산자는 변수 자리가 남은 원문으로, 여정만 첫 고객에게 채운 글로 써서, 그 칸을 다시 그리는 화면 여섯 · 엑셀 · AI 참고 글이 한 고객의 이름 · 매장을 보였다(1116 접수 cmwilf3re1 · 캘린더 댓글)」.

새 계약 `utils/__tests__/c139-results-display.test.ts`(대상은 소스에서 기계로 · 구문 트리)
- R98-1 백엔드 src(시험 밖)의 `INSERT INTO campaigns` 문장 전부를 뽑아 파일별 개수를 분류표(생산자 · message_content 값의 뜻)와 대조 · 표에 없는 새 문장 = 실패 · 여정 생산자 = journey-step-campaign.ts 한 문장.
- R98-2 `pickStepCampaignForUnits` 를 부르는 자리 전부에서 `representativeMessage` 값이 `stepCampaignDisplayCopy` 호출 결과에 묶인다(바인딩 추적 · 렌더 결과 `.message` · `rows[` 에 닿으면 실패).
- R98-3 `stepCampaignDisplayCopy` · `journeySmsDisplayCopy` 값 범위(손으로 쓴 리터럴 기대값) = 알림톡 원문(이모지 · `#{변수}` 그대로) · 문자 LMS · SMS 광고(머리 · 꼬리 꼴 · 080 있음 · 없음) · 원문에 머리 · 꼬리가 이미 있음 · 보낼 수 없는 글자(정리됨) · Liquid · 빈 값 · 반례 = 변수 값이 「무료수신거부」를 담는 고객(그 고객 렌더 = 꼬리 없음 · 대표 본문 = 꼬리 있음 = 원문 기준 판정을 못 박음) · 같은 원문 · 고객 이름 리터럴의 렌더(renderJourneySmsMessage) 결과에서 이름을 변수 자리로 되돌리면 대표 본문과 같음(이 시험 DB 없이 = 공유 값 주입 shared).
- A-1 `ResultsModal.tsx` 의 `setMsgDetailContent(` 객체 인자 전부가 `subject` 속성을 가진다(지금 4) · 창 그리기가 `subject` 를 말풍선에 그린다.
- A-2 `deliveredViewOf` 값 범위 = 1-1 표 전부(리터럴 · 7830 · 7831 · 대체 유형 A · B · L · S · N · 옛 분리 줄).
- A-3 테스트 목록 · 발송 내역 줄의 응답이 `deliveredViewOf` 를 지난다 · 발송 내역 · 테스트 목록 여는 자리가 viewType · viewContents 를 쓴다(구문 트리).
- A-4 `campaignSubjectForDisplay` 값 범위 + CampaignDetailModal 에 `buildAdSubjectFront(` 직접 호출 0 · 이 CT 호출 1(값 하나를 정보 줄 · 미리보기 두 자리가 씀) · 옛 식과 같은 값(값 범위 표 · 알림톡 캠페인 포함).
- A-5 CampaignDetailModal 이 `formatCampaignMessageForDisplay` 에 넘기는 둘째 인자가 여정 캠페인에서 빈 값.
- 실 PG `c139-results-display.pg.test.ts` = 실행기(runJourneyExecutor)를 운영 문장 그대로(바깥 = MySQL 적재 손 · engine-throughput-1102 틀) 돌려 문자 칸 · A/B 칸 · **알림톡 칸**(★ Codex 3R · 시험 DB 에 승인된 발신 프로필 · 템플릿 행 · 외부 승인 상태 조회는 시험 손)에서 캠페인 행 본문 = 기대 리터럴(문자 = 머리 · 원문 · 꼬리 · 알림톡 = 템플릿 원문) · 고객 이름 0 · 알림톡 묶음이 sendUnits 를 지나 적재까지 간다(실패 0) · 같은 회사의 여정 아닌 캠페인 행 무접촉 + 스팸 목록 SELECT 한 번.
- 변이(파일 복사) = 대표 본문을 `rows[0].message` 로 되돌림 → R98-2 · 실 PG 빨간불 · CT 의 buildAdMessage 뺌 · 글자 정리 뺌 → R98-3 빨간불 · 창 여는 자리 하나에서 subject 뺌 → A-1 · deliveredViewOf 의 7831 갈래를 null 로 → A-2 · 응답에서 deliveredViewOf 뺌 → A-3 · 상세의 여정 조건 뺌 → A-5.
- ROOT-LEDGER 에 R98 줄(계약 이름 = c139-results-display).

## 5. 시험 · 배포

- backend tsc 0 · frontend tsc 0 · 단위 전체 · 실 PG 전체(스탬프) · 화면 = 개발 서버 실제 컴포넌트(테스트 목록 장문 · 단문 · 알림톡 · 대체 LMS 줄 · 스팸 장문 · 채널통합조회 장문 · 알림톡 캠페인 · 발송 내역 장문 · 대체 줄 · 여정 상세 · 폭 320 ~ 1440 넘침 0).
- Codex 설계 approve → 구현 → Codex 구현 approve.
- 커밋 = 이 카드 파일 + journey-executor.ts 의 이 카드 줄만(부분) · 커밋 판 사본에서 tsc · 맞닿은 시험.
- DDL 0 · DB 쓰기 0 · ENV 0 · 배포 = 서버 pull → 백엔드 build:safe → 프론트 build:safe → 적재 0건 → 재시작(C139-H1) → 실측 C139-S1(다음 날 오전 여정 행 본문 = 보낸 꼴 · 이름 0).

## 6. 직원 지시문 초안(구현 전 · 기대 결과 고정)

시트 1 테스트발송내역 제목(테스트계정 · 받는 번호 = 직원 본인 휴대폰 · 담당자 번호)
| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 직접발송에서 장문(LMS)을 고르고 제목 「제목 확인 시험」, 본문 「제목 확인 본문」을 넣고 담당자 테스트를 보낸다 | 휴대폰에 제목 「제목 확인 시험」 문자가 온다 |
| 2 | 발송결과 → 테스트발송내역 → 조회 | 담당자 테스트 이력 맨 위 줄 내용 「제목 확인 본문」 |
| 3 | 그 줄의 내용을 누른다 | 창의 말풍선 맨 위에 「제목 확인 시험」(광고를 켰으면 「(광고) 제목 확인 시험」) · 그 아래 본문 |
| 4 | 단문(SMS)으로 본문 「단문 확인」 담당자 테스트 → 테스트발송내역 → 그 줄 내용을 누른다 | 창에 제목 줄이 없다 |
| 5 | 전송결과 탭 → 장문 캠페인 한 줄의 메시지 내용을 누른다 | 창 맨 위에 그 캠페인의 제목 |
| 6 | 그 줄의 상세 → 발송 내역 → 한 줄의 메시지내용을 누른다 | 창 맨 위에 같은 제목 |

시트 2 여정 발송 건 표기(접수하신 인비토 계정)
| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 배포 다음 날 오전 10시 30분까지 기다린 뒤 발송결과 → 전송결과 → 기간 = 그날 하루 → 조회 | 「여정」 줄의 메시지 내용에 사람 이름 대신 「%고객명%님」 |
| 2 | 그 줄의 메시지 내용을 누른다 | 창 본문에 「%고객명%님」 · 맨 끝에 무료수신거부 번호 |
| 3 | 그 줄의 상세를 누른다 · 발송 내역을 열었다 닫는다 | 상세의 메시지 칸에 두 번 다 「%고객명%님」 |
| 4 | 캘린더 → 그날 → [여정] step 1 을 누른다 | 메시지에 「%고객명%님」 · 사람 이름 0 |
| 5 | 발송 내역에서 한 줄의 메시지내용을 누른다 | 그 고객 이름이 든 실제 글(줄마다 받은 글은 개인화된 글이 맞다) |
- 배포 전 날짜의 여정 줄(11-16 까지)은 그때 쓴 원문을 특정할 수 없어 옛 글 그대로다(시트 대상 아님 · 3절 · 원장 기록).

## 7. 범위 밖(기록만 · 착수 0)

1. 손 스팸 검사는 제목을 저장하지 않는다(spam-filter.ts:231 · :258) · 저장하게 바꾸면 같은 글 검사 재사용 판정(spam-test-queue.ts:494 제목 일치)이 달라진다.
2. 발송결과 밖의 제목 없는 메시지 창 셋 = 슈퍼관리자 MessageDetailModal · SmsDetailModal · 관리 통계 StatsTab.
3. 캘린더는 제목을 (광고) 판정 없이 저장 원문 그대로 그린다(CalendarModal.tsx:302 · 직접발송 포함).
4. 테스트 이력의 알림톡 줄(대체 아님)을 누르면 카카오 모양이 아니라 문자 모양 창(줄 이름 「알림톡」 ≠ 창이 보는 'K') · 채널통합조회의 알림톡 캠페인도 문자 모양 창 · 대체 줄의 목록 미리보기 글은 알림톡 글(창만 받은 모양).
5. 직접발송 캠페인의 080 꼬리는 저장하지 않고 화면이 지금 설정으로 붙인다(번호를 바꾸면 과거 행 표시도 바뀐다 · 여정은 2절로 보낸 번호 보존).
6. 배포 전 여정 캠페인 행 55 본문 = 옛 글(3절 · 그때 쓴 판 · 변이 기록 없음).
