# C110 효과 증명 넓히기 + 겹치는 광고 우선순위 + 여정 대조군 결함 A ~ F — 설계서

> 순위 원장 = `status/ROADMAP.md` §1 · §2(1106 Harold 승인 순위) · 흐름 표 = [2026-11-06-effect-proof-flow-ledger.md](2026-11-06-effect-proof-flow-ledger.md)(1106 Harold 확인 「확인하고 설계진행」).
> 지시(1106 Harold) = 「결함까지 닫는 설계서 · 구조체크 닫힐 때까지 · Codex 설계 닫힐 때까지 · 구현 · Codex 구현 닫힐 때까지 · 보고」.
> 카드 = **C110** · DDL = `C110-DDL-1`(배포 원장 §1) · 운영 표본 = 0(대조군 켠 여정 0 · 유료 고객사 여정 미사용 · 1106 실측).
> 상태 표 = §0 맨 아래.

---

## §0 축 대조표(접수 전부 · 이 축이 없으면 그 접수가 닫히는가)

| # | 접수(원문 자리) | 닫는 축(이 설계서 절) | 없으면 |
|---|---|---|---|
| 1 | 로드맵 §1 만들 것 1 · 대조군을 모든 광고 발송으로 | §3 광고 관문 CT · §4 발송별 대조군 | 여정만 잰다 |
| 2 | §1 만들 것 2 · 전체 대조군 | §3 전체 대조군 · §5-2 | CRM 전체 효과 못 봄 |
| 3 | §1 만들 것 3 · 증분을 돈 · 건수로 · ROI 와 한 산식 | §2 효과 산식 CT | 숫자가 또 한 벌 |
| 4 | §1 만들 것 4 · 믿을 만한가 | §2-3 판정 | 표본 적어도 「효과 있음」 |
| 5 | §1 만들 것 5 · 한 줄 결과 + 리포트 반영 | §2-4 문장 · §6 성과 리포트 · PDF | 숫자만 흩어짐 |
| 6 | §1 만들 것 6 · 대조군 비율 추천 | §2-5 필요 인원 | 판단 이름 · 끝없이 기다림 |
| 7 | §2 만들 것 1 · 갈래 순위표 | §3-4 우선순위(약속 = D7 · 먼저 잡힌 높은 갈래 뒤 낮은 갈래 억제) | 먼저 나간 것이 이김 |
| 8 | §2 만들 것 2 · 겹침 창 | §3-4(나가는 날 KST 하루 · 피로도와 같은 창 기록) | |
| 9 | §2 만들 것 3 · 낮은 것의 처리 | §1 D7(뺌) | |
| 10 | §2 만들 것 4 · 미룬 · 뺀 기록과 이유 | §3-5 제외 원장 · §6 고객 이력 | 「왜 안 받았나」 모름 |
| 11 | §2 만들 것 5 · 켜는 법 | §6-1 설정 | |
| 12 | 흐름 표 결함 A · 발송군에 안 받은 고객 섞임 | §7 A | |
| 13 | 결함 B · 실행 행을 「명」으로 | §7 B | |
| 14 | 결함 C · 기간 끝 없음 | §7 C | |
| 15 | 결함 D · 같은 값 이름 셋 | §7 D | |
| 16 | 결함 E · 비율 읽기 실패 = 기록 없이 0 | §7 E | |
| 17 | 결함 F · 돈 · 믿을 만한가 없음 | §2 · §7 F | |
| 18 | 흐름 표 §5 · 플래너 · 대행 · DM · 직접 발송 서버 적재(`/direct-send/commit`)에 피로도 판정 없음 | §3 관문이 공용 판정이 되며 같이 닫힘(R69) | 회사가 켠 상한이 네 갈래에서 안 먹음 |

빠진 축 = 0. 흐름 표 §4 의 ③ CT-69 · ④ 블렌디드 ROAS · ⑤ 수신 고객 기여는 **이번 축 밖**(§10 추가 과제 · 숫자 정의가 다른 지표라 「한 산식」 대상이 아니다 · 그 판정 근거 = §2-1).

---

## §1 결정(Harold 가 바꿀 수 있는 기본값 · 바꾸면 이 절부터 고친다)

| # | 결정 | 이유 |
|---|---|---|
| D1 | 대조군 · 우선순위 · 피로도 = **광고(`is_ad`)만** | 로드맵 §1 「정보성에는 걸지 않는다」 · 판정 입력 = 발송마다 이미 있는 광고 판정 하나(흐름 표 §6) |
| D2 | 모두 **회사가 켤 때만**(기본 꺼짐) · 꺼진 회사 = 지금 그대로 | 운영 회사 동작 무변경 |
| D3 | 전체 대조군 = 회사 비율 1 ~ 10% · 번호마다 고정(md5 · 회사 · 시작 시각) · **비율을 바꾸면 새 비교 기간**(시작 시각 다시) | 로드맵 「배정은 그대로」 = 한 기간 안에서는 같은 사람 · 바꾸면 그 앞 기간과 섞지 않는다 |
| D4 | 발송별 대조군 = 회사 비율 1 ~ 30% · 그 발송의 대상 안에서 번호마다 고정(md5 · 발송 열쇠) · 여정은 여정 자기 비율(지금 그대로) | 대상이 같은 무리 안에서 나눠야 비교가 맞다(전체 대조군으로 캠페인을 재면 대상 고르기 치우침) |
| D5 | 효과 = **보내기로 한 고객 전부 vs 대조군**(받았는지로 거르지 않는다) | 받은 사람만 고르면 실패 · 수신 불가 번호가 빠져 치우친다(흐름 표 결함 A 재판정 · §7 A) |
| D6 | 측정 창 = 기준 시각부터 **7일**(자동 마케팅 ROI 와 같음) · 창이 닫힌 사람만 센다 | 한 산식 · 결함 C |
| D7 | 겹침 = 같은 나가는 날(KST)에 **더 높은 갈래 광고가 먼저 판정된** 번호를 낮은 갈래에서 **뺀다**(미룸 · 합침 없음). 이 기능의 약속 = 「먼저 잡힌 높은 갈래 뒤에 오는 낮은 갈래 억제」이지 「그날 가장 중요한 하나만」이 아니다(★ Codex 설계 3R #2 · 발송 순간의 관문은 앞으로 올 발송을 모른다 · 하루 후보를 마감해 고르는 선발기 = §10 추가 과제). 계약: ① 「먼저」 = **판정(예약) 순서**(회사 · 날 잠금이 줄 세운 순서 · 확정 순서가 아니다 · 3R #1) ② 높은 갈래는 낮은 갈래에 막히지 않는다(낮은 것이 먼저 판정됐으면 둘 다 간다 · 횟수는 피로도 상한) ③ 확정된 예약은 그날 끝까지 산다 · 판정 뒤 확정 전 예약은 2시간 산다(그 사이 버려진 높은 갈래 때문에 낮은 갈래가 빠질 수 있다 = 덜 보내는 쪽) ④ **예외** = 높은 갈래가 판정 뒤 2시간 넘게 확정되지 않은 채 있으면 그동안 판정된 낮은 갈래는 막히지 않는다(둘 다 나갈 수 있다 · 4R) · 정상 경로의 판정 → 확정 간격 = 초 단위(확정 직전 판정 · §3-4) |
| D8 | 기본 순서(켤 때 처음 값) = 여정 > 마케팅 플래너 > 대행 발송 > 자동 마케팅 > AI 캠페인 > DM 발송 > 직접 발송 · 회사가 위아래로 바꾼다 | 로드맵 §2 기본안 |
| D9 | 판단 = 두 무리 각각 30명 이상 + 구매율 차이 양쪽 검정 p < 0.05 일 때만 「효과 있음 · 없음」 · 아니면 「아직 판단 이름」 + 필요한 인원 | 로드맵 §1 만들 것 4 |
| D10 | 여정 대조군 고객 = 지금처럼 여정 전체에서 빠짐(알림톡 정보성 칸도 안 감) | 여정 대조군은 실행 단위로 이미 운영 계약 · 칸 단위로 바꾸면 비교군 정의가 바뀐다 · 정보성만 있는 여정 = 화면에서 대조군 칸을 잠근다(§6-4) |
| D11 | 발송별 대조군은 **그 발송 대상 × 비율 ≥ 30명**일 때만 뽑는다(아니면 그 발송은 대조군 없이 전원 · 원장 줄 없음 · 측정에서 빠짐) | 한두 명 보내는 광고가 통째로 대조군이 되는 일 0 · 30 = D9 판단 하한과 같은 수 |
| D12 | 직접 발송(동기) 손 입력 · 주소록 · 파일 수신자(고객 DB id 없음) = 대조군(전체 · 발송별)은 걸고 **우선순위 · 피로도는 지금처럼 면제** | 피로도 「사용자 명시 행동 면제」(2026-07-05 Harold 확정)는 그대로 · 대조군은 무리 전체에서 뽑아야 측정이 맞다(D5) |
| D13 | 회사가 피로도를 켰으면 이제 **서버 적재 확정 · 플래너 · 대행 · DM 에도 먹는다**(지금 이 넷은 판정이 없다 · §0 #18) | 회사가 켠 상한의 뜻 · 켠 회사 수는 배포 전 Harold 실측(§9 S1) |

---

## §2 효과 산식 CT(한 산식) — 새 `backend/src/utils/effect-measure.ts`

### §2-1 무엇을 하나로 모으나

로드맵 「자동 마케팅 ROI 와 한 산식」 = **수신자별 기준 시각 뒤 7일 구매**(`automarketing-roi.ts:40` `campaignRecipientOrders`). 규칙 = 몰 결제 확정 · 환불 표식 주문 통째로 뺌 · 같은 주문 한 번 · 매장 원장(환불 행 제외) · 몰과 같은 구매인 원장 행 뺌 · 번호로 고객 찾기.
- 이 SQL 을 **기준 시각이 사람마다 다른** 꼴로 일반화해 CT 로 옮긴다: `anchoredOrdersSql` = 입력 `(phone, at)` 쌍 · 창 일수 · 끝(선택) → `(phone, order_key, amount)`.
- `campaignRecipientOrders` 는 이 CT 를 부른다(모든 번호의 기준 = `c.sent_at` · `until` 그대로) → ROI · 담당자 성과 문자 · 하루 요약 · 밴딧이 **바뀐 줄 없이** 같은 숫자(PG 시험 `c102-structural-1104` · `two-door-purchase-1103` 이 지킨다 · 새 시험이 옛 SQL 결과와 대조).
- ③ CT-69(회사 전체 창) · ④ 블렌디드 ROAS(기간 회사 매출 ÷ 비용) · ⑤ 수신 고객 기여(몰만)는 **수신자 귀속이 아닌 다른 지표**라 이번에 묶지 않는다(§10). 같은 PDF 에 셋이 함께 나가는 것은 §6-3 에서 문구로 구분만 한다(「회사 전체 · 발송 뒤 창」 · 「기간 전체 매출 기준」 · 「여정 · DM 수신자 몰 구매」).

### §2-2 무리 집계

`measureGroups(companyId, anchors: {phone, at, group: 't' | 'c'}[], windowDays=7)` → 무리마다 `{ n, buyers, orders, revenue }`.
- n = 번호 수(같은 번호 두 번 = 한 명 · 결함 B) · buyers = 창 안 주문 1건 이상 번호 수 · revenue = 주문 금액 합.
- 창이 아직 안 닫힌 기준(`at > now − 7일`)은 호출부가 넣지 않는다(결함 C · 「측정 중 N명」으로 따로 센다).
- 번호 정규화 = `normalizePhone` CT 하나 · SQL 쪽 = `regexp_replace(…, '\D', '', 'g')`(지금 ROI 와 같음).

### §2-3 판정(순수 · `liftVerdict`)

입력 = 두 무리 `{n, buyers, revenue}`. 출력:
- `rateT = buyers/n` · `rateC` · `liftPp = (rateT − rateC) × 100`
- `incRevenue = (revenueT/nT − revenueC/nC) × nT`(늘어난 매출 ₩ · 반올림 원) · `incBuyers = (rateT − rateC) × nT`
- `pValue` = 2×2 표(무리 × 구매)의 **기대 빈도 네 칸 중 하나라도 5 미만이면 피셔 정확 검정(양쪽 · 로그 계승 합)** · 아니면 두 비율 양쪽 z 검정(합친 비율 · erf 근사) · ★ Codex 설계 1R #7(970명 중 3 · 30명 중 1 = z 0.0098 · 정확 0.115)
- `verdict` = `insufficient`(어느 쪽이든 n < 30 또는 합친 구매자 0) / `positive`(p < 0.05 · liftPp > 0) / `negative`(p < 0.05 · liftPp < 0) / `unclear`(그 밖)
- `limited` 표시(입력) = 그 기간 관문 장애가 있었다(§3-6) → verdict 를 `unclear` 로 내리고 문장 끝에 「이 기간 측정이 일부 막혀 판단을 보류합니다」

### §2-4 한 줄 문장(순수 · `liftSentence`)

| verdict | 문장 |
|---|---|
| positive | 받은 고객의 구매율이 대조군보다 {liftPp}%p 높았습니다. 늘어난 매출 약 {incRevenue}원 · 늘어난 구매 약 {incBuyers}건. |
| negative | 받은 고객의 구매율이 대조군보다 {−liftPp}%p 낮았습니다. 문구 · 대상 · 시간을 다시 볼 때입니다. |
| unclear | 아직 차이가 뚜렷하지 않습니다(구매율 {rateT}% · 대조군 {rateC}%). |
| insufficient | 아직 판단 이릅니다. 대조군 {nC}명 · 받은 고객 {nT}명 · 판단하려면 각각 {needed}명쯤 필요합니다. |

화면 · PDF · 여정 통계가 **이 함수 하나**의 문장을 그대로 그린다(R56).

### §2-5 필요 인원(순수 · `neededPerGroup`)

지금 보이는 두 구매율 그대로 차이를 가리려면 무리마다 몇 명 필요한가 = `ceil((1.96 + 0.84)² × (pT(1−pT) + pC(1−pC)) / (pT − pC)²)` · 차이 0 또는 두 비율 0 = `null`(「아직 구매가 없어 계산할 수 없습니다」). 실제 데이터만 쓴다(임의 상수 = 유의 5% · 검정력 80% 두 개 · 화면에 「판단 기준」으로 적는다).

---

## §3 광고 관문 CT — 새 `backend/src/utils/ad-send-gate.ts`(+ 순수 `ad-send-gate-core.ts`)

### §3-1 정책 읽기

`loadAdGatePolicy(companyId)` → `{ fatigueCap, globalHoldout: {pct, since} | null, campaignHoldoutPct: number, priority: AdBranch[] | null, ready: boolean }`.
- 피로도 = 지금 `getFatigueCap` 그대로(옛 칸만 읽는 따로 된 문장) · 새 칸은 **따로** 읽는다 → 새 칸이 없거나 읽기가 실패해도 피로도는 그대로 산다(★ Codex 설계 1R #4).
- `ready` = 새 스키마 전부(회사 네 칸 · `ad_send_marks` · `ad_gate_failures`)가 있는가 · `information_schema` 한 번 조회 · 프로세스 안 5분 기억 · 거짓이면 새 판정 셋을 끄고 `console.warn`(「C110-DDL-1 전 · 피로도만」 · 5분에 한 줄)(꺼짐도 로그 · R7).
- 설정 저장(§6-1)도 같은 `ready` 를 본다 · 거짓 = 503 `DB_MIGRATION_PENDING`(켜 놓고 판정은 꺼진 상태가 생기지 않게).

### §3-2 갈래

`AdBranch = 'journey' | 'planner' | 'agency' | 'automarketing' | 'ai' | 'dm' | 'direct'` · 이름 표 = `ad-send-gate-core.ts` 한 곳(화면 사본 = `frontend/src/utils/ad-branch.ts` · 대조 시험). 순위 = 회사 `send_priority_order` 안의 자리(판정 때 계산 · 원장에는 갈래 이름을 적는다 = 순서를 바꿔도 옛 줄 뜻이 안 바뀐다).

### §3-3 판정(`gatePhones` · `gateStaging` · 한 트랜잭션)

입력 = 회사 · 정책 · `{ branch, sendDay(KST) | span, holdoutKey | null, batchId, phones 또는 stagingId, eligibility }`. 순서(번호마다 처음 걸리는 이유 하나):
0. **적격**(측정 무리를 정하는 입구 · ★ Codex 설계 1R #5) — 적재 표 경로는 `countStagingFiltered` 와 같은 거름(중복 = 번호당 한 줄 · 광고면 수신거부 · `effectiveUnsubFilter` · 같은 사용자)을 **먼저** 적용한 번호 집합에서만 아래를 판정한다(거름에 걸린 번호는 관문이 보지도 적지도 않는다 · 워커가 지금처럼 지운다). 배열 경로는 호출부가 이미 거른 목록을 넘긴다(지금 피로도 자리와 같다).
1. `global_holdout` — 전체 대조군 · `md5(소금 || ':' || phone)` 앞 8자리 32비트 mod 10000 < pct × 100 · 소금 = SQL 이 `companies` 행에서 직접(`id::text || ':' || to_char(global_holdout_since AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS')`).
2. `priority` — 우선순위 켜짐 · 같은 회사 · 번호 · 나가는 날에 **회사 순서상 더 높은 갈래의 살아 있는 예약**(§3-4)이 있음.
3. `fatigue` — 피로도 켜짐 · 지금 `getFatigueBlockedSet` 과 같은 창 · 같은 합(같은 SQL 조각을 CT 로 빼서 둘이 함께 쓴다 · 두 벌 금지).
4. `campaign_holdout` · `campaign_treated` — **맨 마지막**에, 1 ~ 3 을 다 지난 번호 집합에서 뽑는다(대조군 · 받는 무리가 같은 무리에서 나뉜다 · ★ 1R #5) · holdoutKey 있음 · 발송별 비율 켜짐 · 남은 번호 수 × pct ≥ 3000(30명 · D11)일 때만 · `md5(holdoutKey || ':' || phone)` < pct × 100 = `campaign_holdout`(빠짐) · 나머지 전부 = `campaign_treated`(받는 무리도 원장에 적는다 · 측정 t = 이 줄 · 큐 결과와 무관 = ITT).
   **추첨은 묶음당 한 번**(★ 2R #4 · 구현 1R #6 = 지금 비율을 꺼도 이미 뽑힌 배정은 지킨다 · 그 묶음에 배정이 있으면 새 판정이 다 꺼져 있어도 전체 판정으로 간다): 그 batch 에 발송별 표시 줄이 하나라도 있으면 다시 뽑지 않는다 → 이미 `campaign_holdout` 인 번호 = 다시 들어와도 늘 뺀다 · 이미 `campaign_treated` = 늘 보낸다 · 표시 없는 번호(첫 추첨 뒤 새로 들어온 행) = 보내되 원장에 적지 않는다(측정 무리 밖 · 첫 추첨 무리를 그대로 지킨다) · D11 · 비율은 첫 추첨 때만 본다 · 한 번호 두 무리 = 부분 유일 색인으로 막는다(§9).
- `exemptPhones`(D12) = 2 · 3 만 건너뛴다(1 · 4 는 건다).
- 대조군 해시 = SQL 하나(`holdoutBucketSql`)로만 · 배열 경로도 `unnest` 로 같은 SQL.
- `gateStaging` 세 꼴: `dry`(세기만 · 지우지도 적지도 예약하지도 않음 · /count) · `load`(걸린 행을 `campaign_send_staging` 에서 지우고 같은 트랜잭션에 원장 적재 · **예약 안 함** · 한줄로 적재) · `commit`(load 와 같고 + 통과 번호 예약 · 건수 확정 직전 모든 적재 경로). 같은 적재에 load 뒤 commit = 같은 batch · 이미 지운 번호는 없고 원장 줄은 그대로(유일 색인) · 발송별 대조군은 commit 때 남은 수로 D11 을 다시 보지만 load 때 뽑은 줄은 남는다.
- **잠금**: 우선순위가 켜진 회사는 판정 트랜잭션 처음에 span 의 날마다 **날짜 오름차순으로** `pg_advisory_xact_lock(hashtextextended('adgate:' || company_id || ':' || 날, 0))` → 같은 회사 · 같은 날 판정이 줄을 선다 · 판정과 예약이 같은 트랜잭션(★ 1R #2 · 2R #2). 판정 연결 하나 · 한 트랜잭션 · 그 안에서 다른 연결을 기다리지 않는다(R41). 꺼진 회사 = 잠금 없음.
- **batch_id** = 적재 표 경로 = stagingId(확정 재시도 = 같은 묶음 · 앞 시도에서 지운 줄이 남아 연결된다) · AI 캠페인 = 캠페인 id · 직접 발송(동기) · 자동 캠페인 = 요청 · 회차마다 새 uuid · 여정 = 칸 · 회차마다 새 uuid. 같은 묶음 · 번호 · 종류 = 한 줄(유일 색인 · `ON CONFLICT DO NOTHING`).

### §3-4 우선순위 예약(판정 = 예약 한 자리 · 확정 표식으로만 산다 · ★ 1R #2 · 2R #1 ~ #3 구조 처방)

옛 설계 둘을 버린다: ① 피로도 기록 표에 큐 뒤 비트 덧쓰기(판정 · 기록 두 자리) ② 예약의 살아 있음을 캠페인 상태로 계산(공유 캠페인 · 부분 취소 · 회차를 따라가야 함). 둘 다 이음매를 늘렸다.
- 판정이 통과시킨 번호 = 같은 트랜잭션에 `ad_send_marks` 종류 `reserved` 를 **나가는 날마다**(span 의 날 전부 · 유일 키에 날짜 포함 §9) 적는다. 우선순위 켠 회사만.
- **살아 있는 예약 = 이어진 캠페인 행이 있다(= 확정 표식 · 차감 실패로 캠페인 행을 지우면 저절로 풀린다 · 구현 1R #3) 또는 만든 지 2시간 안**. 확정 표식은 그 발송이 실제로 나갈 길에 들어선 자리에서 채운다: 적재 표 경로 · 직접 동기 · 자동 캠페인 = §3-5 연결(캠페인 INSERT 뒤 · 차감 앞) · 여정 = **이번 회차 단위가 큐에 실린 뒤**(`journey-executor.ts` 새 적재 성공 뒤 · 옛 단위가 held · closed 로 돌아가는 갈래(`:1036`)에서는 채우지 않는다 → 2시간 뒤 저절로 죽음 · 2R #3).
- 확정 뒤 그 발송이 취소 · 실패해도 예약은 그날 끝까지 산다(D7 ②) · 캠페인 상태를 읽지 않는다.
- 연결 뒤 차감이 실패해 캠페인 행을 지우는 갈래 = 따로 되돌리지 않는다(이어진 행이 없으니 확정 아님 · 같은 묶음의 다음 시도가 다시 잇는다 = 연결 조건 「비었거나 이어진 캠페인 행이 없음」 · 구현 1R #3). 중화(failed)로 행이 남는 갈래 = 그날 끝까지 산다(D7 ③ · 덜 보내는 쪽 · ★ 1107 C113 = D10 · D11 로 대체: 나간 것 0 으로 끝난 시도 = 주인이 이어지지 않은 예약 해제 · 취소 = 바로 풀림 · 이어진 뒤 실패 = 그날 판정 유지).
- 판정 = 「같은 회사 · 번호 · 그날 · 살아 있는 예약(확정 또는 2시간 안 · **판정 때 이미 적힌 것**) 중 회사 순서상 더 높은 갈래」가 있으면 `priority`. 앞뒤는 예약 줄이 적힌 순서 = 잠금이 줄 세운 판정 순서 하나뿐이다 → 판정 순서와 확정 순서가 달라도, **높은 갈래가 판정 뒤 2시간 안에 확정되는 한** 결과가 같다(3R #1 · 확정 단계에서 다시 판정하지 않는다 · 확정은 예약의 수명만 늘린다). 2시간을 넘긴 확정 = D7 ④ 예외(낮은 갈래 판정 때 그 예약은 이미 죽어 있어 둘 다 나갈 수 있다 · 4R). 정상 경로는 판정이 확정 바로 앞이라(적재 표 경로 = 건수 확정 직전 commit 판정 · 배열 경로 = 캠페인 INSERT 직전 · 여정 = 적재 직전) 2시간 경계에 닿는 것은 그 사이 프로세스가 멈춘 경우뿐이다.

### §3-5 원장 `ad_send_marks` · 연결

한 줄 = 한 판정에서 한 번호에 붙은 표시: `global_holdout` · `priority` · `fatigue` · `campaign_holdout`(뺌) · `campaign_treated` · `reserved`(보냄).
- **연결은 차감 · 활성화 앞**(★ 1R #3): `createDirectSendCampaign` 에 `spec.adGateBatchId` 를 더하고, 캠페인 INSERT 바로 뒤 · 차감 앞에 `UPDATE ad_send_marks SET campaign_id = $캠페인 WHERE batch_id = $batch AND company_id = $회사 AND campaign_id IS NULL` · 실패 = ~~던짐 → 캠페인 롤백~~ → **★ 1107 Harold: 장애 줄(ad_gate_failures · branch link) + 경고 · 발송은 계속**(`linkAdMarksSafe` · 측정 = 그 기간 보류 · 그 발송의 예약은 확정 안 돼 2시간 뒤 사라짐 = 덜 막는 쪽). 측정 · 우선순위(부가 기능)의 실패가 발송(본 기능)을 막지 않는다. 배열 경로(직접 동기 · 자동 캠페인)도 캠페인 INSERT 바로 뒤 · 차감 · 큐 앞에 같은 함수 · 실패 = 그 경로의 지금 실패 갈래. AI 캠페인 = batch 가 캠페인 id 라 연결 0. 여정 = 칸 캠페인을 고른 자리(`journey-executor.ts:1024` `pick.campaignId`) 뒤 · 큐 적재 앞.
- 연결되지 않은 묶음 = 발송이 안 된 것 = 측정이 안 센다 · 우선순위는 2시간만 센다. 보존 = 400일 넘은 줄 · 연결 안 된 채 3일 넘은 줄을 보관 기한 CT(`retention-sweeper` RETENTION_RULES · 하루 한 번)가 지운다(★ 1107 C113 D16 정정 · 옛 「피로도 정리 워커」는 부르는 곳이 없었다).
- ★ 1107 C113 정정(D10 · D11 · D23): 연결 자리 = 차감 뒤 · 큐(나갈 수 있는 단계) 바로 앞 · 그 전에 끝난 시도 = 주인이 이어지지 않은 예약을 지운다 · 살아 있음 = 이어진 캠페인이 있고 취소 아님 · 또는 이어진 캠페인이 없는 줄의 2시간 · 예약 변경 · 수신자 삭제 = 예약이 캠페인을 따라감 · 관문은 피로도를 보지 않는다(원장 `fatigue` 줄 0 · 피로도 = 입구마다 HEAD 블록) · 관문 = 요금제 씀 + 새 기능 켬(또는 앞 배정)일 때만 · 설계서 = docs/2026-11-07-c113-structure-fix-design.md.
- 여정의 대조군 · 피로도 · 우선순위 건너뜀은 지금처럼 칸 기록(`journey_step_logs` skipped · 이유)이 진실 · 원장에는 `reserved` 만 쓴다(우선순위 판정용 · 두 벌 금지).

### §3-6 관문 장애(★ 1R #6 · 2R #5)

판정 SQL 이 실패하면 = ~~피로도는 옛 함수로 한 번 더~~ → ★ 1107 C113 D23: 피로도는 입구의 HEAD 블록이 이미 했다 · 관문은 새 기능 없이 통과 + `ad_gate_failures`(회사 · 갈래 · 시각 · 오류 앞 200자) 한 줄을 **발송을 계속하기 전에** 쓴다.
- 가용성 절충(3R 메모): 새 표만 망가지고 장애 줄도 못 쓰면 옛 발송 · 차감 경로가 멀쩡해도 그 발송이 멈춘다 · 「새 칸 없음(ready 거짓) = 피로도만으로 보낸다」와는 다른 갈래다(ready 는 칸 존재만 본다 · 쓰기 성공을 보장하지 않는다). 이 절충을 택한 이유 = 기록 없는 우회 발송이 효과 측정을 조용히 오염시키는 것보다 멈춤이 보이는 쪽이 낫다.
- 장애 줄 쓰기까지 실패 = **그 발송을 멈춘다**(던짐 → 그 경로의 지금 실패 갈래 · 차감 앞이라 돈 0). 같은 PG 가 차감 · 캠페인 INSERT 도 하므로 장애 줄을 못 쓰는 상태에서 발송만 성공하는 길을 닫는다 = 「기록되지 않은 우회 발송」 0.
- 측정(§5)은 기간 안에 이 회사 장애 줄이 있으면 `limited` 로 판정을 보류한다(전체 대조군 · 그날의 발송별).

---

## §4 경로별 적용(전 경로 영향표 · 6원칙 ④)

뽑은 명령 = `grep -rn "getFatigueBlockedSet(\|createDirectSendCampaign(\|recordFatigueSends(\|buildSendableStagingInsertSql(" backend/src`(시험 제외). 계약 시험 R69 가 같은 grep 으로 지킨다(§8).

| 갈래 | 판정 자리(지금 → 바꿈) | holdoutKey · batch | 연결(차감 앞) |
|---|---|---|---|
| ai · AI 캠페인 발송 | `routes/campaigns.ts:997` 피로도 → `gatePhones`(같은 나가는 날) | 캠페인 id | 연결 0(batch = 캠페인 id) |
| direct · 직접 발송(동기) | `routes/campaigns.ts:2445` 피로도(고객 DB 행만) → `gatePhones`(전 행 · id 없는 행 = `exemptPhones` · D12) · 광고일 때만(지금처럼 `adEnabled === true`) · 갈래 = `branchOfDirect(sendType)`(`'operator'` = `'ai'` · 그 밖 = `'direct'`) | 요청마다 새 uuid | 캠페인 INSERT 바로 뒤 · 차감 · 큐 앞 |
| direct · 직접 발송(서버 적재 확정) | `routes/campaigns.ts:2101` 앞 **없음** → `gateStaging` · 건수 · 서명 대조보다 앞 · 갈래 = `branchOfDirect(sendType)` | stagingId | `createDirectSendCampaign` 안(spec.adGateBatchId) |
| direct · 직접 발송 건수 미리보기 | `routes/campaigns.ts:1899` `/direct-send/count` → `gateStaging(dryRun)` 결과를 응답에 더함(지우지 · 적지 · 예약하지 않음) | stagingId | — |
| ai · AI 한줄로 서버 적재(화면 `AiLinePage.tsx:1058` 이 확정 때 `sendType: 'operator'`) | `routes/ai.ts:1176 ~ 1187` 적재 · 개별 회신 제외 뒤 · 서명 전 → `gateStaging`(갈래 = `'ai'` = 확정 때 `branchOfDirect('operator')` 와 같은 값) | stagingId | 확정 때 |
| automarketing · 자동 캠페인 | `auto-campaign-worker.ts:818` 피로도 → `gatePhones` | 회차마다 새 uuid | `:927` INSERT 바로 뒤 · 차감 · 큐 앞 |
| automarketing · 연속 운영자(1차 · 리마인드 둘 다) | `continuous-operator.ts:3665` 적재 SQL 안 피로도(그대로) + 개별 회신 제외(`:3687`) 뒤 · 상한 · 예산 검사(`:3703`) 앞 `gateStaging` · `recipientTotal` 에서 뺌 · 0 이면 개별 회신 전원 제외와 같은 「발송 보류」 갈래(이유 = 「대조군 · 우선순위 · 피로도로 전원 제외」) | stagingId | `createDirectSendCampaign` 안 |
| planner · 마케팅 플래너 | `planner-executor.ts:453` 적재 뒤 **없음** → `gateStaging` · total 에서 뺌 · 전원 빠지면 지금의 「대상 0」 갈래 | stagingId | `createDirectSendCampaign` 안 |
| agency · 대행 발송 | `agency-send-worker.ts:1266` 앞 **없음** → `gateStaging` | stagingId | `createDirectSendCampaign` 안 |
| dm · DM 발송 | `routes/dm.ts:1489` 앞 **없음** → `gateStaging` | stagingId | `createDirectSendCampaign` 안 |
| journey · 여정 광고 칸 | `journey-executor.ts:778` 피로도 → `gatePhones`(holdoutKey 없음 = 발송별 대조군 안 걸림 · 여정 자기 대조군은 진입 때) · 건너뜀 분기를 **수신거부 판정(`:802`) 바로 뒤 · 요금제 · 라인 · 운영 크레딧 예약(`:808 ~ 812`) 앞**으로 옮긴다(★ 1R #1 · 지금 피로도 건너뜀도 크레딧 예약 뒤라 같은 뿌리 · 함께 옮김) · 사유 `global_holdout` · `priority_lower` · `fatigue_capped`(그대로) · 칸 전원이 빠지면 크레딧 예약 0 · 실행은 지금 피로도 건너뜀처럼 다음 칸으로 | 칸 · 회차마다 새 uuid | `:1024` 칸 캠페인을 고른 뒤 · 큐 적재 앞 |

**차감 앞**: 모든 자리가 건수 확정 · 차감 앞이다(환불 배관 0). 서버 적재 확정은 **서명 대조 앞**에서 지우고, 같은 적재를 미리 지운 한줄로 적재(ai.ts)와 결과가 같으면 서명이 맞는다 · 그 사이 다른 발송이 우선순위 · 피로도를 바꿨으면 서명이 달라 지금처럼 409 「다시 확인」(보여 준 명단 = 나가는 명단 · R5).
**알림**: 플래너 완료 알림(`planner-executor.ts:559`) · 대행 완료 안내 · 직접 · DM 응답에 「대조군 · 우선순위 · 피로도로 N명 뺐습니다」 한 줄(빠진 수 0 = 문장 없음). 대행 안내 자리는 구현 때 소스에서 확정(빈칸이면 설계서에 한 줄 더함).

---

## §5 측정(무엇을 누구와 비교하나)

| 측정 | 보내기로 한 무리(t) | 대조군(c) | 기준 시각 |
|---|---|---|---|
| 발송별 | 원장 `campaign_id = 그 캠페인 · kind = campaign_treated`(관문을 다 지나 발송별 대조군 추첨에 들어간 번호 중 받는 쪽 · 큐 적재 실패 · 대행 정제도 그대로 t · ITT · ★ 1R #5) | 같은 캠페인 `kind = campaign_holdout` | 캠페인 `sent_at`(없으면 = 아직 안 나감 = 측정 안 함) |
| 전체 대조군 | 회사 고객(`is_active = true` · 번호 숫자 있음 · **번호 기준 중복 뺌**) 중 전체 대조군이 아닌 번호 | 같은 해시로 대조군인 번호 | 비교 기간 시작(`global_holdout_since`) · 창 = 시작부터 지금까지(「기간 누적」이라고 화면에 적는다) · 그 기간 관문 장애 줄 있음 = `limited`(§3-6) |
| 여정 | 여정에 처음 들어온 실행이 대조군이 아닌 고객 | 처음 실행이 `holdout` 인 고객 | 그 고객의 첫 진입 시각 · 7일 · 창 닫힌 사람만 |

전체 대조군 효과 = 「CRM 전체가 만든 매출」 = `liftVerdict` 의 `incRevenue`. 발송별 = 최근 90일 · 대조군이 있는 캠페인만 · 최근 것부터 30개(넘으면 화면에 「최근 30개」) · 큐를 읽지 않는다(원장만).

---

## §6 화면

1. **설정(`frontend/src/pages/Settings.tsx` 피로도 묶음 아래)** — 「효과 측정 대조군」: 전체 대조군 켜기 + 비율(1 · 3 · 5 · 10 · 숫자 1 ~ 10) · 「비율을 바꾸면 새 비교 기간이 시작됩니다」 · 발송별 대조군 켜기 + 비율(5 · 10 · 20 · 숫자 1 ~ 30) · 「광고 발송마다 대상의 N%는 보내지 않고 비교해요」. 「겹치는 광고 우선순위」: 켜기 + 일곱 갈래 순서(위 · 아래 단추) · 「같은 날 더 높은 갈래 광고가 먼저 잡힌 고객은 낮은 갈래 광고에서 뺍니다 · 낮은 갈래가 먼저 잡혔거나 앞 발송의 확정이 크게 늦어지면 둘 다 나갈 수 있어요(하루 횟수는 피로도 상한으로)」. 저장 = 지금 회사 설정 저장(`routes/companies.ts:232 ~ 300`)에 칸 추가 · 칸 없음(42703) = 503 `DB_MIGRATION_PENDING`.
2. **성과 리포트(`PerformancePage.tsx` 자동 마케팅 ROI 카드 곁)** — 「효과 증명」 카드: 전체 대조군 한 줄 문장 + 숫자 칸(늘어난 매출 · 구매율 둘 · 대조군 인원) · 발송별 목록(캠페인명 · 날짜 · 문장 · 판정 띠 · 대조군 · 우선순위 · 피로도로 뺀 수) · 빈 상태 = 「설정에서 대조군을 켜면 다음 광고부터 효과를 잽니다」 + 설정 링크. 새 주소 `GET /api/ai/operator/performance/effect-proof?days=` (`routes/ai.ts` ROI 주소 곁 · 같은 문 · 같은 오류 처리).
3. **PDF(`performance-pdf-render.ts`)** — 「효과 증명」 절(같은 문장 함수 · 전체 대조군 + 발송별 상위 5) · 옛 세 절 제목에 기준을 적는다(③ 「캠페인 발송 후 기여(회사 전체 구매)」 · ④ 「추정 매출(기간 전체 매출 기준)」 · ⑤ 「수신 고객 기준 기여(여정·DM · 몰 구매)」).
4. **여정 통계(`JourneyStatsPage.tsx:184 ~ 211`)** — 제목 「대조군 비교」 · 칸 「보내기로 한 고객」 · 「대조군(보내지 않음)」 · 「늘어난 매출」 · 단위 「명」= 고객 수 · 문장 = §2-4 · 「진입 7일이 지난 고객만 셉니다 · 측정 중 N명」. 시작 카드(`JourneyStartCard.tsx:296`) = 광고 칸이 하나도 없는 여정이면 대조군 칸 잠금 + 「알림톡만 있는 여정은 대조군을 두지 않습니다」.
5. **이름 하나 「대조군」(결함 D)** — `JourneysPage.tsx:1750` 뱃지 · title · `customer-timeline.ts:700` 「비교군」 · `journey-stats.ts` 문구.
6. **고객 이력(`customer-timeline.ts`)** — 원장의 빠짐 종류(`global_holdout` · `campaign_holdout` · `priority` · `fatigue` · 캠페인에 연결된 줄만) 를 사건으로(`campaign_treated` · `reserved` 는 안 그림): 「광고 제외 · 대조군(전체)」 · 「광고 제외 · 대조군(이 발송)」 · 「광고 제외 · 같은 날 더 높은 순위 광고」 · 「광고 제외 · 피로도 상한」 + 캠페인명 · 날짜. 여정 skip 사유 `global_holdout` · `priority_lower` 도 같은 말.

디자인 하한 = `LESSONS_FRONTEND` 디자인 최소 기준(기존 화면 안 묶음이라 그 화면의 틀 · native dialog 0 · 모델명 0 · 내부 이름(CT · DDL · md5) 0).

---

## §7 결함 A ~ F 처방(흐름 표 §3)

| 결함 | 판정 | 처방 | 뿌리 | 계약 시험 |
|---|---|---|---|---|
| A 발송군에 안 받은 고객 | **재판정 = 비교 방식은 맞다**(보내기로 한 무리 전체 vs 대조군 · 받은 사람만 고르면 치우침) · 틀린 것은 이름 「발송군」 | 이름 「보내기로 한 고객」 + 설명 한 줄 · 산식 = §5 여정 | R56 | `c110-contract` 「여정 비교 칸 문구 = 문장 CT 출력」 |
| B 실행 행을 「명」 | 결함 | 고객 단위(처음 실행이 무리를 정함) · §5 | R1 | PG 시험: 같은 고객 재진입 2회 = 1명 |
| C 기간 끝 없음 | 결함 | 7일 창 · 창 닫힌 사람만 · 측정 중 따로 | R1 | PG 시험: 6일 전 진입 = 측정 중 · 8일 전 진입 8일째 구매 = 안 셈 |
| D 이름 셋 | 결함 | 「대조군」 하나 | R56 | 계약: frontend · backend 문자열에 「홀드아웃」 · 「비교군」 0(주석 제외) |
| E 비율 읽기 실패 = 조용히 0 | 결함 | `getJourneyHoldoutPct` catch 에 `console.warn`(여정 · 오류) · 0 유지(덜 재는 쪽) | R7 | 계약: catch 블록에 warn |
| F 돈 · 믿을 만한가 없음 | 결함 | §2 판정 · 문장 · 필요 인원 | R1 | 단위 시험 `effect-measure` |

같은 뿌리 전수:
- **R69(새 뿌리) · 광고 관문을 경로마다 손으로 건다** — 공용 발송 입구(`createDirectSendCampaign`)를 지나는 갈래 넷에 피로도가 빠졌다. 처방 = 관문 CT 하나 · 계약 시험이 `createDirectSendCampaign(` 를 부르는 모든 파일과 `getFatigueBlockedSet(` 를 부르던 모든 파일에 `gatePhones(` 또는 `gateStaging(` 이 있는지 · `createDirectSendCampaign(` 호출 spec 마다 `adGateBatchId` 가 있는지 소스에서 뽑아 본다(면제 = 정보성만 보내는 호출부 · 이유 한 줄 · `getFatigueBlockedSet` 은 관문 CT 안과 장애 되돌림 자리만).
- 같은 뿌리 R47(판정이 효과 자리에 없다) — 여정 건너뜀 분기가 운영 크레딧 예약 뒤에 있었다(지금 피로도도) → 수신거부 뒤 · 크레딧 앞(§4 journey 줄) · 계약 시험이 `firstOutcome` 안 분기 순서를 소스 위치로 본다.
- R1(두 벌) — 효과 산식: `campaignRecipientOrders` 가 새 CT 를 부르는지 · 여정 비교가 `purchasedSinceEntrySql` 을 더는 쓰지 않는지(목표 판정 · 기다리기 칸 · 지도는 「여정 목표 달성」이라 그대로 · 이유 = 효과 측정이 아니다).

---

## §8 시험

| 층 | 이름 | 볼 것 |
|---|---|---|
| 단위 | `effect-measure.test.ts` | liftVerdict 네 판정 경계(29 · 30명 · p 0.049 · 0.051) · 기대 빈도 5 미만 = 피셔(970/3 · 30/1 = p 0.115 → unclear) · limited = unclear · 늘어난 매출 반올림 · 필요 인원 null · 문장 다섯 개 |
| 단위 | `ad-send-gate-core.test.ts` | 갈래 이름 표 · 회사 순서로 순위 계산 · 이유 순서 · 정책 정규화(범위 밖 = 꺼짐) · `branchOfDirect` |
| 계약 | `c110-contract-1106.test.ts` | R69 소스 뽑기 · 화면 사본 갈래 표 = 서버 표 · 「홀드아웃 · 비교군」 0 · 여정 비교 문구 = CT · getJourneyHoldoutPct warn |
| 실 PG | `c110-effect-gate-1106.pg.test.ts`(C110-DDL-1 을 사본에 얹음) | 해시 고정(같은 번호 같은 판정 · since 바뀌면 다시 뽑힘) · 적격 먼저(중복 · 수신거부 번호는 원장에 0) · 발송별 대조군 = 다른 관문을 다 지난 번호에서만 · treated + holdout = 남은 번호 전부 · 30명 하한 · gateStaging 지움 + 원장 줄 · dryRun = 0 지움 · 0 줄 · 우선순위**동시 두 판정**(두 연결 · 높은 갈래가 잠금을 먼저 = 낮은 갈래 빠짐 · 낮은 갈래가 먼저 = 둘 다 통과 · 낮은 판정 → 높은 판정 → 높은 확정 → 낮은 확정 = 둘 다 통과 · 높은 판정 → 낮은 판정 → 낮은 확정 → 높은 확정 = 낮은 것 빠짐 · 높은 판정 뒤 2시간 1분에 낮은 판정(높은 쪽 미확정) = 둘 다 통과 · 높은 판정 뒤 1시간 59분 확정 → 2시간 1분에 낮은 판정 = 낮은 것 빠짐) · 여러 날 span = 날마다 예약 · 둘째 날 단일 발송도 막힘 · 확정 전 2시간 넘은 예약 = 안 막음 · 확정된 예약은 캠페인 cancelled 뒤에도 그날 막음 · 추첨 한 번(load 뒤 commit · 비율 바꿔도 같은 무리 · 다시 들어온 holdout 번호 = 다시 뺌) · 장애 줄 쓰기 실패 = 던짐 · 연결이 차감 앞(연결 실패 = 캠페인 롤백 갈래) · 피로도 = 옛 getFatigueBlockedSet 과 같은 집합 · 새 칸 없음 = 피로도만 · 판정 오류 = 옛 피로도 + ad_gate_failures 줄 · `anchoredOrdersSql` 이 옛 `campaignRecipientOrders` SQL 과 같은 주문 맵(몰 · 원장 · 환불 · 중복) · 여정 비교 B · C |
| 기존 | 백엔드 vitest 전체 · test:pg 전체 · tsc 두 쪽 | 회귀 |

변이 확인 = 관문 호출 한 곳을 지운 사본으로 R69 계약이 빨간불(파일 복사 방식 · 메모리 `feedback_mutation_check_by_file_copy_not_git`).

---

## §9 DDL · 배포 순서 · 되돌리기

`C110-DDL-1`(배포 앞 · 추가만 · 한 트랜잭션 = 다 되거나 하나도 안 됨(★ 1R #4) · 옛 코드는 새 칸 · 새 표를 읽지도 쓰지도 않는다):

```sql
BEGIN;
SET LOCAL lock_timeout = '3s';
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS global_holdout_pct smallint CHECK (global_holdout_pct BETWEEN 1 AND 10),
  ADD COLUMN IF NOT EXISTS global_holdout_since timestamptz,
  ADD COLUMN IF NOT EXISTS campaign_holdout_pct smallint CHECK (campaign_holdout_pct BETWEEN 1 AND 30),
  ADD COLUMN IF NOT EXISTS send_priority_order text[];
CREATE TABLE IF NOT EXISTS ad_send_marks (
  id          bigserial PRIMARY KEY,
  company_id  uuid        NOT NULL,
  batch_id    uuid        NOT NULL,
  campaign_id uuid,
  branch      varchar(20) NOT NULL,
  kind        varchar(20) NOT NULL CHECK (kind IN ('global_holdout', 'priority', 'fatigue', 'campaign_holdout', 'campaign_treated', 'reserved')),
  phone       varchar(20) NOT NULL,
  send_day    date        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ad_send_marks_batch_phone_kind_day ON ad_send_marks (batch_id, phone, kind, send_day);
CREATE UNIQUE INDEX IF NOT EXISTS ad_send_marks_arm ON ad_send_marks (batch_id, phone) WHERE kind IN ('campaign_holdout', 'campaign_treated');
CREATE INDEX IF NOT EXISTS ad_send_marks_campaign ON ad_send_marks (campaign_id, kind) WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ad_send_marks_reserved ON ad_send_marks (company_id, phone, send_day) WHERE kind = 'reserved';
CREATE INDEX IF NOT EXISTS ad_send_marks_phone ON ad_send_marks (company_id, phone, created_at);
CREATE TABLE IF NOT EXISTS ad_gate_failures (
  id         bigserial PRIMARY KEY,
  company_id uuid        NOT NULL,
  branch     varchar(20) NOT NULL,
  error      varchar(200),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ad_gate_failures_company ON ad_gate_failures (company_id, created_at);
COMMIT;
```

배포 전 실측 `C110-S1`(Harold 실행 · D13 영향 회사 수):

```sql
SELECT COUNT(*) FILTER (WHERE fatigue_cap_days IS NOT NULL AND fatigue_cap_max IS NOT NULL) AS fatigue_on, COUNT(*) AS companies FROM companies;
```

실측 1건 · 직원 시트 준비 `C110-S2`(시험 회사에 광고 받을 수 있는 합성 번호 고객이 200명 이상인가):

```sql
SELECT COUNT(DISTINCT regexp_replace(phone, 'D', '', 'g')) AS phones FROM customers WHERE company_id = 'c7c97996-19b3-4e4f-9c45-ce10deab257f' AND is_active = true AND COALESCE(phone, '') <> '';
```

순서 = DDL → 코드 배포(코드는 DDL 이 없어도 피로도만 · 새 판정 꺼짐 + warn · 설정 저장 503 · 측정 주소 빈 결과). 되돌리기 = 코드를 내린 뒤에만 `DROP TABLE ad_gate_failures; DROP TABLE ad_send_marks; ALTER TABLE companies DROP COLUMN global_holdout_pct, DROP COLUMN global_holdout_since, DROP COLUMN campaign_holdout_pct, DROP COLUMN send_priority_order;`.
실측 1건(6원칙 ⑤ · ★ 1R #8) = 인비토 시험 회사(c7c97996 · 도달 불가 합성 번호 · S2 로 200명 확인)에서 발송별 대조군 20% 켜고 직접 발송 200명(기대 대조군 40명 ≥ 30 = D11 통과) → 원장 `campaign_holdout` N · `campaign_treated` 200 − N · 큐 적재 수 = 200 − N · 차감 = 적재 수 × 단가(§11 시트 3 · 4).

---

## §10 범위 밖(추가 과제 · 기록만)

1. ③ CT-69 · ④ 블렌디드 ROAS · ⑤ 수신 고객 기여 — 이름 · 기준 문구만 이번에 붙임 · 정의를 하나로 줄일지는 따로.
2. 겹친 낮은 광고를 **미루기 · 합치기**(D7 은 뺌만) · 그리고 **하루 후보 마감 선발기**(갈래마다 그날 후보를 마감 시각까지 모아 회사 순서로 하나만 고름 = 「그날 가장 중요한 하나만」 · 발송 경로 전체를 마감 · 선발 뒤 보냄으로 바꾸는 큰 일 · 3R #2).
3. 설정 화면의 대조군 비율 **자동 추천**(과거 발송의 구매율로 미리 계산) — 이번 = 결과 화면의 필요 인원까지.
4. 플래너 · 대행 승인 화면에서 「승인 뒤 관문으로 빠질 수 있음」 미리 알림.

---

## §11 직원 지시문(구현 전 · DEFECT-PLAYBOOK §3 · 엑셀 시트 C110-S1)

| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 테스트계정(인비토 시험 회사)으로 로그인 → 설정 → 「효과 측정 대조군」 | 「전체 대조군」 · 「발송별 대조군」 켜기 두 개가 꺼져 있다 |
| 2 | 「발송별 대조군」을 켜고 20 을 누른 뒤 저장 | 「저장되었습니다」 · 다시 들어와도 20 |
| 3 | 직접 발송 → 고객 목록에서 「전체 선택」(200명 이상) 중 200명 → 광고 켬 → 보내기 | 완료 안내에 「대조군으로 N명 뺐습니다」 · N 은 25 ~ 55 사이 |
| 4 | 발송 결과 → 3번 발송 | 보낸 수 = 200 − N · 잔액이 (200 − N)건 값만큼 줄었다 |
| 5 | 「겹치는 광고 우선순위」 켜기 · 저장 | 일곱 갈래 순서가 여정 · 마케팅 플래너 · 대행 발송 · 자동 마케팅 · AI 캠페인 · DM 발송 · 직접 발송 |
| 6 | 순서에서 「직접 발송」을 맨 위로 올리고 저장 | 맨 위가 직접 발송 |
| 7 | 고객 관리 → 3번 200명 중 아무 5명의 이력을 하나씩 연다 | 5명 모두 「광고 제외 · 대조군(이 발송)」 줄 또는 3번 발송을 받은 줄 중 하나가 있다 · 둘 다 없는 사람 0 |
| 8 | 성과 리포트 → 「효과 증명」 | 3번 발송 줄 · 「아직 판단 이릅니다」 문장 |
| 9 | 여정 → 아무 여정 → 통계 | 「홀드아웃」 · 「비교군」 글자가 없다 · 대조군이 있는 여정이면 「대조군 비교」 |
| 10 | 설정 → 두 대조군 · 우선순위 끄고 저장 | 셋 다 꺼짐 |

---

## §12 구조체크 기록

**1회차(1106 · 이음매를 소스와 대조)** — 결함 9 · 전부 설계서에 반영:
1. 적재 표 경로가 확정을 다시 시도하면 앞 시도에서 지운 대조군이 원장에 다시 안 남아 캠페인 대조군에서 빠진다 → batch = stagingId(§3-3).
2. 직접 발송(동기) 손 입력 수신자 = 피로도 면제 정책과 대조군 측정이 부딪힘 → D12 · `exemptPhones`.
3. 처리기가 갈래를 모른다(`direct-send-processor.ts:356` `p` 에 없음) → spec.adBranch → send_config → 워커 `cfg` → `p.adBranch`(§4).
4. AI 한줄로 적재(ai.ts)와 확정(campaigns.ts commit)의 갈래가 다르면 우선순위 판정이 달라 서명이 늘 어긋난다 → 확정 때 `sendType: 'operator'`(AiLinePage.tsx:1058) = `'ai'` 로 둘을 맞춤.
5. 전체 대조군 소금 시각을 JS 가 글자로 만들면 SQL 쪽과 어긋날 수 있다 → SQL 이 칸에서 직접(§3-3).
6. 발송별 대조군이 한두 명짜리 광고를 통째로 빼는 일 → D11.
7. 연속 운영자 = 적재 SQL 안 피로도 뒤 수신자 수(`recipientTotal`)를 다시 세야 상한 · 예산 검사가 맞다 → 개별 회신 제외 뒤 · 상한 앞(§4).
8. 고객 표 같은 번호 여러 행(R55) → 전체 대조군 모집단 = 번호 기준 중복 뺌(§5).
9. 피로도가 네 갈래에 새로 먹는 것 = 회사 동작 변화 → D13 · 배포 전 S1.

**2회차(1106 · 1회차 처방이 만든 새 이음매)** — 결함 0:
- batch = stagingId 인데 같은 적재를 `/count`(dryRun)로 미리 세면 원장에 안 쓰므로 묶음이 섞이지 않는다 · 유일 색인(batch · 번호 · 이유)이 재시도 중복을 막는다.
- `exemptPhones` 는 우선순위 · 피로도만 건너뛴다 · 대조군 판정 순서(1 · 2)가 먼저라 면제 번호도 대조군이면 대조군으로 빠진다(D12 의도).
- `branchOfDirect` 는 `send-type-axis.ts` 와 같은 파일 묶음(CT)에 둔다 · 화면 갈래 표 사본은 대조 시험(§8).

**3회차(1106 · Codex 설계 1R 8건 수용 · 같은 뿌리 묶음)**:
- 돈 순서(#1 여정 건너뜀이 크레딧 예약 뒤 · #3 연결이 차감 뒤) = 「판정 · 연결이 효과(차감) 앞」 한 뿌리(R47) → 여정 분기 이동 · 연결을 createDirectSendCampaign 안 차감 앞으로.
- 두 진실(#2 우선순위 판정 ↔ 큐 뒤 기록) = 구조 처방: 판정 = 예약 한 트랜잭션 + 회사 · 날 잠금 · 예약의 살아 있음 = 캠페인 상태 하나 → **branch_mask 칸 · 처리기 갈래 배관 · recordFatigueSends 변경을 지웠다**(코드가 준다).
- 장애 갈래(#4 부분 DDL · #6 장애 기간 오염) = 「새 기능 장애가 옛 보호 · 측정을 오염시키지 않는다」 한 뿌리 → DDL 한 트랜잭션 · ready 판정 · 장애 때 옛 피로도 · 장애 원장 · limited.
- 측정 정의(#5 다른 거름 · #7 작은 표본 검정) = ITT 를 원장에서 직접(treated 도 적음 · 마지막에 추첨) · 피셔.
- 검증 시나리오(#8) = 200명 · 20%.

**4회차(1106 · 3회차 처방이 만든 이음매)** — 결함 0:
- 예약 잠금은 우선순위 켠 회사만 · 판정 트랜잭션 안 · 큐 적재 · 차감은 트랜잭션 밖(잠금이 차감을 기다리지 않는다 · R41 연결 재대기 없음 = 판정은 한 연결 한 트랜잭션).
- treated 줄은 발송별 대조군을 뽑은 발송에만 · 뽑지 않은 발송(D11 미달 · 꺼짐)은 treated 0 = 측정 대상 아님.
- 예약 「연결 전 2시간」 = 적재 표 경로의 확정은 화면 확인까지 길 수 있다 → 적재 때(ai.ts · count) 예약하지 않고 **확정 때만** 예약한다(dryRun · 한줄로 적재는 예약 0 · 확정 gateStaging 이 예약) · 그래서 2시간은 확정 → 연결 사이(초 단위)만 덮는다.

**5회차(1106 · Codex 설계 2R 5건 · 같은 부류 두 번째 = 멈추고 뿌리)**:
- 우선순위(#1 · #2 · #3)가 1R #2 에 이어 다시 나왔다. 왜 = 예약의 살아 있음을 캠페인 상태로 다시 계산해 회차 · 날짜 · 공유 캠페인 · 부분 취소를 따라가야 했다. 구조 처방 = 계약 둘(높은 갈래는 막히지 않음 · 확정된 예약은 그날 끝까지) + 살아 있음 = 확정 표식 하나 + 날마다 예약 · 날짜 오름차순 잠금 → 캠페인 상태 읽기가 설계에서 빠졌다(코드가 준다).
- 추첨 불변(#4) = 묶음당 한 번 · 표시 우선 · 두 무리 부분 유일 색인.
- 장애 기록(#5) = 장애 줄을 못 쓰면 발송을 멈춘다(차감 앞).

**6회차(1106 · 5회차 처방의 이음매)** — 결함 0:
- 연결 롤백(차감 실패)이 campaign_id 를 NULL 로 되돌려도 발송별 표시(treated · holdout)는 남는다 → 다음 확정 시도(같은 stagingId)가 다시 연결 · 추첨은 다시 안 함(묶음당 한 번).
- 여정은 발송별 대조군이 없어 추첨 줄 0 · reserved 만(날마다 = 여정은 즉시 발송이라 하루).

**7회차(1106 · Codex 설계 3R 2건 · 우선순위 세 번째)**:
- 왜 세 번째인가 = 「발송 순간 관문」으로 「그날 가장 중요한 하나만」을 약속했기 때문이다. 관문은 앞으로 올 발송을 모른다 → 그 약속은 이 구조로 지킬 수 없다. 처방 = 약속을 구조가 지킬 수 있는 만큼으로 정직하게 줄인다(D7 · 먼저 판정된 높은 갈래 뒤 낮은 갈래 억제 · 「먼저」 = 판정 순서) · 큰 약속(하루 선발기)은 §10 추가 과제로 이름 붙여 남긴다. 코드 · 장치는 늘지 않는다(확정 재판정 0).

**8회차(1106 · Codex 설계 4R 1건)** — 2시간 경계에서 확정 순서 독립이 깨지는 것을 D7 ④ 예외 · §3-4 단정 범위 · §6-1 문구 · §8 경계 두 시나리오로 명시(장치 0 · 정상 경로 간격 = 초).

**구현 Codex 1R(1106 · 7건 전부 수용 · 뿌리 넷)**:
- 관문 입력 ≠ 실제 발송 집합(R5) = 동기 경로 관문을 적격 거름(금액 조건 · 개별 회신 · 수신거부) 뒤 filteredRecipients 로 옮김 · 서버 적재 확정 · 미리보기 span = 분할 첫 ~ 마지막 차수(`directSendSpanOf` · send-time-util 한 곳) · 중복 제거를 끈 미리보기 = 뺀 행 수(`excludedRows`).
- 연결 실패 · 되돌림 = 살아 있음을 이어진 캠페인 행 존재로 · 되돌림 함수 `unlinkAdMarks` 삭제(코드가 준다) · 플래너 `AD_GATE_LINK_FAILED` = 확정적 미발송(표식 해제 · 환불 갈래).
- 첫 배정 불변 = 지금 비율과 무관하게 묶음 배정 먼저(`hasPriorArms`).
- 설정 저장 자리표시자 = 순수 함수 `buildAdGateSettingsUpdate` + 단위 시험.

**구현 Codex 2R(1106 · 3건 수용)** — span 이 같은 부류 두 번째: 왜 = 마지막 날이 최종 인원에 걸리고 최종 인원이 관문 뒤에 정해지는 순환. 처방 = 판정은 관문 전 인원의 span(넓거나 같다 = 덜 보내는 쪽) · 예약은 통과 인원으로 다시 계산한 span(`spanForCount`) · 첫 배정 조회 실패 = 장애 갈래(`needsFullJudge` · 장애 줄 · 피로도만) · 측정 줄은 중화(failed) 캠페인에서 재시도 캠페인으로 다시 잇고 예약 줄은 그날 끝까지 남긴다(연결 조건을 종류로 가름).

**구현 7R ~ 10R(1106 ~ 1107 · Harold 「미가입자는 관계가 없어야」)** — 원장 잇기 = 이번 판정이 원장 줄을 썼거나 그 묶음에 앞 시도 줄이 있을 때만(`marked`) → 대조군 · 우선순위를 안 쓰는 회사 = 잇기 UPDATE 0(그 실패가 발송을 멈추지 않음) · 장애 갈래도 앞 시도 원장은 잇는다(7R) · 원장 읽기 전 자리에 회사 조건(8R) · 계약 = 원장 별칭마다 회사 조건(9R) · 10R approve.

**구현 11R(1107 · Harold 「요금제 쓰는 회사도 발송은 나가야」)** — 잇기 실패 = 던지지 않음(`linkAdMarksSafe` 한 곳 · 장애 줄 + 경고 · 발송 계속) · 입구 다섯(공용 입구 · AI · 직접 동기 · 자동 캠페인 · 여정)이 이 함수만 부른다(계약) · 플래너 확정적 미발송 목록에서 AD_GATE_LINK_FAILED 제거(이제 던지지 않음).

## 상태

| 단계 | 상태 |
|---|---|
| 흐름 표 | 1106 Harold 확인 |
| 설계서 | 닫힘(구조체크 8회차 · Codex 5R approve) |
| 구조체크 | 1회차 9 → 2회차 0 → 3회차(1R) 8 → 4회차 0 → 5회차(2R) 5 → 6회차 0 → 7회차(3R) 2 |
| Codex 설계 | 1R 8건 → 2R 5건 → 3R 2건(약속 정정) → 4R 1건(경계 명시) → **5R approve(1106)** |
| 구현 · Codex 구현 | 구현 끝 · Codex 구현 11R approve(7R ~ 11R = Harold 지시 · 미가입 회사 잇기 0 · 잇기 실패 = 발송 계속) · vitest 771 / 11,740 · 실 PG 61 / 444 · tsc 0 · 0 · 변이 5 빨간불 · 미커밋 |
| DDL · 배포 · 직원 시트 | 대기(원장 C110-S1 · S2 · DDL-1 · H1 · S3) |
