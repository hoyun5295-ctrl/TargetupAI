# 에이전트 선불 충전·잔액 축 한줄로 흡수 — 설계 및 인수인계

> 작성 2026-07-24 (오전) · **다음 세션이 이 문서만 읽고 단독 재개 가능하도록 작성**
> 상태(0724 저녁): **§5-1 완결(원장 DDL+선불 지정·단가 UI) / §5-2 배포 완료 / §5-3 충전 실행 코드 완결(Codex 16R ship·배포 대기 — 신규 테이블 DDL + GRANT 선행) / 왕복 실측 통과(62 충전 연동 실가동) / §8 잔여 = 8-2·8-8 / 다음 = §5-3 배포 → §5-4 충전 요청 → §5-5 대조 워커 → 컷오버(최종 백필+143 종료 통지)**
> 이 문서가 이 트랙의 SoT다. 진행하면 여기에 갱신한다.

---

## 0. 이 문서 사용법 (다음 세션 진입 절차)

1. 이 문서를 **처음부터 끝까지** 읽는다. §2(실측 원문)를 건너뛰지 마라 — 모든 판단의 근거다.
2. §8(미확인)에 있는 항목은 **추측하지 말고** 명시된 검증 명령으로 확정한 뒤 진행한다.
3. §6(선행 관문)이 해소되지 않았으면 §5 구현을 시작해도 **동작하지 않는다**. 순서는 §7을 따른다.
4. 서버 명령은 전부 Harold님이 실행한다(AI는 SSH 금지). 명령은 복붙 가능한 형태로 제공한다.

---

## 1. 발단 — 서수란 팀장 접수

### 1-1. 티켓 「한줄로 단가 지정 관련 확인」 (2026-07-23 15:23, 고객사관리)

원문 3문항:

> **1.** 웹과 Agent를 함께 사용하는 업체 중 요금제 유형이 다를 경우에는 어떻게 지정을 해야 할까요?
> 웹에 대한 지정 부분이기 때문에 웹에 대한 내용으로 지정하면 상관이 없을까요(정산 반영은 어떻게 될지)?
> ex. 웹은 선불 Agent는 후불로 사용하는 경우(트렉스타)
>
> **2.** 사용자 계정 별 단가가 틀린 경우 단가 설정은 어떻게 해야할지요?
> ex. 런소프트의 경우 1, 2의 단가는 동일하나 3은 단가가 더 높습니다.
> 또한 선불 금액을 나눠서 관리하고 있는데.. 만약 이대로 사용하길 원한다면 관리자 계정으로 3개가 나가고 해당 custId를 나눠줘야 할 것 같은데요.
>
> **3.** 57번 선불 업체의 경우 잔액을 옮겨줘야 할까요?
> 추후 PAY 잔액 연동까지 완료되면 자동 이관이 되니 선불 전환만 하고 빼두면 될까요?

### 1-2. Harold 지시 (2026-07-24)

- 기존에는 **PAY에서 충전** → 그게 **게이트웨이에 반영**되는 구조였다.
- 한줄로에도 선/후불 로직이 있으니 **선불이면 게이트웨이로 충전이 가능해야 한다(당연한 것)**.
- **충전 요청 기능**도 넣어야 한다.
- 대시보드 "발송 현황" 안의 **잔액 현황(현재 선불 업체만 노출)을 에이전트 전용 업체에도** 넣어야 한다.
- **"이건 지난 내역이고 향후 추가될 업체에도 필요하다. 할 거면 제대로 구현해놔야 한다."**
  → **고정 목록 하드코딩 금지. 에이전트 회사면 자동 편입되는 일반 구조여야 한다.**

---

## 2. 서버 실측 전량 (명령 + 결과 원문)

> 전부 2026-07-24 오전에 Harold님이 직접 실행. 아래 결과는 **가공 없이 원문**이다.

### 2-1. 62 pay-ingest-db — `RSRM_FillAmtHist` 구조

```bash
docker exec -it pay-ingest-db mysql -uroot -p sales -e "SHOW COLUMNS FROM RSRM_FillAmtHist; SELECT COUNT(*) AS total FROM RSRM_FillAmtHist;"
```

```
Field   Type    Null    Key     Default Extra
SeqNo   int(11) NO      PRI     NULL    auto_increment
StoreId varchar(20)     YES
FillAmt float   YES             0
FillDtTm        datetime        YES             NULL
PayMethod       varchar(1)      YES             NULL
RsApplyFlag     varchar(1)      YES             NULL
RsApplyDtTm     datetime        YES             NULL
PayFkey varchar(10)     YES             NULL

total
7026
```

> ⚠ 최초에 `-i`(TTY 없음)로 안내해 **비밀번호가 화면에 에코됨**. 반드시 `-it`를 쓸 것.

### 2-2. 62 — 충전 집계 + 최근 5건

```bash
docker exec -it pay-ingest-db mysql -uroot -p sales -e "SELECT COUNT(*) total, SUM(RsApplyFlag='N') pending_N, SUM(RsApplyFlag='Y') applied_Y, MAX(FillDtTm) last_fill, MAX(RsApplyDtTm) last_apply FROM RSRM_FillAmtHist; SELECT SeqNo, StoreId, FillAmt, FillDtTm, RsApplyFlag, RsApplyDtTm FROM RSRM_FillAmtHist ORDER BY SeqNo DESC LIMIT 5;"
```

```
+-------+-----------+-----------+---------------------+---------------------+
| total | pending_N | applied_Y | last_fill           | last_apply          |
+-------+-----------+-----------+---------------------+---------------------+
|  7026 |         0 |      7016 | 2026-07-06 13:40:21 | 2026-07-06 13:41:01 |
+-------+-----------+-----------+---------------------+---------------------+
+-------+---------+---------+---------------------+-------------+---------------------+
| SeqNo | StoreId | FillAmt | FillDtTm            | RsApplyFlag | RsApplyDtTm         |
+-------+---------+---------+---------------------+-------------+---------------------+
|  7042 | D0079   | 5000000 | 2026-07-06 13:40:21 | Y           | 2026-07-06 13:41:01 |
|  7041 | D0078   | 2000000 | 2026-07-02 14:01:32 | Y           | 2026-07-02 14:02:01 |
|  7040 | D0078   | 2000000 | 2026-06-30 10:42:26 | Y           | 2026-06-30 10:43:00 |
|  7039 | B0082   | 1000000 | 2026-06-25 09:14:44 | Y           | 2026-06-25 09:15:01 |
|  7038 | D0078   | 2000000 | 2026-06-23 11:54:48 | Y           | 2026-06-23 11:55:00 |
+-------+---------+---------+---------------------+-------------+---------------------+
```

### 2-3. 143 (레거시 PAY 원본) — 같은 테이블 집계 ★전환 판정 근거

```bash
# 143 서버에서 실행 (mysql 계정 sales / 비번은 Harold 보유 — 문서 미기재)
mysql -h 127.0.0.1 -P 3388 -u sales -p sales -e "SELECT COUNT(*) total, MAX(FillDtTm) last_fill, MAX(RsApplyDtTm) last_apply, SUM(RsApplyFlag='N') pending_N FROM RSRM_FillAmtHist;"
```

```
+-------+---------------------+---------------------+-----------+
| total | last_fill           | last_apply          | pending_N |
+-------+---------------------+---------------------+-----------+
|  7036 | 2026-07-23 14:38:31 | 2026-07-23 14:39:11 |         0 |
+-------+---------------------+---------------------+-----------+
```

### 2-4. 축 대조 1차 — FillAmtHist.StoreId ↔ SalesStts.**CustId** (축 잘못 잡은 쿼리)

```bash
docker exec -it pay-ingest-db mysql -uroot -p sales -e "SELECT (SELECT COUNT(DISTINCT StoreId) FROM RSRM_FillAmtHist) fill_stores, (SELECT COUNT(DISTINCT CustId) FROM RSRM_SalesStts) stat_custs, (SELECT COUNT(*) FROM (SELECT DISTINCT StoreId s FROM RSRM_FillAmtHist) f JOIN (SELECT DISTINCT CustId c FROM RSRM_SalesStts) t ON f.s = t.c) matched;"
```

```
+-------------+------------+---------+
| fill_stores | stat_custs | matched |
+-------------+------------+---------+
|         206 |        234 |      70 |
+-------------+------------+---------+
```

### 2-5. 축 대조 2차 — FillAmtHist.StoreId ↔ SalesStts.**StoreId** (정정 쿼리)

```bash
docker exec -it pay-ingest-db mysql -uroot -p sales -e "SELECT (SELECT COUNT(DISTINCT StoreId) FROM RSRM_FillAmtHist) fill_stores, (SELECT COUNT(DISTINCT StoreId) FROM RSRM_SalesStts) stat_stores, (SELECT COUNT(*) FROM (SELECT DISTINCT StoreId s FROM RSRM_FillAmtHist) f JOIN (SELECT DISTINCT StoreId s FROM RSRM_SalesStts) t ON f.s=t.s) matched_store, (SELECT COUNT(*) FROM (SELECT DISTINCT CustId, StoreId FROM RSRM_SalesStts) x) cust_store_pairs, (SELECT COUNT(DISTINCT CustId) FROM RSRM_SalesStts) custs;"
```

```
+-------------+-------------+---------------+------------------+-------+
| fill_stores | stat_stores | matched_store | cust_store_pairs | custs |
+-------------+-------------+---------------+------------------+-------+
|         206 |      117841 |             1 |           118542 |   234 |
+-------------+-------------+---------------+------------------+-------+
```

### 2-6. 활성 충전 계정 (2025-01-01 이후) — 62 기준

```bash
docker exec -it pay-ingest-db mysql -uroot -p sales -e "SELECT StoreId, COUNT(*) cnt, ROUND(SUM(FillAmt)) total_amt, MAX(FillDtTm) last_fill FROM RSRM_FillAmtHist WHERE FillDtTm >= '2025-01-01' GROUP BY StoreId ORDER BY last_fill DESC;"
```

```
+---------+-----+-----------+---------------------+
| StoreId | cnt | total_amt | last_fill           |
+---------+-----+-----------+---------------------+
| D0079   | 121 | 464000000 | 2026-07-06 13:40:21 |
| D0078   |  94 | 260000000 | 2026-07-02 14:01:32 |
| B0082   |  72 | 100193026 | 2026-06-25 09:14:44 |
| C0112   |  17 |  41681410 | 2026-05-23 08:45:01 |
| C0109   |   3 |   -362069 | 2026-05-14 15:29:04 |
| C0108   |   3 |    -32723 | 2026-05-14 15:28:45 |
| C0107   |  28 |   8847063 | 2026-05-14 15:28:25 |
| C0106   |   3 |   1095302 | 2026-05-14 15:28:06 |
| C0089   |  12 |  32386997 | 2026-05-14 15:27:29 |
| B0023   |   1 |     20000 | 2026-04-07 09:39:14 |
| B0081   |  18 |   3500000 | 2026-04-03 11:06:26 |
| C0115   |  15 |  45600000 | 2026-03-14 15:02:22 |
| C0096   |   3 |    710000 | 2026-03-12 13:03:24 |
| C0085   |   6 |   7820000 | 2026-03-12 13:03:08 |
| C0135   |  25 |  91000000 | 2026-02-24 10:20:51 |
| D0131   |   1 |     10000 | 2026-02-20 11:44:49 |
| C0087   |  25 |  58580490 | 2026-02-19 14:12:15 |
| C0088   |  97 |  99819248 | 2026-02-19 14:12:02 |
| C0105   |   8 |   8740916 | 2026-02-05 17:10:43 |
| B0043   |   2 |    300000 | 2026-02-04 15:52:30 |
| B0042   |   2 |    100000 | 2026-02-04 15:52:20 |
| C0130   |  56 | 125000000 | 2026-01-24 10:33:33 |
| B0114   |   1 |   -645884 | 2025-12-29 16:33:59 |
| C0119   |   8 |  12600000 | 2025-12-24 17:53:19 |
| C0132   |  15 |  14100000 | 2025-12-18 15:51:35 |
| C0103   |   1 |   1500000 | 2025-12-15 16:44:48 |
| C0134   |   7 |   2351722 | 2025-10-13 14:14:20 |
| C0133   |  20 |  32989967 | 2025-10-13 14:13:12 |
| D0059   |   9 |   2620000 | 2025-09-23 14:50:42 |
| B0163   |  15 |   8662087 | 2025-09-23 14:50:28 |
| C0129   |   9 |  14079800 | 2025-08-25 14:29:46 |
| C0128   |   1 |     -9900 | 2025-07-30 13:39:21 |
| C0125   |  14 |  15920700 | 2025-07-30 13:39:11 |
| C0126   |   4 |  11000000 | 2025-07-02 12:25:23 |
| C0131   |   6 |   5461000 | 2025-05-30 15:46:35 |
| B0225   |   3 |   1000000 | 2025-05-29 10:53:40 |
| C0121   |   2 |  -4500000 | 2025-04-22 15:27:33 |
| C0124   |   1 |  -1544610 | 2025-04-18 15:22:02 |
| C0123   |   1 |  -1327850 | 2025-04-18 15:21:38 |
| C0069   |   1 |  -1367570 | 2025-04-18 15:20:37 |
| C0068   |   1 |  -1403560 | 2025-04-18 15:20:09 |
| C0007   |   1 |  -1323550 | 2025-04-18 15:19:06 |
| C0006   |   1 |  -1522880 | 2025-04-18 15:18:26 |
| C0114   |   4 |   2439290 | 2025-04-08 15:54:01 |
| C0063   |   1 | -10000000 | 2025-01-23 11:39:50 |
+---------+-----+-----------+---------------------+
(45 rows)
```

### 2-7. 위 45개 ↔ 한줄로 `company_agent_ids` 매핑 (한줄로 PG)

```sql
SELECT v.sid AS agent_send_id, c.company_name, c.usage_type, c.billing_type, c.balance
FROM (VALUES ('D0079'),('D0078'),('B0082'),('C0112'),('C0109'),('C0108'),('C0107'),('C0106'),('C0089'),('B0023'),('B0081'),('C0115'),('C0096'),('C0085'),('C0135'),('D0131'),('C0087'),('C0088'),('C0105'),('B0043'),('B0042'),('C0130'),('B0114'),('C0119'),('C0132'),('C0103'),('C0134'),('C0133'),('D0059'),('B0163'),('C0129'),('C0128'),('C0125'),('C0126'),('C0131'),('B0225'),('C0121'),('C0124'),('C0123'),('C0069'),('C0068'),('C0007'),('C0006'),('C0114'),('C0063')) AS v(sid)
LEFT JOIN company_agent_ids cai ON cai.agent_send_id = v.sid
LEFT JOIN companies c ON c.id = cai.company_id
ORDER BY (c.company_name IS NULL), v.sid;
```

```
 agent_send_id |     company_name     | usage_type | billing_type | balance
---------------+----------------------+------------+--------------+----------
 B0023         | 언니가간다           | agent      | postpaid     |     0.00
 B0042         | 에픽소프트           | agent      | postpaid     |     0.00
 B0043         | 에픽소프트           | agent      | postpaid     |     0.00
 B0081         | 피케이포유           | agent      | postpaid     |     0.00
 B0082         | 피케이포유           | agent      | postpaid     |     0.00
 B0114         | 진소프트             | agent      | postpaid     |     0.00
 B0163         | 비즈아이솔루션       | agent      | postpaid     |     0.00
 B0225         | (주)고운세상코스메틱 | both       | prepaid      | 91277.00
 C0006         | 케이피모바일         | agent      | postpaid     |     0.00
 C0007         | 케이피모바일         | agent      | postpaid     |     0.00
 C0063         | SENDIO               | agent      | postpaid     |     0.00
 C0068         | 케이피모바일         | agent      | postpaid     |     0.00
 C0069         | 케이피모바일         | agent      | postpaid     |     0.00
 C0085         | 전서구통신           | agent      | postpaid     |     0.00
 C0087         | 다나가               | agent      | postpaid     |     0.00
 C0088         | 다나가               | agent      | postpaid     |     0.00
 C0089         | 다나가               | agent      | postpaid     |     0.00
 C0096         | 전서구통신           | agent      | postpaid     |     0.00
 C0103         | 시큐엠               | agent      | postpaid     |     0.00
 C0105         | 다나가               | agent      | postpaid     |     0.00
 C0106         | 다나가               | agent      | postpaid     |     0.00
 C0107         | 다나가               | agent      | postpaid     |     0.00
 C0108         | 다나가               | agent      | postpaid     |     0.00
 C0109         | 다나가               | agent      | postpaid     |     0.00
 C0112         | 콜비서               | agent      | postpaid     |     0.00
 C0114         | 태산네트워크         | agent      | postpaid     |     0.00
 C0115         | 콜비서               | agent      | postpaid     |     0.00
 C0121         | 케이피모바일         | agent      | postpaid     |     0.00
 C0123         | 케이피모바일         | agent      | postpaid     |     0.00
 C0124         | 케이피모바일         | agent      | postpaid     |     0.00
 C0125         | 원탑문자             | agent      | postpaid     |     0.00
 C0126         | 그린나래             | agent      | postpaid     |     0.00
 C0128         | 원탑문자             | agent      | postpaid     |     0.00
 C0129         | 태산네트워크         | agent      | postpaid     |     0.00
 C0130         | 런소프트             | agent      | postpaid     |     0.00
 C0131         | 황금마차             | agent      | postpaid     |     0.00
 C0132         | 문자데이             | agent      | postpaid     |     0.00
 C0133         | 플랫에이             | agent      | postpaid     |     0.00
 C0134         | 플랫에이             | agent      | postpaid     |     0.00
 C0135         | 범문자               | agent      | postpaid     |     0.00
 D0059         | 비즈아이솔루션       | agent      | postpaid     |     0.00
 D0078         | 런소프트             | agent      | postpaid     |     0.00
 D0079         | 런소프트             | agent      | postpaid     |     0.00
 C0119         |                      |            |              |
 D0131         |                      |            |              |
(45 rows)
```

---

## 3. 실측으로 확정된 사실 (추측 아님 — §2가 근거)

| # | 사실 | 근거 |
|---|---|---|
| F1 | **충전 축은 아직 143에서만 돌고 있다.** 143 최신 충전 `2026-07-23 14:38:31`(반영 14:39:11), 62는 `2026-07-06 13:40:21`에서 정지. 62 대기(N) 0 = 못 읽어 쌓인 게 아니라 **아무것도 안 들어옴**. | 2-2, 2-3 |
| F2 | 62 총 7,026 vs 143 총 7,036 = **차이 10건**. 0707 복원 이후 143에만 쌓인 신규 충전. | 2-2, 2-3 |
| F3 | **수집 엔진 반영 주기 ≈ 1분.** 입력 후 12~41초 뒤, 항상 다음 분 `:00~:01`에 `RsApplyFlag=Y` + `RsApplyDtTm` 기록. | 2-2 (5건 전부) |
| F4 | **`FillAmtHist.StoreId`는 CustId 체계**(B/C/D + 4자리). `SalesStts.StoreId`(117,841개)와는 겹침 **1개**뿐 = 이름만 같은 **완전히 다른 축**. | 2-4, 2-5 |
| F5 | 충전 대상 식별자 = **우리 `company_agent_ids.agent_send_id`와 같은 축**. 3단 매핑 불필요. | 2-4(70 매치), 2-7(43/45 매핑됨) |
| F6 | **음수 충전(상계/차감)이 실제 업무다.** C0063 -10,000,000 / C0121 -4,500,000 / B0114 -645,884 등. | 2-6 |
| F7 | **일괄 처리 패턴 존재.** 2026-05-14 15:27~15:29에 C0089·C0106·C0107·C0108·C0109 5건 연속. | 2-6 |
| F8 | **1회사 다(多)발송ID가 기본.** 45개 중 43개가 20개 회사에 귀속 = 평균 2.15개. 다나가 8, 케이피모바일 7, 런소프트 3. | 2-7 |
| F9 | **한 회사가 여러 서버에 걸친다.** 런소프트 = C0130(57) + D0078·D0079(58). 비즈아이솔루션 = B0163(54) + D0059(58). | 2-7 |
| F10 | **`billing_type`이 실태를 반영 못 함.** 매핑된 43개 중 **42개가 `postpaid`·`balance 0`**(고운세상 B0225만 prepaid). 그런데 이들 전부 게이트웨이에선 선불 충전 운영 중. | 2-6 + 2-7 |
| F11 | **고아 발송ID 2건**: `C0119`(12,600,000 충전 이력), `D0131`(10,000) — 충전 이력이 있는데 우리 매핑에 없음. | 2-7 |
| F12 | 62 기준 `RsApplyFlag`가 N도 Y도 아닌 행 **10건**(7,026 − 7,016). | 2-2 |

### 접두 = 서버 매핑 (기확정)
`B` = 54번 / `C` = 57번 / `D` = 58번. 2-6 분포: C 33개, B 8개, D 4개 → 서수란이 말한 "**57번 선불 업체**"가 데이터로 확인됨(개수 최다). 단 최근 충전 금액 1·2위는 D(58)의 D0079(4.64억)·D0078(2.60억).

---

## 4. 근본 진단

1. **선불/후불 축이 웹 전용으로만 존재한다.** `companies.billing_type`·`balance`는 웹 발송 차감/환불 경로만 소비한다. 에이전트 발송은 한줄로가 차감하지 않고 게이트웨이가 한다. 그래서 F10 같은 "전부 postpaid인데 실제론 선불" 상태가 나온다. → **에이전트 축의 선/후불·잔액·단가를 별도로 표현해야 한다.**
2. **진짜 정산 단위는 회사가 아니라 발송ID다.** 충전(F6)·잔액·단가가 전부 ID별로 쌓이고, 회사는 ID를 여러 개(F8) 서버를 넘나들며(F9) 갖는다. 서수란 Q2(런소프트 계정별 단가 상이 + 선불 금액 분리 관리)가 정확히 이 구조다.
3. **충전 경로가 143에 묶여 있다.** 143 폐기(목표 7/31) 시점에 충전이 끊긴다(F1). 우리가 화면을 만들어도 **수집 엔진이 62를 안 보면 게이트웨이에 반영되지 않는다.**

### 서수란 3문항 답 (위 진단 기준)

- **Q1 (트렉스타 — 웹 선불/Agent 후불)**: 웹 기준으로 지정하면 된다. `billing_type`은 웹 차감만 소비하므로 Agent에 영향 없다. 다만 **근본 해결은 에이전트 축 선/후불을 발송ID 단위로 분리**하는 것(§5-1). 그러면 혼합이 예외가 아니라 정상이 된다.
- **Q2 (런소프트 계정별 단가)**: **회사를 3개로 쪼개지 마라.** 통계·카카오 템플릿·정산·계정이 전부 조각난다. 정답은 `company_agent_ids`에 **ID별 단가**를 붙이는 것(§5-1). 그때까지는 대표 단가로 두고 대기.
- **Q3 (57번 선불 잔액 이관)**: **"PAY 잔액 연동되면 자동 이관"은 사실이 아니다.** 그런 기능은 설계에 없고 `RemAmt`는 통계로 흘러올 뿐 `companies.balance`와 무연결이다. 이관은 **전환 시점에 이관 충전 1건**(기존 잔액만큼 `FillAmtHist` 입력)으로 수동 처리해야 한다. "빼두면 자동"으로 두면 잔액이 붕 뜬다.

---

## 5. 설계 (확정 방향 — 일반 구조, 고정 목록 금지)

### 5-1. `company_agent_ids`를 **에이전트 계정 원장**으로 격상
- ID별 컬럼 추가: **단가**(SMS/LMS/MMS/카카오) + **선불/후불 구분**.
- 웹 축(`companies.cost_per_*` / `billing_type` / `balance`)과 **완전 독립**.
- 효과: Q1·Q2 동시 해결. **신규 업체는 발송ID를 등록하기만 하면 자동 편입**(하드코딩 없음).
- ⚠ DDL 전 `information_schema`로 기존 컬럼 확인 필수(db_column_verify).
- **★2026-07-24 적용 완료(실측 검증 통과)**: 사전 information_schema 검증(기존 5컬럼) → 소비처 전수 grep 9곳(pay-stats 2·pay-mappings 3·companies.ts 4, 전부 컬럼 명시형·SELECT \*/무명시 INSERT 0건 = 영향 0) → ALTER 실행 → 재검증 10컬럼·기존 283행 전부 postpaid 확인. 추가 컬럼 = `billing_type varchar NOT NULL DEFAULT 'postpaid' CHECK(prepaid/postpaid)` + `cost_per_sms/lms/mms/kakao numeric NULL`. SCHEMA.md 반영 완료.

### 5-2. 잔액은 **복제하지 않고 게이트웨이 실값을 읽어 표시**
- 소스: `RSRM_SalesStts.RemAmt`의 발송ID별 **최신값**. (읽는 방법은 §8-1에서 0724 실측 확정 — MAX(DestDt) 행)
- 우리 DB에 잔액을 따로 보관하면 **이중 진실**이 된다(6원칙 ③). 저장 금지, 조회만.
- 노출: 대시보드 "발송 현황 → 잔액 현황"을 `usage_type in (agent, both)`에도. 웹 선불(`companies.balance`)과는 **다른 지갑**이므로 `both`면 둘 다 표시.
- **★2026-07-24 구현 완료 (배포 대기)**:
  - CT `pay-stats.ts` — `queryPayAgentBalances(companyId)` + 순수 선택 로직 `pickLatestBalances`(테스트 대상 분리). 선불(prepaid) 발송ID만. 선택 = DestDt 최대 → UpdTm 최신 → MsgType·StoreId 사전순(결정적).
  - `routes/balance.ts` — `GET /api/balance/agent` (column does not exist → 503 DB_MIGRATION_PENDING).
  - `Dashboard.tsx` — 발송 현황 카드에 에이전트 잔액 블록(발송ID·기준일 DestDt·잔액, 빈 배열=미노출, 비블로킹 로드).
  - Codex 리뷰(gpt-5.6-sol) 1R 7건 → 4건 즉시 정정: ①동일 시각 복수 행 비결정 선택 → 결정적 tie-break ②집계 전 ID를 0원 합성 → `rem_amt null` + "집계 전 — 잔액 미확인" 표시(금액 미표시) ③대시보드 로딩 블로킹 → 비동기 분리 ④프론트 원소 미검증 → 구조 가드. R1-3(PAY env 미설정 시 503 미작동)=의도 확정·주석 명시.
  - 테스트 `__tests__/pay-agent-balance.test.ts` 7건 신설. BE·FE tsc 0 · vitest 928.
  - Codex 2R 정정: RemAmt null/빈문자→0 강제 변환 차단(`remAmtNum`). §8-9 행 단위 실측으로 **권위 행 = StoreId '' 계정 합계 행** 확정 → SQL·순수 함수 이중 필터.
  - Codex 3R 판정 = ship with follow-ups(R2 2건 해소 확인) → 후속 정정: "큰 값 우선" 축 제거, 우선순위 = DestDt 최대 → UpdTm 최신 → 값 보유(동시각 한정) → MsgType·StoreId 사전순. 최신 스냅샷 값 없음 = fail-closed null(과대 표시 편향 제거). 테스트 it 11건·vitest 932. Codex 4R 확인 대기.
  - **잔여**: §8-10 보조 인덱스 (CustId, DestDt) 추가(강문희 엔진 영향 확인 후) + 선불 지정 입력 수단(§5-3 전 단계 — 아래).
- ~~선불 지정 입력 수단 (Codex R1-6)~~ **★2026-07-24 오후 구현 완료 — Codex(gpt-5.6-sol) 5R do-not-ship 3건 정정 → 6R ready to ship**:
  - CT `parseAgentLedgerFields`(POST 기본값형)·`parseAgentLedgerPatch`(PATCH 부분 갱신형 — memo만 보내도 원장 미초기화) 신설(pay-stats.ts).
  - companies.ts: GET agent-ids에 billing_type+단가 4종 동반 / POST 선택 입력(미지정=postpaid=기존 동작) / **PATCH /:id/agent-ids/:rowId 신설**(동적 SET·필드 0건 400·memo 200자 상한·RETURNING 효과 검증·503 CREATE/ALTER).
  - AdminDashboard.tsx: 발송ID 목록에 선불/후불 뱃지+단가 요약, 행 인라인 편집(선불/후불 토글·단가 4종 점 1개 필터·메모). **선불 지정 즉시 §5-2 잔액 표시·§5-3 충전 대상 편입.**
  - 테스트: pay-agent-balance.test.ts 원장 파서 6블록 포함 총 938 통과. BE·FE tsc 0.
  - 6R 비차단 제안 2건(다중 점 입력을 병합 대신 거부 / 라우트 통합 테스트)은 후속 선택 과제.

### 5-3. 충전 실행 (슈퍼관리자)
- 흐름: 회사 → 발송ID 선택 → 금액 입력 → `FillAmtHist` INSERT(`RsApplyFlag='N'`) → **폴링으로 `Y` + `RsApplyDtTm` 확인 후에만 성공 표시**(6원칙 ②, F3이 근거).
- **음수 입력 지원 필수**(F6). 한줄로 `balance_transactions`는 `type`으로 방향을 정하는 반대 방식이니 **혼동 금지**.
- **다건 일괄 입력 지원**(F7).
- INSERT 대상 DB = **62 pay-ingest-db**(143 아님). ★왕복 실측(§6-1)으로 62 연동 실가동 확인됨 — §6 선행 조건 해소.
- **★2026-07-24 구현 완료 (Codex gpt-5.6-sol 16R ready to ship·배포 대기)**:
  - CT `pay-stats.ts` — `parseAgentCharges`(1~50건·요청 내 중복 금지·금액 십진만·배치 절대합 ≤1억)·`insertAgentCharges`(전체 60초 데드라인 fencing·단일 트랜잭션)·`getAgentChargeStatus`·`listAgentCharges`·`findGatewayCharges`(대조)·`matchHealWindow`(자가복구 순수 판정).
  - `routes/admin.ts` — `GET /agent-charges/targets` / `POST /agent-charges`(멱등키 UNIQUE·서버 전역 uncertain 게이트·일 한도 원자적 gross 2억·발송ID 실존+선불 강제·고액/불확실 알림) / `POST /agent-charges/:id/resolve`(3분 숙성+게이트웨이 대조 후에만 not_applied·사유 필수·resolved_by/at 영속) / `GET /agent-charges/status`(requestId 기준·자가복구) / `GET /agent-charges`(이력).
  - `AgentChargePanel.tsx`(신규) — 충전 관리 탭 상단. 다건 입력·음수 상계·반영 폴링(applied=Y만 성공)·불확실 해소 UI·이력.
  - **신규 테이블 `agent_charge_requests`**(요청 원장/감사 — 게이트웨이 잔액·반영은 여전히 FillAmtHist 단일 진실). DDL 필요.
  - **선행: 62 backend MySQL 계정(paystats)에 `RSRM_FillAmtHist` INSERT 권한 GRANT 필요**(현재 SELECT 전용). 권한 전엔 등록 시 503 DB_GRANT_PENDING 안내, 화면·조회는 정상.
  - Codex 16라운드(돈 기능 적대 검증) — 멱등성·이중충전·음수 악용·한도 우회·불확실 처리·트랜잭션 fencing까지 근본 정정. 마지막은 "3분 유예 + 게이트웨이 대조" 설계로 종결(destroy 즉시성 비의존). 잔여 이론적 엣지(DB 다분 fsync 멈춤 등 재해 수준)는 비차단.

### 5-3 DDL (Harold 실행 — 서버 PG)
```sql
CREATE TABLE IF NOT EXISTS agent_charge_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key varchar(80) NOT NULL UNIQUE,
  requested_by varchar(80),
  reason varchar(200) NOT NULL,
  charges jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_amount numeric NOT NULL,
  abs_total numeric NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'reserved',
  resolved_by varchar(80),
  resolved_at timestamptz,
  resolve_note varchar(200),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_charge_requests_created ON agent_charge_requests (created_at DESC);
```
status 값: reserved(예약) → registered(반영 대기) / uncertain(커밋 응답 유실) → resolve로 registered|not_applied.

### 5-4. 충전 요청 (고객사)
- 에이전트 업체가 요청 등록 → 직원이 확인 후 5-3으로 실행. 기존 무통장입금 요청(`deposit_requests`) 흐름 재사용 검토.

### 5-5. 고아 발송ID 대조 워커
- 게이트웨이(충전 이력/통계)에는 있는데 `company_agent_ids`에 없는 ID를 주기적으로 표시(F11의 C0119·D0131이 실증).
- **없으면 신규 업체가 조용히 누락된다** — Harold 지시("향후 추가 업체")의 핵심 안전장치.

### 5-6. 잔액 이관 (Q3)
- 자동 아님. 전환 시점에 **이관 충전 1건**으로 처리. 5-3 기능이 그대로 도구가 된다.

---

## 6. 선행 관문 — 외주(강문희) ★0724 회신 수신·성격 재정의

**옛 전제(폐기):** "강문희가 수집 엔진 소스 DB를 143→62로 바꿔줘야 한다."
**★0724 강문희 회신(원문 요지):** **"문자중계서버는 143과 62 병행동작하게 세팅되어 있으며 언제든지 전환 가능한 상태."** 전환 판단·시점은 인비토 몫 — 인비토가 143→62 마이그레이션 완료 후 62만 사용하면 되고, 문제 없으면 강문희는 143 연동 프로그램만 종료.

**회신으로 확정된 사실:**
- FillAmtHist = PAY가 write / 중계서버가 read. 충전 = 결제 금액을 그냥 INSERT(FillAmt).
- PayMethod(1=카드, 2=계좌이체, 코드명 RSRMPYTY)·PayFkey(PG 결제키·별도 테이블 연결용)는 **PAY쪽 충전관리 프로그램 전용 — 중계서버는 사용하지 않음**. 비워도/삭제해도 무방(§8-5 종결).
- 엔진의 반영 기준 = **RsApplyFlag**(N 읽어서 잔액 증액 후 Y로 update — 중복 반영 방지). **SeqNo는 워터마크 아님** → 62 auto_increment 재채번 무해(§8-6 종결).

**남은 실행(전부 인비토 몫):**
1. ~~왕복 실측 = 활성 판별~~ **★0724 통과 — 62 충전 연동 실가동 확정**: B0023에 +1,000 'N' INSERT(SeqNo 7044) → `Y` 14:16:51 반영 → −1,000 상계(SeqNo 7045) → `Y` 14:22:50 반영. 순변동 0. **음수 상계도 62 경유로 정상 동작 실증.** 6원칙 ⑤ 왕복 실측 종결 — §5-3 충전 실행의 기술 전제 전부 확보. (부수: 실측 전 자리표시 'N' 행(SeqNo 7043 StoreId '발송ID')이 실수 삽입됐다가 엔진 픽업 전 삭제·잔존 0 — 실측 SQL 템플릿에 자리표시를 넣지 말 것 교훈)
2. **143→62 충전 이력 백필 = 컷오버 시점 최종 1회**: PAY 화면 충전이 §5-3 화면으로 대체되는 시점에 143 신규분(SeqNo>7042 기준 추출)을 **SeqNo 제외 INSERT(재채번)** + RsApplyFlag **'Y' 그대로**(이미 반영된 금액 — 'N'이면 이중 증액 사고). 그 전에는 직원이 143 PAY 화면 계속 사용(엔진이 143도 병행 처리 중이라 실충전 무중단).
3. 62 단독 사용 확정 후 강문희에게 143 연동 종료 통지.
4. (미답 잔여) RSRM_SalesStts에 (CustId, DestDt) 보조 인덱스 추가 시 엔진 영향 — 후속 질문 1건.

---

## 7. 실행 순서 (★0724 강문희 회신 반영 재정렬)

1. ~~강문희 메일~~ **완료** — 발송·회신 수신(§6). 남은 외주 접점 = (CustId, DestDt) 인덱스 질문 1건 + 최종 143 연동 종료 통지.
2. §8 실측 — **8-1·8-3·8-4·8-5·8-6·8-9·8-10 완료**. 잔여 = 8-2(143 SHOW TABLES → 고아 ID 소속)·8-8(서수란).
3. ~~§5-1 DDL~~ **완료(0724 적용·검증)**.
4. §5-2 잔액 표시 **코드 완료(Codex 4R ship·배포 대기)** → **선불 지정·단가 입력 UI(§5-3 전 필수)** → §5-3 충전 실행 → §5-4 충전 요청 → §5-5 대조 워커.
5. ~~왕복 실측~~ **★0724 통과**(§6-1 상세) — 62 충전 연동 실가동·음수 상계 실증. §5-3 오픈 게이트 해소.
6. **143→62 충전 이력 백필 = 컷오버 시점 최종 1회**(§6-2): SeqNo>7042 추출·SeqNo 제외·'Y' 그대로. 이후 62 단독 확정 → 강문희 143 연동 종료 통지.
7. §5-6 기존 선불 잔액 이관.

---

## 8. 미확인 / 열린 질문 (추측 금지 — 반드시 실측)

| # | 항목 | 확인 방법 |
|---|---|---|
| 8-1 | ~~잔액(RemAmt) 조회 방법~~ **★0724 실측 확정**: 잔액 = CustId별 `MAX(DestDt)` 행의 RemAmt. UpdTm은 판별 기준 불가(배치가 최근 며칠을 같은 시각으로 일괄 갱신 — 0721~0723 행 전부 `07-24 05:00:17`). 갱신 = 05:00 배치 + 54·58은 당일 장중 갱신도 있음. ⚠ 과거 행(0707 dump 복원분·0715 이전 적재분)은 RemAmt=0 → 최근 발송 없는 ID는 stale/0으로 보임 — **화면에 기준일(DestDt) 동반 표시 의무**. C0130은 0703 이후 행 없음 = 적재 갭 아니라 실제 발송 없음(57 적재는 0723분까지 정상) | 완료 |
| 8-2 | **고아 ID `C0119`·`D0131`의 소속 회사** | 143 PAY 원장(`RSRM_Mem`/`RSRM_MemStore`) 또는 서수란 확인. 143 `SHOW TABLES;`부터 — **미실행** |
| 8-3 | `SalesStts.StoreId`(117,841개)의 정체 — 충전과 무관하나 미규명 | 필요 시 샘플 조회. **충전 설계에는 쓰지 말 것** |
| 8-4 | ~~RsApplyFlag 제3값 10건~~ **★0724 실측 확정**: 전부 `NULL` — 2017~2021 레거시 잔재(옛 StoreId 체계 S002/test01/A·Y코드, 소수점 마이너스 보정 포함, RsApplyDtTm 전부 NULL). 현행 의미 축 = N(대기)→Y(반영) 둘뿐. **우리 INSERT = `RsApplyFlag='N'` 확정** | 완료 |
| 8-5 | ~~PayMethod·PayFkey 코드 체계~~ **★0724 종결(강문희 회신)**: PayMethod 1=카드·2=계좌이체(코드명 RSRMPYTY), PayFkey=PG 결제키(별도 테이블 연결용). **둘 다 PAY쪽 충전관리 전용 — 중계서버 미사용, 비워도 무방.** 분포 실측(현행 전부 '2'+PayFkey 빈 값)과 정합. **우리 INSERT = PayMethod '2' + PayFkey 비움 확정** | 완료 |
| 8-6 | ~~SeqNo 채번 충돌~~ **★0724 종결(강문희 회신)**: 엔진 반영 기준 = **RsApplyFlag**(N 읽어 증액 후 Y update, 중복 방지). SeqNo는 이력용 auto_increment일 뿐 워터마크 아님 → 62 재채번 무해. 백필 시 SeqNo 제외 INSERT | 완료 |
| 8-7 | 62에 INSERT 권한 있는 계정 — 현재 backend용 `paystats`는 **SELECT 전용** | 충전용 쓰기 계정 신설 필요 (§5-3 구현 단계) |
| 8-8 | 서수란 Q2의 런소프트 "1,2,3"이 `C0130`·`D0078`·`D0079` 맞는지 | 서수란 확인 |
| 8-9 | ~~동일 (CustId, DestDt) RemAmt 불일치 여부~~ **★0724 행 단위 실측까지 완료 — 권위 행 확정**: RemAmt는 **StoreId=''(계정 합계 행)에만** 실린다. D0130 실증 = 빈 StoreId 행(L·S) 둘 다 18,445(같은 값 복제), UUID StoreId 상세 행 전부 0. B0001 = 빈 행 7,390.1 / 'alarm' 행 0. 부수 확정: SalesStts.StoreId(§8-3)의 정체 = 하위 스토어/채널 상세 축('' = 계정 합계). 코드 규칙 = StoreId 빈 행만 잔액 소스(SQL+순수 함수 이중 적용) + DestDt 최대 → 값 보유·최대(방어) → UpdTm → MsgType. **배포 게이트 해소** | 완료 |
| 8-10 | ~~RSRM_SalesStts 인덱스~~ **★0724 실측: PK = (DestDt, CustId, StoreId, MsgType)** — DestDt 선두라 CustId 조건 MAX(DestDt)는 범위 스캔(총 959,106행). **소견 = `(CustId, DestDt)` 보조 인덱스 추가 필요**(조회 자주 아님·대시보드 로드당 1회지만 안전). 실행 전 강문희 엔진(replace 쓰기) 영향 확인. 부수 확정: PK 덕에 완전 동일 키 중복 행 불가(선택 결정성 보장) | 실측 완료 — 인덱스 추가 대기 |

---

## 9. 함정 · 절대 원칙

- `docker exec`는 반드시 **`-it`** (`-i`만 쓰면 비밀번호가 화면에 그대로 찍힌다 — 이번에 실제 발생).
- **`SalesStts.StoreId`를 충전 축으로 쓰지 마라**(F4). 충전은 `FillAmtHist.StoreId` = CustId 체계.
- **잔액을 우리 DB에 복제 저장하지 마라**(이중 진실 → 6원칙 ③).
- **효과 검증 없이 성공 표시 금지**(6원칙 ②) — `RsApplyFlag=Y` 확인이 유일한 성공 신호.
- **음수 충전을 막지 마라**(F6). 단, 한줄로 `balance_transactions`의 `type` 방식과 혼동 금지.
- 회사를 쪼개서 다ID 문제를 푸는 안은 **채택하지 않는다**(Q2).
- DB 컬럼/테이블 신규 참조 전 `information_schema` 검증(tsc 통과 ≠ SQL 유효).

---

## 10. 관련 문서 · 코드 · 진행 상태

- 상위 트랙: `docs/레거시서버_폐기_플랜.md`, `docs/2026-07-07-pay-absorption-track-d-design.md`
- 메모리: `project_2026_0703_legacy_server_decommission.md`(0720 Track D 실측·전제 정정), `project_2026_0723_pay_agent_stats_tabs.md`
- 코드(에이전트 통계 축 — 이미 구현·배포됨): `packages/backend/src/utils/pay-stats.ts`(`queryPayAgentStats` / `queryPayAgentStatsAllCompanies` — 둘 다 발송ID별 축 보유), `routes/manage-stats.ts`, `routes/admin.ts`, `utils/manage-stats-export.ts`
- **2026-07-23 20:27 커밋 `adc47a72`로 배포 완료**: 고객사 발송통계 발송ID별×유형 + 웹/에이전트 합산 엑셀, 모바일 DM 색·크기 건.
- **2026-07-24 슈퍼관리자 대칭 보강 = 배포 완료**: `queryPayAgentStatsAllCompanies` 발송ID 축 + `GET /admin/stats/export/agent` + AdminDashboard 발송ID 컬럼·에이전트 엑셀 버튼. tsc 0 / vitest 921 통과 후 배포.
  → **결과: 고객사 화면과 슈퍼관리자 화면 모두 (기간 × 발송ID × 유형) 축 + 엑셀(CSV)을 갖췄다.** 즉 §5 충전·잔액 기능이 붙을 통계·대조 기반은 이미 완비된 상태에서 시작한다.
