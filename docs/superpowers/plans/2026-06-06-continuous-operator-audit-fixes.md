# 자동마케팅(Continuous Operator) 점검 결함 통합 정정 계획

> **실행:** 본 세션 인라인. 각 작업 TDD(순수 로직) + tsc 0 + 자가 grep + verification-before-completion. 배포는 Harold.

**목표:** 2026-06-06 전수 점검에서 확정된 결함·죽은 코드·낡은 카피를 한 번에 정리해, 자동마케팅이 실제 동작과 화면·상태가 100% 일치하게 만든다.

**원칙:** 세션8 자율발송은 배포분 → 해피패스 불변(추가형 정정만). 여정 엔진 미수정. 신규 컬럼 0(기존 컬럼 재사용, 사전 information_schema 덤프 1회로 확인). 한 건씩 순차.

**근거(전수 grep):** 죽은 모델 2개가 코드/화면에만 잔존 — ①`opt_out_minutes`(저장만, 발송 로직 미사용) ②7일 검증 게이팅(`adminConfirmProposal` 라우트·함수 프론트 호출 0, 진행바 표시만). 둘 다 세션8이 스팸통과+`auto_send_lead_minutes` 자율발송으로 대체.

---

## 사전 검증 (코드 작성 전 1회)

operator_proposals 실제 컬럼 덤프 — A가 쓰는 컬럼(status·campaign_id·auto_sent_at·scheduled_send_at·reviewed_at·auto_execute_reason)이 모두 실재하는지 확정:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'operator_proposals'
ORDER BY ordinal_position;
```

(전부 기존 배포 SELECT/UPDATE에서 쓰던 컬럼이라 ALTER 불필요 — 덤프는 0번 원칙 준수용 최종 확인.)

---

## 파일 구조

- `packages/backend/src/utils/autosend-policy.ts` — 신규 순수 함수 `decideStuckSendingRecovery` 추가(+verify 테스트).
- `packages/backend/src/utils/continuous-operator.ts` — A(정지 복구)·B(080 가드)·D1(status 파라미터화)·E(죽은 함수 제거).
- `packages/backend/src/routes/ai.ts` — D2(validStatuses 갱신)·E(orphan 라우트 제거).
- `packages/frontend/src/pages/ContinuousOperatorPage.tsx` — F(죽은 검증/옵트아웃 UI 제거·카피를 실제 모델로·누출 단어 정리).
- `packages/backend/src/utils/__tests__/autosend-policy.verify.ts` — 신규 테스트.

---

## A. 'sending' 정지 복구 (최우선)

**문제:** claim(scheduled/pending→sending) 후 발송 커밋 전 쿼리(operator 조회·재추출·staging) 예외 시 'sending'에 영구 정지. 자동=알림 없이 누락, 수동=500+재승인 불가. 복구 경로 없음.

**해결(검증된 campaign 'sending' 자동정리 패턴 미러 — admin.ts:1673):**

- **A0** `sendScheduledProposal` 자동 claim에 `reviewed_at = NOW()` 추가 → 자동·수동 공통 claim 시각 확보(정지 노후 판정용).
- **A1** `dispatchProposalSend` 커밋 전 구간(operator 조회·재추출·staging)을 try/catch로 감싸 예외 시 'sending'→'admin_review'(scheduled_send_at=NULL·사유·통지) 후 rethrow.
- **A2** 발송 커밋 직후 `campaign_id`를 즉시 기록(별도 UPDATE) → 커밋 마커. 이후 최종 `status='sent'` UPDATE 실패해도 마커 남음.
- **A3** `runAutoSendPass` 끝에 정지 정리 추가:
  - `'sending' AND campaign_id IS NOT NULL` → `'sent'`(이미 커밋, 시각 무관 안전).
  - `'sending' AND campaign_id IS NULL AND reviewed_at < NOW() - interval '30 min'` → `'admin_review'`+통지(절대 자동 재발송 X).

**순수 함수(TDD):**
```ts
// autosend-policy.ts
export type StuckAction = 'mark_sent' | 'demote_admin_review' | 'keep';
export function decideStuckSendingRecovery(
  row: { campaignId: string | null; reviewedAt: Date | null },
  now: Date,
  staleMinutes: number = 30,
): StuckAction {
  if (row.campaignId) return 'mark_sent';
  if (row.reviewedAt && now.getTime() - row.reviewedAt.getTime() >= staleMinutes * 60_000) return 'demote_admin_review';
  return 'keep';
}
```
테스트: campaign_id 있음→mark_sent / null+노후→demote / null+최근→keep.

**커밋 순서 변경(dispatchProposalSend 성공 경로):** createDirectSendCampaign 반환 직후 `UPDATE ... campaign_id=$2` → deductCreditSafe(best-effort) → `UPDATE ... status='sent', auto_sent_at=NOW() WHERE id AND status='sending'`. (재발송 없음 — createDirectSendCampaign 재호출 안 함.)

---

## B. 광고 자율발송 080 가드

**문제:** 080·reject_number 모두 없으면 광고가 번호 없는 "무료거부"로 발송(정보통신망법). 자동·수동(approve) 공유 경로 `dispatchProposalSend`에 가드 없음.

**해결:** `getOpt080Number` import.
- `generateProposalForOperator` 자격 판정: `isAd`면 `getOpt080Number(operator.createdBy, operator.companyId)` 결과 필요 → 없으면 autoExecuteEligible=false(→'pending' 수동검토).
- `dispatchProposalSend` 발송 직전 최종 가드: `isAd && !opt080` → 'admin_review'+scheduled_send_at=NULL+통지("광고 무료거부 번호(080) 미설정 — 발송 보류"), 발송 안 함. (자동·수동 단일 차단점.)

---

## D. listProposals status 파라미터화 + 라우트 화이트리스트

- **D1** continuous-operator.ts:735 `AND p.status = '${status}'` 문자열 보간 제거 → 파라미터/고정 매핑. (현재 라우트가 화이트리스트해 악용 불가하나 방어.)
- **D2** routes/ai.ts:2006 validStatuses에 신규 상태 추가: `scheduled, sending, sent, skipped, admin_review, admin_stopped`. (auto→sent 전환 후 상태별 조회 정합.)

---

## E. 죽은 코드 제거

- `markProposalExecuted`(continuous-operator.ts:803) — 호출 0건.
- `adminConfirmProposal`(continuous-operator.ts:652) + 라우트 `/operator/proposals/:id/admin-confirm`(routes/ai.ts:2080) — 프론트 호출 0건(검증 게이팅 제거 잔재).
- DB 컬럼(verification_*·opt_out_minutes)은 보존(메모리 정합) — 함수/라우트/UI만 제거.

---

## F. 프론트 카피·UI를 실제 모델로 정정 (ContinuousOperatorPage.tsx)

- **F1** 7일 검증 진행바·"검증 통과 시 자동 발송" 블록(967~998) 제거 — 동작 안 하는(admin-confirm 미호출) 옛 모델 표시. 실제 모델("스팸 통과 → 준비 알림 → lead분 뒤 자율발송, 그 사이 정지") 카피로 교체.
- **F2** 발송주기 옵션 "매주/매달 — 발송 2시간 전 담당자 안내 (5분 옵트아웃)"(1312~1313)·"옵트아웃 본질"(1311) → lead 모델 카피로.
- **F3** 옵트아웃 시간(분) 입력 필드(1369~1375) 제거 또는 "자율 발송 준비 시간"으로 일원화(autoSendLeadMinutes 이미 1380~1392에 존재) — 중복·미사용 필드 정리.
- **F4** 누출 단어 정리: 페이지 전역 `본질`·과도한 `영역` 자연 한국어 치환(984·1064·1074·1311 등).
- 자가 grep: 저장 직후 `본질|영역|박[음힘는을힌지혀]|Opus|Sonnet|GPT|Claude|confirm\(|alert\(|prompt\(` = 0건.

---

## C. 자율실행 게이트 설정 지점 (Harold 결정 대기)

`cdp_auto_execute_enabled`·max_recipients/max_cost/max_risk를 켜는 화면·API 부재(DB 전용). 자가-서브 토글 신설은 기능 추가(디자인 퀄리티·마케팅 UX 룰 적용) → Harold 의도 확인 후 별도 작업. 본 계획 A~F와 독립.

---

## 회귀 안전

- A·B는 추가형(에러 경로·가드·정리) — 해피패스 SQL/순서 중 campaign_id 기록 시점만 앞당김(재발송 유발 없음).
- D1·E·F는 동작 동일/제거 — 발송 로직 무변.
- 배포: backend `build:safe` + frontend `build:safe` + restart all. (Harold)

## 자기 검토
- 점검 10항 ↔ 작업 매핑: 1=A, 5=B, 9=D, 죽은코드=E, 카피=F, 7=C(대기). 누락 없음.
- 신규 컬럼 0 — 사전 덤프로 재사용 컬럼만 확인.
- 순수 함수 TDD: decideStuckSendingRecovery.
