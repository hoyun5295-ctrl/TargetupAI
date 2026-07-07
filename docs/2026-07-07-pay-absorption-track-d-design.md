# Track D 설계 — PAY 사이트 한줄로 흡수 (에이전트 발송결과·잔액·정산)

> 상위 SoT = `docs/레거시서버_폐기_플랜.md` (Track D). 이 문서는 그 Track D의 상세 설계.
> 작성: 2026-07-07 (비토) / 상태: 설계안 — 데이터 유입 경로 확정(§6 선행) 후 착수.
> ⚠️ 미확정 사실은 **[확인]** 표기. 추측으로 구현 진입 금지 (no_guess).

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
  CustId   varchar(5)
  StoreId  varchar(4)   -- 발송ID (S001…)
  RemAmt   float        -- 잔액 (게이트웨이가 넣음)
  MsgType  varchar(2)   -- S/L/M/K/X(팩스)/KS(카톡후SMS)/KL(카톡후LMS)
  TotCnt   int          -- 총건
  OkCnt    int          -- 성공
  FailCnt  int          -- 실패
  ReadyCnt int          -- 대기
  UpdTm    datetime
  InsTm    datetime
  -- PK: [확인⑩] 실제 PK에 MsgType 포함 여부 — replace 기준키 확정용.
  --     유형별 분리 저장이면 PK=(DestDt,CustId,StoreId,MsgType).
RSRM_SalesMst   -- 운영자 원부 (CustNm·StoreNm·PayTp·RemAmt). [확인⑨] 실데이터 재요청 대상.
RSRM_FillAmtHist-- 충전이력. 역방향(§4) 필요 시에만.
```

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

### 3-3. 슈퍼관리자 — 전체 정산 합산
- 전체 업체 발송량 × 단가 → 결제/일일차감/잔액 현황 (PAY page 전체현황 대체).
- 단가: [확인] PAY 단가(RSRM_SalesPrice) vs 한줄로 단가 중 정산 기준 통일 결정.

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

| Phase | 내용 | 선행 |
|-------|------|------|
| 1 | 수신 DB 스키마 3테이블 + 계정 + 54·57·58 인바운드 → 강문희 목적지 변경 발주 → 데이터 유입 확인(PAY와 동일 기간 합계 대조 검증) | §6 전부 |
| 2 | backend GET /api/agent-results(회사 격리) + agent 조회 화면 + `AGENT_ALLOWED_PATHS` 배선 | Phase 1 |
| 3 | both `/manage` StatsTab 'Agent 발송' 구분 | Phase 2 |
| 3.5 | (선택·편의) 한줄로 충전 입력 화면 + FillAmtHist INSERT — **필수 아님.** 선불 충전은 게이트웨이 직접 유지가 최소. 넣을 경우만 6원칙 실측 1건 | Phase 3 후, Harold 결정 시 |
| 4 | 슈퍼관리자 정산 합산 (단가 기준 확정 후) | Phase 3 |
| 5 | PAY 접속 차단 2주 무클레임 → 레거시 폐기(Track F) | Phase 1~4 |

---

## 6. 착수 전 선행 (blocker — §서팀장/강문희)

1. **RSRM_SalesMst 덤프 재요청** — CustNm·StoreId(발송ID)·PayTp·단가. (PAY ID.xlsx는 RSRM_Mem 로그인 계정뿐 = 업체 매칭 불가)
2. **PayTp 분포** — 충전 역방향(§4) 유지/폐기 결정.
3. **수신 DB 접속정보 확정 → 강문희 발주** — MySQL 계열, 54·57·58 인바운드, replace 기준키.
4. **RSRM_SalesStts 실제 PK에 MsgType 포함 여부** — 수신 테이블 replace 기준키(유형별 통계 덮어쓰기 방지).

---

## 7. 위험·주의

- **replace 기준키 오설정 = 유형별 통계 소실**: (DestDt,CustId,StoreId) 단위 삭제 시 MsgType 여러 행이 함께 지워짐 → 게이트웨이가 그 grain의 전 유형을 한 배치로 재삽입하는 구조인지 확인(⑩). 수신 테이블은 READ만이라 우리 쪽 무결성 위험은 낮으나, 조회 집계가 grain을 잘못 잡으면 이중/누락.
- **수신 DB 커넥션 격리**: 기존 QTmsg MySQL pool 재사용 시 발송 경로 영향 0 확인. 신규 pool 권장.
- **게이팅 함정**: `AGENT_ALLOWED_PATHS` 확장 누락 = 에이전트 발송결과 화면 접근 불가(§3-1).
- **잔액 이중 위치**: RSRM_SalesMst.RemAmt(현재잔액) + RSRM_SalesStts.RemAmt(일자 스냅샷) — 조회 시 어느 것을 진실로 볼지 정의.
