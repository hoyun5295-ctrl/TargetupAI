# 요금제 일할 크레딧 · 무료체험 만료일 필수 · 구독 상태 기본값 · 대행 스위치 문 (2026-10-26)

> 호출어 **요금제 일할 크레딧 / 체험 끝 보장 / 대행 스위치 문 / 제시뉴욕 보정**
> 이 문서가 소유 = 이번 묶음의 결정 · 바뀐 동작 · 배포 순서 · DDL · 데이터 보정. 뿌리 = [ROOT-LEDGER](ROOT-LEDGER.md) R1 · R6 · R15 · R20. 교훈 = LESSONS_DB 맨 위.

## 1. 접수 (Harold 1026)
- 「무료체험을 하다가 끝나면 정확하게 미가입으로 가는지」
- 「10/26 에 스타터를 신청하면 11월에 10월 정산할 때 10/26~10/31 을 일할 계산」
- 「업그레이드 신청 · 신청 완료(슈퍼관리자 승인) 때 남은 기간 크레딧이 들어가야」 · 기존 요금제 사용자의 업그레이드도 같은 규칙
- 「직원이 슈퍼관리자에서 요금제를 바꿨는데 크레딧이 안 들어온다」 → 제시뉴욕 보정
- 「만료되었는데도 안 내려간 것도 바로잡아야지」 · 「대행 업체는 요금제를 안 쓰는데 스팸필터 테스트를 하게 하려고 무료체험을 반복해서 줬다」

## 2. 실측 (Harold 운영 SQL 1026)
| 사실 | 값 |
|---|---|
| 정산 일할 | 이미 됨 — 청구서 요금제 줄 = `company_plan_changes` 구간 일할(변경일 당일 = 새 요금제 · 분모 = 그 달 일수). 제시뉴욕 10월 = 150,000 × 6/31 = **29,032원** 자동 |
| 남은 기간 크레딧 | **안 됨** — 산식(07-26)은 있었지만 꺼져 있었다. 승인해도 다음 달 1일 리셋 전까지 0, 또는 리셋 전이면 한 달치 통째 |
| 체험 만료 → 미가입 | 워커(매일 04:00)는 맞다. 그런데 **만료일 없는 TRIAL 2곳**(berluti 5/11 · woorimfmg 5/7 가입일부터) — 워커가 못 본다 |
| 상태 기본값 | `companies.subscription_status` DB 기본값 = `'trial'` → 체험 이력 0 인 미가입 **32곳**이 「체험 중」 |
| 대행 업체 체험 반복 | 대행 스위치 켠 4곳(idlook · kumkang · paulaschoice · shiseido) 체험 2회씩 · 스팸 검사 23~178건 |
| 제시뉴욕 | 후불 · 10/26 FREE → STARTER(슈퍼관리자 직접 변경 · 이력 있음) · 관리자 지급 50(미지급 대신) · 「후불 충전 100(월말 55,000원)」 = **가입기념 무상**인데 충전 경로로 들어가 10월 정산에 청구될 상태 |

## 3. 결정 (Harold 동의 1026)
- **ㄱ 크레딧 일할** = 요금제 변경 CT `recordPlanChange` 한 곳에서 `(새 월 크레딧 − 직전 월 크레딧) × 남은 일수 ÷ 그 달 일수`(반올림 한 번). 올림 = 지급 · 내림 = 회수(07-26 규칙 · 음수 허용). 직전이 체험이면 **체험 남은 크레딧은 없애고** 새 요금제 일할로. 이번 달 리셋 전이면 직전 요금제로 리셋부터. 시작일 = max(변경일, 이번 달 1일) — 잠금을 기다리다 달을 넘긴 처리(10/31 요청 → 11/1)는 이번 달 전체 몫(Codex 1R) · 다음 달 이후 변경일은 건너뜀. 원장 = `ai_credit_transactions` type `plan_prorate`(부호 = 방향) · 키 = 이력 행 id. 체험 부여 · 만료는 건너뜀.
  옛 「그 달 권리 − 이미 부여한 양」 산식과 선불 다시 열기 「한 달치 보충」은 지웠다(체험 경로가 원장 없이 기본 칸을 덮어써 합계가 틀림 · 보충은 일할과 겹침).
- **ㄴ 체험 끝 보장** = 무료체험(TRIAL) 배정은 체험 CT(`grantFreeTrial`) 한 길 — 슈퍼관리자 직접 변경 · TRIAL 요금제 신청 승인 · 회사 생성이 같은 트랜잭션에서 CT 를 부른다. `recordPlanChange` 가 체험 CT 가 아니거나 만료일 없는 TRIAL 을 던진다. 화면 호출 0 인 옛 주소 3개 삭제(grant-trial · revoke-trial · PUT /api/companies/:id). 회사 수정에서 구독 상태를 손으로 trial 로 바꾸면 400(`TRIAL_VIA_BUTTON`).
- **ㄷ 상태 기본값** = 회사 생성 INSERT 가 구독 상태를 직접 쓴다(유료 = paid · 미가입 · 요금제 없음 = 빈 값). 빈 상태를 'trial' 로 메우던 4곳(로그인 응답 · 대시보드 · 회사 목록 · 체험 부여 응답) 정리. 슈퍼관리자 select 에 「미설정」.
- **ㄹ 대행 스위치 문** = 대행발송 스위치가 켜진 회사는 요금제와 관계없이 대행발송(`canUseAgencySend` = 스위치 · 정지 · 만료만 막음)과 스팸 검사(`SPAM_FILTER_OPEN_SQL` = 요금제 칸 OR 스위치)가 열린다. 청구는 그대로(무료 3회 `source='trial'` 만 청구 제외 · 열린 회사 검사 = 지금 체험 요금제 회사처럼 일반 검사).
- berluti · woorimfmg = **7일 뒤 만료**(그 사이 직원 안내) · 만료 다음 날 04:00 워커가 미가입으로.

## 4. 배포 순서 (업무시간 밖 · 한 번에)
1. 로컬 = push → 서버 = pull · `packages/backend` build:safe · `packages/frontend` build:safe · `pm2 reload targetup-backend`
2. 데이터 보정(§5 A~C) — 배포 뒤
3. DDL(§6) — 보정 뒤(상태 trial · 만료일 없음 = 0 확인 → 제약)

## 5. 데이터 보정 SQL (서버 .62 · `docker exec -i targetup-postgres psql -U targetup targetup`)
**A. 제시뉴욕** — 가입기념 100 = 무상 전환(청구 제외 · 원장 type grant) + 스타터 10/26~31 남은 기간 58 − 대신 지급 50 = **+8**. 하나라도 어긋나면 전부 되돌아간다(DO 블록).
```sql
DO $$
DECLARE n int; cid uuid; b int; p int;
BEGIN
  SELECT id INTO cid FROM companies WHERE company_code = 'jessinewyork' FOR UPDATE;
  UPDATE ai_credit_requests SET billed = true, admin_note = '가입기념 무상 100크레딧(청구 제외 · 1026 Harold)'
   WHERE id = '2b40b255-b2ac-45b7-8f0c-981926fde390'::uuid AND company_id = cid AND status = 'approved' AND billed = false;
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'request %', n; END IF;
  UPDATE ai_credit_transactions SET type = 'grant', source = 'admin-grant', reason = '가입기념 무상 100크레딧(후불 충전 경로로 들어간 것을 무상으로 전환 · 1026)'
   WHERE id = 'c8f97b0a-fa33-4789-90c2-91d7ac59a189'::uuid AND company_id = cid AND type = 'postpaid_grant';
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'grant tx %', n; END IF;
  UPDATE companies SET ai_credits_base_remaining = ai_credits_base_remaining + 8 WHERE id = cid
  RETURNING ai_credits_base_remaining, ai_credits_purchased INTO b, p;
  INSERT INTO ai_credit_transactions (company_id, type, amount, bucket, source, idempotency_key, balance_base_after, balance_purchased_after, reason)
  VALUES (cid, 'plan_prorate', 8, 'base', 'plan-prorate', 'plan-prorate-manual:' || cid || ':2026-10-26', b, p,
          '스타터 10/26~31 남은 기간 58 − 대신 지급 50 = 8(1026 수동 보정)');
END $$;
```
- `billed = true`(청구서 id 없음) = 정산 발행이 집계하는 조건(`status='approved' AND billed=false`)에서 빠진다. 청구서 삭제 되돌림은 `billed_invoice_id` 로만 풀어서 이 행은 다시 안 잡힌다.

**B. 미가입 32곳 상태 정리** — 체험 이력 0 · FREE · 상태 trial → 빈 값
```sql
UPDATE companies c SET subscription_status = NULL, updated_at = NOW()
 WHERE c.subscription_status = 'trial'
   AND c.plan_id IN (SELECT id FROM plans WHERE plan_code = 'FREE')
   AND NOT EXISTS (SELECT 1 FROM company_plan_changes x WHERE x.company_id = c.id AND x.change_type = 'trial_start');
```

**C. 만료일 없는 체험 2곳 = 7일 뒤 만료**
```sql
UPDATE companies SET trial_expires_at = NOW() + INTERVAL '7 days', updated_at = NOW()
 WHERE company_code IN ('berluti', 'woorimfmg') AND trial_expires_at IS NULL
   AND plan_id IN (SELECT id FROM plans WHERE plan_code = 'TRIAL');
```

## 6. DDL (보정 뒤 · `lock_timeout` = 정지 예산)
```sql
SET lock_timeout = '3s';
ALTER TABLE companies ALTER COLUMN subscription_status DROP DEFAULT;
SELECT count(*) AS trial_without_expiry FROM companies WHERE subscription_status = 'trial' AND trial_expires_at IS NULL;  -- 0 이어야 아래 실행
ALTER TABLE companies ADD CONSTRAINT companies_trial_needs_expiry CHECK (subscription_status IS DISTINCT FROM 'trial' OR trial_expires_at IS NOT NULL);
```
되돌리기: `ALTER TABLE companies DROP CONSTRAINT companies_trial_needs_expiry; ALTER TABLE companies ALTER COLUMN subscription_status SET DEFAULT 'trial';`

## 7. 실측 1건 시나리오 (배포 뒤)
- 다음 요금제 승인(또는 직접 변경) 1건 → `SELECT type, amount, reason FROM ai_credit_transactions WHERE company_id = … AND type = 'plan_prorate' ORDER BY created_at DESC LIMIT 1` = 남은 일수 몫(식 §3).
- 대행 스위치 켠 미가입 회사(체험 끝난 paulaschoice 등) = 대행발송 화면 진입 · 스팸 검사 시작 정상.

## 8. 범위 밖 (기록만)
- 미가입인데 상태 `paid` 55곳 · 만료일 남은 미가입 52곳(`paid` 16 · `trial_expired` 36) — 판정이 전부 요금제 코드 기준이라 기능 영향 없음(코드 기준).
