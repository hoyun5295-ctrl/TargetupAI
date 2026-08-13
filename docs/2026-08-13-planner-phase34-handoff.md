# 마케팅 플래너 Phase 3·4 인계 — 다음 세션 착수 원장 (2026-08-13)

> **호출어 = "마케팅 플래너 3,4"** (또는 "마케팅 플래너" → 기능 문서 §8 → 이 문서).
> Harold 지시 = **"3,4 한번에 끝까지"**. 이 문서는 그 착수 직전까지의 실측·판단·순서·함정을 전부 담는다.
> 구조·불변 원칙 = [FEATURE-MARKETING-PLANNER.md](FEATURE-MARKETING-PLANNER.md) §2~§6 · 근거 = [설계서](2026-08-12-ax-marketing-planner-design.md) §5-4~§5-6·§8.
> **이번 세션(0813) 코드 변경 = 0** — 실측·판단까지만 왔다. 다음 세션은 §4 순서 ①부터 코드를 쓴다.

---

## §1 확정 실측 (2026-08-13 운영 information_schema — 재검증 불요)

### 1-1. `operator_proposals.operator_id` = **NOT NULL** ← 진입 경로를 가른 사실
플래너發 발송을 `operator_proposals`에 실으려면 오퍼레이터 행이 필요하다. 행사마다 가짜 `continuous_operators`를 만들면
매일 도는 제안 생성 워커가 그 행을 집고, 자동마케팅 화면·통계·만료 워커에 플래너 행이 섞인다 — **기각**.

**확정 판단: 플래너 전용 실행 워커 + 공용 CT 직접 재사용.** `dispatchProposalSend`(proposal 전제)는 못 쓰지만,
그 안에 쌓인 안전장치는 전부 독립 CT라 같은 것을 부르면 된다(§3 재사용 표). 인라인 재구현 금지.

### 1-2. `cdp_events` 15컬럼
`id·company_id·identity_link_id·customer_id·event_name(varchar50 NOT NULL)·properties(jsonb NOT NULL)·source(varchar30 NOT NULL)·occurred_at·created_at` + `anonymous_id·session_id·trust_level·schema_version·sent_at·received_at`(전부 NULL 허용).
참여 이벤트(Phase 4)는 신규 테이블 없이 여기 적재한다. ⚠ **event_name 신설 전 소비처 영향표 의무**(§6-1).

### 1-3. `saved_segments` 17컬럼 — **`filter_jsonb` jsonb가 실존** (SCHEMA.md 등재본에 없던 컬럼 — SCHEMA 갱신 필요)
`segment_type`은 `'hanjullo'|'custom'`. 참여자 세그먼트를 만들 때 `filter_jsonb`를 어느 소비처가 어떻게 읽는지
grep이 선행이다(§6-2). **진실 복사 금지 원칙상, 참여자 명단을 세그먼트에 스냅샷으로 굳히지 말고
cdp_events를 읽는 동적 정의가 1순위 검토안이다.**

### 1-4. `kakao_templates` 62컬럼
`profile_id NOT NULL`(FK kakao_sender_profiles) · `template_code` NULL 허용(등록 직후 null이 정상 — 식별은 `template_key` 축, D146) ·
`alarm_notified_status` · `service_mode` · `inspection_comment/evidence_*` 실존. 플래너 알림톡 검수 대행은 이 표에 행을 만들어
기존 30분 동기화 워커·5분 알림 job 사슬을 그대로 탄다.

### 1-5. `ai_credit_transactions` — CHECK 제약 없음(0726 pg_constraint 실측·SCHEMA 등재)
`type='refund'` 신설이 DB에서 막히지 않는다. 대신 **type 소비처 전수 확인 의무**: `getMonthlyUsage`(deduct만 합산 — refund 반영 여부 판단),
`sumDeductRows`, frontend `CREDIT_TYPE_LABELS`(refund 라벨 추가), billing overage 집계(`type` 필터 확인).

### 1-6. planner 테이블 상태 전이는 DDL 추가 없이 성립
`planner_events` CHECK = draft·briefed·approved·producing·scheduled·done·reported·cancelled·re_brief /
`planner_touchpoints` CHECK = planned·locked·producing·ready·scheduled·sent·skipped·hold_credit — **Phase 3·4 전이 전부 이 안에 있다.**
`asset_ref uuid`(제작물)·`exec_ref uuid`(캠페인) 컬럼도 이미 있다.

---

## §2 예정 DDL (배포 후 실행 — 코드가 42703 폴백 동반)

```sql
-- 알림톡 template_key(varchar)·당일 문안·재시도 카운트 등 채널별 실행 참조. uuid 컬럼(asset_ref·exec_ref)로는 못 담는다.
ALTER TABLE planner_touchpoints ADD COLUMN IF NOT EXISTS exec_meta jsonb NOT NULL DEFAULT '{}';
-- 결과 브리핑 통지 멱등(월간 1회) — planner_monthly_approvals에.
ALTER TABLE planner_monthly_approvals ADD COLUMN IF NOT EXISTS result_notified_at timestamptz;
```
그 외 신규 테이블 0. 참여 이벤트 = cdp_events, 참여자 세그먼트 = saved_segments 재사용.

---

## §3 재사용 실물 (전부 시그니처 확인 완료 — 새로 만들지 마라)

| 축 | 실물 | 비고 |
|---|---|---|
| 문안 당일 생성 | `orchestrate({companyId,userId,objective,companyInfo,customerStats,forcedChannel,benefitContent,forcedIsAd:true,segmentKey,…}, {source,cost})` — `continuous-operator.ts:826` 호출부가 조립 견본 | 혜택 = `planner_events.benefit_text` verbatim 주입. 플래너 source 신설(`planner-touchpoint-send`?) 시 크레딧 3점 세트 확인 |
| 발송 커밋 | `createDirectSendCampaign(spec, {companyId,userId}, training?)` — `direct-send-core.ts:62`. staging COUNT·campaign INSERT·잔액 차감·환불 배관·워커 트리거 포함 | spec 조립은 `direct-send-spec.ts` 참조. `campaigns.message_type`에 KAKAO 금지(LMS+`send_channel` 축 — LESSONS 0727) |
| 대상 추출·수 | `countOperatorAudienceFor` / `buildSendableStagingInsertSql`(`operator-recipients.ts`) — 게이트 동반 staging 적재 | 브리핑에 보여준 수와 같은 문 |
| 야간 창 | `isSendableHourKst`·`shiftToSendableHour`(`autosend-policy.ts`) | |
| 광고 080 | `getOpt080Number` — 광고 문자는 080 없으면 발송 불가(자동완화 금지) | |
| 스팸 게이트 | CT-09 spam-test-queue(발송 전 통과 의무·차단 시 재생성 — `continuous-operator.ts` 리마인드 스팸 검증 호출부가 견본) | |
| 통지 | `notifyOperatorAdmins(op, title, body, {noticeHeader})` + `PLANNER_NOTICE_HEADER`(`planner-approval.ts` — 0813 신설) | 무과금 인증 라인 |
| 알림톡 검수 | `createAlimtalkTemplate(senderKey, body)`→templateCode · `requestInspection(senderKey, templateCode, comment?)` · `getRecentlyModifiedAlimtalkTemplates({since})` · `getAlimtalkCommentFile(senderKey, templateCode)` (`alimtalk-api.ts:582~`) | 식별은 template_key 축. 정보성 톤 강제 + 혜택·광고 표현 배제(통과 조건) |
| 이메일 수신자 | `countCustomerEmailRecipients`·`resolveCustomerRecipients`(`email-channel.ts`) · 발송 = `sendEmailCampaign` | |
| 크레딧 | `checkCredit`·`deductCredit`(멱등키)·`deductCreditSafe`(반환 boolean = 돈 빠졌는가) | **환불 함수는 없다 — §5-⑤가 신설** |
| 마이그레이션 503 | `handleDbMigrationError` | exec_meta 참조 endpoint catch에 의무 |

⚠ **소재 3채널(이메일·DM·인앱)의 AI 생성이 라우트에 묶여 있는지 서버 함수로 존재하는지 미확인** — 다음 세션 첫 grep(§6-3).
라우트에 묶여 있으면 서버 내부 호출용 함수 추출이 선행 과제다(라우트 재호출 금지).

---

## §4 구현 순서 (각 덩어리 = tsc·테스트 끊고 진행 · 전체 종결 전 Codex 적대 검토)

1. **실행 골격 + 문자** — `utils/planner-executor.ts` 신설: `approved` 터치포인트의 `computeTouchpointDate`(조회 계산 — 저장 금지)가
   오늘(KST)인 것을 집어 ①당일 문안 생성(orchestrate·혜택 verbatim) ②스팸 게이트 ③staging 적재(발송 게이트 동반)
   ④`createDirectSendCampaign` ⑤`exec_ref`=campaignId·status `sent`. **0건 = 발송 생략 + 통지**(자동완화 금지).
   크레딧 부족 = `hold_credit` + 즉시 통지 + [재개] 경로(§5-④와 공용). 실행 선점은 터치포인트 행 CAS(status planned→producing)로 —
   승인 원장 attempt 패턴 미러. 워커 등재 = app.ts 부팅(선언이 아니라 워커가 사실 — 계약 테스트로 고정).
2. **소재 3채널 대행 제작** — 승인 직후(승인 확정 트랜잭션 밖 best-effort + 대조 워커가 그물) `producing`→제작→`asset_ref`→`ready`.
   제작비는 **제작 시점 차감**(멱등키 = `planner-produce:{touchpointId}`), 승인 트랜잭션과 결속 금지(0808 아카이브 교훈 — 고객 확정 경로에 부가 작업 금지).
3. **알림톡 검수 오케스트레이션** — 승인 시 정보성 문안 생성→`kakao_templates` INSERT(**`alarm_notified_status` 채워서** — 0720 이관 함정:
   비우면 5분 알림 job이 집어 과거 알림 오발송)→검수 제출→30분 워커가 갱신하는 status를 플래너 워커가 읽어 APR이면 발송 예약 편입,
   반려면 재생성·재제출 1회(exec_meta에 카운트)+통지, 2회 반려 = 보류+통지. 리드타임 5영업일 미달 = 재사용 APR 폴백 → 없으면 그 터치포인트만 `skipped`+사유.
4. **대조 워커 + 월중 소진** — 이중 진실(플래너 ↔ campaigns/제작물) 대조: 승인됐는데 예정일 지나도록 미실행 / 취소됐는데 실행 잔존 / `producing` 고아(lease 초과).
   발견 = 통지 + 자동 복구 가능분만 복구(모호하면 사람에게). best-effort 경보 원칙(행 단위 정확 1회 보장 쌓지 마라 — LESSONS 0731).
5. **취소·환불** — `refundCredit` CT 신설(`ai-credit-tx.ts`에 type='refund'·bucket 정책·멱등키 `planner-refund:{회사}:{YYYY-MM}`).
   환불 조건 = 그 달 제작·실행 0건일 때만 전액(§3-4 확정 — 일할 없음). 원장 전이 `approved→cancelled` + 행사·터치포인트 일괄 취소.
   type 소비처 전수(§1-5) 동시 정정. **마이너스·자동충전 금지 그대로.**
6. **Phase 4 — 참여 동의 + 결과 브리핑** — ①이메일 [참여하기] 버튼(공개 엔드포인트 + HMAC 토큰: 회사·행사·고객 바인딩·만료 —
   journey-pause 형태. 참여는 멱등 적재라 1회성 불요) → `cdp_events`(event_name 신설 — §6-1 영향표 선행, `occurred_at=now` 실시간이라
   소급 발화 위험 없음) → 참여자 세그먼트(§6-2 판단 후) → 후속 터치포인트 타겟 선택지에 노출 ②결과 브리핑 = 실측 집계(campaigns·발송 결과 —
   목업 금지)를 브리핑 화면에 결과 탭으로 + 월말 통지 1회(`result_notified_at` 멱등). 행사 `done→reported` 전이. 참여 동의 법적 문구(§9-4)는
   화면에 "광고 수신동의와 별개" 명시로 최소 충족, 약관 검토는 별건 유지.

## §5 게이트 (설계서 §8 그대로)

Phase 3 = Codex 적대(차감·발송·검수 = 쓰기 경로) + **실측 1건 풀사이클**(기입→승인→제작→당일 문안→발송→결과).
Phase 4 = 실측(동의→세그먼트→당일 타겟 반영). 실측은 Harold 몫 — 시나리오를 완료 보고에 동봉.

## §6 다음 세션 첫 grep 3건 (코드 쓰기 전)

1. **cdp_events event_name 소비처 전수** — 참여 이벤트 이름이 기존 집계·여정 트리거·세그먼트 축에 걸리는지(설계서 §9-8. "테이블을 세는 소비처"까지 — hasCdpData류, LESSONS 0801).
2. **saved_segments 소비처** — `filter_jsonb`·`segment_type` 소비 방식. 참여자 세그먼트를 동적 정의로 할 수 있는지, 타겟 추출이 세그먼트를 어떻게 읽는지.
3. **소재 3채널 AI 생성의 서버 함수 실존**(§3 ⚠) — email(완성 50)·dm(생성5+발행100)·inapp(게시 100) 각각 라우트 밖 호출 가능 형태인지.

## §7 불변 리마인드 (기능 문서 §3 요지 — 어기면 되돌리는 비용이 크다)

미승인=미발송=미차감 / 문안은 당일·소재는 승인 후 / 혜택 verbatim / 0건=차단·자동완화 금지 / 대조 워커 없이 배선 금지 /
마이너스·자동충전 금지 / 발송 예정일은 저장하지 않는다(조회 계산) / 알림톡=정보성 전용 / **진실 복사 금지**(참여자·결과 집계는 원본을 읽는다).
