# C148 그룹웨어 오류접수 세 건 설계서 (2026-11-20)

접수 원문 = 그룹웨어 1120 세 건(남지현 「자동 마케팅 AI 새 제안 스팸 이슈」 · 서수란 「(이메일대행) 맞춤법 확인 관련 개선 요청」 · 박성용 「발신번호 등록 갯수 제한 변경 건」).
Harold 1120 「추천대로 설계 · 설계 Codex 닫힐 때까지 · 구현 · 구현 Codex 닫힐 때까지 · 보고」.

## §0 축 대조표(접수 항목 전부)

| 접수 | 항목 | 이 설계의 축 | 이 축이 없으면 닫히는가 |
|---|---|---|---|
| T1 | 다음 회차 10시 검사 3안 정상 수신인데 「스팸필터 통과 못 해 보류」 문자 · 화면 「검사 결과 없음 · 검토 필요」 | §1 시간 초과 = 보류 + 회복이 다시 읽음 | 안 닫힘 |
| T2-1 | 맞춤법 제안을 문안 전체에서 한 번에 | §2-가 같은 낱말 모든 자리 · 지시문 「끝까지」 | 안 닫힘 |
| T2-2 | 혜택안내 두 곳이 한 번에 안 고쳐짐 | §2-가 | 안 닫힘 |
| T2-3 | 고친 뒤 스팸 다시 돌고 맞춤법 새 제안 → 또 한 바퀴 | §2-나 맞춤법 고치기 뒤 다시 검사 0 | 안 닫힘 |
| T2-4 | 스팸 검사 자체 시간(1 ~ 10분) | 범위 밖(접수 「참고」 · 검사 장비 시간) | 해당 없음 |
| T3-1 | 회사명의 무선 = 법인 4 유지 · 기타명의 무선 = 회사 총량 해제 · 명의자(CI/DI) 1인당 3 | §3 회선 셈 | 안 닫힘 |
| T3-2 | 회사명의 · 기타명의 뒤 [유선번호] · [무선번호] 두 번째 선택 | §3 화면 | 안 닫힘 |
| T3-3 | 무선 = 통신가입증명원 빠짐 · 재직증명서 · 위임장 등 그대로 · 휴대폰 본인인증 · 입력 번호 = 인증 번호 | §3 본인인증 + 서버 대조 | 안 닫힘 |

Harold 결정(1120 「추천대로」):
- 회사명의 무선에는 본인인증을 붙이지 않는다(법인 명의 휴대폰 = 개인 본인확인 대상 아님 · ⚠ 미검증 · KMC 규격 확인 과제). 회사명의 유선 · 무선 = 서류 · 회사 상한 지금 그대로.
- 1인당 3회선 범위 = 같은 회사 안(회사별 격리).
- 이미 승인된 기타명의 휴대폰(본인인증 이력 없음 · 운영 12건 중 무선 수 미측정) = 그대로 쓰고 회사 무선 총량에서만 빼며 1인 셈에는 넣지 않는다.

## §1 T1 자동마케팅 시간 초과 보류(결함)

### §1-1 실측(Harold 1120 서버 출력 · 제안 11-20 10:01:00)

| 안 | 검사 시작 → 닫힘 | 닫힐 때 첫 판정 | 늦은 보고(지금 줄) |
|---|---|---|---|
| 1안 | 10:01:00 → 10:02:02 | SKT pass · KT timeout · LGU timeout | KT 10:02:26 pass · LGU 10:03:13 pass = 전부 통과 |
| 2안 | 10:02:04 → 10:03:05 | KT pass · SKT pass · LGU timeout | LGU 끝내 없음 |
| 3안 | 10:03:06 → 10:04:08 | KT pass · SKT pass · LGU timeout | LGU 10:05:59 pass = 전부 통과 |

제안 = admin_review · spam_test_status timeout · 담당자 문자 「3안 모두 스팸필터를 통과하지 못해」. 보낼 수 있는 안(1안 · 3안)이 있었다.

### §1-2 흐름 표(소스 이음매)

| # | 자리 | 값 범위 | 지금 | 바뀐 뒤 | 그리는 화면 |
|---|---|---|---|---|---|
| 1 | `spam-test-queue.ts:1173` 검사 닫힘(60초 · `TIMEOUTS.spamFilterTest`) | 줄마다 pass · blocked · unconfirmed · timeout · failed | 통신사 결과 없는 줄 = timeout | 그대로 | 없음 |
| 2 | 앱 늦은 보고(`SPAM_LATE_REPORT_MINUTES` = 10) | timeout · blocked → pass | 닫힌 뒤 10분 안 줄을 고침 | 그대로 | 없음 |
| 3 | `waitForTestCompletion` → `runOneTest` → `sequenceSpamVariants` | 안마다 pass · blocked · rejected · unconfirmed · pending · timeout · failed | timeout 이면 다음 안 검사 · 재생성 0 | 그대로 | 없음 |
| 4 | `continuous-operator.ts:1845` 최종 판정 | pass · blocked · rejected · unconfirmed · pending · timeout · failed | 통과 안 없고 대안 합산이 장애면 1안 원값 · 대안 합산이 blocked · rejected 면 그것(1안 timeout + 2안 blocked = blocked) | **순서 = 통과 > 확인 중 · 검사 중 > 검사한 안 중 하나라도 timeout > 차단 > 반려 > 그 밖** · timeout 안이 하나라도 있으면 그 안이 늦은 보고로 통과할 수 있으니 보류(★ 설계 Codex 1R #2) | 없음 |
| 5 | `continuous-operator-policy.ts decideSpamOutcome` | 위 일곱 | timeout = 미통과(admin_review · hold 없음) | **timeout = hold**(unconfirmed · pending 과 같은 갈래 · 사유 문장 따로) | 「승인할 제안」 카드 사유 · 담당자 문자 |
| 6 | `continuous-operator.ts:1915` hold 갈래 | scheduled 행만 | 검토로 내림 · heldSendAt 저장 · 문자 0 | 그대로(timeout 도 이 갈래) | 카드 「검토 필요」 |
| 7 | `continuous-operator.ts:1925` 미통과 갈래 | blocked · failed · rejected | 검토 + 「통과하지 못해」 문자 | timeout 은 더 오지 않음 | 담당자 문자 |
| 8 | `recoverHeldProposals` 후보(`:2775`) | spam_test_status | pending · unconfirmed 만 | **+ timeout 이고 `spamCheck ? 'heldSendAt'` 인 행만**(배포 전 timeout 회차 = heldSendAt 없음 = 손대지 않음) | 없음 |
| 9 | 회복 판정(`:2789`) | 검사마다 outcome(`spamTestOutcomeOf`) pass · blocked · unconfirmed · pending · error | 통과 → 되돌림 · 기다림(hold) → 6시간까지 기다림 · 그 밖 → 종결 | **기다림에 「error · blocked 이고 닫힌 지 10분 안」 더함**(늦은 보고가 시간 초과 · 차단 줄을 아직 통과로 고칠 수 있다 · 구현 때 blocked 포함 · SCHEMA spam_filter_test_results 주석) · 나머지 그대로 | 없음 |
| 10 | 회복 종결 안내 | late · blocked · error | blocked · error 모두 「통과하지 못해」 | **error = 「스팸 검사 결과를 받지 못해」** · blocked 그대로 | 담당자 문자 |
| 11 | `restoreHeldProposal` | 자격 있음 · 없음 | 예약 되돌림(보류 전 시각 · 지났으면 다음 발송 창) + 안내 | 그대로 | 담당자 문자 「결과가 늦게 나와 통과」 |

이번 회차에 적용: 10:04 hold(문자 0) → 10:04 ~ 10:05 회복 패스가 1안 전부 통과 확인 → 12:00 예약 그대로 + 「늦게 나와 통과 · 12시에 보내요」.

### §1-3 고칠 곳
0. 최종 판정(`continuous-operator.ts:1845`) — 통과 · 기다림이 아니고 검사한 안 중 `spamResult === 'timeout'` 이 하나라도 있으면 `finalResult = 'timeout'`(차단 · 반려보다 앞) · 회복이 그 회차의 모든 안 검사를 다시 읽으므로 막힌 안이 섞여도 통과 안이 나오면 되돌린다 · 끝내 통과가 없으면 회복 종결 문장이 막힌 안(blocked)이 있으면 「통과하지 못해」 · 없으면 「결과를 받지 못해」.
1. `decideSpamOutcome` — `finalResult === 'timeout'` 을 hold 갈래로. 사유 = 「스팸 검사 결과가 늦어지고 있어 자동 발송을 보류했어요. 결과가 오면 다시 판단해요. 제안 상세에서 다시 검사하거나 승인할 수도 있어요」.
2. `readSpamTestOutcome` — 반환에 `closedAt`(spam_filter_tests.completed_at · 없으면 null) 한 칸 더함(호출부 읽기 전용 · 기존 칸 불변).
3. `recoverHeldProposals` — 후보 조건 + 기다림 판정(error 이고 closedAt 이 `SPAM_LATE_REPORT_MINUTES` 안) + error 종결 문장.

### §1-4 범위 밖(기록만)
- 대행 · 여정 · 재검사 등 다른 검사 길은 검사 장애 = 1분 뒤 다시 검사(`spamVerdictWithRetry`) 구조라 이 결함과 길이 다르다.
- ★ 1120 마무리 확인 = 여정 2시간 전 스캐너는 장애면 기록만(보류 · 문자 0 · `journey-pretest-notifier.ts:362-366`) · 다음 주기에 같은 키 최근 검사를 지금 결과로 다시 읽어(`spamCheckFor` · 늦은 보고 반영) 통과면 재사용 = 같은 결함 아님 · 코드 수정 0.
- 화면 「다시 검사」(`runProposalSpamRetest`) 결과의 timeout = 사람이 누른 검사 · 이번 범위 아님.

## §2 T2 대행 맞춤법(개선 + 결함 둘)

### §2-1 흐름 표

| # | 자리 | 지금 | 바뀐 뒤 | 그리는 화면 |
|---|---|---|---|---|
| 1 | AI 지시문(`sms-spell-check.ts:95` · `sns-spell-check.ts:61`) | 「짧은 구간(틀린 낱말과 앞뒤 한두 낱말) · 원문에 한 번만 나오는 구간으로 잡는다」 | before = 「틀린 낱말과 앞뒤 한두 낱말 · **그래도 원문에 두 번 이상 나오면 한 번만 나올 때까지 앞뒤 낱말을 더 넣는다(짧게보다 한 번만이 먼저)**」 · after = 「before 에서 그 틀린 곳만 고친 것(더 넣은 앞뒤 낱말은 그대로)」 · 더함 = 「같은 틀린 곳이 여러 자리에 있으면 자리마다 따로 적는다 · 문안 처음부터 끝까지 빠짐없이 본다」 · ★ 설계 Codex 3R #1(앞뒤 두 낱말까지 같은 반복 자리 = 판정 ①에서 둘 다 탈락) | 없음 |
| 2 | 판정 ①(`spell-check.ts:125`) | before 가 원문에 정확히 한 번일 때만 | **그대로**(여러 번 나오는 짧은 before 는 어느 자리인지 모른다 · SNS 시험 「가 가 가」 = 0 계약 유지) | 대행 승인 · 대행 접수 · 직접발송 점검 · SNS 맞춤법 목록 |
| 3 | 서버가 다른 자리로 넓히기 | 없음 | **없음(두지 않는다)** · ★ 설계 Codex 1R #4 · 2R #1 = 같은 부류 두 번 → 서버는 문맥을 못 본다(결재/결제 · 잘못했다/잘 못했다) → 넓히기 장치를 통째로 뺐다 · 자리마다 판정은 문맥을 보는 AI 가 1행 지시대로 자리마다 따로 낸다 | 같은 목록 |
| 4 | 대행 고치기(`agency-send-change.ts:153`) | `spell_check = NULL`(다음 검사 뒤 AI 처음부터) | 맞춤법 고치기(`change.kind === 'spell'`)만 `spell_check = {version: 새 판, issues: [], failed: false, afterFix: true}` · 글자 직접 수정은 지금처럼 NULL | 승인 화면 맞춤법 상자 0곳 |
| 5 | 워커 훅(`agency-send-spell.ts runAgencySpellAfterTest`) | 늘 AI 검사 | 저장값의 version = 이번 판이고 failed 아님이면 검사 건너뜀(이력 0) · 그 밖 그대로 | 진행 기록 「맞춤법을 확인했습니다」 줄 0 |
| 6 | 안내 건수(`readAgencySpellCount`) | 저장값 판 = 지금 판이면 건수 | 그대로(0 → 승인 문자에 맞춤법 줄 없음) | 승인 요청 문자 |

직원 사례: 접수 → 「포인트:」 · 「[혜택 안내]」 · 「혜택 안내 드립니다」 세 곳 한 번에 → 고치기 → 스팸 검사 약 4분 → 승인 문자(맞춤법 줄 없음). 옛 세 바퀴 → 한 바퀴.

### §2-2 왜 서버가 넓히지 않는가(설계 Codex 1R #4 · 2R #1 · 같은 부류 두 번 = 구조 판단)
- 같은 글자라도 맞고 틀림이 문맥으로 갈린다(「카드 결재 → 결제」 옆 「내부 결재」 · 「영어를 잘못했다 → 잘 못했다」 옆 「친구에게 잘못했다」). 글자 수 · 종류 조건은 문맥을 못 본다 → 조건을 좁혀도 반례가 남는다.
- 그래서 자리 판정은 문맥을 보는 AI 몫으로 두고, 서버 판정 ①(정확히 한 번 · 짧아 어느 자리인지 모르는 before 는 버림)은 그대로 둔다. 바뀌는 것은 지시문(자리마다 따로 · 끝까지)뿐이다.
- 한계(빠지는 것): AI 가 한 자리를 빠뜨리면 그 자리는 제안되지 않는다(결정적 보장 아님) · 2-나 때문에 다음 바퀴 검사도 없다.

### §2-3 빠지는 것
- 첫 검사에서 AI 가 놓친 곳은 두 번째 검사가 없으니 제안되지 않는다(지시문 「끝까지」까지만 · AI 두 번 돌려 합치기 = 하지 않음).

## §3 T3 발신번호 회선 제한(새 기능)

### §3-1 실측(Harold 1120 서버 출력)
- identity_verifications: kmc verified 6건(first_login 5 · change 1) · dup_key_hash 6/6 · 제약 = PK 하나(purpose CHECK 없음).
- companies: corporate 138 · 미설정 10 · mobile_line_limit 전부 NULL(법인 무선 상한 = 스위치 `SENDER_LINE_PER_ACCOUNT_ENABLED` 켜졌을 때 활성 계정 × 4 · 스위치 상태 미측정 · 이 설계는 그 계산 불변).
- sender_registrations: company approved 12 · rejected 6 · other approved 12 · rejected 5 · pending 0.

### §3-2 흐름 표

| # | 자리 | 지금 | 바뀐 뒤 | 그리는 화면 |
|---|---|---|---|---|
| 1 | 신청 화면(`CallbacksTab.tsx` 2차) | 회사명의 · 기타명의 → 서류 → 번호 | 회사명의 · 기타명의 → **[유선번호] · [무선번호]**(고르기 전 입력 칸 잠김) → 서류 · 번호 | 관리 → 발신번호 |
| 2 | 서류(같은 화면) | 회사 = 통신가입증명원 · 기타 = 동의서 + 재직증명서 또는 거래관계 + 통신가입증명원 | 기타 + 무선만 통신가입증명원 빠짐(선택지에서도) · 나머지 그대로 | 같은 화면 |
| 3 | 본인인증(기타 + 무선) | 없음 | [휴대폰 본인인증] → 기존 인증 창(`IdentityVerifyModal` 새 mode `sender`) → 완료 시 「홍*동 · 010-****-1234 · 입력한 번호와 같아요 / 달라요」 · 번호를 고치면 인증 풀림 · 신청 단추 = 인증 + 일치일 때만 | 같은 화면 |
| 4 | 인증 시작(신설 `POST /api/sender-registration/owner-verify/start` · 회사 관리자) | 없음 | 신설 CT `utils/sender-owner-verify.ts startSenderOwnerVerification` = **새 표 `sender_owner_verifications`** 에 대기 행(그 계정의 옛 대기 행 = superseded · 회사 · 계정 · 10분) → 인증기관 `buildStart({ verificationId })` · ★ 설계 Codex 1R #1 = 로그인 본인인증 표(`identity_verifications`)에는 **한 줄도 쓰지 않는다**(그 표를 읽는 로그인 관문 · 최초 인증 판정 · 담당자 요약 · 슈퍼 현황 7곳이 목적을 가리지 않는다 → 표를 나눠 뿌리를 닫는다 · 로그인 코드 무수정) | 없음 |
| 5 | 인증 완료(신설 `/owner-verify/complete`) | 없음 | `completeSenderOwnerVerification` = 인증기관 `verify(payload, { verificationId })`(KMC 구현은 DB 무접촉 · 요청번호 = verificationId 세 자리 대조) → 그 행 확정(그 계정 · 그 회사 · 대기 · 미만료 · 그 인증기관 · 한 문장) · dupKey 없으면 거절 · users · mfa 무접촉 · 응답 = verificationId · 가린 이름 · 가린 번호 · 입력 번호와 일치 여부 | 없음 |
| 6 | 신청 접수(`createRegistration`) | 회사 단위 상한(풀 조회 뒤 따로 INSERT) | 번호 종류는 서버가 번호로 정한다(`lineKindOf`) · 기타 + 무선 = `ownerVerificationId` 필수 → **한 트랜잭션**: 인증 행 FOR UPDATE(이 계정 · 이 회사 · verified · 30분 안 · dup_key_hash 있음 · 인증 번호 = 신청 번호) → `pg_advisory_xact_lock(hashtext('sender-owner:' 회사 ':' DI해시))` → 1인 셈 → INSERT(owner_verification_id) · 같은 인증 재사용 = 부분 유일 인덱스 23505 → 안내 · ★ 설계 Codex 1R #3 = 남은 1회선에 동시 신청 둘 = 정확히 하나만 | 오류 토스트 |
| 7 | 회선 판정 CT | `checkSenderLineLimit(회사, 번호)` | 회사명의 · 유선 · 직접 추가 = 그대로(인자 그대로) · 기타 + 무선 + 인증 = 신설 `checkOwnerMobileLimit(run, 회사, DI해시, 자기 id)`(트랜잭션 연결로 · 잠금 뒤) = **같은 회사 · 같은 DI · 기타명의 신청(대기 + 승인 중 번호 살아 있는 것) · 자기 제외** 수 < 3 · 회사 총량은 보지 않는다 · 기타 + 무선 + 인증 없음(배포 전 신청) = 회사 판정 그대로 | 오류 문장 |
| 8 | 회사 무선 셈(`countCompanyLines`) | callback_numbers 무선 전부 | 승인된 기타명의 신청이 만든 번호(`approved_callback_id` · number_type other)는 무선 셈에서 뺌 · 유선 셈 그대로 · 화면 정책(`getSenderLinePolicy`)도 같은 함수 | 슈퍼관리자 회사 화면 「무선 N」 |
| 9 | 승인(`approveRegistration`) | 회사 단위 재판정(풀) | 기타 + 무선 + 인증 = 같은 트랜잭션에서 같은 잠금 → `checkOwnerMobileLimit`(자기 제외) · 그 밖 = 지금 그대로 | 슈퍼관리자 승인 오류 |
| 10 | 슈퍼관리자 신청 상세(`SenderRegDetailModal`) | 서류 | 기타 + 무선 = 「명의자 본인인증: 이름 · 가린 번호 · 신청 번호와 일치 · 인증 시각」 | 슈퍼관리자 |

### §3-3 DDL(배포 뒤 · 원장 C148-DDL-1)
```sql
SET lock_timeout = '3s';
CREATE TABLE IF NOT EXISTS sender_owner_verifications (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status varchar(12) NOT NULL CHECK (status IN ('pending', 'verified', 'superseded')),
  provider varchar(20) NOT NULL,
  verified_name varchar(100),
  verified_phone varchar(20),
  dup_key_hash varchar(64),
  provider_tx_id varchar(120),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  verified_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_sender_owner_verifications_user_pending ON sender_owner_verifications (user_id) WHERE status = 'pending';
ALTER TABLE sender_registrations ADD COLUMN IF NOT EXISTS owner_verification_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS ux_sender_registrations_owner_verification ON sender_registrations (owner_verification_id) WHERE owner_verification_id IS NOT NULL;
```
- DDL 전: 새 표 · 새 칸을 읽고 쓰는 곳 = 인증 시작 · 완료 · 기타 + 무선 신청 · 승인 1인 셈 · 신청 상세 본인인증 줄뿐 → 없음(42P01 · 42703) = 503 `DB_MIGRATION_PENDING`(db_alter_safety_net) · 상세 = 본인인증 줄 없음 · 그 밖 신청 · 승인 · 목록 = 지금 그대로.
- identity_verifications = 무접촉(DDL 0 · 쓰기 0 · 읽기 0).

### §3-4 지키는 것
- 본인인증 한 건 = 신청 한 건(부분 유일 인덱스) · 인증 번호 ≠ 신청 번호 = 접수 거절(화면 표시와 별개로 서버가 다시 본다) · 인증한 계정 · 회사 ≠ 신청 계정 · 회사 = 거절.
- 로그인 본인인증(`identity_verifications` · users.phone · mfa_phone · 로그인 관문)은 이 기능에서 읽지도 쓰지도 않는다 — 인증기관 구현(`resolveIdentityProvider`)과 복귀 창 · 화면 팝업 통로만 같이 쓴다.
- 같은 회사 · 같은 DI 의 접수 · 승인 = 한 잠금으로 줄 선다(셈과 INSERT/승인 UPDATE 가 같은 트랜잭션).
- 회사명의 · 유선 · 직접 추가(슈퍼 · 고객사) 판정 = 지금 그대로(소유 인자 없음 = 회사명의).

### §3-5 범위 밖(기록만)
- 슈퍼관리자가 기타명의 번호의 phone 을 직접 고치는 길(`admin.ts:2662`)은 소유 인자 없이 회사 판정 그대로.
- 법인 무선 「사업자번호당 4」(접수 문장) vs 코드 「활성 계정 × 4」(스위치) 차이 = 지금 계산 불변 · Harold 판단 과제.

## §4 계약 시험(뿌리마다 기계 추출)

| 뿌리 | 시험 |
|---|---|
| T1 판정 | `decideSpamOutcome('timeout')` = hold · admin_review · 사유 문장 · 옛 시험(automarketing-spam-variants-1003 `toContain('결과를 받지 못함')`) 갱신 |
| T1 최종 판정 순서 | 순수 함수로 뽑아(`operatorFinalSpamResult(tested, passedIndex, totalTestCount)`) 표 시험: timeout+blocked+timeout = timeout · blocked+timeout = timeout · rejected+timeout = timeout · blocked+blocked = blocked · failed+failed = failed · unconfirmed+timeout = unconfirmed · pass 있음 = pass |
| T1 회복 | 실 PG: heldSendAt 있는 timeout 회차 + 닫힌 지 1분 timeout 줄 = 기다림(종결 0) → 줄 pass = 되돌림(scheduled · heldSendAt) / heldSendAt 없는 옛 timeout 회차 = 손대지 않음 / 닫힌 지 11분 timeout = error 종결 · 문장 「결과를 받지 못해」 |
| T2 같은 낱말 | 소스 계약: 문자 · SNS 지시문에 「자리마다 따로」 · 「끝까지」 · 「한 번만 나올 때까지 앞뒤 낱말을 더」 줄 / `judgeSpellCandidates`: 「서울점 오늘 방문 고객께 혜택안내 자세히 보내 드립니다\n부산점 … 같은 줄」 + 지점명까지 넓힌 두 후보 = 두 항목(고치는 자리 = 각 줄의 「혜택안내」) / `judgeSpellCandidates`: AI 가 자리마다 따로 낸 두 후보(「및 혜택안내 드립니다」 · 「[혜택안내]」) = 두 항목 / 서버 넓히기 없음 = 「영어를 잘못했다 → 잘 못했다」 후보 + 원문 「친구에게 잘못했다」 = 한 항목 · 「카드 결재 → 결제」 + 「내부 결재」 = 한 항목 / 「가 가 가」 = 0(옛 계약) |
| T2 고친 뒤 | `runAgencySpellAfterTest` 저장값 판 = 이번 판 → AI 호출 0 / `editAgencyContentTx` spell 갈래 = afterFix 저장 · text 갈래 = NULL(소스 계약) |
| T3 셈 | 실 PG: 기타명의 승인 무선 = 회사 무선 셈 0 / 같은 DI 3건(대기 + 승인) 뒤 넷째 = exceeded / 승인 번호 지운 신청 = 셈 0 / 자기 제외 / **남은 1회선에 다른 인증 · 다른 번호 동시 접수 둘 = 정확히 하나 성공**(Promise.all · 두 연결) |
| T3 접수 | 실 PG: 인증 없음 · 다른 번호 · 30분 지남 · 다른 계정 · 다른 회사 · 대기(미확정) · 재사용 = 거절 / 정상 = INSERT owner_verification_id |
| T3 완료 CT | 실 PG(시험 인증기관): 완료 뒤 `identity_verifications` 행 수 · users.phone · mfa_phone 불변 · 만료 · 다른 계정 · 두 번째 완료 = 거절 · dupKey 없음 = 거절 / 소스 계약: `sender-owner-verify.ts` 안 `identity_verifications` 글자 0 |

## §5 배포(원장 C148)
- C148-P0 없음(읽기 확인은 §1-1 · §3-1 로 끝).
- C148-H1 한줄로 배포(백엔드 + 프론트 · 적재 0건 때 재시작) → C148-DDL-1(§3-3) → C148-S1(직원 시트 · §6).

## §5-1 설계 Codex 기록
- 1R needs-attention 4 → 전부 수용: #1 high 로그인 본인인증 표 혼입 → 표 분리(`sender_owner_verifications`) · #2 high 섞인 결과(timeout + blocked)가 차단으로 굳음 → 최종 판정 순서 · #3 medium 동시 신청 → 회사 · DI 잠금 + 한 트랜잭션 · #4 medium 문맥 없는 교정 복제 → 한글 4글자 이상 띄어쓰기 넣기만 넓힘 · 판정 ① 그대로.
- 2R needs-attention 1(T1 · T3 추가 지적 0) → #1 medium 「잘못했다/잘 못했다」 = 1R #4 와 같은 부류 두 번째 → 개별 수정 멈춤 · 왜 반복 = 서버 넓히기는 문맥을 못 보는 구조 → 구조 수정 = 넓히기 장치 삭제(§2-2) · 자리 판정 = AI 지시문.
- 3R needs-attention 1 → #1 medium(「한두 낱말」 지시가 반복 문맥에서 유일성과 충돌 · 같은 부류 아님 = 지시문 문장 하나) → 수용: 「한 번만 나올 때까지 앞뒤를 더 · after 는 그 자리만」 + 계약 사례.
- 4R **approve**(No material findings) = 설계 닫힘 1120.

## §5-2 구현 기록(1120)
- 파일: T1 `continuous-operator-policy.ts`(operatorFinalSpamResult · decideSpamOutcome timeout = hold) · `continuous-operator.ts`(최종 판정 호출 · 회복 후보 · 기다림 · 종결 문장) · `spam-test-queue.ts`(readSpamTestOutcome lateOpen) / T2 `spell-check.ts`(SPELL_LOCATION_RULES) · `sms-spell-check.ts` · `sns-spell-check.ts` · `agency-send-spell.ts`(AGENCY_SPELL_AFTER_FIX_SQL · 같은 판 건너뜀) · `agency-send-change.ts`(spellOnly) · `routes/agency-send.ts`(spellIssueIds) · 화면 `agency-send-api.ts` · `AgencySendDetail.tsx` / T3 새 `sender-owner-verify.ts` · `sender-line-limit.ts`(countCompanyLines · checkOwnerMobileLimit · OWNER_MOBILE_LIMIT 3) · `sender-registration.ts`(createOwnerMobileRegistration · 승인 소유 갈래 · 상세 본인인증 줄 · UserFacingError 코드 OWNER_*) · `routes/sender-registration.ts`(owner-verify/start · complete · respondUserError) · 화면 `IdentityVerifyModal.tsx`(mode sender) · `CallbacksTab.tsx`(유선 · 무선 · 명의자 인증 · 서류) · `SenderRegDetailModal.tsx` / 원장 C148-H1 · DDL-1 · S1.
- 설계와 다르게 한 곳: 회복 기다림에 닫힌 지 10분 안 blocked 도 넣음(늦은 보고가 차단 줄도 고친다) · 맞춤법만 고친 판 판정 = 링크 [고치기] + 로그인 화면 [고치기](구현 1R · 서버가 넣은 제안 id 를 다시 적용해 같을 때).
- 시험: 새 계약 c148-staff-tickets 14 + 갱신(spam-verdict-4value · precheck-0925 · automarketing-spam-variants) · 실 PG held-recovery C148 4건(13건 중) · 새 실 PG c148-sender-owner 7 · 뿌리 대장 R10 · R11 맞춤(면제 0) · 실 PG 전체 101파일 925건 통과(스탬프 기록).
- 구현 Codex: 1R needs-attention 1(로그인 화면 [고치기]가 text 저장이라 afterFix 우회 → spellIssueIds 서버 재적용) · 2R 1([그만두기] 뒤 넣은 id 잔존 → 함께 비움) · **3R approve** · 배포 뒤 변이 M4 로 동시 신청 시험 보강 → 4R 2(시간 짐작 · 실패 경로 정리) → **5R approve**(운영 코드 무변경 · 시험만).
- 확인 못 한 것: 신청 화면 · 승인 화면을 브라우저로 보지 못함(로컬 백엔드 · 로그인 없음 · 프론트 화면 시험 기반 없음) → C148-S1 직원 시트 · 본인인증 실제 휴대폰 1건 = 배포 뒤.

## §5-3 닫기 칸(DEFECT-PLAYBOOK §2 · 결함 = T1 · 하나라도 비면 「미검증」)
- [x] 흐름 표 빈칸 0 · Harold 확인 = 1120 「추천대로」(§1-2 · §2-1 · §3-2)
- [x] 결함마다 처방 · 뿌리 번호(T1 = R89 넓힘 · ROOT-LEDGER 이력 1120) · 계약 시험(`c148-staff-tickets` T1 · 실 PG held-recovery C148 4) · 변이 = 1120 배포 뒤 다섯(M1 시간 초과 보류 순서 · M2 decideSpamOutcome 보류 · M3 회복 늦은 보고 창 · M4 회사 · 명의자 잠금 · M5 고친 판 건너뜀) 전부 빨간불 · 원복 해시 같음(`scratchpad c148-mutate.js`) · ★ M4 는 처음에 초록불 = 옛 동시 신청 시험(둘을 같이 띄움)이 잠금을 증명하지 못했다 → 앞 접수를 커밋 전으로 붙잡고 뒤 접수 세션이 막힌 것을 DB(`pg_blocking_pids`)로 확인하는 시험으로 바꾼 뒤 빨간불(구현 Codex 4R = 시간 짐작 · 실패 경로 정리 두 지적 반영 · 5R)
- [x] tsc 0 · 백엔드 단위 전체(834파일 · 스탬프 1건 = 실 PG 전체 재실행으로 해소) · 실 PG 전체 101파일 925건
- [x] Codex 설계 approve(4R) · Codex 구현 approve(3R)
- [x] 서버 deployed_head = e8da2da0(원장 C148-H1 확인 출력) · DDL-1 끝
- [ ] 직원 지시문 결과 = C148-S1(지시문 = 1120 대화 · 설계서 §6 줄과 같은 뜻)
- [x] BUGS B-1120-5 상태 · 기능 문서 이력(FEATURE-AUTOMARKETING §7 · FEATURE-AGENCY-SEND §5 · 전송자격인증 설계서 D-8 행)

## §7 추가 결함 넷(1120 세션 마무리 중 발견 · Harold 「저것까지 제대로 위의 셋과 더불어 완벽하게 수정 · 코덱스 닫힐 때까지」)

| # | 결함 | 사실(코드 · 실측) | 고객이 겪는 일 | 처방 |
|---|---|---|---|---|
| A | 회복이 회차를 되돌려도 안별 검사 결과는 옛 값 | `restoreHeldProposal` · `markRecovery` 가 passedIndex · fp · recovery 만 쓰고 `spamCheck.results[].result` 는 그대로 → 카드 칩(`ProposalDecisionCard.tsx:147 · 406`)이 그 값을 그린다 | 늦은 보고로 통과해 예약된 안에 「검사 결과 없음」 칩(T1 접수 「사이트에서도 검사 결과 없음」의 화면 절반) · 확인 중 · 검사 중 회복도 같다 | 회복이 다시 읽은 결과로 안별 결과를 함께 쓴다: 통과 · 차단 · 확인 중 · 검사 중 = 그 값 · 장애 = 옛 값 그대로(되돌림 · 검토 · 종결 세 갈래 · 순수 함수 `refreshHeldResults`) |
| B | 슈퍼관리자 신청 상세 서류 이름 | `SenderRegDetailModal.tsx:157-159` = 통신가입증명원이 아니면 전부 「위임장」 · 서류 종류 다섯(`DocumentInfo.type`) | 사용 동의서 · 재직증명서 · 거래관계증명이 「위임장」(기타명의 무선 = 통신가입증명원 없음 → 더 잘 보임) | 종류 다섯 이름 표 · 모르는 값 = 「서류」 |
| C | 슈퍼관리자 사용량 상세의 대행 맞춤법 | `precheck-usage.ts:381` = 이 판 저장값이 있으면 'ok' → T2 의 맞춤법 고친 판(빈 결과 · afterFix)이 「고칠 곳 없음」 | AI 가 검사하지 않은 판이 「검사했는데 고칠 곳 없음」 | 상태 'after_fix' 따로 · 화면 문장 「담당자가 맞춤법 제안을 골라 고친 판이라 다시 검사하지 않았습니다」 |
| D | 옛 첨부 이름 깨짐 | 1120 실측(Harold 서버 출력): 담당자 위임장 23/30 · 발신번호 신청 서류 27/60 · 에셋 라이브러리 31/209 · 대행 이미지 0/54 · 깨진 이름은 전부 10-19 이전(03-18 ~ 10-19) = 10-19 B-1005-4③ 이후 새 업로드는 정상 · 저장값 자체가 UTF-8 을 라틴 글자로 읽은 글자 | 슈퍼관리자 등록현황 · 신청 상세 · 에셋 목록에 「(ì¬ë…)」 · 다운로드 이름 · 에셋 이름 찾기도 깨진 글자 | 저장값을 한 번 고쳐 쓴다(DML · 화면 덧칠 아님): 글자가 전부 U+0001 ~ U+00FF 이고 U+0080 ~ U+00FF 가 있는 이름만 latin1 바이트 → UTF-8 로 다시 읽기 · 다시 읽기 실패(올바른 UTF-8 아님 = 원래 라틴 글자 이름 · 예 「café」) = 그대로 · 고치기 전 값 = 백업 표 · 두 번 돌려도 그대로 |

### §7-1 D DML(원장 C148-DML-1 · 한 트랜잭션 · 배포와 무관 · 코드 변경 0)
- 대상 = sender_managers.authorization_doc.originalName · sender_registrations.documents[].originalName · cdp_assets.filename. 대행 이미지(0건) · SNS(이름 칸 없음) = 대상 아님.
- 판정 · 변환 = 세션 함수 `pg_temp.c148_fix_name`(앱 `restoreUploadFileName` 규칙 + **다시 읽은 결과에 한글(완성형 가 ~ 힣 · 호환 자모 ㄱ ~ ㆎ · 조합용 자모 U+1100 ~ 11FF · A960 ~ A97F · D7B0 ~ D7FF = macOS 분해형(NFD) 이름 · ★ D-2R)이 있을 때만**(★ 설계 Codex D-1R #2 = 정상 라틴 이름 「Â².png」 · 두 번 깨진 이름이 한 겹씩 풀려 두 번째 실행이 또 바꾸던 것을 막는다 · 깨진 이름은 모두 한글 파일명) · 예외 = 원래 값) · 백업 = `c148_filename_fix_backup(src, row_id, old_value jsonb, fixed_at · PK (src, row_id))` · ON CONFLICT DO NOTHING = 처음 고치기 전 값만 남는다 · 되돌리기 = 원장 C148-RB-2.
- 트랜잭션 = 원장 블록 본문에 BEGIN · COMMIT 을 두지 않는다(★ 설계 Codex D-1R #1 = 시험 틀의 BEGIN · ROLLBACK 을 안쪽 COMMIT 이 확정했다) · 운영 실행 = `psql -1`(한 트랜잭션) · 실 PG 시험 = 같은 본문을 바깥 트랜잭션 안에서.
- 문서 배열은 순서(WITH ORDINALITY)를 지키고 바뀌는 요소만 바꾼다 · 이름이 NULL 인 요소 · 행은 건드리지 않는다.

### §7-2 영향 · 범위 밖
- A = 카드 칩 · 회복 결말만(발송 관문 · 지문 · 예약 무변) · B · C = 슈퍼관리자 화면 글자만 · D = 이름 글자만(파일 · 경로 · 저장 이름 storedName 무변).
- 범위 밖 = 없음(대행 이미지 깨진 이름 0건 · SNS 저장 줄에 이름 칸 없음 · 새 업로드는 10-19 부터 복원 저장).

### §7-3 계약 시험
| # | 시험 |
|---|---|
| A | 순수 `refreshHeldResults`: timeout → pass · timeout → blocked · 장애 = 옛 값 · 검사 id 없는 안 = 그대로 / 실 PG: 시간 초과 회차 되돌림 뒤 results[0].result = pass · 막힘 종결 = blocked |
| B | 소스 계약: 상세 창 서류 이름 표에 다섯 종류 · 「위임장」 단독 삼항 0 |
| C | precheck-usage: afterFix 저장값 = 'after_fix' · 화면 상태 표에 after_fix 문장(Record = tsc) |
| D | 실 PG: 깨진 이름(위임장 · 서류 배열 둘째 요소 · 에셋 · 분해형(NFD) 한글) = 한글로(분해형은 분해형 그대로) · 정상 한글 · 영문 · 「café」 · 「Â².png」(정상 라틴) · 두 번 깨진 한글 이름(한 겹 풀면 한글 아님) = 그대로 · 이름 NULL 요소 · 배열 아닌 documents = 그대로 · 배열 순서 · 다른 키 그대로 · 백업 행 = 바뀐 행 수 · 두 번째 실행 = 바뀜 0 · 백업 0 추가 / 소스 계약: 원장 블록 본문에 BEGIN · COMMIT 0 |

### §7-4 기록(1120)
- 설계 Codex: 1R needs-attention 2(#1 high 블록 안 COMMIT 이 시험 틀 확정 → 본문 BEGIN · COMMIT 삭제 · psql -1 / #2 medium 정상 라틴 이름 · 두 번 깨짐 다시 읽기 → 한글이 나올 때만 · 백업 PK) · 2R 1(분해형 한글 누락 → 조합용 자모 범위) · **3R approve**(A · B · C 는 1R 부터 지적 0). 첫 시도는 Codex 모델 붐빔(at capacity)으로 다시 띄움.
- 구현: A `refreshHeldResults`(policy) · 회복 세 갈래 `heldResultsPatch($n)` / B `SENDER_DOC_LABEL` / C `after_fix` / D 원장 C148-DML-1 · ★ 편집 도구가 원장 SQL 의 `\u` 표기를 글자(ÿ · 가 ~ 힣)로 바꿔 저장했다(뜻은 같음 · 제어 문자 0 확인) → 스크립트로 `\u` 표기로 통일(붙여 넣는 원장 = 표기가 보여야 한다).
- 시험: c148-staff-tickets §7 넷 · 실 PG held-recovery(안별 결과 기대) · 새 실 PG c148-filename-fix · 변이 8 전부 빨간불(MA2 는 처음 초록 = 종결 사례 저장값이 이미 blocked 라 바뀔 것이 없었다 → 저장값 timeout 으로 바꾼 뒤 빨간불).
- 구현 Codex: 1R needs-attention 1(B 서류 종류 값 `__proto__` = 상속 속성이 객체로 꺼내져 상세 화면 멈춤 → 표가 직접 가진 키만 · 그 밖 「서류」 · 시험 = 화면 표를 뽑아 같은 식 · 변이 빨간불) · **2R approve** · 그 뒤 push 전 pg-test-stamp 가 새 실 PG 시험을 「기대는 CT import 0 = 판정 불가」로 막음 → 시험이 실제로 기대는 앱 복원 restoreUploadFileName 을 import 해 깨진 한글 넷 · café 에서 DML 과 같은 결과를 단언(라틴 전용 이름은 설계상 갈림 = 단언 안 함) · **3R approve**(시험 줄만).
- 배포 = 원장 C148-H2(A · B · C) · C148-DML-1(D · 코드 무관 · psql -1).

## §6 직원 회신(배포 뒤 · 말투 = 부드러운 반말 · 쉼표만 · 이름 0)
- T1: 검사폰 보고가 늦게 와도 보류만 해 두고, 결과가 오면 원래 시각에 다시 예약되게 고쳤어, 이제 늦게 와서 통과한 안이 있으면 "결과가 늦게 나와 통과" 문자가 오고 원래 시각에 나가, 10분이 지나도 결과가 안 오면 그때 "검사 결과를 받지 못해" 문자로 검토를 요청해
- T2: 맞춤법 검사가 문안 끝까지 보고 같은 실수가 여러 곳이면 자리마다 따로 제안하게 했고, 맞춤법 고치기로 고친 문안은 맞춤법을 다시 제안하지 않고 스팸 검사 뒤 바로 승인 요청이 가게 했어, 접수하고 고칠 곳 고르고 한 번만 고치면 승인 문자까지 한 바퀴로 끝나
- T3: 발신번호 신청에서 회사명의나 기타명의를 고르면 유선번호, 무선번호를 한 번 더 고르게 했어, 기타명의 무선은 통신가입증명원 없이 휴대폰 본인인증으로 받고 입력한 번호와 인증한 번호가 같아야 신청돼, 기타명의 무선은 회사 총량에서 빠지고 명의자 한 사람당 3개까지, 회사명의 무선은 지금처럼 회사 기준으로 세
