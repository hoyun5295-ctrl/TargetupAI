# C137 이메일 대행 건을 다시 그리는 화면의 광고 표기 — 흐름 표 · 처방 · 직원 시트

> 접수 = 그룹웨어 오류접수 `cmwd36hnr1corjnscq7xlnim1`(서수란 · 「(이메일대행) 080수신거부 처리 관련 건」) **재오픈**(1113 10:40 · 처리 메모 「담당자에게 수신되는 승인 문자 링크 확인 시 제목에는 여전히 (광고)가 자동으로 붙어 보여집니다」).
> 앞 처방 = C132 ④(설계서 `docs/2026-11-13-c132-four-tickets-design.md` §2 · 배포 5b7c709d · 1113 09:12).
> Harold 1116 「이거만 여기 세션에서 디버깅 완전 마무리하자 · 재오픈된 거야 · 제대로 좀 처리하자」.

## §0 판정

결함이다(직원 실측 차이 아님). 첨부 6장 중 3 · 6(담당자 테스트 문자) = 제목 · 본문에 (광고) · 080 없음 = 실제 발송과 같음. 4 · 5(승인 링크 화면) = 머리에 「받으신 테스트 문자 그대로 나갑니다」라고 쓰고 제목 앞에 「(광고)」를 붙여 그리며, 안내 문장이 「광고 표시와 무료 수신거부 번호는 자동으로 붙습니다」라고 말한다 = 보이는 글과 나가는 글이 다르다.

## §1 서버 지금 / 배포 뒤

- 서버 지금 = a2b6aeb2(C132 5b7c709d 포함) · 결함 자리 파일에 그 뒤 바뀐 줄 0 → 접수 화면 = 지금 배포본 그대로.
- 실측(1116 Harold 서버 출력) = C132 배포 뒤 이메일 접수 = `ad_text f` 9건(sent 3 · cancelled 6) · 칸 이전 이메일 접수(ad_text NULL = 종전 표기) 14건 · 원스텝 `t` 2건 · 배포 뒤 캠페인 406 중 `send_config.adText = false` 3건(= 이메일 대행 발송 3건 · 발송 결과 화면에서 (광고) · 080 이 붙어 보이는 건).

## §2 뿌리(새 뿌리 R97 · ROOT-LEDGER 등재)

광고 여부(`is_ad` = 광고 발송 분류 · 야간 제한 · 080 명단 · 광고 관문 · 피로도)와 광고 표기(`ad_text` · `send_config.adText` = 글에 (광고) · 080 을 붙이는가)는 C132 에서 두 축이 됐다. C132 흐름 표(D1 ~ D9)는 **글을 조립하는 서버 자리**만 뽑았고, **저장된 글을 다시 그리는 화면**(값을 그리는 화면 축)은 표에 없었다 → 화면은 여전히 `is_ad` 하나로 표기를 그렸다. 같은 꼴 = 메모리 「흐름 표 = 판정 자리 + 두 축(값 범위 · 그리는 화면)」.

## §3 흐름 표 — 이메일 대행 건이 보이는 자리 전수

칸 뽑기 = 프론트 전 파일에서 `buildAdSubjectFront(` · `buildAdMessageFront(` · `formatCampaignMessageForDisplay(` 호출과 문장 「광고 표시와 무료 수신거부 번호는 자동으로」를 grep → 저장된 행(캠페인 · 대행 접수)을 그리는 자리만 남김(새로 쓰는 작성 화면은 로컬 상태 `isAd` · `adTextEnabled` = 저장된 건이 아님). 서버 자리 = C132 표 D1 ~ D9.

| 단계 · 자리 | 쓰는 쪽(값) | 읽는 쪽(그림) | 판정 | 근거 |
|---|---|---|---|---|
| 접수(이메일) | `agency-send-intake` 접수 코어 → `ad_text = false` | — | 정상 | C132 · 실측 §1 |
| 1차 스팸 검사 · 테스트 문자 · 발송 · 예약 문안 고치기 | C132 D3 ~ D8(서버 조립) | — | 정상 | 첨부 3 · 6 · C132 계약 시험 |
| 대행 상세 문안 화면 | 원문 | `AgencySendDetail` 원문 그대로 | 정상 | 접수 원문 「상세 문안 화면에서는 고객이 올린대로 보이나」 |
| 고객사 관리 → 통계 | `manage-stats.ts`(is_ad 를 안 냄) | `StatsTab.tsx:560` | 정상 | is_ad 없음 = 원문 그대로 |
| **승인 링크 제목** | `agency-approve.ts toApprovalView`(isAd 만) | `AgencyApprovePage.tsx:245` | **결함** | 첨부 4 · 5 |
| **승인 링크 안내 문장** | 같음 | `AgencyApprovePage.tsx:250` | **결함** | 첨부 4 · 5 |
| **발송 결과 목록 문안** | `results.ts GET /campaigns`(send_config 를 뗌) | `ResultsModal.tsx:713 · 807` → `formatCampaignMessageForDisplay` | **결함** | is_ad 만 봄 · 이메일 대행 발송 3건 |
| **발송 결과 상세 제목 · 본문** | `results.ts GET /campaigns/:id` | `CampaignDetailModal.tsx:69 · 81 · 185` | **결함** | 같음 |
| **캘린더 문안** | `campaigns.ts GET /`(send_config 를 뗌) | `CalendarModal.tsx:345` | **결함** | 같음 |
| **예약 목록 제목 · 문안 수정 칸 (광고) 표시** | 같음(`/api/campaigns?status=scheduled`) | `ScheduledCampaignModal.tsx:138 · 449` | **결함** | 같음(고친 제목은 서버 D8 에서 표기 없이 나감) |
| **슈퍼관리자 통계 상세 문안** | `admin.ts GET /stats/send/detail`(is_ad 만) | `StatsDetailModal.tsx:154` | **결함** | 같음 |
| 형식 「LMS · 광고」 · 목록 「· 광고」 | is_ad | 승인 링크 · 대행 목록 · 슈퍼관리자 원장 | 유지 | 광고 발송 분류(C132 K5) |

값 범위 = 행마다 (is_ad, 표기 칸) = (true, false) 이메일 대행 · (true, NULL) 칸 이전 · 화면 · 원스텝 · 그 밖 광고 · (false, *) 광고 아님. 표기 칸을 안 내는 응답 = undefined = 종전.

## §4 처방(하나)

1. **서버가 화면에 표기 칸을 낸다.** 캠페인 = `campaignAdTextSelect(alias)`(`utils/direct-send-spec.ts` · `send_config.adText` 가 false 일 때만 false · 그 밖 NULL · send_config 통째는 안 냄). 대행 승인 링크 = `adText`(행 `ad_text` 가 false 일 때만 false · 그 밖 null).
2. **화면 판정 한 곳** = `adTextOnFront(isAd, adText) = !!isAd && adText !== false`(`utils/formatDate.ts` · 서버 `adTextOn` · `agencyAdTextApplies` 와 같은 식). `formatCampaignMessageForDisplay` 가 이 판정을 써서 결과 목록 · 상세 · 캘린더 · 슈퍼관리자 통계가 한 번에 따른다. 제목(`buildAdSubjectFront` 의 셋째 인자) · 안내 문장 · 예약 수정 칸의 (광고) 표시도 이 판정.
3. 칸이 없는 응답 = 종전 표기 → **이메일 대행 건 말고 화면 변화 0**(미가입 · 직접발송 회사 포함).

### 나눠 올림

| 단계 | 파일 | 언제 |
|---|---|---|
| C137-H1 | 서버 `direct-send-spec.ts` · `results.ts`(목록 · 상세 SELECT) · `agency-approve.ts` · 화면 `formatDate.ts` · `AgencyApprovePage.tsx` · `CampaignDetailModal.tsx` · `ScheduledCampaignModal.tsx` · 시험 | 지금 |
| C137-H2 | 서버 `routes/campaigns.ts`(GET / 목록 = 캘린더 · 예약 목록의 응답에 `${campaignAdTextSelect('c')}`) · `routes/admin.ts`(GET /stats/send/detail 의 SELECT · 응답 객체에 `ad_text`) | 두 파일에 다른 세션(C133 C + D · C134)의 미커밋 변경이 있음 → 그 커밋 뒤 |

H1 만 나가도 캘린더 · 예약 목록 · 슈퍼관리자 통계는 종전 그대로다(칸이 없으면 종전 표기 · 깨짐 0). H2 가 칸을 더하는 순간 화면은 고칠 것 없이 따른다.

## §5 계약 시험

| 시험 | 못 박는 것 |
|---|---|
| `c137-ad-text-render.test.ts` 값 범위 | isAd × adText 16칸 = 화면 판정 = 서버 두 판정 |
| 같은 파일 · 저장 글 그리기 | 광고 + 표기 끔 = 저장 글 그대로 · 칸 없음 · null · true = 종전 글자 그대로 · 광고 아님 = 그대로 · 판정 줄 |
| 같은 파일 · 서버 칸 | SELECT 조각 글자 · 결과 목록 · 상세 SELECT · 승인 링크 재료 |
| 같은 파일 · 기계 추출 | 프론트 전 파일의 `buildAdSubjectFront` · `buildAdMessageFront` 셋째 인자가 저장된 행의 광고 여부(`x.is_ad` · `r.isAd` 꼴)를 그대로 넘기는 자리 = 0 · 「(광고) 」 앞붙임 표시와 자동 부착 안내 문장의 조건이 광고 여부만 보는 자리 = 0 |
| `c137-ad-text-render.pg.test.ts` | 실 PG 에서 SELECT 조각(끔 · 켬 · 키 없음 · 문자열 · NULL) |
| `agency-ad-subject-display.test.ts`(옮김) | 승인 링크 제목 = CT 한 벌(표기 칸까지) |

변이 10(승인 링크 제목 · 안내 문장 · 저장 글 그리기 · 화면 판정 식 · 결과 상세 제목 · 예약 수정 칸 표시 · 결과 목록 SELECT · 상세 SELECT · 승인 링크 재료 · SELECT 값) 전부 빨간불.

## §6 직원 시트(서 팀장 · 배포 뒤 · 시험용 회사 계정 · 받는 번호 = 직원 본인 휴대폰)

| 순 | 하세요 | 보이면 맞음 | 맞음 / 다름 |
|---|---|---|---|
| 1 | 평소 이메일 대행 시험처럼 요청서와 명단(받는 사람 = 본인 휴대폰 한 줄)을 대행 메일 주소로 보낸다. 요청서 제목 칸 = 「표기 확인 시험」 · 문안 칸 = 「표기 확인 문안입니다」 · 광고 칸 = 광고 · 문자 종류 = LMS | 접수 완료 회신 메일이 온다 | |
| 2 | 휴대폰에 온 테스트 문자를 연다 | 제목 「표기 확인 시험」 · 본문 「표기 확인 문안입니다」 · (광고) 없음 · 무료수신거부 줄 없음 | |
| 3 | 승인 요청 문자의 주소를 누른다 | 「대행발송 승인」 화면 | |
| 4 | 회색 문안 칸의 굵은 첫 줄을 본다 | 「표기 확인 시험」(앞에 (광고) 없음) | |
| 5 | 회색 칸 맨 아래 작은 글을 본다 | 「받는 분마다 항목 값이 다르게 들어갑니다. 실제 모습은 받으신 테스트 문자와 같습니다.」 까지만 있고 「광고 표시와 무료 수신거부 번호는 자동으로 붙습니다」가 없다 | |
| 6 | 「이 문안 그대로 승인하기」 → 확인 창에서 승인 | 승인 완료 화면 | |
| 7 | 보낼 시각이 지난 뒤 휴대폰을 본다 | 문자 1통 · 2번과 같은 제목 · 본문 | |
| 8 | 한줄로에 로그인 → 발송 결과 → 그 건 줄을 본다 | 문안에 (광고) · 무료수신거부 없음 | |
| 9 | 그 건을 눌러 상세 창을 연다 | 제목 「표기 확인 시험」(앞에 (광고) 없음) · 본문에 (광고) · 무료수신거부 없음 | |
| 10 | (비교) 대행발송 화면에서 새 요청으로 같은 제목 · 문안 · 광고 체크 · 받는 사람 본인 휴대폰 | 테스트 문자 · 승인 화면 · 발송 결과 상세 모두 제목 앞 (광고) · 본문 끝 무료수신거부 번호 있음 | |

다름이면 그 화면을 캡처해 붙이고 다음 줄로 넘어가지 않는다. 캘린더 · 예약 목록 · 슈퍼관리자 통계는 C137-H2 뒤 같은 시트에 줄을 더한다.

## §7 기록

- Codex(gpt-6-astra · 적대 리뷰) = 구현 1R approve(지적 0 · SQL 파라미터 · 응답 매핑 · 알림톡 · 브랜드 갈래 그대로)
- 확인 = backend tsc 0 · frontend tsc 0 · 새 시험 · 옮긴 시험 16건 · 변이 10 빨간불 · 단위 전체 · 실 PG = (진행 · 실 PG 는 다른 카드 원장 항목이 §0 에 없어 시작 단계에서 멈춤 = 그 세션에 알림)
- 새 SQL 조각 = 운영 PG 에서 읽기로 확인(1116 Harold 서버 출력 · off 만 f · on · 키 없음 · NULL = 빈값 · 이메일 대행 캠페인 3건 8ac2cb53 · 3a6ebb98 · a7098900 = is_ad t · ad_text f)
- 단위 전체(1116 08:40) = 823파일 13,260 중 9 빨간불 = 전부 다른 카드 C136 미커밋 작업(proposal-trial · proposal 라우트 · ProposalPage · 원장 C136 카드 줄 없음) + PG 통과 기록(변경된 PG 시험 일곱 = 실 PG 전체 실행이 필요한데 C136 원장 항목이 막음) → 이 카드 push 는 그 정리 뒤
- 커밋 경로 = `scratch/c137/commit-paths.txt` · 문안 = `scratch/c137/commit-msg.txt`
