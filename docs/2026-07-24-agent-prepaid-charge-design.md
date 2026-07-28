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

### 5-4. 충전 요청 (고객사) — ★2026-07-27 구현 완료 (DDL 대기)

**`deposit_requests` 재사용은 폐기했다.** 그 테이블의 승인 경로는 한줄로 `companies.balance`(웹 지갑)를 올린다.
에이전트 요청을 같은 테이블에 섞으면 기존 무통장입금 승인 화면이 **게이트웨이 지갑 요청을 웹 잔액으로 잘못 증액**할 수 있다
(6원칙 ④ — 축이 다르면 테이블도 다르다). 또한 단위가 회사가 아니라 **발송ID**다(런소프트 = C0130·D0078·D0079).

**흐름**
1. 고객사 `/manage` → **충전 요청** 탭(`usage_type` agent/both + 선불 지정 발송ID 보유 회사에만 노출)
   → 발송ID·금액·입금자명(+입금일·메모) 등록 = `pending`.
2. 슈퍼관리자 `AgentChargePanel` 상단 **접수함**에 뜬다 → **[충전 폼에 담기]** 1클릭으로 발송ID·금액·사유가 채워짐
   → 기존 §5-3 [충전 등록] 그대로 실행. 등록 성공 시 요청은 `processing` + `charge_request_id` 연결.
3. §5-3 폴링이 **전건 반영(`RsApplyFlag='Y'`)** 을 확인한 순간에만 `fulfilled`. 등록만으로 완료 표시하지 않는다(6원칙 ②).
4. 반려 = `pending`에서만 가능, **사유 필수**(고객사 화면에 그대로 표시).

**불변 규칙**
- **요청은 어떤 잔액도 건드리지 않는다.** 증액 경로는 §5-3 하나뿐 — 요청 행은 직원 화면을 채워 주는 대기열일 뿐이다.
- **고객사 입력은 양수 정수만.** 음수 상계는 내부 회계 조정이라 요청 창구에 열면 고객사 입력으로 차감이 접수된다.
- 발송ID 소유·`billing_type='prepaid'`는 **서버에서 재검증**(프론트 목록 신뢰 금지 — 남의 발송ID 직접 POST 차단).
- 같은 발송ID·같은 금액 `pending`이 10분 내 있으면 이중 접수로 차단(같은 금액 반복 입금이 실무에 있어 영구 차단은 안 한다).
- 테이블 미생성 = 503 `DB_MIGRATION_PENDING`(500 노출 금지).
- 충전 성공 후 요청 연결에 실패해도 **500을 내지 않는다** — 충전은 이미 확정이라 프론트가 새 키로 재시도하면 이중 충전이 된다.

**코드**: CT `utils/agent-charge-orders.ts`(파싱·상태 전이 판정·라벨) + 계약 테스트 24건 / 고객사 라우트 `routes/agent-charge-orders.ts`(targets·목록·등록)
/ 슈퍼 `routes/admin.ts`(`GET /agent-charge-orders`·`POST /agent-charge-orders/:id/reject` + `POST /agent-charges`에 `orderIds` 선택 파라미터 + `settleLinkedChargeOrders`)
/ 프론트 `components/manage/AgentChargeRequestTab.tsx`(신규)·`ManagePage.tsx`(탭)·`AgentChargePanel.tsx`(접수함).

### 5-4 DDL (Harold 실행 — 서버 PG)
```sql
CREATE TABLE IF NOT EXISTS agent_charge_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  agent_send_id varchar(40) NOT NULL,
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  depositor_name varchar(50) NOT NULL,
  expected_at date,
  memo varchar(200),
  status varchar(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','fulfilled','rejected')),
  reject_reason varchar(200),
  charge_request_id uuid REFERENCES agent_charge_requests(id) ON DELETE SET NULL,
  requested_by varchar(80),
  resolved_by varchar(80),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_charge_orders_status ON agent_charge_orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_charge_orders_company ON agent_charge_orders (company_id, created_at DESC);
```

**⛔ 오픈 전 선행 2건**: ①발송ID `billing_type='prepaid'` 지정(현재 283행 전부 postpaid라 요청 탭이 "선불 지정된 발송ID가 없습니다"로만 뜬다)
②실측 1건(요청 등록 → 담기 → 충전 등록 → `Y` 반영 → `fulfilled` 전이까지 왕복, 6원칙 ⑤).

**미확정(서팀장 확인 대상)**: ①에이전트 업체가 웹으로 요청하길 원하는지(현행은 전화·메일 후 직원 입력) ②에이전트 입금 계좌가 웹 무통장입금과 같은 계좌인지 — **화면에 계좌번호를 넣지 않은 이유** ③승인 권한을 직원 계정까지 열지 여부(현재 슈퍼관리자 전용).

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
| 8-1 | ~~잔액(RemAmt) 조회 방법~~ **⛔ 0727 폐기 — §14로 대체**(잔액 소스는 `RSRM_SalesMst.RemAmt` 계정 원장. 아래 0724 결론은 통계 스냅샷을 잔액으로 오인한 것). 이하 원문 보존: 잔액 = CustId별 `MAX(DestDt)` 행의 RemAmt. UpdTm은 판별 기준 불가(배치가 최근 며칠을 같은 시각으로 일괄 갱신 — 0721~0723 행 전부 `07-24 05:00:17`). 갱신 = 05:00 배치 + 54·58은 당일 장중 갱신도 있음. ⚠ 과거 행(0707 dump 복원분·0715 이전 적재분)은 RemAmt=0 → 최근 발송 없는 ID는 stale/0으로 보임 — **화면에 기준일(DestDt) 동반 표시 의무**. C0130은 0703 이후 행 없음 = 적재 갭 아니라 실제 발송 없음(57 적재는 0723분까지 정상) | 완료 |
| 8-2 | ~~고아 ID `C0119`·`D0131`의 소속 회사~~ **★2026-07-27 종결**: `C0119`=**준네트웍스_미1**(`RSRM_SalesMst` 실측·PayTp 2·잔액 24,450원·PAY 로그인 계정 없음) / `D0131`=**한줄로·스팸필터 테스트 충전**(Harold). 준네트웍스·준네트워크는 0720 매핑에서 내부 계정으로 제외한 곳이라 `company_agent_ids` 부재가 정상 — **실업체 누락 아님**. §5-5 대조 워커의 예외 목록 후보 | 완료 (상세 §12) |
| 8-3 | `SalesStts.StoreId`(117,841개)의 정체 — 충전과 무관하나 미규명 | 필요 시 샘플 조회. **충전 설계에는 쓰지 말 것** |
| 8-4 | ~~RsApplyFlag 제3값 10건~~ **★0724 실측 확정**: 전부 `NULL` — 2017~2021 레거시 잔재(옛 StoreId 체계 S002/test01/A·Y코드, 소수점 마이너스 보정 포함, RsApplyDtTm 전부 NULL). 현행 의미 축 = N(대기)→Y(반영) 둘뿐. **우리 INSERT = `RsApplyFlag='N'` 확정** | 완료 |
| 8-5 | ~~PayMethod·PayFkey 코드 체계~~ **★0724 종결(강문희 회신)**: PayMethod 1=카드·2=계좌이체(코드명 RSRMPYTY), PayFkey=PG 결제키(별도 테이블 연결용). **둘 다 PAY쪽 충전관리 전용 — 중계서버 미사용, 비워도 무방.** 분포 실측(현행 전부 '2'+PayFkey 빈 값)과 정합. **우리 INSERT = PayMethod '2' + PayFkey 비움 확정** | 완료 |
| 8-6 | ~~SeqNo 채번 충돌~~ **★0724 종결(강문희 회신)**: 엔진 반영 기준 = **RsApplyFlag**(N 읽어 증액 후 Y update, 중복 방지). SeqNo는 이력용 auto_increment일 뿐 워터마크 아님 → 62 재채번 무해. 백필 시 SeqNo 제외 INSERT | 완료 |
| 8-7 | 62에 INSERT 권한 있는 계정 — 현재 backend용 `paystats`는 **SELECT 전용** | 충전용 쓰기 계정 신설 필요 (§5-3 구현 단계) |
| 8-8 | 서수란 Q2의 런소프트 "1,2,3"이 `C0130`·`D0078`·`D0079` 맞는지 + **통장 대조 미해소**(런소프트 통장 3,100만 vs 143 실측 2,600만 — 차 500만. `C0130`은 1월 이후 충전 0이라 143에 안 잡히는 입금 경로가 따로 있는지 확인 필요) | 서수란 확인 |
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

---

## 11. 충전 원장 유입 정지 — 실측 확정 (2026-07-26)

**증상**: 충전 이력 화면이 7월 4건(700만원)만 보여준다. 런소프트는 7월 통장 입금만 3,100만원이다.

**실측**:

| 확인 | 결과 |
|---|---|
| `RSRM_FillAmtHist` 전체 | SeqNo 1~7045 · 실제 7,028행 · 결번 17 · 최신 `2026-07-24 14:21:57` |
| 월별 | 07월 **4건 700만** / 06월 13건 3,096만 / 05월 23건 5,847만 |
| `FillDtTm > '2026-07-07'` | **B0023 ±1,000 두 건뿐 — 둘 다 우리가 0724에 넣은 테스트** |
| 그 직전 게이트웨이 행 | 7042 = `2026-07-06 13:40` |

**확정**: 62 `pay-ingest-db`의 충전 원장은 **0707 초기 dump에서 멈춰 있다.** 강문희가 push하는 것은
통계(`RSRM_SalesStts`)뿐이고 충전 원장은 유입되지 않는다. 우리가 INSERT한 행은 엔진이 읽어 `RsApplyFlag='Y'`로
반영하므로 **쓰기 경로는 살아 있다** — 끊긴 것은 그들 채널로 일어난 충전이 우리에게 돌아오는 경로다.

**이미 알고 있던 잔여였다.** Track D 잔여 목록의 `컷오버(143 SeqNo>7042 백필 — RsApplyFlag 'Y' 그대로, 'N'이면 이중 증액)`가
정확히 이것이다(7042가 dump 마지막 행이라는 것까지 일치). 실행이 안 됐을 뿐이다.

**백필 설계 함정 — SeqNo를 그대로 옮기면 안 된다.** 62의 7044·7045는 우리가 넣은 행이고, 143은 그 사이
독립적으로 채번을 계속했다. 143의 7044·7045와 62의 7044·7045는 **서로 다른 충전**이다.
백필은 새 SeqNo로 넣고, `RsApplyFlag`는 반드시 `'Y'`로 — `'N'`이면 엔진이 다시 반영해 **이중 증액**된다.

### 우리 쪽 결함 — 멈춘 데이터를 화면이 숨겼다

19일째 안 들어오는 원장을 아무 표시 없이 최신인 양 보여줬다. 통장과 직접 대조하기 전까지 아무도 몰랐다.
같은 계열 교훈이 §8-1(잔액 RemAmt)에 "화면에 기준일 동반 표시 의무"로 이미 있는데 충전 원장에는 안 걸려 있었다.

**처방**: `latestAgentChargeAt()`(필터 무관 원장 전체 최신)을 API가 함께 내리고, 화면이
`원장 최신 YYYY-MM-DD HH:mm`을 상시 표기 + **14일 이상 공백이면 붉은 경고**(월 13~35건이 정상이라 14일 공백은 비정상 신호).
경고 문구는 "이 목록은 그 시점까지만 담고 있어 실제 충전과 다를 수 있다 — 잔액 판단 근거로 쓰지 말라"로 명시한다.

**일반화**: 외부가 push하는 수신 DB를 화면에 그대로 붙일 때는 **"언제까지의 데이터인가"를 같이 보여줘야 한다.**
유입이 끊겨도 화면은 조용히 정상으로 보이고, 그 조용함이 곧 사고다(LESSONS_DB 2026-07-23 적재 갭과 같은 계열).

### 함께 확인된 것 — 발송ID 선불 지정이 0건

`company_agent_ids` 283행의 서버 분포는 `B(54) 129 · C(57) 62 · D(58) 92`이고 **전부 충전 목록에 노출된다**(매핑 누락 없음).
그러나 `billing_type='prepaid'`가 **세 서버 모두 0건**이라, 지금은 어떤 발송ID도 충전 등록이 서버에서 거부된다
(충전은 `prepaid` + `usage_type` agent/both만 허용). 잔여의 "서수란 선불 발송ID 지정"이 선행되어야 한다.

### 부수 — 충전 이력 화면 개선 (Harold 지시)

나열식 목록을 **10건 페이징**으로(총 건수·이전/다음). 발송ID **검색**(`SearchableSelect` — 283개라 기본 셀렉트로는 못 찾는다)과
**기간 필터** 추가. 서버는 목록과 건수가 같은 WHERE 조각을 쓰고, `SeqNo`가 채번 유일값이라 LIMIT/OFFSET이 결정적이다.

---

## 12. 143 → 62 충전 원장 백필 — ★실행 완료 (2026-07-27)

§11이 진단한 누락분을 실제로 옮겼다. **10건 · 순합 25,955,131원 · 미반영 0.**

### 실측 대조 (실행 전)

| 확인 | 143 | 62 |
|---|---|---|
| 총 행수 | **7,036** | 7,028 (게이트웨이 7,026 + 우리 테스트 2) |
| MAX(SeqNo) | 7052 | 7045 |
| 최신 충전 | 2026-07-23 14:38:31 | 2026-07-06 13:40:21 (게이트웨이 기준) |

7,036 − 7,026 = **10** 으로 누락 건수와 교차 일치했고, 구간은 `SeqNo > 7042` 하나로 떨어졌다.
**7월 12건 전부 `RsApplyFlag='Y'`** — 즉 잔액은 이미 정상 반영된 상태였고 우리 원장만 뒤처져 있었다(미반영 사고 아님).

### 실행 방식 — 값을 사람이 옮겨 적지 않는다

143에서 `CONCAT` + `QUOTE()`로 **INSERT문 자체를 생성**해 62에 `source`로 넣었다.
`PayMethod`·`PayFkey` 같은 값을 우리가 추측하거나 손으로 옮기는 경로를 아예 없앤다.

- `SeqNo` **컬럼 자체를 INSERT에서 제외**(auto_increment 재채번). 62의 7044·7045는 우리 테스트 행이라
  143의 같은 번호와 **다른 충전**이다 — 번호를 그대로 옮기면 원장이 뒤섞인다.
- `RsApplyFlag`는 **`'Y'` 그대로**. `'N'`이면 엔진이 다시 읽어 2,595만원이 한 번 더 증액된다.
- 음수 상계 1건(`B0082` −44,869)도 그대로 포함. 빼면 잔액이 그만큼 부풀려진다.
- `START TRANSACTION` → INSERT 10건 → 검증 SELECT → **숫자 확인 후 수동 `COMMIT`**(6원칙 ②).

### 결과 (실행 후)

`COUNT=10 · SUM=25955131 · bad=0` 확인 후 커밋. 62 총 **7,038행 / MAX(SeqNo) 7055**.
`MAX(FillDtTm)`은 `2026-07-24 14:21:57`로 나오는데 이는 143에 없는 **우리 테스트 행**이 최신이기 때문이며,
143 대조 기준은 `SeqNo > 7042` 구간 합이다. 화면의 14일 공백 경고도 함께 해소됐다.

### 남은 함정

**백필은 컷오버와 한 세트다.** 직원이 143 PAY 화면을 계속 쓰면 그 이후 충전이 또 62에 빠진다.
이번 백필의 경계는 143 `SeqNo 7052`(2026-07-23 14:38)이므로, 컷오버 시점에 143 `MAX(SeqNo)`가
7052를 넘었다면 그 초과분을 같은 방식으로 한 번 더 옮겨야 한다.

### 부수 — §8-2 고아 발송ID 2건 종결

`C0119` = **준네트웍스_미1**(PayTp 2·잔액 24,450원·`RSRM_Mem`에 로그인 계정 없음),
`D0131` = **한줄로·스팸필터 테스트 충전**(Harold 확인).
준네트웍스·준네트워크는 0720 PAY 매핑에서 **내부 계정으로 분류해 회사 생성에서 제외**한 곳이라
`company_agent_ids`에 없는 것이 정상이다. **실업체 누락 아님 — 대조 워커(§5-5)의 예외 목록 후보.**

부수 확정: 143 `sales` DB의 한글은 **UTF-8**이다(`SET NAMES utf8`로 정상 표시). 옛 세션에서 `?`로 보였던 것은
클라이언트 문자셋 미지정이며 데이터 손상이 아니다. `C0115~C0122`가 2024-03-15 전후 일괄 등록·전부 PayTp 2·
`StoreId=CustId` 구조라 같은 계열로 보인다(접미 `_미1`·`_게1`의 의미는 미확인).

---

## 13. 발송ID 표시명 = 발급명(PAY 저장 고객사명) 전 화면 통일 — ★구현 완료 (2026-07-27)

**발단(Harold)**: 발송통계는 `런소프트 / 런소프트2 / 런소프트3`으로 갈라 보이는데, 발송ID 매핑 화면과 충전 화면은
세 줄이 전부 `런소프트`였다. → **"PAY에 저장되어 있는 고객사명을 그대로 모든 곳에서 통일되게 보이게 하라."**

**원인(실측)**: 이름 소스가 화면마다 달랐다. 통계만 게이트웨이 원장 `RSRM_SalesMst.CustNm`(발급명)을 붙이고
(`pay-stats.ts fetchCustNames`, 0725 서수란 건), 매핑·충전 화면은 `companies.company_name`만 썼다.
회사 1개에 발송ID가 여럿인 게 기본(F8)이라 **회사명 폴백은 구조적으로 세 줄을 같은 이름으로 만든다.**

**설계 — 우리 DB에 표시명 컬럼을 만들지 않았다.**
편집 가능한 `display_name`을 두는 안을 먼저 냈다가 폐기했다. 이름이 두 곳(게이트웨이·우리)에 살면 갈리고,
갈리면 지금 증상이 그대로 재현된다(6원칙 ③ 이중 진실). `company_agent_ids`는 0724 ALTER 상태 그대로 10컬럼.
표시명을 바꿔야 하면 PAY 원장에서 바꾸는 것이 원천이다.

**규칙**: 라벨 = **`발송ID / 발급명`**(통계가 쓰던 형식). 발급명이 없으면 발송ID만 — **회사명으로 대체하지 않는다.**
CT = `pay-stats.ts` `getAgentCustNameMap()`(원장 전량·60초 캐시·실패 시 직전 캐시 폴백·절대 throw 안 함)
+ `formatAgentIdLabel()` + 순수 `reduceCustNameRows()`. 프론트 미러 = `utils/agentLabel.ts`.

**반영 지점**: 슈퍼 발송ID 매핑(companies.ts `GET agent-ids`) · 충전 대상·이력·접수함(admin.ts 3곳) ·
고객사 충전 요청 대상·이력(agent-charge-orders.ts 2곳) · 고객사 대시보드 에이전트 잔액(balance.ts) ·
청구서 상세 모달·발행 미리보기(billing.ts 2곳). 통계·엑셀은 이미 발급명을 쓰고 있어 형식만 기준으로 삼았다.

**부수 효과**: 충전 이력은 게이트웨이 원장 기준으로 이름을 붙이므로 **우리 매핑에 없는 고아 발송ID도 이름이 나온다**
(`C0119` → 준네트웍스_미1). 이전에는 "매핑 없음"만 떴다.

**제외 1건(의도)**: 거래내역서 **PDF 2페이지 '구분' 칸**은 발송ID만 유지. 칸 폭이 47pt·`lineBreak:false`(잘라냄)라
발급명을 넣으면 이름이 잘려 나간다(0726 요금제 일자 칸이 같은 이유로 겹친 전례). PDF에 넣으려면 열 폭 재설계가 선행이고
그건 실청구 발행 대기 중인 레이아웃을 건드리는 일이라 분리했다.

**실측 근거(0727)**: `RSRM_SalesMst` 730행·발급명 빈 값 **0건** / `C0130`=런소프트3 · `D0078`=런소프트 · `D0079`=런소프트2.
검증: BE·FE tsc 0 · vitest 1,370 통과(발급명 맵·라벨 순수 테스트 신설). SCHEMA.md에 `RSRM_SalesMst` 등재.

---

## 14. 잔액 소스 정정 — 통계 스냅샷 → 계정 원장 실시간값 ★구현 완료 (2026-07-27)

**발단(Harold)**: 충전 요청 화면 잔액이 `C0130 0원(07-09 기준)` / `D0079 10,383,500(07-23 기준)`으로 기준일이 제각각.
게이트웨이 실값은 `C0130 640,281.6` · `D0078 4,881,401.2` · `D0079 10,384,422.82`. **"강문희가 던져주는 값을 실시간으로 봐야 한다."**

**실측으로 확정된 사실**

| 확인 | 결과 |
|---|---|
| `RSRM_SalesStts` C0130 계정 행(`StoreId=''`) | **전 기간 RemAmt=0** (2026-04~07 전량). `UpdTm`도 `DestDt+6일`(07-15 배치가 07-09분 적재) |
| `RSRM_SalesMst.RemAmt` (62) | C0130 **640281.6250** · D0078 4881227.5000 · D0079 10384423.0000 |
| 같은 값 (143) | **완전 일치** — 62 사본이 멈춘 게 아니라 계속 따라온다 |
| 값의 움직임 | D0078이 몇 분 사이 4,881,401.2 → 4,881,227.5 (**발송분 실시간 차감**) |
| `RSRM_SalesMst.UpdTm` | 2023-07 / 2024-09 = **계정 생성·수정 시각**. 잔액 갱신 시각이 아니다(Harold 지적, 값 움직임이 증명) |

**정정**: 잔액 소스 = `RSRM_SalesStts.RemAmt`(일별 통계 스냅샷) → **`RSRM_SalesMst.RemAmt`(계정 원장)**.
기준일(`as_of_date`) 축 폐기 — 실시간 값에는 기준일이 없고, 원장 `UpdTm`은 기준일로 쓸 수 없다.
옛 순수 함수 `pickLatestBalances`(DestDt·UpdTm 우선순위)는 잘못된 소스 전용이라 폐기하고 **`pickLedgerBalances`** 로 교체.

**권위 행 규칙**: `StoreId = CustId`(계정 대표 행). 여러 개면 `SeqNo` 최대(결정적).
대표 행이 없는 계정(0727 실측 `B0046` 200행·`B0021`·`B0062`)은 **지점 행을 합산하지 않고 `rem_amt=null`(`no_account_row`)**.
합이 계정 잔액이라는 근거가 없고, 돈은 틀린 숫자보다 "확인 불가"가 낫다. 미확정은 `console.log`로 표면화한다.

**화면**: 기준일 표기 제거, 미확정은 `잔액 확인 불가`, 캡션을 "계정 원장 실시간 잔액"으로. 대상 = 고객사 대시보드 잔액 블록 · 충전 요청 탭 잔액 카드.

**이것이 실사용에 준 영향**: 런소프트3(C0130)은 실제 640,281원이 있는데 화면이 **0원**을 보여주고 있었다.
그대로 뒀으면 고객사가 잔액 0으로 오해해 불필요한 충전 요청을 하고, 직원이 그걸 근거로 충전했을 수 있다.

**검증**: BE·FE tsc 0 · vitest 1,368 통과(`pickLedgerBalances` 9건 신설 — 대표 행 선택·지점 행 0 무시·합산 금지·SeqNo 결정성·소수 보존·음수 실값).
