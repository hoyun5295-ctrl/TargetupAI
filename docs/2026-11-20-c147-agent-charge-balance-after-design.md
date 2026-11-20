# C147 충전 내역 · 반영 뒤 잔액 설계서(2026-11-20)

> 접수 = 그룹웨어 오류접수 cmwmvyqjc228ojnschr5lgr77(11-19 10:43 · 박성용) 「충전 전후 잔액 확인 요청」 · 캡처 = 고객사 「관리 → 충전 요청 → 충전 내역」 표 반영 칸(빨간 상자) · 원문 = 「반영 칸에 충전 or 차감 이후 금액 표기」
> Harold 1120 「사용자가 들어와서 선불 충전하는 애들 말하는 것」 → 「62 번에 보이는 걸 그렇게 보이게」 → 62 sales 칸 실측 → 「이 안으로 진행」(앞으로 반영되는 줄부터 반영 순간 잔액을 남겨 행마다 보인다)
> C146 E4 「코드 0 · 직원 회신」 판정은 거둔다(이 설계서가 대신한다).

## §0 사실(실측) · 미가입 변화 0

**사실(Harold 1120 서버 출력)**
- 62 `pay-ingest-db` sales 표 = 셋뿐: `RSRM_FillAmtHist`(SeqNo · StoreId · FillAmt · FillDtTm · PayMethod · RsApplyFlag · RsApplyDtTm · PayFkey) · `RSRM_SalesMst`(… RemAmt · UpdTm · InsTm) · `RSRM_SalesStts`(일자 · 유형별 건수 + 적재 시점 RemAmt).
- 충전 줄마다 반영 뒤 잔액을 남기는 칸 = 0. 지금 잔액 = `RSRM_SalesMst.RemAmt`(대표 행 · 발송이 나가는 대로 실시간 · 고르는 규칙 = `pay-stats.ts` `pickLedgerBalances`).
- 게이트웨이(65) `billing_ledger` 충전 반영 줄 = 0행 → 이 화면의 발송ID 충전은 65 원장을 지나지 않는다.
- 결론 = 지난 줄의 반영 뒤 잔액은 어디에도 없다 · 앞으로 반영되는 줄부터 반영을 확인한 순간의 지금 잔액을 한줄로가 남긴다.

**미가입 · 직접발송만 쓰는 회사 변화 0**: 이 화면 탭(「충전 요청」)은 발송ID(에이전트 지갑)가 있는 회사만 보인다(`ManagePage.tsx:53` hasAgentWallet) · 새 일꾼은 62 를 읽고 한줄로 새 표에만 쓴다(발송 · 차감 · 잔액 무접촉) · 발송 핵심 다섯 파일 무수정.

## §1 흐름 표

| 단계 | 쓰는 쪽 | 읽는 쪽 | 값 범위 | 그리는 화면 | 판정 |
|---|---|---|---|---|---|
| 충전 줄 생성 | 한줄로 `pay-stats.ts:1275` INSERT(FillDtTm = 62 MySQL `NOW()` · RsApplyFlag 'N') · 부르는 길 = `agent-charge-core.ts:216` executeAgentChargeBatch 하나(소비처 = `routes/admin.ts` 담당자 직접 · 요청 승인 / `routes/charge-approve.ts` 문자 링크 승인) · 한줄로 밖에서 들어온 줄이 있으면 FillDtTm 은 그쪽 시계(판정은 P2 3 의 오래됨 = 빈 값 쪽) | 중계 엔진 | 양수 충전 · 음수 차감 | | 정상 |
| 반영 | 중계 엔진(한줄로 밖) = RsApplyFlag 'Y' · RsApplyDtTm(중계 시계) | 한줄로 `toChargeRow` | 반영 시각 = 중계 시계(62 시계와의 차이 미측정) | 반영 칸 「반영 완료 · 시각」 | 정상 |
| 잔액 | 중계 → 62 `RSRM_SalesMst.RemAmt` | `queryLedgerBalancesByIds` → `pickLedgerBalances` | 지금 값 하나 · 반영분이 62 에 실리는 지연 = 미측정 | 「발송ID 잔액」 카드 | 정상 |
| **반영 뒤 잔액 기록(새)** | 새 일꾼(30초) → 한줄로 PG 새 표 | 조회 라우트 | 반영 직전 회차 잔액 → 지금 잔액이 금액 절반 이상 같은 방향으로 움직인 회차의 잔액(반영 확인 뒤 1분 30초 안) · 근거가 모자라면 빈 값 | | **E4 처방** |
| 충전 내역 조회 | `routes/agent-charge-orders.ts` `GET /ledger` | 화면 | 줄마다 `balanceAfter`(숫자 또는 null) 더함 | | 처방 |
| 화면 | | `AgentChargeRequestTab.tsx` 반영 칸 | | 「반영 완료 · 11-10 14:09 · 잔액 2,885,310」 · 기록 없는 줄 = 지금 그대로 | 처방 |

## §2 처방

### P1 · 새 표 `agent_fill_balance_marks`(DDL · 배포 뒤)

```sql
CREATE TABLE IF NOT EXISTS agent_fill_balance_marks (
  seq_no integer NOT NULL,                 -- RSRM_FillAmtHist.SeqNo
  agent_send_id text NOT NULL,             -- RSRM_FillAmtHist.StoreId(발송ID · 62 칸 폭 미측정 → 길이 제한으로 회차 전체가 실패하지 않게 text · 구현 때 바꿈)
  fill_amount numeric(18, 3) NOT NULL,     -- RSRM_FillAmtHist.FillAmt(부호 그대로 · 증거 판정용)
  state varchar(12) NOT NULL CHECK (state IN ('pending', 'applied', 'captured', 'skipped')),
  pending_seen_at timestamptz,             -- 반영 대기('N')로 본 첫 회차
  last_pending_at timestamptz,             -- 반영 대기로 본 마지막 회차(공백 판정 · Codex 설계 1R #1)
  balance_before numeric(18, 3),           -- 마지막 반영 대기 회차의 그 발송ID 잔액(증거 판정의 앞 값)
  applied_seen_at timestamptz,             -- 반영('Y')을 처음 본 회차
  balance_after numeric(18, 3),            -- captured 일 때만
  skip_reason varchar(16) CHECK (skip_reason IS NULL OR skip_reason IN ('missed', 'gap', 'multi', 'no_evidence', 'gone')),
  captured_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (seq_no, agent_send_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_fill_balance_marks_open ON agent_fill_balance_marks (state) WHERE state IN ('pending', 'applied');
```

- 돈의 진실이 아니다(잔액 = 62 · 이 표 = 그 순간 읽은 값의 기록). 지우는 길 없음(줄 수 = 충전 건수 · 한 해 수백 줄).

### P2 · 기록 일꾼 `utils/agent-fill-balance.ts`(30초 · `app.ts` 부팅 줄 하나)

> ★ Codex 설계 1R(high 3 · medium 2 = 전부 「근거 없이 captured」 한 축) → 시간을 기다리는 규칙을 버리고 **증거가 있을 때만 기록**하는 꼴로 다시 짰다. 원칙 = 근거가 모자라면 빈 값(잔액을 틀리게 보이는 것보다 비워 두는 쪽).

회차마다(겹침 방지 · 62 미설정 · 표 없음 = 조용히 건너뜀 · MySQL 질의마다 시간 제한 10초 · **관측 시각 = 읽은 시각(쓰는 시각 아님) · 반영 대기(N) 관측 = R1 시각(이른 쪽) · 반영(Y) 관측 = R2 시각(늦은 쪽)** = 둘 다 판정을 빈 값 쪽으로 민다(N 이 이르면 공백이 커 보이고 이웃 하한이 이르다 · Y 가 늦으면 이웃이 오래 남는다 · ★ 9R #2)):
1. 62 를 세 번 읽는다(같은 풀 · 읽기만):
   - R1 = `SELECT SeqNo, StoreId, FillAmt, RsApplyFlag FROM RSRM_FillAmtHist`(**창 없음 · 매 회차 원장 전체** · ★ 6R = 이웃 누락 다섯 번째 · 왜 되풀이됐나 = 관측에 창(최근 2일 · 열린 기록)을 둘 때마다 그 창 밖에 사각이 생겼다 → 창을 없앤다 · 첫 회차에 모든 줄을 기록(Y = missed · N = pending) = 그 뒤 PG 기록 없는 Y 줄 = 이번 회차에 처음 반영으로 보인 줄 · 읽기 부담 = 원장 전체 줄 수 = 배포 앞 실측 C147-P0)
   - B = R1 에서 반영 대기(N) 줄이 있거나 PG 열린 기록(pending · applied)이 있는 발송ID 의 잔액(`queryLedgerBalancesByIds` · 대표 행 규칙 그대로 · 미확정 = 잔액 모름)
   - R2 = R1 과 같은 문장
   - 발송ID 마다 R1 · R2 의 그 발송ID 줄 상태(SeqNo · RsApplyFlag)가 하나라도 다르면 = **이번 회차 그 발송ID 는 잔액을 기록하지 않는다**(captured 0 · 잔액을 읽는 사이에 반영이 끼었다 · 1R #2). **관측은 그대로 남긴다**(★ 7R = 잔액 기록과 관측 보존을 떼어 냄): R1 · R2 어느 쪽에서든 본 줄은 기록한다(N 을 봤으면 pending · Y 를 처음 봤으면 applied_seen_at = 지금 · 기록 없으면 missed) = 그 줄이 뒤에 원장에서 사라져도 이웃으로 남는다.
   - 원장에서 사라진 줄: PG 열린 기록(pending · applied)인데 R1 · R2 둘 다에 없으면 → `skipped`(gone · applied_seen_at 이 비었으면 지금) = 「사라짐을 본 시각에 반영됐을 수 있다」로 보고 이웃 ③ 으로 30분 남긴다(★ 7R).
2. PG 기록을 읽는다(전부 · 줄 수 = 원장 줄 수).
3. 순수 판정 `planFillMarks({ rows, balances, marks, nowMs, tickMs })`(시계 = 이 일꾼의 회차 시각만 · 중계 시계 RsApplyDtTm 은 쓰지 않는다):
   - 'N' + 기록 없음 → `pending`(pending_seen_at = last_pending_at = 지금 · balance_before = 지금 잔액(모르면 비움)).
   - 'N' + 기록 `pending` → last_pending_at = 지금 · balance_before = 지금 잔액(반영 직전 값으로 계속 당김).
   - 'Y' + 기록 없음 → `skipped`(missed · 반영 대기를 본 적 없음 = 앞 값 없음 · 처음 배포 때 지난 줄 전부 · 한 회차 안에 생기고 반영된 줄) · **applied_seen_at = 지금**(반영을 처음 본 시각은 상태와 무관하게 모든 줄에 남긴다 = 아래 이웃 판정의 근거).
   - 'Y' + 기록 `pending`:
     - 지금 − last_pending_at > 2 회차 → `skipped`(gap · 일꾼이 멈췄거나 읽기를 건너뛴 사이에 반영 · 1R #1).
     - 그 밖 → `applied`(applied_seen_at = 지금) 후 이웃 판정 · 증거 판정.
   - 'Y' + 기록 `applied`: 지금 − applied_seen_at > 2 회차 → `skipped`(no_evidence) · 그 밖 → 이웃 판정 · 증거 판정.
   - **이웃 판정**(★ 2R high · 1R #4 와 같은 뿌리 = 같은 발송ID 의 다른 반영분이 앞 값 · 뒤 값 사이에 섞임 · 옛 「이번 회차에 바뀐 줄」만 보던 판정은 이미 끝난(missed · skipped · captured) 앞 줄의 늦은 반영분을 놓쳤다): **이웃 = 잔액을 아직 바꿀 수 있는 같은 발송ID 의 다른 줄 = ① 62 에서 아직 반영 안 된 줄(R1 = 원장 전체) ② PG 열린 기록(pending · applied) ③ 반영을 처음 본 지 30분 안의 줄(PG · applied_seen_at ≥ 그 줄의 last_pending_at − 30분 · 상태 무관) ④ 이번 회차에 처음 반영으로 보이는 줄(PG 기록 없음 또는 pending 에서 바뀜)** · 이웃이 하나라도 있으면 → `skipped`(multi)(★ 4R = 2R · 3R 과 같은 부류 세 번째 → 이웃의 정의를 한 줄로 고정 · 2일 창이 이웃을 자르지 않는다). **이웃 입력 = R1 · R2(원장 전체) + PG 기록 전체**(창 없음 · ★ 6R · 3R 의 「창 밖 이웃」 은 창을 없애 닫힘). ③ = 잔액이 반영 표시(Y)보다 먼저 실리는 순서여도 반영 대기 이웃의 금액이 섞일 길을 닫는다(★ 3R 다음 단계). 근거 = 62 잔액 반영 지연이 30분보다 짧다는 가정(미측정 · §7) 아래에서만, 앞 값 · 뒤 값 사이에 다른 줄의 반영분이 끼지 않았다고 말할 수 있다. 배포 직후 30분 = 첫 회차에 반영으로 본 줄이 있는 발송ID 는 모두 빈 값(처음 관측 시각 = 배포 시각 · P2 5 연속 관측 30분과 겹친다).
   - **증거 판정**(1R #3 · 「1분 기다렸다」는 증거가 아니다): 앞 값 = balance_before · 뒤 값 = 이번 회차 잔액. 충전(금액 F > 0) = 뒤 − 앞 ≥ F/2 · 차감(F < 0) = 뒤 − 앞 ≤ F/2 일 때만 `captured`(balance_after = 뒤 값). 앞 값 · 뒤 값 가운데 하나라도 모르면 증거 없음. 증거가 없으면 `applied` 그대로(다음 회차 다시 · 2 회차 넘으면 no_evidence).
     - 근거 = 같은 발송ID 에 다른 반영이 없는 구간에서 잔액은 발송으로 줄고 발송 실패 환불로만 는다 · 반영분이 실리기 전에는 금액의 절반만큼 같은 방향으로 움직이려면 그 구간(최대 1분 30초) 발송액(차감 줄) 또는 실패 환불액(충전 줄)이 금액의 절반을 넘어야 한다 = 금액이 작은 줄에서만 남는 틈 · 그때 기록되는 값은 반영분이 빠진 값(차감 줄 = 실제보다 높게 · 충전 줄 = 실제보다 낮게 · 차이 = 그 줄 금액)(§7 밝힘).
4. PG 쓰기 = 한 트랜잭션 · 새 줄 = `INSERT … ON CONFLICT DO NOTHING` · 상태 바꿈 = `UPDATE … WHERE seq_no = $ AND agent_send_id = $ AND state = <판정이 본 상태> AND <판정이 본 last_pending_at · applied_seen_at 과 같음>`(두 회차가 겹쳐도 앞 상태를 덮지 않음).
5. **잔액 기록(captured)은 「연속 관측 30분」 일 때만**(★ 7R · 8R = 관측 보존 같은 부류 두 번째 → 규칙 하나): 회차 시작부터 20초가 지났으면 그 회차 captured 만 버리고 관측(pending · applied_seen_at · missed · gone)은 쓴다(1R #5 늦게 끝난 읽기) · 관측 쓰기가 실패했거나 건너뛴 회차(62 · PG 오류 · 겹침으로 건너뜀)가 있었으면, 그리고 프로세스가 새로 뜬 뒤에는 **연속 관측 시작 시각 S = 그 뒤 처음으로 그 회차 관측을 PG 에 끝까지 커밋한 시각**(★ 10R · 실패한 시각이 아니다 = 관측이 다시 이어지기 전 틈에 생긴 반영도 30분 안에 든다 · S 가 아직 없으면(실패 뒤 · 재시작 뒤 아직 커밋 전) captured 0 · 메모리 값)이고, captured 는 **그 줄의 앞 잔액 관측(last_pending_at)이 S + 30분 이후일 때만**(★ 9R #1 · 지금 회차만이 아니라 앞 값까지 차단 해제 뒤) · S + 30분 전에 잡은 앞 잔액을 가진 줄은 증거가 있어도 `skipped`(no_evidence · 반영 대기를 계속 보면 last_pending_at 이 당겨져 해제 뒤 앞 값으로 다시 판정) = 영속하지 못한 관측이 있었던 30분 안에는 이웃을 다 안다고 말하지 않는다.

### P3 · 조회 · 화면

- `agent-fill-balance.ts` `loadFillBalances(rows)` = (seq_no, agent_send_id) 짝으로 `captured` 줄만 → Map · 표가 없으면 빈 Map(로그 한 번 · DDL 전 = 지금 화면 그대로).
- `GET /api/agent-charge-orders/ledger` 줄에 `balanceAfter: number | null` 더함(다른 칸 무변경 · 열람 범위 = 기존 소유 발송ID 걸름 그대로 · 잔액 읽기 실패는 목록을 막지 않음 = null).
- 화면 반영 칸 = `반영 완료 · 11-10 14:09 · 잔액 2,885,310`(잔액 표기 = 기존 `formatAgentBalance` · 숫자일 때만) · 「충전 내역」 설명 줄에 한 문장: 「잔액은 반영을 확인하며 읽은 값이라 그 사이 발송한 만큼 다를 수 있습니다. 확인할 수 없었던 줄과 이 기능 전의 내역에는 표시되지 않습니다.」

## §3 영향표

| 자리 | 바뀜 |
|---|---|
| `pay-stats.ts` | 읽기 함수 하나 더함(`readFillLedgerAll` = 원장 전체 · 질의 시간 제한) · `queryLedgerBalancesByIds` 에 선택 인자 `timeoutMs`(안 주면 시간 제한 없음 = 기존 소비처 `routes/admin.ts:4485` · `queryPayAgentBalances` 동작 그대로) |
| 새 `utils/agent-fill-balance.ts` | 일꾼 · 순수 판정 · 조회 |
| `app.ts` | 부팅 줄 하나(`startAgentFillBalanceWorker`) |
| `routes/agent-charge-orders.ts` `GET /ledger` | 줄에 balanceAfter |
| 슈퍼관리자 충전 화면(`routes/admin.ts:4794`) | 무변경(접수 = 고객사 화면) |
| `AgentChargeRequestTab.tsx` | 반영 칸 글 · 설명 한 문장 · `LedgerRow.balanceAfter` |
| 62 | 읽기만(기존 풀 · 30초 한 번 · 원장 전체 두 번 + 반영 대기 · 열린 기록 발송ID 잔액) |
| 발송 · 차감 · 잔액 · 충전 승인 | 무접촉 |

## §4 시험

- 계약(`c147-fill-balance.test.ts`): `planFillMarks` 표(pending → applied → captured · 증거 없음 = applied 유지 → no_evidence · 반영 대기를 본 적 없음 missed · 공백 gap · 같은 발송ID 이웃(이번 회차 · 30분 안에 반영을 처음 본 다른 줄 · 이미 끝난 missed · skipped 줄의 늦은 반영분 = 2R 연속 충전 시나리오 · 반영을 본 뒤 2일 조회 창에서 빠진 이웃 = 3R 시나리오 · 반영 대기로만 본 채 2일 창을 벗어난 뒤 반영되는 이웃 = 4R 시나리오 · 오래된 반영 대기 줄이 반영으로 바뀌는 회차 = 5R 시나리오 · PG 기록 없는 오래된 줄이 R1 · R2 사이에 반영되어 그 회차 쓰기가 빠진 뒤 다음 회차 = 6R 시나리오(원장 전체 읽기 · 기록 없는 Y 줄 = 이웃 ④) · R1 · R2 가 어긋난 회차에 본 줄이 그 뒤 원장에서 지워지고 반영분만 늦게 실림 = 7R 시나리오(관측은 기록 · 사라진 열린 기록 = gone · 30분 이웃) · 세 조회 성공 합계 21초 회차 = 8R 시나리오(captured 만 버리고 관측은 기록) · 관측 쓰기 실패 · 재시작 뒤 30분 = captured 0 · 차단 해제 전에 잡은 앞 잔액 = 빈 값(9R #1 경계) · 관측 재개 직전 삭제 + 늦은 반영 = S 는 재개 뒤 첫 커밋 시각(10R) · R2 에서 처음 본 반영 = R2 시각으로 30분(9R #2 경계) · R1 에 반영 안 된 오래된 줄이 늘 실림) multi · 앞 값 모름 · 잔액 모름 · 차감 · 충전 방향 · R1 ≠ R2 발송ID 는 쓰기 0 · 20초 넘은 회차 쓰기 0 · 중계 시계(RsApplyDtTm)를 판정에 쓰지 않음) · 일꾼 부팅 줄 한 곳 · 조회 라우트가 CT 를 부름 · 화면이 숫자일 때만 잔액 글.
- 실 PG(`c147-fill-balance.pg.test.ts` · 원장 DDL 블록 그대로): 62 읽기 모의 + 실제 표로 세 회차 진행 · 겹친 회차의 조건부 쓰기 · 조회 Map.
- 변이 = 판정 갈래마다 · 조건부 쓰기 끔 · 화면 숫자 판정 끔.

## §5 직원 시트(배포 · DDL 뒤)

| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 0 | (서버) 배포 · DDL 뒤 30분이 지났는지 본다(그 전 충전은 빈 칸이 맞다 · P2 5) | |
| 1 | 선불 발송ID 가 있는 테스트 고객사로 「관리 → 충전 요청」에서 1,000원 충전 요청 → 슈퍼관리자가 승인(또는 담당자 직접 충전) | 「충전 내역」 맨 위에 그 줄 · 「반영 대기」 |
| 2 | 충전 요청 전에 맨 위 「발송ID 잔액」 카드 숫자를 적어 두고, 반영 뒤 3분 기다렸다가 「새로고침」 | 그 줄 반영 칸 「반영 완료 · 시각 · 잔액 …」 · 잔액 = 적어 둔 숫자 + 1,000 에서 그 사이 발송분만큼 적은 값 |
| 3 | 예전 줄을 본다 | 잔액 없이 「반영 완료 · 시각」 그대로 |

## §6 배포

- 순서 = 코드 배포 → DDL(원장 C147-DDL-1 · 표가 없으면 일꾼 · 조회가 조용히 건너뜀 = 배포와 DDL 사이 변화 0) → S1(위 시트 1 · 2 · 서버 = 표에 captured 한 줄).
- 되돌리기 = 코드 내림 뒤 `DROP TABLE IF EXISTS agent_fill_balance_marks;`.

## §7 범위 밖 · 미검증

- 지난 줄의 반영 뒤 잔액 = 어디에도 없음(실측) · 만들지 않는다.
- 반영 순간의 정확한 값 = 중계 엔진 안에서만 생김 · 이 처방 = 반영 확인 뒤 1 ~ 2분 안의 값(화면 문장으로 밝힘).
- 반영분이 62 잔액(RemAmt)에 실리는 지연 = 미측정. 그 줄 자체는 지연에 기대지 않는다(증거 판정 · 1분 30초 안에 증거가 없으면 빈 값). 다만 **같은 발송ID 의 다른 줄 반영분이 섞이지 않는다는 판단은 두 가정에 기댄다**(이웃 판정): ① 62 잔액 반영 지연 < 30분 ② 62 충전 원장에 아직 보이지 않는 줄(한줄로 밖 · 중계 쪽 직접 입력)이 잔액에 먼저 실리지 않는다 ③ 충전 원장 줄이 이 일꾼이 한 번도 보기 전(30초 사이)에 생겼다 지워지지 않는다(한줄로 코드 · 게이트웨이 코드에 이 원장 줄을 지우는 문장 0 = 소스 grep · 중계 쪽은 미확인). 62 에 보이는 줄은 반영 대기(N · 나이 무관)든 반영(Y · 처음 본 지 30분 안)이든 이웃 판정이 막는다(순서 무관) · 중계가 끝내 반영하지 않는 오래된 반영 대기 줄이 있는 발송ID 는 그 줄이 남아 있는 동안 모든 줄이 빈 값(틀린 값보다 빈 값) · 측정 = S1 에서 반영 표시(Y)를 본 시각과 잔액이 움직인 시각의 차이(서버 기록 = 표의 applied_seen_at · captured_at).
- 남는 틈 = 같은 구간(최대 1분 30초) 발송액이 차감 금액의 절반을 넘는 작은 차감 줄(기록 = 실제보다 그 금액만큼 높게) · 발송 실패 환불액이 충전 금액의 절반을 넘는 작은 충전 줄(기록 = 실제보다 그 금액만큼 낮게). 큰 금액(수십만 원 이상) 줄에서는 1분 30초 발송 · 환불이 절반에 닿을 길이 사실상 없다(미측정 · 회사별 분당 발송액 실측 = S1 뒤 필요하면).
- 읽기 부담 = 30초마다 62 충전 원장 전체 줄 수(미측정 · 고객사 화면 한 회사 62건) · 배포 앞 실측 C147-P0 = `SELECT COUNT(*) FROM RSRM_FillAmtHist` · 수십만 줄이면 다시 본다.
- 슈퍼관리자 충전 화면 잔액 표기 = 접수 밖(같은 조회 CT 로 붙일 수 있음 · 추가 과제).

## §9 Codex 설계 기록

- 1R needs-attention 5(high 3 · medium 2 · 전부 수용 · 한 축 = 근거 없이 captured): #1 재시작 공백 동안 반영된 줄에 늦은 잔액 → last_pending_at 공백 판정(gap) · #2 판정과 잔액 읽기 사이 다른 반영 → R1 · B · R2 세 번 읽기 · 발송ID 상태가 바뀌면 그 회차 쓰기 0 · #3 1분 대기는 반영분이 잔액에 실린 증거가 아님 → 앞 값(반영 직전 회차 잔액) · 뒤 값 증거 판정 · 증거 없으면 빈 값 · #4 SeqNo 순서 ≠ 반영 순서 → 같은 발송ID 여럿 = 전부 빈 값(multi) · #5 늦게 끝난 읽기 → 질의 시간 제한 10초 · 회차 20초 넘으면 쓰기 0. 시간 기다림 규칙(1 회차 대기 · 3 회차 late · later_fill · same_window)은 걷었다.
- 2R needs-attention 1 high = 같은 발송ID 에서 앞 줄(missed)의 늦은 반영분이 뒤 줄의 증거로 쓰임(옛 multi 는 「이번 회차에 바뀐 줄 · applied 상태」만 봄) → 1R #4 와 같은 뿌리 → 판정 하나로 바꿈 = 이웃 판정(반영을 처음 본 시각을 상태와 무관하게 모든 줄에 남기고, 같은 발송ID 다른 줄이 그 줄의 반영 직전 관측 30분 전 이후에 반영됐으면 빈 값) · 가정 「62 잔액 반영 지연 < 30분」 을 §7 에 밝히고 S1 에서 잰다.
- 3R needs-attention 1 high = 이웃 판정 입력이 이번 조회 창(최근 2일)의 줄 기록뿐이라 창 밖으로 빠진 이웃의 늦은 반영분을 놓침 → 2R 과 같은 뿌리(이웃 반영분 혼입)의 입력 범위 → 이웃 입력을 조회 창과 떼어 PG 기록 전체에서 읽음 + 「다음 단계」 순서 문제 = 반영 대기(N) 이웃이 있으면 빈 값(잔액이 Y 보다 먼저 실려도 막힘) · 남는 가정 둘(지연 < 30분 · 62 에 안 보이는 줄이 먼저 실리지 않음)을 §7 에 밝힘.
- 4R needs-attention 1 high = 반영 대기(N)로만 본 채 2일 조회 창을 벗어난 이웃이 빠짐 → 이웃 판정 지적 2R · 3R · 4R = 같은 부류 세 번째 · 왜 되풀이됐나 = 2일 조회 창이 「잔액을 아직 바꿀 수 있는 줄」의 범위를 잘랐다 → 이웃의 정의를 한 줄로 고정(62 반영 안 된 줄 전부 · 반영을 처음 본 지 30분 안 줄 · 이번 회차 처음 반영) · 조회 = 반영 안 된 줄 전부 + 최근 2일 줄(창은 반영으로 바뀌는 줄을 찾는 데만).
- 5R needs-attention 1 high = 오래된 반영 대기 줄이 반영으로 바뀌는 순간 R1 조건(반영 안 됨 · 최근 2일)에서 빠져 이웃에서 사라짐 → 같은 부류 네 번째 · 뿌리 = 조회 조건이 줄의 상태 변화에 따라 그 줄을 놓친다 → 원칙 하나 = 한 번 본 줄은 해소될 때까지 놓치지 않는다(R1 에 열린 기록 SeqNo 를 늘 더함 · 열린 기록 = 이웃) · 이웃 정의 ①②③④.
- 6R needs-attention 1 high = PG 기록 없는 오래된 줄이 R1 · R2 사이에 반영되면(그 회차 쓰기 생략) 다음 회차에 조회 창 밖이라 이웃에서 빠짐 → 이웃 누락 다섯 번째 · 왜 되풀이됐나 = 관측에 창(최근 2일 · 열린 기록 덧붙이기)을 둘 때마다 창 밖에 사각이 생겼다 → **창을 없앤다**(매 회차 원장 전체 · 첫 회차에 모든 줄 기록 · 기록 없는 Y 줄 = 이번 회차 처음 반영 = 이웃 ④) · 2일 창 · 열린 기록 SeqNo 덧붙이기는 걷음 · 읽기 부담 = 배포 앞 실측.
- 7R needs-attention 1 high = R1 · R2 가 어긋난 회차에 그 발송ID 쓰기를 통째로 건너뛰어 본 줄이 남지 않고, 그 줄이 원장에서 지워지면 이웃에서 사라짐 · 「첫 회차 기록 = 별도 반례 없음」(Codex) → 뿌리 = 잔액 기록과 관측 보존을 한 덩어리로 묶었다 → 떼어 냄(어긋난 회차 = 잔액 기록만 막고 관측은 기록 · 사라진 열린 기록 = gone · 30분 이웃) · 한 번도 보기 전에 생겼다 지워지는 줄 = 가정 ③(한줄로 · 게이트웨이 코드에 지우는 문장 0).
- 8R needs-attention 1 high = 20초 마감을 넘긴 회차가 관측까지 버려 7R 의 이웃 누락이 재발 → 관측 보존 같은 부류 두 번째 → 규칙 하나 = 「captured 는 연속 관측 30분일 때만」(마감 초과 = captured 만 버림 · 관측 쓰기 실패 · 건너뜀 · 재시작 뒤 30분 = captured 0 · 관측 시각 = 읽은 시각).
- 9R needs-attention 2 high(시간 경계 · 8R 규칙의 경계와 관측 시각 뜻): #1 차단 해제 전에 잡은 앞 잔액으로 captured → 앞 잔액 관측(last_pending_at)이 「연속 관측 시작 + 30분」 이후일 때만 · #2 R2 에서 처음 본 반영을 R1 시각으로 소급해 이웃이 먼저 만료 → 관측 시각 = N 은 R1(이른 쪽) · Y 는 R2(늦은 쪽) = 시각 정의를 늘 빈 값 쪽으로.
- 10R needs-attention 1 high = 30분 차단 시작점을 실패 시각으로 잡으면 관측 재개 전 틈의 반영을 놓침 → S = 실패 · 건너뜀 · 재시작 뒤 처음으로 관측을 PG 에 끝까지 커밋한 시각(그 전 = captured 0).
- **11R approve**(10R S 정의 · §7 가정 셋 아래 틀린 captured 반례 0) → 설계 닫힘 · 구현 착수.

## §10 구현 기록(1120)

- 파일: 새 `utils/agent-fill-balance.ts`(순수 판정 `planFillMarks` · 증거 `hasFillEvidence` · 회차 `fillBalanceTick` · 쓰기 `writeFillPlan` · 조회 `loadFillBalances` · 부팅 `startAgentFillBalanceWorker`) · `utils/pay-stats.ts`(`readFillLedgerAll` · `FillLedgerRow` · `queryLedgerBalancesByIds` 선택 인자 `timeoutMs`) · `routes/agent-charge-orders.ts`(/ledger `balanceAfter`) · `app.ts`(부팅 줄) · `AgentChargeRequestTab.tsx`(반영 칸 「· 잔액 …원」 · 설명 한 문장) · 원장 C147-P0 · H1 · DDL-1 · S1.
- 설계와 다르게 한 곳: ① 표 `agent_send_id` = text(62 StoreId 폭 미측정 · 길이 초과로 회차 전체가 실패하지 않게) · `skip_reason` CHECK ② 회차 시작 때 지난 커밋에서 2 회차(60초) 넘게 지났으면 S 비움(멈춤 · 지연도 끊김) ③ 반영을 본 뒤 다시 반영 대기로 보인 applied = skipped(no_evidence) ④ 62 원장 줄 발송ID 빈 줄 = 뺌 · SeqNo 축 모양 아님 = 그 회차 실패 · FillAmt 숫자 아님 = 0(증거 불가) ⑤ 이웃 · S 미달 = skipped(끝) · 20초 마감 · R1 ≠ R2 · 증거 없음 = applied 유지(다음 회차 다시) ⑥ 화면 잔액에 「원」(같은 탭 「발송ID 잔액」 카드와 같은 표기).
- Codex 구현 1R needs-attention 2 high(전부 수용 · 새 부류 둘): #1 금액이 바뀐 줄을 처음 저장 금액으로 증거 판정 → 판정 자리에서 저장 금액 ↔ 지금 원장 금액 대조(소수 셋째 자리) · 다르면 no_evidence · #2 줄 단위 조건부 쓰기가 다른 프로세스(PM2 reload 겹침)의 미커밋 이웃 관측을 못 막음 → 뿌리 = 단일 프로세스 전제 → 회차 전체를 프로세스 사이 잠금(`pg_try_advisory_lock` · lockPool 연결) 하나로 · 못 잡으면 S 비우고 건너뜀.
- Codex 구현 2R needs-attention 1 medium(잠금 해제 질의에 시간 제한 없음 → 응답이 멈추면 회차 · 연결이 영영 붙잡힘) → 뿌리 = 회차 안 PG 질의 전부에 시간 제한이 없었고 세션 잠금이라 따로 풀어야 했다 → 구조 바꿈(덧댄 장치 걷음): 회차 전체 = pool 연결 하나 · 트랜잭션 하나 · `pg_try_advisory_xact_lock`(따로 푸는 질의 없음 · lockPool · 해제 분기 걷음) · 그 연결 질의마다 `query_timeout` 10초 · 오류 · 시간 초과 = 연결 버림(서버가 트랜잭션 · 잠금을 되돌림 = 늦게 끝난 질의도 커밋 0).
- Codex 구현 3R needs-attention 2(high 1 · medium 1): #2 medium(62 공용 풀 연결 대기에 끝이 없어 회차 · 잠금이 계속 남음) = 2R 과 같은 부류(회차의 바깥 기다림에 끝이 없음) 두 번째 · 왜 되풀이됐나 = I/O 도구마다 시간 제한을 하나씩 덧대며 공용 자원(62 풀 3개)을 빌렸고, 질의 시간 제한은 풀 연결 대기 · 시간 초과 뒤 반납(mysql2 3.24.6 = 서버 응답 때만 반납)을 덮지 못했다 → 구조: 회차가 제 62 연결을 연다(`openPayStatsConnection` · 접속 10초 · 질의 10초 · 끝나면 늘 destroy · 공용 풀 무접촉) = 회차 안 기다림 전부가 PG 연결 얻기 5초 · PG 질의 10초 · 62 접속 10초 · 62 질의 10초 넷 중 하나로 끝난다 · #1 high(체크아웃한 PG 연결 'error' 이벤트가 프로세스를 죽임) → 연결 얻자마자 리스너(회차 실패 = 연결 버림) · 놓기 전 뗌 · 62 회차 연결에도 리스너.
- Codex 구현 4R(첫 실행 = Codex 쪽 작업이 첫 파일 읽기 뒤 멈춰 취소 · 다시 실행) needs-attention 1 medium(mysql2 3.24.6 destroy() = close() = stream.end() 송신 쪽만 닫음 → 응답 · FIN 없는 62 에서 소켓 · 명령이 회차마다 쌓임) → 3R 구조(회차 제 연결)의 닫기 한 곳 · 새 층 아님 → 닫기 도우미 하나(`closePayStatsConnection` = destroy 뒤 밑 소켓 destroy) · 회차는 늘 이 도우미로만(소스 계약) · 시험 = 답 · FIN 없는 실제 TCP 상대.
- **Codex 구현 5R approve**(4R 고친 줄 · 직접 호출부 · 실질 결함 0).
- 검증 = backend tsc 0 · frontend tsc 0 · 계약 c147-fill-balance 46 · 실 PG c147-fill-balance.pg 7(원장 블록 C147-DDL-1 글자 그대로 · 62 읽기 모의 · 회차 시계 주입 · 잠금 쥔 다른 연결 · 표 잠금으로 막힌 질의 10초 시간 초과 · 62 읽기 중 PG 세션 끊김) · 변이 = 판정 · 회차 · 화면 20 + 1R 고침 4 + 2R 고침 5 + 3R 고침 5 + 4R 고침 2 = 36 전부 빨간불.
- 화면 실물 = 미검증(잔액 글은 62 반영 + 기록 일꾼 captured 가 있어야 보인다 = 원장 C147-S1 · 시트 §5 에서 본다).
- 전체 = 단위 833파일 13,633건 · 실 PG 100파일 914건(스탬프 기록) 통과.
