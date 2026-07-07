# Track D 설계 — PAY 사이트 한줄로 흡수 (에이전트 발송결과·잔액·정산)

> 상위 SoT = `docs/레거시서버_폐기_플랜.md` (Track D). 이 문서는 그 Track D의 상세 설계.
> 작성: 2026-07-07 (비토) / 상태: 설계안 — 데이터 유입 경로 확정(§6 선행) 후 착수.
> ⚠️ 미확정 사실은 **[확인]** 표기. 추측으로 구현 진입 금지 (no_guess).
> ★ 2026-07-07 서팀장 2차 회신 반영 — SalesMst 원부 수령(730행 분석)·선불 실재·강문희 3답변(§2-2 SysId·replace 기준·인바운드 방향). 잔여 blocker = §6.

---

## 0. 목표

PAY 사이트(pay.invitobiz.com:8080) 폐기. `usage_type = agent / both` 업체가 자기 QTmsg 발송량·잔액을 한줄로에서 조회. 슈퍼관리자가 전체 정산을 합산 조회. 게이트웨이(중계서버 54·57·58)가 결과 통계를 레거시 `sales` DB 대신 **한줄로가 지정한 수신 DB**로 적재.

핵심 원칙: 게이트웨이 코드 변경 최소(접속 대상 DB만 교체). 한줄로는 수신 테이블을 **읽기만** 한다(적재는 게이트웨이가 replace 방식으로 수행).

---

## 1. 이미 구현된 기반 (Track A — 재사용)

| 자산 | 위치 | 역할 |
|------|------|------|
| `companies.usage_type` (web/agent/both) | companies.ts 생성 L1508 / 수정 L1902 | 슈퍼관리자 유형 3종 + CHECK + 503 방어 |
| `company_agent_ids` (회사 1:N 발송ID, 전역 UNIQUE) | companies.ts L1947~2054 (GET/POST/DELETE) | **CustId·StoreId ↔ 한줄로 회사 매핑 축** |
| `isAgentOnlyCompany` 게이팅 | authStore.ts L20 / App.tsx L79·L95 | agent 전용 = `AGENT_ALLOWED_PATHS`만 |

Track D는 이 3개 위에 "데이터 유입 + 조회 화면 + 정산"만 얹는다.

---

## 2. 데이터 유입 (수신 DB)

### 2-1. 방식
한줄로 측 **MySQL 계열(MariaDB 호환) 수신 인스턴스**에 레거시와 동일 스키마 3테이블을 두고, 그 접속정보를 강문희에게 전달 → 게이트웨이는 접속 대상 DB만 교체.
- 한줄로 스택 = PostgreSQL(메인) + MySQL(QTmsg 발송). 게이트웨이가 mysql driver 직결이므로 수신은 **MySQL 계열**이어야 한다.
- 권장: 기존 QTmsg MySQL 서버에 별도 DB `pay_ingest` 신설 + 전용 계정 + 54·57·58 인바운드 open. 새 인스턴스 없이 논리 분리. (물리 위치·방화벽은 Harold/서팀장 인프라 영역 — 설계는 "MySQL 계열 + 3테이블 + 54·57·58 인바운드"만 명시)
- 대안(강문희 답변): API 수신도 가능하나 **delete+insert 둘 다** 구현 필수(실시간 replace). DB 직결이 개발부담·정합 면에서 우선.

### 2-2. 수신 스키마 (레거시 테이블설계 엑셀 기준 — 원본 유지)
```
RSRM_SalesStts  -- 중계서버가 replace(있으면 삭제 후 insert)로 적재. 한줄로는 READ only.
  DestDt   varchar(8)   -- YYYYMMDD
  SysId    varchar(2)   -- ★ 2026-07-07 강문희 개선 확정: 서버 구분(54/57/58) 컬럼 신설 — 수신 스키마에 추가
  CustId   varchar(5)
  StoreId  varchar(4)   -- 발송ID = CliBillId (강문희 확정)
  RemAmt   float        -- 잔액 (게이트웨이가 넣음)
  MsgType  varchar(2)   -- S/L/M/K/X(팩스)/KS(카톡후SMS)/KL(카톡후LMS)
  TotCnt   int          -- 총건
  OkCnt    int          -- 성공
  FailCnt  int          -- 실패
  ReadyCnt int          -- 대기
  UpdTm    datetime
  InsTm    datetime
  -- 키(강문희 확정): (DestDt, CustId, StoreId, MsgType) + 개선 SysId 포함 → (DestDt, SysId, CustId, StoreId, MsgType)
  -- replace 실동작(⑩ 해소): DELETE WHERE DestDt='당일' AND CustId LIKE '<billIdPrefix>%' (서버별 CustId 첫 영문자 상이)
  --   → 일자+서버 단위 몽땅 삭제 후 전 유형 재집계 INSERT = MsgType 덮어쓰기 위험 없음(한 배치 전체 재삽입 구조).
  --   ★ prefix 매핑 확정(서팀장 2026-07-07): B=54 / C=57 / D=58. 이관분 SysId 백필 = §7-2 ④-c.
RSRM_SalesMst   -- 운영자 원부 (⑨ 해소 — 2026-07-07 수령·분석 §2-4). 단가 컬럼은 없음(별도 RSRM_SalesPrice).
RSRM_FillAmtHist-- 충전이력. 역방향(§4) 필요 시에만.
```

### 2-4. SalesMst 원부 분석 (2026-07-07 수령 — RSRM_SalesMst.xlsx 730행)
- 컬럼: SeqNo·CustId·CustNm·StoreId·StoreNm·PayTp·RemAmt·Memo·MobNo·Email·UpdTm·InsTm. **단가 없음** → 정산(§3-3)은 RSRM_SalesPrice 덤프 추가 필요.
- CustId 고유 499 / StoreId 고유 383 / (CustId,StoreId) 중복 0. **1 CustId : N StoreId = 4곳**(B0046=200개·B0021=4·C0002=3·B0062=2) — company_agent_ids 1:N 구조 정합.
- **PayTp: 2(선불)=385행·1(후불)=345행.** 후불 행 다수는 StoreId 없음(NaN) → **매핑 축은 StoreId 단독 불가, CustId+StoreId 이원**(§2-3 [확인] 해소: 통계의 StoreId=CliBillId, 원부에 StoreId 없는 업체는 CustId로 매칭). 동일 CustId가 PayTp 1·2 두 행으로 공존하는 사례 있음(언니가간다 B0023, 고운 B0225) — 잔액은 PayTp=2 행의 RemAmt.
- 선불 잔액>0 = 177행, 잔액 합 39,276,527원. 상위: 콜비서_미1 845만·런소프트2 687만·범문자 588만·런소프트 409만·유다솔루션3 207만….
- 서팀장 5곳 실측 대조: 런소프트(D0078·D0079·C0130) 피케이포유(B0081·82) 언니가간다(B0023) 시큐엠(C0103·104) 고운(B0225 — 종료·잔액 508,002원 보존 확인). "대표적으로"라 했듯 실제 선불은 더 많음(잔액>0 177행) — 활성 업체 수는 유입 데이터(SalesStts)로 확정.

### 2-3. 회사 매핑
- 발송 통계 grain = `(CustId, StoreId)`. 한줄로 회사 매핑은 `company_agent_ids.agent_send_id`.
- **[확인] 발송ID = StoreId인가 CustId인가.** 레거시 통계 grain·B0046 사례(CustId 1개에 StoreId 174개)로 보면 **agent_send_id = StoreId**가 자연스럽고, 총판(1 CustId : N StoreId)은 `company_agent_ids` 1:N 구조와 정확히 맞음.
- 총판 구분이 CustId 단위로도 필요하면 `company_agent_ids`에 `cust_id` 컬럼 추가 검토(현재 스키마 재확인 후 — db_column_verify).

---

## 3. 조회 화면 (3종)

### 3-1. 에이전트 전용(agent) — 신규 `/agent-results`
- 위치: 카카오 템플릿 관리(`/kakao-rcs`) 옆 메뉴.
- 내용: 일별 × 발송ID별 SMS/LMS/MMS/카톡(+팩스·카톡폴백) 성공·실패·대기 + 잔액 + 엑셀 다운로드 (PAY page1 대체).
- 회사 격리: `company_agent_ids`로 자기 발송ID(StoreId)만.
- 게이팅: `AGENT_ALLOWED_PATHS`에 `/agent-results` **추가 필수** (안 하면 진입 즉시 `/kakao-rcs`로 회수 — App.tsx L95).

### 3-2. both 업체 — 기존 `/manage` StatsTab에 'Agent 발송' 구분 추가
- 웹 발송(PG 자체 차감·QTmsg 한줄로 발송) + 에이전트 발송(수신 DB) 한 화면 병합.
- 탭 또는 채널 필터로 '웹 발송 / Agent 발송' 구분. 기존 웹 통계 산식 무접촉(회귀 0).

### 3-3. 슈퍼관리자 — 전체 정산 합산 + 거래내역서 이용구분 (★ Harold 2026-07-07: 조회와 분리 금지, 한 번에)
- 전체 업체 발송량 × 단가 → 결제/일일차감/잔액 현황 (PAY page 전체현황 대체).
- **단가 원장 = 한줄로 (Harold 확정 2026-07-07)**: 레거시 RSRM_SalesPrice는 대부분 NULL(서팀장 — 원하는 업체만 기입 정책)이라 원천 불가 → 덤프 요청 철회. agent 업체도 companies로 생성되므로 직원이 슈퍼관리자에서 단가 직접 입력(웹 업체와 동일 패턴). Phase 2 설계 확정 사항: ①Agent 단가는 웹 cost_per_*와 **분리 입력**(Agent엔 X팩스·KS/KL 등 웹에 없는 유형 + both 업체 채널별 단가 상이 가능) ②미입력 업체 = "단가 미설정" 표시 + 미입력 목록 화면(임의 기본값 계산 금지 — no_arbitrary_constants).
- **거래내역서(billing_invoices PDF) 이용구분 의무**: 웹+에이전트 겸용(both) 업체는 거래내역서에 '웹 발송'/'Agent 발송'이 정확히 구분되어 나와야 한다. billing.ts = **발송 파이프라인 절대 보호 영역** — 기존 웹 정산 산식 무접촉(회귀 0) + Agent 구분 추가 방식. billing_invoices 스키마 확장 여부는 구현 설계 시 information_schema 검증 후 확정(db_column_verify).

---

## 4. 충전 역방향 (선불 약 5% — 읽기 전용으로 충분, Harold 2026-07-07)

업체 95% 후불 / 5% 선불. 충전 입력 경로가 **둘** 있음(Harold 확인): ①**게이트웨이 직접** ②PAY 화면. → PAY를 내려도 게이트웨이 직접 경로가 살아 있어 선불 충전이 끊기지 않는다.

**핵심: 잔액은 게이트웨이가 1분마다 통계로 push한다.** 충전을 어디서 하든(게이트웨이·PAY) 그 결과 잔액(RemAmt)은 게이트웨이가 실시간으로 `RSRM_SalesStts`/`Mst`에 실어 보낸다. 따라서 **한줄로는 잔액을 READ만 해도 항상 최신·정확**하다. 충전 입력을 한줄로가 대행할 필요가 없다.

**결론 — 흡수는 READ-only로 충분:**
- Track D 본체 = 통계·잔액·충전이력 **조회 + 정산**. 충전 입력(FillAmtHist write)은 **한줄로 필수 아님.** 선불 5% 충전은 게이트웨이 직접 경로 유지.
- 수신 DB에 `RSRM_FillAmtHist`는 포함하되(게이트웨이 역방향 동기화가 그 테이블을 계속 읽으므로 목적지만 이동), 한줄로는 그 테이블을 **조회만**(충전이력 화면).
- ⇒ 5% 선불이 스코프를 키우지 않는다. §5 Phase 3.5(충전 입력 화면)는 **선택(편의)로 강등** — 필수 경로에서 제외.

**[확인] 게이트웨이 직접 충전이 잔액에 반영되어 RemAmt로 통계에 유입되는지** — 거의 확실(잔액을 게이트웨이가 push)하나, 목적지 변경 후 실측 1건으로 확인(게이트웨이 직접 충전 → 수신 DB RemAmt 상승 조회).

**선택지(Harold 결정 — 급하지 않음):** 편의를 위해 한줄로에 충전 입력 화면을 두려면 FillAmtHist INSERT(RsApplyFlag='N') 1경로 추가 = 게이트웨이 수집엔진 무변경(픽업 → N→Y). 단 돈에 닿으므로 6원칙 실측 1건(충전→픽업→잔액 상승→재조회). 지금은 게이트웨이 직접 유지가 최소.

---

## 5. 구현 단계

> ★ 2026-07-07 Harold 지시로 재편 — 조회(옛 2·3)와 정산·거래내역서(옛 4)를 **분리 구현 금지, Phase 2로 일괄 설계·구현·배포 1회.** 정산 연동이 빠진 조회-only 배포는 하지 않는다.

| Phase | 내용 | 선행 |
|-------|------|------|
| 1 | 수신 DB 구축(§7 런북) → 강문희 목적지 변경 발주 → 데이터 유입 확인(143 스냅샷 대조 §7-4) | §6 잔여(IP 3개·SysId는 §7에 반영됨) |
| 2 | **일괄 구현**: ①agent 조회 `/agent-results`+`AGENT_ALLOWED_PATHS` ②both `/manage` StatsTab 'Agent 발송' 구분 ③슈퍼관리자 정산 합산 ④**거래내역서 이용구분(§3-3 — billing.ts 보호구역·웹 산식 무접촉)** — 설계 승인 → 구현 → 6원칙 실측(정산 1건 대조) → 배포 1회 | Phase 1 + RSRM_SalesPrice 덤프 |
| 2.5 | (선택·편의) 한줄로 충전 입력 화면 + FillAmtHist INSERT — **필수 아님.** 선불 충전은 게이트웨이 직접 유지. 넣을 경우만 6원칙 실측 1건 | Phase 2 후, Harold 결정 시 |
| 3 | PAY 접속 차단 2주 무클레임 → 레거시 폐기(Track F) | Phase 1~2 |

---

## 6. 착수 전 선행 (blocker — 2026-07-07 서팀장 2차 회신 반영)

1. ~~RSRM_SalesMst 덤프~~ **완료(2026-07-07 수령·§2-4 분석)**. ~~1-b RSRM_SalesPrice~~ **철회(2026-07-07)** — 레거시 단가 대부분 NULL 확인, 단가 원장=한줄로 직원 입력으로 확정(§3-3).
2. ~~PayTp 분포~~ **완료** — 선불 실재(잔액>0 177행·합 3,927만원·고운 잔액 보존). §4 READ-only 결론 유지(충전은 게이트웨이 직접 경로).
3. **수신 DB 접속정보 확정 → 강문희 발주** — 형식 확정(강문희): 호스트/포트/DB명/계정/비번 5요소를 우리가 정해 전달(현행 예시 143:21772, DB=sales). **방화벽 방향 확정: 54·57·58→송신이므로 우리(수신) 측 인바운드만 open.** 잔여 = 수신 DB 물리 위치·5요소 확정(Harold — ⚠️ 인바운드 개방 필요라 2026-02-28 교훈과 정합 필수: 127.0.0.1 바인딩 불가한 유일 예외 지점 → 비표준 포트 + 54·57·58 3개 IP만 화이트리스트 + 최소권한 전용 계정 + 기존 smsdb와 분리).
4. ~~replace 기준키~~ **완료(⑩ 해소)** — 일자+서버(CustId prefix LIKE) 몽땅 삭제 후 (DestDt,CustId,StoreId,MsgType) 재집계 삽입 = 유형 덮어쓰기 위험 없음. **개선 반영 의무 = 수신 스키마에 SysId 컬럼 추가**(§2-2). 잔여 [확인] = billIdPrefix(B/C/D) ↔ 서버(54/57/58) 매핑표.

---

## 7. Phase 1 런북 — 수신 DB 구축 (2026-07-07 확정 설계, Harold 컨펌 후 실행)

### 7-1. 확정 구성 (정답 1개)
| 항목 | 값 | 근거 |
|------|-----|------|
| 위치 | invito(58.227.193.62) 신규 도커 컨테이너 `pay-ingest-db` | 폐기 프로젝트에 신규 서버 비용 역행·143은 폐기 대상·backend가 localhost 조회 |
| 이미지 | MariaDB — 143과 동일 메이저 버전(§8-2 ①에서 확인 후 확정, 기본 후보 10.11 LTS) | 동일 스키마·dump 호환 최대 |
| 호스트 포트 | **23388** (제안 — Harold 확정) | 비표준(143도 21772 방식) |
| DB/게이트웨이 계정 | `sales` / `sales` 유지, **비밀번호만 신규 강력** | 강문희 측 변경 = 호스트·포트·비번 3개로 최소 |
| 게이트웨이 권한 | `sales.*`에 SELECT/INSERT/UPDATE/DELETE, **호스트 제한 = 54·57·58 공인 IP 3개만**(와일드카드 % 계정 금지) | 정방향 replace(DELETE+INSERT) + 역방향 FillAmtHist 읽기·RsApplyFlag UPDATE |
| 한줄로 backend 계정 | `hanjul_ro`@`localhost`·`172.%` — **SELECT only** | READ-only 원칙을 계정 권한으로 강제 |
| 데이터 이식 | 143에서 mysqldump 3테이블(스키마+데이터) 그대로 복원 → SysId ALTER 1건 | 추측 스키마 0·원부 RemAmt/충전이력 연속성. **★정정(2026-07-07 Harold 지적): 전환일 직전 최종 dump = 3테이블 전부**(게이트웨이 replace는 당일 DestDt만 삭제·재삽입 — dump~전환 사이 과거 일자는 게이트웨이가 복구 안 함) → 통째 재복원 후 SysId ALTER+백필 재실행 |
| 백업 | 일일 mysqldump cron (FillAmtHist=이력 보호. Stts/Mst는 게이트웨이 재적재 파생) | 개발 안전 §2 백업 원칙 |
| 롤백 | 접속정보를 143으로 되돌리면 끝 (DB직결의 장점) | 최소 영향·가역성 |

**⚠️ 컨펌 필수 — 0.0.0.0 예외**: "도커 포트 바인딩 127.0.0.1, 0.0.0.0 절대 금지"(2026-02-28 랜섬웨어) 룰의 **유일 예외 지점**. 외부(54·57·58)가 붙어야 하므로 공개 바인딩이 불가피. 방어 3중 = ①MySQL 계정 host를 3개 IP로 제한(핵심 — %계정 없음) ②비표준 포트 ③OS 방화벽 3-IP 허용(가능 환경 시). 기존 발송 기간계 smsdb 컨테이너는 127.0.0.1 그대로 무접촉.

> ★ 2026-07-07 Harold 확정: ①0.0.0.0 예외 승인 ②포트 23388 확정 ③실행 순서 승인 ④**정산 일괄 원칙** — 슈퍼관리자 정산·거래내역서(billing_invoices PDF)에 웹/Agent 이용구분이 정확히 나뉘어 들어가야 하며, 조회 화면과 분리하지 않고 **한 번에 설계·구현**한다(§5 Phase 재편).

### 7-2. 실행 절차 (Harold 직접 — 순서 준수)
> ★ 진행3(2026-07-07 21:45): **⑤ 방화벽 완료 — Phase 1 서버 준비 전체 종료.** `pay-ingest-fw.service`(root로 생성·start·enable) → DOCKER-USER 실측: ACCEPT 58.227.193.58/.57/.54 → DROP(ctorigdstport 23388) 순서 정상·재부팅 지속. 잔여 = ⑥ 강문희 발주(Harold 이메일 — §7-3 문안+sales 비번 별도 채널) → 전환일 절차(최종 dump 3테이블→재복원→SysId 재백필→전환) → §7-4 유입 검증. 검증 후 Phase 2 설계 착수.
> ★ 진행2(2026-07-07 21:30): **③ 계정 완료**(sales×3 IP=58.227.193.54/.57/.58 확정 — 한줄로 62와 같은 대역·hanjul_ro×2·%호스트 0) · **④-c SysId 백필 완료**(54=801,720/57=7,468/58=125,044 합=934,232 전체 일치·NULL 0=B/C/D 외 prefix 없음) · **⑤ = netfilter-persistent 부재 → systemd 유닛 `pay-ingest-fw.service`로 대체**(After=docker, oneshot iptables 4줄 — 지금 적용+재부팅 지속 일원화, root 필요). 잔여 = ⑤ 실행 확인 → ⑥ 발주.
> ★ 진행(2026-07-07 21:05): ⓪~④ **완료** — 143 실측 MariaDB 5.5.56 → 이미지 mariadb:10.11(`--sql-mode=""` 레거시 호환) 확정·컨테이너 기동(10.11.18)·dump 82MB 복원·SysId ALTER·행수 대조 일치(934,232/730/7,026 — Mst 730=서팀장 엑셀 730행과도 일치). **④-b(신규): 공식 이미지가 기본 생성하는 `root@'%'`(원격 root) DROP** — 원격 접속 가능 계정을 3-IP sales로만 한정하는 마감(컨테이너 관리는 root@localhost 소켓이라 무영향). 잔여 = ③·⑤(서팀장 IP 3개 회신 대기)·⑥ 발주.
⓪ **[invito]** 비밀번호 3개 생성(영숫자만 32자 — 셸/설정 인용 문제 없음). 출력을 개인 보관, 강문희에겐 sales용만 별도 채널:
```
for k in root sales hanjul_ro; do echo "$k: $(openssl rand -hex 16)"; done
```
① **[143]** 버전 확인 + 1차 dump:
```
mysql -h127.0.0.1 -P3388 -usales -p -e "SELECT VERSION();"
mysqldump -h127.0.0.1 -P3388 -usales -p sales RSRM_SalesStts RSRM_SalesMst RSRM_FillAmtHist > /tmp/pay_sales_3t_$(date +%Y%m%d).sql
```
② **[invito]** 컨테이너 생성(비번 2개 준비 — root용·sales용):
```
docker run -d --name pay-ingest-db --restart unless-stopped \
  -e MARIADB_ROOT_PASSWORD='<루트비번>' -e TZ=Asia/Seoul \
  -p 23388:3306 -v /home/administrator/pay-ingest-data:/var/lib/mysql mariadb:<①에서 확인한 메이저>
```
③ **[invito]** DB·계정 (54·57·58 공인 IP는 강문희 회신으로 채움):
```
docker exec -i pay-ingest-db mariadb -uroot -p'<루트비번>' <<'SQL'
CREATE DATABASE sales;
CREATE USER 'sales'@'<IP54>' IDENTIFIED BY '<sales비번>';
CREATE USER 'sales'@'<IP57>' IDENTIFIED BY '<sales비번>';
CREATE USER 'sales'@'<IP58>' IDENTIFIED BY '<sales비번>';
GRANT SELECT,INSERT,UPDATE,DELETE ON sales.* TO 'sales'@'<IP54>','sales'@'<IP57>','sales'@'<IP58>';
CREATE USER 'hanjul_ro'@'localhost' IDENTIFIED BY '<ro비번>';
CREATE USER 'hanjul_ro'@'172.%' IDENTIFIED BY '<ro비번>';
GRANT SELECT ON sales.* TO 'hanjul_ro'@'localhost','hanjul_ro'@'172.%';
SQL
```
④ **[invito]** 복원 + SysId ALTER + 행수 대조(143 COUNT와 일치 확인):
```
docker exec -i pay-ingest-db mariadb -uroot -p'<루트비번>' sales < /tmp/pay_sales_3t_YYYYMMDD.sql
docker exec -i pay-ingest-db mariadb -uroot -p'<루트비번>' sales -e \
  "ALTER TABLE RSRM_SalesStts ADD COLUMN SysId varchar(2) NULL AFTER DestDt; \
   SELECT (SELECT COUNT(*) FROM RSRM_SalesStts) stts,(SELECT COUNT(*) FROM RSRM_SalesMst) mst,(SELECT COUNT(*) FROM RSRM_FillAmtHist) fill;"
```
④-c **[invito]** 이관분 SysId 백필(prefix 확정 B=54/C=57/D=58 — 게이트웨이 연결 전 초기화라 안전):
```
docker exec -i pay-ingest-db mariadb -uroot -p'<루트비번>' sales -e "UPDATE RSRM_SalesStts SET SysId='54' WHERE CustId LIKE 'B%'; UPDATE RSRM_SalesStts SET SysId='57' WHERE CustId LIKE 'C%'; UPDATE RSRM_SalesStts SET SysId='58' WHERE CustId LIKE 'D%'; SELECT SysId, COUNT(*) cnt FROM RSRM_SalesStts GROUP BY SysId;"
```
(GROUP BY에 NULL 잔존 시 = B/C/D 외 prefix 존재 — 서팀장 확인 대상.)
⑤ OS 방화벽 — **⚠️ 도커 함정: `docker -p`로 열린 포트는 ufw·INPUT 체인 규칙을 우회한다**(도커가 nat/FORWARD로 먼저 처리). 도커 트래픽 필터링의 공식 지점 = `DOCKER-USER` 체인:
```
# DROP을 먼저 넣고, ACCEPT 3개를 -I로 그 위에 삽입 (최종 순서: ACCEPT×3 → DROP)
iptables -I DOCKER-USER -p tcp -m conntrack --ctorigdstport 23388 -j DROP
iptables -I DOCKER-USER -p tcp -m conntrack --ctorigdstport 23388 -s <IP54> -j ACCEPT
iptables -I DOCKER-USER -p tcp -m conntrack --ctorigdstport 23388 -s <IP57> -j ACCEPT
iptables -I DOCKER-USER -p tcp -m conntrack --ctorigdstport 23388 -s <IP58> -j ACCEPT
iptables -L DOCKER-USER -n --line-numbers   # 순서 확인 (ACCEPT 3개가 DROP 위)
```
재부팅 시 소실 주의 — `netfilter-persistent save`(설치돼 있으면) 또는 부팅 스크립트로 지속화. 이 단계는 2차 방어(포트 스캔 은닉)이고, 1차 구조 방어는 ③의 계정 host 제한(화이트리스트 외 IP는 인증 시도 자체가 거부)이라 ⑤가 늦어져도 ③만으로 무단 로그인은 불가.
⑥ 강문희 발주(§7-3) → 게이트웨이 접속 테스트 → 전환일 확정 → **전환일 절차(기간 갭 0 보장)**: ①[143] 3테이블 최종 dump → ②[invito] 통째 재복원 → ③SysId ALTER+백필 재실행(B=54/C=57/D=58) → ④강문희 접속정보 전환 → ⑤당일 유입 COUNT 확인(이상 시 접속정보 원복 = 즉시 롤백). (최종 dump에 Stts 포함 필수 — replace는 당일만 지워 과거 일자 갭은 자동 복구 안 됨.)

### 7-3. 강문희 발주 문안 (전환 시 전달 — 비번은 별도 채널)
> ★ 54·57·58 공인 IP = 58.227.193.54/.57/.58 확정(Harold 2026-07-07 — 한줄로 62와 같은 대역, 서버명=마지막 옥텟 관례. 143=27.102.203.143과 동일 관례).
>
> 수신 DB 준비 완료됐습니다. 아래로 적재 목적지 변경 부탁드립니다.
> - 호스트 58.227.193.62 / 포트 23388 / DB `sales` / 계정 `sales` / 비번 별도 전달 (MariaDB, 기존과 동일 스키마 3테이블 + 데이터 이관 완료)
> - 접속은 54·57·58(58.227.193.54/.57/.58)에서만 열려 있습니다.
> - 말씀하신 개선사항대로 RSRM_SalesStts에 `SysId varchar(2)`를 추가했습니다 — 적재 시 '54'/'57'/'58' 값을 함께 넣어 주세요.
> - 역방향(RSRM_FillAmtHist 충전이력 수집 엔진)도 같은 새 DB를 보도록 함께 변경 부탁드립니다.
> - 전환: 가능하면 병행 적재(양쪽 동시)로 시작하고, 어려우면 전환일을 지정해 주세요. 문제 시 접속정보만 되돌리면 즉시 원복됩니다.

### 7-4. Phase 1 완료 판정 (6원칙 ⑤ 실측)
- 전환 후 수신 DB `RSRM_SalesStts` 당일 행 유입 확인 + PAY(143) 전환 직전 스냅샷과 동일 grain 합계 대조.
- 게이트웨이 직접 충전 1건 → RemAmt 상승이 수신 DB로 유입되는지(§4 [확인] 해소).
- 완료 후 Phase 2(backend 신규 read pool + `/agent-results`) 착수 — 별도 설계 승인.

## 8. 위험·주의

- ~~replace 기준키 오설정~~ **해소(2026-07-07 강문희)**: 일자+서버 단위 전체 삭제 후 전 유형 재삽입 구조 확정 — 유형별 소실 위험 없음. 남은 주의 = 조회 집계 키에 **SysId 포함**(같은 CustId가 복수 서버에서 오면 SysId 없인 합산 오류) + 원부 내 동일 CustId 복수 행(PayTp 1·2 공존 — B0023·B0225 실측) 매핑 시 PayTp=2 행의 RemAmt가 잔액 진실.
- **수신 DB 커넥션 격리**: 기존 QTmsg MySQL pool 재사용 시 발송 경로 영향 0 확인. 신규 pool 권장.
- **게이팅 함정**: `AGENT_ALLOWED_PATHS` 확장 누락 = 에이전트 발송결과 화면 접근 불가(§3-1).
- **잔액 이중 위치**: RSRM_SalesMst.RemAmt(현재잔액) + RSRM_SalesStts.RemAmt(일자 스냅샷) — 조회 시 어느 것을 진실로 볼지 정의.
