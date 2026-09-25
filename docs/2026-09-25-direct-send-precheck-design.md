# 직접발송 보내기 전 점검 개편 설계서 (2026-09-25)

> **발동** = Harold 0925 「AI 다듬기를 맞춤법 검사로 대체 · 무료요금제는 월 5회 · 스팸필터테스트가 임팩트가 없다」 → 목업 1~3(B안) 승인 ·
> 「무료스팸테스트 3회 · 15만원 요금제 전환 유도 모달」 · 「스팸검사 안 하고 발송하면 경고 모달 + 24시간 다시 보지 않기」 · 「스팸필터테스트 검사 창도 올드해」 →
> 「전체 개편 승인 · 끝까지 · Codex 닫힐 때까지」.
> 함께 도는 설계 = [대행발송 맞춤법](2026-09-25-agency-spell-check-design.md)(공용 검사기 §3-1 · 대행 층). 문서와 코드가 다르면 현재 코드가 진실이다.

---

## 0. 한 줄

**직접발송 창을 "본문 → 보내기 전 점검(스팸·맞춤법) → 발송 바(예약·분할·광고 · 발신번호 · 전송)"로 다시 짜고, 스팸 검사를 안 하고 보내면 경고 창이 이유(통신사 스팸함 · 비용은 청구)를 설명한다. 미가입 회사는 스팸 검사 3회(평생 · 차감 0) · 맞춤법 월 5회를 무료로 쓰고, 다 쓰면 스타터 안내 창이 뜬다.**

## 1. 불변

1. **⛔ 검사 결과로 글을 바꾸지 않는다.** 바뀌는 것은 사용자가 [고치기]를 누를 때뿐이다(대행 설계 불변 1과 같다).
2. **⛔ 경고는 막지 않는다.** [그냥 보내기]는 언제나 누를 수 있다. 막힘·미완료·안 함을 알릴 뿐이다.
3. **⛔ "검사했는가"는 화면 기억이 아니라 검사 원장이다** — `spam_filter_tests`에서 같은 회사 · 같은 발신번호(숫자만) · 같은 종류(단문/장문) · 같은 문안(공백 무시 = 해시 정규화와 같음) · 24시간 안(`POST /api/spam-filter/recent-check`). 새로고침·다른 화면 검사도 인정한다.
4. **⛔ 체험 검사는 어느 청구·비용 집계에도 들어가지 않는다.** 선불 = 라우트가 차감을 건너뛴다 · 후불 = 정산 집계가 `spamBillableTestSql()`로 뺀다. 조건은 CT 한 벌(`utils/spam-trial.ts`)이다.
5. **⛔ 무료 횟수는 서버가 센다.** 스팸 = `spam_filter_tests.source='trial'` 행 수(회사 advisory 잠금 안에서 세고 넣음) · 맞춤법 = `spell_check_uses` 행 수(같은 방식). 화면은 서버가 준 남은 횟수를 보여 줄 뿐이다.
6. **⛔ 가격·크레딧·무료 문자 수량은 요금제 표(`GET /api/plans`)에서 읽는다.** 안내 창에 숫자를 적어 두지 않는다.
7. **⛔ 창 = 전체 화면**(★0925 Harold 재지시 "기본이 너무 작다 · 모달 자체를 전체화면으로" — 글 길이 따라 늘던 방식을 거둠) · 본문 칸은 창 높이를 채우고 넘치면 칸 안 스크롤 + "미리보기로 한 번에 보기"(넘침은 실제 높이로 잰다). 왼쪽 열 폭 560 유지 · 모바일은 자유 높이 + 본문 칸 상한 420.

## 2. 화면 (목업 3 · B안)

| 자리 | 무엇 | 코드 |
|---|---|---|
| 본문 칸 | (광고) · 본문(textarea 자동 높이) · 수신거부 줄(고정 · 자물쇠)이 한 흐름 · 칸 안 도구 줄(특수문자·보관함·문자저장·변수 · byte · 미리보기) | `DirectSendPanel.tsx` · `styles/direct-send.css` "보내기 전 점검 개편" 절 |
| 보내기 전 점검 | 스팸 검사 칸(아직 = 노란 면) · 맞춤법 검사 칸(NEW · 아직 = 초록 테두리) · 58px | `direct-send/DirectCheckTiles.tsx` |
| 발송 바 | 왼쪽 열(512px)에 맞춘 예약·분할·광고 3칸(58px) · 오른쪽 발신번호(옛 본문 아래 줄에서 원본 그대로 옮김 · 위로 열림) · 전송 | `DirectSendPanel.tsx` footer |
| 분할 풍선 | 100/500/1,000/3,000 · 직접 입력(1~9999) · "N번에 나눠 · 몇 시쯤 다 나가요"(안내 추정 · 실제 시각은 서버 `calcSplitSendTime`) | `direct-send/SplitSendPopover.tsx` |
| 맞춤법 결과 창 | 줄마다 그대로 두기·고치기 · 모두 고치기 · "문장까지 AI로 다듬기 · 1크레딧"(옛 AI 다듬기 자리) · 단문 90byte 초과 고치기 잠금(화면 바이트 계산과 같은 함수) | `direct-send/DirectSpellModal.tsx` |
| 발송 전 경고 | 안 함(24시간 다시 보지 않기) · 막힘 · 진행 중 · 결과 없음 · 맞춤법 남음 | `direct-send/SendSpamWarnModal.tsx` |
| 요금제 안내 | 써 본 효과(검사 원장) → 스타터 카드 1장 → [스타터 요금제 알아보기] · [다음에 할게요] · "이번 문자는 검사 없이 그대로 보낼 수 있어요" | `direct-send/TrialUpsellModal.tsx` |
| 스팸 검사 창 | 상태 카드(60초 원형 타이머) · 통신사별 한 줄(도착 시간) · 지난 검사(통신사 색 점) · 체험/청구 한 줄 · 판정·API·폴링은 원본 그대로 | `SpamFilterTestModal.tsx`(여는 곳 4곳 · 넘기는 값 불변 · `onEdit` 선택 추가) |
| 미리보기 | 폰 높이 420 고정 → 최소 420 · 최대 화면 | `DirectPreviewModal.tsx` |

경고 창 안내(Harold 0925 원문 요지): 정상 문자도 SKT T스팸필터링 · KT 스팸차단 · LG U+ 스팸차단에 걸리면 고객 휴대폰 스팸 메시지함으로 들어가 고객은 못 보지만, 통신사에는 전달로 처리되어 발송 비용은 그대로 청구된다. 근거 = 서버 판정("통신사 전달 성공 + 테스트폰 미수신 = 막힘", `routes/spam-filter.ts`).

## 3. 서버

| 입구 | 무엇 |
|---|---|
| `GET /api/send-checks/status` | `{ paid, spamTrial{eligible,limit,used,remaining,blockedFound}, spell{unlimited,limit,used,remaining,issuesFound,ready} }` |
| `POST /api/send-checks/spell` | 문자 맞춤법(source `direct-send-spell` · 크레딧 0) · 미가입 월 5회(`SPELL_FREE_EXHAUSTED` 403) · 사용자당 1분 6회(429) · AI 실패는 횟수에서 뺀다 · 단문 바이트 잠금은 화면(명단 최장 값·(광고)·수신거부 줄까지 화면만 정확히 안다) |
| `POST /api/spam-filter/recent-check` | 불변 3 조회(조회만) · `{checked, verdict(running/pass/blocked/warn), blockedCarriers, missingCarriers, trial}` · 실패 = `{checked:false, unknown:true}` |
| `POST /api/spam-filter/test` | 요금제에 스팸 검사가 없는 회사 = 체험: 잠금 → 센다 → 3 미만이면 `source='trial'`로 넣는다(한 트랜잭션) · 차감 건너뜀 · 한 통도 못 나가고 실패하면 행을 지워 체험을 되돌린다 · 3회 다 쓰면 `SPAM_TRIAL_EXHAUSTED` 403 |
| `GET /api/spam-filter/tests` | `source` · 통신사별 `results` 동봉(지난 검사 색 점) |

**맞춤법 AI 호출** = 채널 중립 엔진 `utils/spell-check.ts` → 문자 층 `utils/sms-spell-check.ts`(보호 구간 · 링크 앞뒤 한 칸 · 단문 바이트). **월 AI 호출 한도 면제(★Harold B안)** = CT-55 `ai-rate-limit.ts`의 `AI_CALL_LIMIT_EXEMPT_SOURCES`(직접발송·대행 맞춤법 source 둘 · 이름 소유도 CT-55) 한 벌. 관문(`callAIWithFallback`)은 `isAiCallLimitExempt(source)`로 한도 검사를 건너뛰고(FREE 한도 0회라 필요), 한도와 비교되는 숫자 전부(`getMonthlyUsage` used · `getDailyUsage` count · 사용량 화면 전월 호출)는 `aiLimitCountedSql()`로 뺀다. 기록·캐시·크레딧 판정은 그대로 · 출처별 분포와 일별 비용에는 보인다. SNS 층은 목록 밖이라 동작 불변. 이유 = 유료 한도(TRIAL·STARTER·BASIC 1,000회)를 맞춤법이 깎으면 크레딧 매출을 내는 AI 기능이 먼저 막힌다(0925 운영 확인).

## 4. 원장 · DDL (배포 뒤 · Harold)

| 무엇 | 상태 | 코드 폴백 |
|---|---|---|
| `spam_filter_tests.source = 'trial'` | 기존 칸(새 칸 0) · CHECK 제약 유무 확인 필요 | 제약이 있으면 체험 INSERT가 실패한다(차감 전 · 발송 전) → 확인 SQL 먼저 |
| `spell_check_uses`(새 표) | CREATE 대기 | 표가 없으면 요금제 회사 = 기록 없이 검사 · 미가입 = 503 `DB_MIGRATION_PENDING`(셀 수 없으면 막는다) |
| `agency_send_requests.spell_check jsonb` | ADD 대기(대행 설계 §6) | 컬럼 없으면 저장·표시를 건너뛴다 |

```sql
-- 확인(배포 전): 새 표 부재 · source 제약 · AI 호출 한도
SELECT to_regclass('public.spell_check_uses');
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'spam_filter_tests'::regclass;
SELECT plan_code, ai_calls_per_month FROM plans WHERE is_active = true ORDER BY monthly_price;

-- DDL(배포 뒤)
SET lock_timeout = '3s';
CREATE TABLE IF NOT EXISTS spell_check_uses (
  id bigserial PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id uuid NULL,
  source varchar(40) NOT NULL,
  period_month char(7) NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','done','failed')),
  issue_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_spell_check_uses_company_month ON spell_check_uses (company_id, source, period_month);
ALTER TABLE agency_send_requests ADD COLUMN IF NOT EXISTS spell_check jsonb;
```

## 5. 영향표

| 대상 | 읽기·쓰기 | 처리 |
|---|---|---|
| `spam_filter_tests.source` | 쓰기 = 수동 검사 라우트(체험만 'trial') / 읽기 = 체험 셈 · 정산 2곳 · 비용 표시 3곳(`manage-stats`·`admin` 합계 · `campaigns` 테스트 결과 목록) | 정산·비용 = `spamBillableTestSql` / 목록 = 비용 0 · 표시 유지 / 큐 워커(`test.source === 'auto_ai'`) 무영향 |
| 선불 차감 `prepaidDeduct` | 체험은 부르지 않는다 | 유료 경로 무변경 |
| 스팸 판정 기대 집합(★Codex 4R·5R) | 읽기 = `recent-check`만: 결과 행 + 지금 쓰는 테스트폰(`spam_filter_devices.is_active`) → `withExpectedSpamDevices` / 쓰기 = 없음 | 결과 행 = 실제로 보낸 건(청구 단위)이라 발송 루프·정산은 무변경(4R에 넣었던 발송 전 일괄 생성은 5R에서 원복: 못 보낸 행이 만료 정리로 timeout → 청구됐다). 중간에 끊긴 검사 = running → warn + 결과 없는 통신사 |
| `services/ai.ts callAIWithFallback` · CT-55 `ai-rate-limit.ts`(★B안) | 관문 = 면제 목록 판정 · 셈 = `aiLimitCountedSql` | 목록 밖 source 는 기존 동작 그대로. 한도와 비교되는 소비처 전수 = 한도 판정 · 이번 달 호출 · 한도 사용률 · 일평균·한도 도달 예측 · 30일 예측 · 자연어 분석 · 전월 호출(같은 조각). 출처별 분포 무변경. 한도 알림 설정은 저장만(읽는 워커 없음) |
| 직접발송 창 | 옛 보조 버튼 3개 · 옵션 카드 · 본문 아래 발신번호 줄 · 전송 버튼 자리 | 발송 바로 이동(원본 코드 그대로) · 전송 흐름은 `stageAndConfirm`(옛 본문 그대로)으로 이어진다 |
| 스팸 검사 창 | 여는 곳 4곳(대시보드·자동발송·모바일 DM·여정) | props 불변 · 화면만 교체 |
| 미리보기 창 | 직접발송·타겟 발송 공용 | 폰 높이만 |
| 맞춤법 예약 수명(★Codex 4R·5R) | `spell-check-quota.ts` 예약(세기)·완료(done) | `SPELL_LEASE_ALIVE_SQL` 한 벌(70분 · `clock_timestamp()`) · 두 자리 모두 회사 잠금 안. 수명 지난 예약은 세지 않고 done 도 되지 않는다(failed). 무료 회사는 done 기록된 검사만 결과를 받는다 |
| 도움말 카탈로그 | `send-direct`·`check-spam`·`schedule-send`·`write-copy-ai` | 새 버튼 이름으로 정정 |

## 6. 계약 테스트

`backend/src/utils/__tests__/precheck-0925.test.ts` — 문자 보호 구간 · 단문 90바이트(서버·화면) · 대행 버전 묶음·안내 줄 · 워커 A 순서 · 자동 교정 0 · 체험 차감 건너뜀·잠금 · 청구 4곳 조건 · 스팸 판정 = 서버(기대 테스트폰 = 통신사+번호로 채움 · 일부 결과로 통과 금지) · 고치기 거울(본체 글자 동일) · 맞춤법 한도(1분 창 · 월 5회 · 예약 수명 한 벌 · 무료는 done 기록분만 결과 · 표 없음 폴백) · AI 면제 범위 · 화면 계약(모델명·native dialog 0).

## 7. 미검증

- ~~`spam_filter_tests.source` CHECK 제약 유무 · 요금제별 `ai_calls_per_month`~~ → 0925 운영 확인: CHECK 없음(FK·PK만) · FREE 0 / TRIAL·STARTER·BASIC 1,000 / PRO 5,000 / BUSINESS 20,000 / STAFF·ENTERPRISE 무제한 → 맞춤법이 한도를 깎는 것 확인 → B안(위 §3).
- 실제 문자 문안에서 AI 교정 품질(오탐률).
- 스팸 체험 발송 실패 되돌리기 = 한 통도 못 나간 경우만(부분 발송은 체험 1회로 센다).
- **남긴 것(Codex 7R medium · 불수용)**: 결과 행 저장이 DB 오류로 중간에 끊긴 검사 뒤 24시간 안에 관리자가 **바로 그 테스트폰을 비활성화**하면 기대 목록에서 빠져 통과가 된다. 불수용 근거 = 판정 기준이 "지금 가진 테스트폰 전부가 받았는가"라 새로 검사해도 같은 범위·같은 통과가 나온다(재검사와 어긋나지 않는다). 온전히 닫으려면 검사 시점 기대 목록을 따로 저장하는 칸이 필요하다(DDL · 결과 행에 실으면 5R처럼 청구가 틀어진다). 같은 축 3번째(4R·6R·7R)라 여기서 멈춘다.

## 8. 이력

| 날짜 | 무엇 |
|---|---|
| 0925 | 목업 1~3 · 요금제 안내 창 · 스팸 검사 창 목업 승인 · 구현(DDL 대기 2 · 확인 SQL 1) |
| 0925 | Codex adversarial 1R·2R·3R — 경과·수용 판단은 [대행 맞춤법 설계서 §8](2026-09-25-agency-spell-check-design.md) (지적 전부 대행 훅·문자 층·최근 검사 조회) |
| 0925 | Codex 4R(누적 전체 · medium 3 · high 0): 스팸 결과 행 발송 전 일괄 생성 · 맞춤법 고아 예약 70분 뒤 제외 · 사용량 조회 실패가 검사 결과를 버리지 않음 — 셋 다 이번 신규 코드라 기록만 하지 않고 닫음 |
| 0925 | Codex 5R(high 1 · medium 1 = 4R 수정이 만든 같은 부류): 뿌리 = 결과 행에 "기대 집합"과 "청구 단위"를 겹쳐 실은 것 → 쓰기 원복 · 판정 자리에서 기대 테스트폰 채움. 맞춤법 = 세는 자리와 완료 자리의 수명 판정을 한 벌·같은 잠금으로. 화면의 안 불리던 스팸 판정 거울 제거 |
| 0925 | Codex 6R(high 0 · 5R 두 뿌리 닫힘 판정 · medium 1 = 통신사 옮긴 번호 → 대조 키 통신사+번호) · 7R(high 0 · 맞춤법 추가 결함 없음 · medium 1 불수용 = §7 남긴 것). **critical·high 0 연속 2라운드로 종료** |
| 0925 | 확인 SQL 결과(CHECK 없음 · AI 호출 한도 요금제별) → Harold B안 승인: 맞춤법 호출을 월 AI 호출 한도 검사·셈에서 뺀다(CT-55 면제 목록 한 벌 · 인자 제거). DDL 2 실행 완료(Harold · 배포 전 · 기존 코드 무영향) |
| 0925 | Harold "기본이 너무 작다" → 창 = 전체 화면(100vw × 100vh · 모서리 0 · 둘레 여백 0) · 본문 칸 상한 데스크톱 없음 / 모바일 420 유지 |
| 0925 | Harold: 스팸 검사 사용자 문구에서 "테스트폰"·기기 대수 표현 제거(검사 방식을 드러내지 않는다 · 통신사별 줄 = "SKT 스팸 검사" · 계약 테스트로 재유입 차단) · 발송 전 경고 창 A안(그림 세 칸: 스팸 차단에 걸림 → 고객 스팸함으로 → 비용은 청구 · 긴 문단 제거 · 단어 단위 줄바꿈 · 막힘 경고도 같은 칸) |
