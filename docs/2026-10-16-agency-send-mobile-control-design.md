# 대행발송 개편: 담당자 휴대폰 한 대로 확인·승인·취소 (2026-10-16 설계서)

> 접수 = 서수란 그룹웨어 `cmval4qz81ivjjnn4w1xkcp93` + 직원 의견서(요청 6개).
> 결정 경로 = 비토 구조체크(후보 5) → 브레인스토밍 5역할(기획·프론트엔드·디자이너·백엔드·회의론자 · 1차 → 교차 1라운드 → 회의론자 최종 검증 7건) → Harold 승인(1016 「수렴안 승인 · 축 0부터」).
> 상설 = [FEATURE-AGENCY-SEND.md](FEATURE-AGENCY-SEND.md)(불변 원칙·소유표는 그 문서가 소유한다. 여기는 이번 개편의 근거와 순서).

## 0. 요청과 목표

| # | 요청 | 축 |
|---|---|---|
| ① | PC 접수내역 목록 「승인하기」 옆 취소 | 화면 |
| ② | 승인 요청 뒤 24시간 미승인이면 자동으로 닫기 | 축 4 |
| ③ | 담당자 모바일에서 맞춤법 고치기 바로 적용 | 축 3 |
| ④ | 모바일 취소(승인 전·후) | 축 2 |
| ⑤ | 모바일 보낼 시간 수정 | 축 2 |
| ⑥ | 모바일도 24시간 | 축 4 |

목표(직원 문장) = 법령 변경(로그인·발송 인증 강화 · 10/26)에도 「이메일 한 통 + 담당자 휴대폰」으로 끝나는 대행.
**영업 문장 = 「인증을 줄인 게 아니라, 인증하는 곳을 담당자 휴대폰 하나로 모았다」.** 쓰지 않는 말 = 인증 없이 · 인증 생략 · 로그인 없이 발송 · 누구나 승인. 「PC 로그인이 필요 없다」는 협회 질의(§5 ①) 전까지 쓰지 않는다.

## 1. 뒤집힌 전제 하나

구조체크는 「링크 열기 = 소지 인증」을 제안했다. **5역할 전원이 접었다.** 링크는 넘겨줄 수 있는 bearer다(사무실에서 카톡 전달 흔함 · 단축 URL 에 토큰째 저장 `agency-send-link.ts` buildShortAgencyApproveUrl). 3.5 「접속환경 변경 시 재인증」 조건도 없다.
→ **승인할 때만 그 폰으로 6자리 인증번호**. 직접발송의 발신 인증(3.5)과 같은 장치(`utils/sender-auth.ts`)·같은 기준(8시간 유지 · IP 대역 + 브라우저 · 시행일 · 시범 명단).

## 2. 수렴안 (축별)

### 축 0. 승인의 법정 추가 인증 (10/26 전 · 1순위) ← 이번 구현
- **게이트 자리 = 승인 CT 하나**(`approveAgencyRequestTx`). PC 승인·링크 승인이 같은 함수를 지나므로 두 입구에 함께 걸린다(지금은 PC 승인에도 없다 · `routes/agency-send.ts:672`).
  - 순서 = 사전 읽기 → **승인 가능 판정(안 되면 인증번호 문자를 보내지 않는다)** → `checkSenderAuthGate`(BEGIN **앞** · 인증번호 문자는 외부 호출) → BEGIN → 잠금 → 재판정 → 전이·이력 → COMMIT.
  - 인증 키 = 발송과 같은 판정(최종 검증 7): 수신자 행에 회신번호가 하나라도 있으면 `*`(계정 축), 없으면 대표 번호. 판정 = `findUnregisteredRequestCallbacks(row).rowCallbacks.length > 0`(워커 적재와 같은 함수 · `agency-send-worker.ts:1093`).
  - 막히면 403 + `senderAuthRejection` 몸통(직접발송과 같은 계약) → 화면이 인증 창을 띄우고 통과하면 눌렀던 승인을 다시 실행한다(`useSenderAuth`).
- **링크 = 「담당자 번호 ∩ 계정 MFA 번호」에만**(최종 검증 1).
  - 계정 후보 = 그 회사의 활성 · 비시스템 사용자 중 **접수 계정**(`created_by`) 또는 **관리자**(DB 어휘 `user_type='admin'` · JWT 어휘 아님 · 불변 11).
  - 한 번호의 승인 계정 = 접수 계정의 MFA 번호와 같으면 접수 계정, 아니면 **관리자 중 정확히 하나**일 때 그 관리자, 그 밖은 없음(링크 없음).
  - ★1016 배포 전 실측 정정: 최근 30일 외부 고객사 3곳 13건의 담당자 번호가 전부 직원 번호였다(고객사 계정 MFA 번호 0 · 직원 검증 단계). 직원 검증 단계(★1016 Harold): 고객사에 넘기기 전 직원이 업체 접수에 자기 번호를 담당자로 넣어 승인한다 → 접수 계정·접수 회사 관리자 다음 순위로 **직원 회사(ENV `AGENCY_STAFF_COMPANY_IDS`) 계정 정확히 하나**(여럿이면 그중 관리자 하나)도 승인 계정이 된다. 인증번호는 직원 자기 MFA 번호로. 고객사 담당자가 자기 계정에 휴대폰 번호를 등록하면 고객사 쪽이 먼저다.
  - 판정 = `utils/agency-send-link.ts` 의 순수 함수 `pickLinkApprovers` + 조회 `resolveLinkApprovers`. **발급**(`buildApproveTexts` · 워커 3분기 공통) · **링크 열기**(`resolveToken`) · **승인 잠금 구간**(승인 CT) 세 곳이 같은 함수를 부른다(강등·비활성·번호 변경 뒤 7일 링크가 살아 있지 않게).
  - 승인 계정이 `approved_by`·승인 이력 `by` 에 남는다(지금 링크 승인은 NULL).
  - 교집합 밖 번호 = 링크 없이 테스트 문자 + 로그인 승인 안내 + 「승인은 끝자리 XXXX 담당자가 휴대폰으로 합니다」(링크 받는 번호가 있을 때).
  - **이 발급 규칙은 시행 스위치와 무관하게 항상 적용**한다(인증번호 요구만 스위치를 따른다). 배포 전에 「링크를 잃는 회사 수」를 실측하고 대행발송이 열린 회사에 고지한다(§4).
- **「검증된 번호」 = 계정 MFA 번호 그 자체**(직접발송 3.5 와 같은 기준 · 승인 인증번호가 그 폰 소지를 증명). 본인인증(`identity_verifications`) 일치까지 요구하지 않는다: 연동 시행 전이면 오늘 링크가 0 이 된다(1003 기록 기준 · 현재 상태 미검증). 슈퍼관리자 직접 입력 구멍은 본인인증 시행 일정의 일(범위 밖).
- 링크 경로의 인증번호 확인 = `POST /api/agency-approve/sender-auth/verify`(토큰 헤더 · 승인 계정으로 `verifySenderAuthChallenge` · 응답 문구는 로그인 경로와 같은 CT 함수 `senderAuthVerifyResponse`).
- 취소·시각 변경·고치기는 인증번호 없이 + 담당자 전원 통보(취소는 발송을 멈추는 쪽 · 시각·고치기는 다시 승인을 지난다).
- 전송자격인증 원장 925줄 「대행 승인 = 직원 축이라 범위 밖」 정정 · 3.5 대응표에 「대행 승인 = 3.5 인증번호」.

### 축 1. 접수 조작 CT
- `editAgencyContentTx`(change = text | spell issueIds) · `rescheduleAgencyRequestTx` 신설 = `routes/agency-send.ts:710~885` 본문 이동(응답 계약 그대로 · 순서 hasAgencySpellColumn → attemptBlocksChange → UPDATE 그대로 · 이력 = `WITH upd AS (UPDATE) INSERT` 한 문장).
- 취소 CT: `cancelledBy` null 허용 + `cancelledByType 'agency_link'`(campaigns.cancelled_by 는 uuid) · 선택 인자 `revision`(화면·링크 = 실어 보내고 어긋나면 409 STATE_CHANGED + **현재 화면 재료**를 실어 화면이 그 값으로 바뀜 · 최종 검증 2 · 운영 취소 = null).
- 전이표 정정 3(expired → awaiting_approval · reapproval → awaiting_approval · awaiting_approval 자기 자신) + 테스트.

### 축 2. 조작 주체 · 정책
- 주체 user | link | staff. `agencyActions(actor, row, now)` 하나가 조작별 허용·막힌 사유를 만들고 info 의 `actions{}` 와 각 POST 가드가 같은 함수를 부른다. 상태 축은 기존 `checkApproval`·`canCancel`·`isEditable` 재사용.
- 링크 = 승인 · 취소 · 시각 변경(승인 전 + 미발송 재개만) · 맞춤법 제안 적용. 자유 문안 수정 = 로그인만. staff = 취소만.
- 감사 = 이벤트 via·phone·ip·ua · `recordAuditLog agency_link_<op>` · 전원 통보 · EVENT_LABEL 같은 커밋.
- 새 링크 API = `/api/agency-approve/{cancel, reschedule, spell-fix}`(토큰 헤더만 · 접수 id 미노출 · 무효는 같은 404).

### 축 3. 모바일 고치기
- 저장된 제안을 id 로 적용(SPELL_STALE · id 대조 · blocked 거절 · 겹침 거절 · slice==before · 역순 치환 · 남은 시간 MIN_LEAD 미달 거절) → `editAgencyContentTx`. 문안 버전 증가 → 옛 링크 닫힘 → 재검사 → 새 테스트 문자 + 새 승인 문자. 화면은 성공 뒤 로컬 「새 문자 대기」.

### 축 4. 승인 대기 24시간
- DDL 1 = `agency_send_requests.approval_requested_at timestamptz NULL`. 찍는 자리 = 상태를 바꾸는 바로 그 UPDATE(워커 A awaiting_approval · 워커 B reapproval · 시각 변경 복귀 · 문안 수정 때 NULL · 최종 검증 5). 컬럼 탐지로 없으면 24h 규칙만 쉰다 + 컬럼을 직접 쓰는 catch 에 503.
- `approveBy = min(approval_requested_at + 24h, 보낼 시각 - 필요 리드타임)` 함수 하나를 `isApprovalExpired`·`checkApproval` 양쪽이 쓴다(대상 awaiting_approval · reapproval). 만료 후보 조회는 기존과 별도. 이력 `expired {reason: approval_timeout}` · 새 만료 문구(링크는 링크 받는 번호에만).
- 시각 변경으로 승인 대기에 돌아가면 승인 요청 문자를 다시 보낸다(워커 A·B 의 **승인 요청 안내 + 촉박 분기만** 담은 함수 · 테스트 문자·「예약취소」 원문 제외 · 최종 검증 4). 새 토큰 만료 = 새 보낼 시각 기준 · 24h 재시작 · 설계서 §16-3 ② 정정.
- [이 시각으로 다시 진행] 은 되살린 뒤 상태로 `checkApproval` 이 통과할 때만 보인다(최종 검증 3).
- 같은 내용 진행 건 확인 = 메일 워커 조회(`agency-send-mail-worker.ts:950`)를 CT 로 올려 자기 자신을 빼고 부른다(최종 검증 6 · `isEmailDupBlocking` 은 행 하나만 봐서 막지 못한다).
- 주말 보정 없음 · 마감에 요일 · 2주 뒤 24h 만료 건 실측.

### 화면
- 모바일(`AgencyApprovePage` 한 파일): actions{}·approveBy 만 본다 · 하단 고정 바 없음 · 맞춤법 고르면 주 버튼 [고른 N곳 고치고 다시 검사]·승인 숨김 · 맨 아래 외곽선 [이 발송 취소] · 시각 [바꾸기] native · ConfirmModal light(위험 동작 자동 포커스 끔) · 바닥글 「인증번호는 이 화면에만 입력합니다. 전화나 메시지로 인증번호를 묻지 않습니다」 · 카운트다운 없음.
- PC: 목록 [취소] + 확인창 · **상세 취소 확인창 없음(현재 결함) 정정** · 목록 행 보조 줄 「승인 마감 토 18:30」 · PC 승인 인증 창.

## 3. 축 0 영향표

| 소비처 | 바뀌는 것 | 스위치 꺼짐(오늘) |
|---|---|---|
| PC 승인(`POST /api/agency-send/:id/approve`) | 승인 CT 가 발신 인증 게이트를 부른다 · 막히면 403 SENDER_AUTH_REQUIRED · 화면 인증 창 | 게이트가 DB 를 건드리기 전에 통과(`isSenderAuthEnforced`) = 동작 동일 |
| 링크 승인(`POST /api/agency-approve/approve`) | 같은 게이트 · 승인 계정 = 토큰 번호와 MFA 번호가 같은 계정 · approved_by 기록 | 인증번호 없음 · 링크 대상 제한은 적용 |
| 링크 열기(`GET /info`) | 토큰 번호에 승인 계정이 없으면 404 | 같음(이미 나간 링크도 404 가 될 수 있다 → 고지) |
| 승인 안내 문자 3분기(워커 A·B·버전 불일치) | 링크는 승인 계정이 있는 번호에만 · 나머지는 로그인 안내 + 「승인은 끝자리 XXXX」 | 같음 |
| 운영 취소 · 고객 취소 · 문안 수정 · 시각 변경 | 없음 | 없음 |
| 담당자 테스트 문자 | 없음(모든 번호에 그대로) | 없음 |
| `checkSenderAuthGate` 다른 소비처 4곳 | 없음(함수 무변경) | 없음 |
| 인증번호 확인 응답 문구 | 로그인 경로와 링크 경로가 CT 함수 하나 | 없음 |

DDL 0(쓰는 컬럼 = users.company_id · user_type · is_active · is_system · mfa_phone = 운영 코드 실사용 · `routes/billing.ts:248` · `utils/unsubscribe-helper.ts:460` · `utils/sender-auth.ts:266`).

## 4. 배포 전 실측 · 고지 (축 0)
1. 최근 30일 접수에서 담당자 번호가 접수 계정·관리자 MFA 번호와 하나도 안 맞는 회사 수(= 링크를 잃는 회사). SQL 은 배포 인계 때 하나씩.
2. 대행발송이 열린 회사에 고지(링크는 계정 담당자 휴대폰으로만 · 10/26 부터 승인 때 인증번호).
3. 배포 뒤: 시범 계정으로 PC 승인 → 인증 창 → 통과 → 승인 / 링크 승인 → 인증 창 → 통과 → 승인 · 이력 by.

## 5. Harold 결정 · 미검증
① 「링크와 인증번호가 같은 폰」 구조를 심사가 3.4 우회로 볼지(협회 질의 한 건) ② 링크를 잃는 업체(실측 후 고지) ③ 주말 보정 없음(2주 뒤 실측).

## 6. 범위 밖(BUGS 등재)
「보낼 수 없는 글자」 서버 검사 없음 · 슈퍼관리자 MFA 번호 직접 입력 · `datetime-local` 해외 시간대 · 만료 증가로 명단 잔존(B-0825-6) · 모바일 IP 대역 변동으로 재인증 잦음(미검증).

## 7. 갈린 지점과 택한 근거
- 승인 계정 범위 = 접수 계정 + 관리자(기획·백엔드 · 각자 자기 계정·번호로 인증 = 공동 인증수단 아님 · 승인자는 approved_by) ← 회의론자 「접수 계정만」.
- 검증 정의 = MFA 번호(위 근거) ← 기획·회의론자 「본인인증 일치」.
- 무효 링크 = 같은 404 유지 ← 백엔드·회의론자 「문안 버전만 낡으면 410」.
- 취소 revision = 넣음(4역할) ← 회의론자 「의도는 같다」.
- 만료 문자 링크 = 링크 받는 번호에만(휴대폰 재진행) ← 회의론자 「링크 없음」.
- 모바일 하단 고정 바 = 없음(디자이너가 1차 안을 접음).
