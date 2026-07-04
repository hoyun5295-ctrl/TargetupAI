# 브랜드메시지 정식 통합 설계서

- 작성일: 2026-07-04
- 상태: **설계 초안 — 후속작업으로 보류(2026-07-04). Harold가 직원 회의 후 재확정 예정.** RCS는 별도 후속 트랙.
- 결정권자: Harold
- SoT: 이 문서. 참조 규격: 휴머스온 IMC-Agent 매뉴얼 v2.3.1(레이아웃 규약) + 큐테크놀로지 57서버 포팅 설명서(2026-0206·0510) + `qtmsg.xml`.

---

## 0. 전송 실체 재확정 (2026-07-04 조사 결과 — 회의 후 이 기준으로 재작성)

> §3~§8이 "IMC_BM 테이블 직접 적재"를 전제로 쓰였으나, 실측 결과 그 전제가 틀렸다. 아래가 실제 전송 구조다. 재개 시 전송(WS-3)·집계(WS-2)를 이 기준으로 재작성할 것.

- **IMC_BM_FREE/BASIC_BIZ_MSG 테이블은 운영 MySQL 전 스키마에 부재**(실측: `LIKE 'IMC_BM%'` → Empty set). 즉 현행 `brand-message.ts`→`insertKakaoQueue`(IMC_BM)는 **한 건도 발송 못 하는 死코드**. 그래서 지금까지 브랜드 발송 0.
- 실제 경로 = **QTmsg 큐 `SMSQ_SEND_RCS`**(RCS·브랜드 공유, 로그 `SMSQ_SEND_RCS_YYYYMM`), 브랜드 **msg_type='F'**(알림톡 'K'와 별개, RCS='R'). 컬럼은 알림톡과 같은 k_* 계열 + 이미지용 `file_name1~6`: `dest_no·call_back·msg_contents·title_str·k_template_code·k_button_json·k_etc_json(1024자)·file_name1~6·app_etc1·app_etc2·bill_id·sender_code·rsv1='1'`.
- 성공 결과코드 = **1801(친구성공)/1802(비친구성공)**(0206 버전은 1800). → 우리 발송결과/통계는 브랜드를 이 코드로 성공 분류(알림톡 REPORT_CODE='0000'과 다름).
- **게이트웨이(57서버/cnm2) 과금체계는 우리 무관**(Agent 직접 접속 고객용 별도 선불엔진). 한줄로는 **자체 PG 선불로 차감**(§WS-1 유효). 우리 일 = QTmsg 큐에 브랜드를 올바르게 적재해 내보내는 것뿐.
- 전송부 재배선: `insertKakaoQueue`(IMC_BM, 폐기) → `insertAlimtalkQueue`를 미러한 `insertBrandQueue`(SMSQ_SEND_RCS, msg_type='F', 이미지=file_name, 리치콘텐츠=k_etc_json/k_button_json, app_etc1=campaignId). 그러면 집계/정산/통계가 SMSQ_SEND_RCS를 app_etc1로 읽어 자동 편입 → §WS-2 IMC_BM 이슈 소멸.

**미결(회의에서 확정할 것)**:
1. `SMSQ_SEND_RCS`가 우리 앱 MySQL(smsdb)에 있는가, 57서버 별도 DB라 별도 커넥션이 필요한가. (확인 SQL: `SELECT TABLE_SCHEMA FROM information_schema.TABLES WHERE TABLE_NAME='SMSQ_SEND_RCS';`)
2. 8유형·캐러셀/쿠폰/커머스/이미지를 `k_template_code`/`k_etc_json`(1024)/`file_name1~6`/`k_button_json`에 담는 정확한 매핑 — 57서버 `/home/mmsr3/agent/qtmsg3.0.8.2/sql/brand/*.sql`(벤더 테스트 정답). k_etc_json 1024 제한상 캐러셀 등은 템플릿(RBC 사전등록)+변수 구조일 가능성 — 실물 확인 필요.
3. 유형별 차등 단가 vs 실제 과금 축(친구/비친구 성공) 정합 — 우리 단가 정책과 통신사 과금 축이 다르므로 슈퍼관리자 단가 설계 시 재확인.

---

## 1. 배경 & 목표

브랜드메시지는 발송 코어·엔드포인트·프론트 에디터·템플릿 등록까지 end-to-end로 구현돼 있으나, **단가·선불·정산·성과·통계에 정식 채널로 편입되어 있지 않다.** 지금은 실사용 발송이 0에 가까운 클린 상태이므로, 반쪽 통합을 나중에 두 번 손대는 대신 **처음부터 단가/선불/정산/성과/통계에 브랜드메시지를 정식 채널로 합쳐서 시작**한다.

목표:
1. 유형별 차등 단가 + 슈퍼관리자 설정 + 선불 차감/환불 정합.
2. 발송결과·통계·정산에서 자유형/기본형 모두 정확 집계(현재 기본형 누락).
3. 성과리포트에 브랜드메시지를 SMS/DM/이메일과 나란한 채널로 편입(발송·비용·ROAS).
4. 발송통계·전송통계 화면에 채널 하나가 늘어도 레이아웃 무결.
5. 매뉴얼 v2.3.1 스펙 정합(발송 거부 위험 제거) — 실측 게이트.
6. 위 전부를 **기간계(SMS/알림톡) 영향 0**으로 진행.

비목표(후속): RCS(젬텍 NGS) 실발송 통합, 브랜드메시지 링크 클릭 단위 추적.

---

## 2. Harold 확정 결정사항

- **단가 = 유형별 차등**(8종). 슈퍼관리자(sys)에서 설정. 회사별 오버라이드 가능.
- **성과 = 이번엔 채널 집계**(발송/도달 건수 + 유형별 비용). 우리 성과는 코호트 ROAS(매출=cdp_events, 비용=성공×단가)라 클릭추적 없이 채널 편입만으로 충분.
- **RCS = 후속 분리.** 단, 단가/선불/정산/성과/통계 뼈대는 향후 채널 확장(RCS 등)을 받아들일 수 있게 채널 파라미터화로 설계(RCS 전용 코드는 추가하지 않음 — YAGNI).
- **기간계 영향 최소화**가 전 워크스트림 최상위 제약.

---

## 3. 현재 구현 지도

### 강점(유지·활용)
- 발송 코어 `utils/brand-message.ts`(CT-12): `BUBBLE_TYPES` 8종·`BUTTON_TYPES` 8종·`sendBrandMessage`(자유형)·`sendBrandMessageTemplate`(기본형)·`buildAttachmentJson`/`buildCarouselJson`·검증·선불차감/환불·문안학습.
- 전송: `utils/sms-queue.ts` `insertKakaoQueue`→`IMC_BM_FREE_BIZ_MSG`, `insertKakaoBasicQueue`→`IMC_BM_BASIC_BIZ_MSG`(IMC-Agent 테이블 직접 적재). 매뉴얼 스펙과 동일 구조.
- 엔드포인트 `routes/campaigns.ts` `POST /brand-send`(`mode: free|template` 분기).
- 프론트 `pages/KakaoRcsPage.tsx` 브랜드메시지 탭 → `components/BrandMessageEditor.tsx`(8유형+쿠폰/커머스/캐러셀/리스트)+`BrandMessagePreview.tsx`. **단 자유형 전용**(mode/templateCode 미전송).
- 템플릿 등록/검수: `utils/alimtalk-api.ts` brand 함수 + `routes/alimtalk.ts` `/brand-templates` + `BrandTemplateForm/ManagementSection`.

### 약점(이번에 보완)
1. [높음] 기본형 `IMC_BM_BASIC` 집계 전면 누락 — results/stats/sync/billing 모두 `IMC_BM_FREE`만 읽음.
2. [높음] 성공 확정 시점 결함 — `POST /brand-send`가 발송 직후 `status='completed'` + `campaign_runs.total_success = 적재 수`. 실도달(REPORT_CODE) 전 성공 확정 → 정산(REPORT_CODE 기준)과 이중 진실.
3. [높음] 선불 단가 0원 버그 — `brand-message.ts`가 `prepaidDeduct(..., 'kakao', ...)`(소문자) 전달, `prepaid.ts`는 `'KAKAO'`(대문자)만 매칭 → **선불 고객 브랜드메시지 0원 차감(무료 발송)**.
4. [중간] 매뉴얼 JSON 구조 불일치 — 쿠폰·아이템 `link{}` 중첩(매뉴얼 flat) / 캐러셀 head `description·img_url`(매뉴얼 `content·image_url`) / 커머스 `currency_unit` 추가·`discount_fixed` 누락 / `imc.img` 미지원.
5. [중간] `BUSINESS_CODE`(특수부가사업자 식별코드) 두 INSERT 모두 미설정 — 인비토 D234 7300 계열 위험.
6. [중간] 제약값 어긋남 — WIDE_ITEM_LIST 4 vs 5 / CAROUSEL 6 vs 3(기본형) / MESSAGE 매뉴얼 표 400 vs 가이드 1300.
7. [낮음] 프론트 자유형 전용(기본형 UI 미연결) / 추적키 `REQUEST_UID` 단일.

---

## 4. 워크스트림

각 WS는 독립 배포 가능하도록 격리한다. 순서: WS-0 → (WS-1 + WS-2 병행) → WS-3 → WS-4/5.

### WS-0 · 실측 선행 (Harold, 코드 착수 전 게이트)
운영 MySQL 실측으로 발송 파이프라인 존재 여부와 컬럼을 확정한다. §8 SQL 참조.

- **★ 2026-07-04 실측 확정: `smsdb.IMC_BM_FREE_BIZ_MSG` 부재(MySQL ERROR 1146).** 우리 앱이 붙는 smsdb에 브랜드 적재 테이블이 없어 **현재 브랜드메시지는 INSERT 실패로 한 건도 발송 불가**(선불 0원 버그와 겹쳐 조용히 실패해 옴). → **최상위 게이트 = IMC-Agent 브랜드 테이블 provisioning.** 전 스키마 위치 확인(§8) 후, 부재면 휴머스온 IMC-Agent 브랜드메시지 활성화/테이블 생성(서팀장·휴머스온 coordination, 우리 코드 아님)이 모든 발송 WS의 선행 조건.
- 테이블 확인되면: `MESSAGE` 실제 길이 + `BUSINESS_CODE` 컬럼 유무.
- 자유형 각 유형 실발송 1건 REPORT_CODE(현 JSON 구조로 쿠폰/커머스/캐러셀이 실제 도달하는지) — provisioning 후.
- 브랜드메시지 `BUSINESS_CODE` 필수 여부(휴머스온 확인).

게이트: **WS-3(발송)·WS-5(기본형 UI)·실발송 검증은 provisioning 완료 후.** WS-1(단가/선불)·WS-2(집계/통계/성과 코드)는 테이블 부재와 무관하게 설계·구현 가능(적재 대상이 생기면 바로 동작하도록 `does not exist` fallback 동반).

### WS-1 · 단가 / 선불 / 슈퍼관리자
목표: 유형별 차등 단가를 회사별로 설정하고, 선불 차감/환불에 정확히 반영.

- 데이터 모델: 신규 테이블 `brand_message_prices`(§5). 전역 기본단가(company_id NULL) + 회사별 오버라이드. 기존 `companies.cost_per_*` 무변경.
- 단가 조회 CT: `utils/brand-pricing.ts`(신규) — `getBrandUnitPrice(companyId, bubbleType)`: 회사 오버라이드 → 전역 기본 → 없으면 0 + 발송 차단(임의 상수 금지, 미설정은 insufficient로 정직 처리).
- 선불 차감: 브랜드 전용 경로. `prepaidDeduct`에 `messageType='BRAND'` + `bubbleType` 인자를 받는 분기 추가(또는 `prepaidDeductBrand` 신설). 단가는 `getBrandUnitPrice`로 조회. **현행 `'kakao'` 소문자 0원 버그 정정 — `brand-message.ts`가 이 경로를 쓰게 교체.**
- 거래 기록: `balance_transactions.message_type = 'BRAND'`, description에 bubble 유형 명시 → 정산·성과 채널 분리.
- 환불: 실패분 환불도 동일 유형별 단가 기준(누적 idempotent 패턴 유지).
- 슈퍼관리자 UI(sys): 브랜드 유형별 단가 설정 화면(전역 기본 8종 + 회사별 오버라이드). 기존 슈퍼관리자 단가 관리와 동일 톤.
- 기간계 영향: SMS/LMS/MMS/KAKAO 차감 경로 무변경. 브랜드 분기만 추가. **★ 지금 0원 → 정상 과금 전환이라 배포 = 과금 시작 시점.** Harold가 시점/공지 통제.

### WS-2 · 집계 + 통계 + 성과 (핵심)
목표: 자유형/기본형 모두 정확 집계 + 브랜드메시지를 성과 정식 채널로.

- 기본형 누락 해소(약점 1): `results.ts`·`stats-aggregation.ts`·`campaign-sync-worker.ts`·`billing.ts`의 `IMC_BM_FREE` 집계에 `IMC_BM_BASIC` 합산을 미러(동일 WHERE/필드). 두 테이블 UNION 또는 헬퍼 단일화. 자유형 산식 불변(회귀 0).
- 성공 확정 정합(약점 2): 성공 지표를 **REPORT_CODE(실도달)로 일원화**한다. `POST /brand-send`는 큐 적재 수를 즉시 success로 굳히지 않는다 — 적재 직후 상태는 발송요청(대기), `campaign_runs.total_success`는 확정 워커/집계가 REPORT_CODE 성공분으로 채운다. status도 적재=발송요청 / 완료=결과 확정 후로 정합. 발송결과·정산이 이미 REPORT_CODE 기준이라 세 소스가 일치.
- 성과 채널 편입: 브랜드 성공 발송을 성과의 채널·고객축 breakdown에 추가 + 유형별 비용을 블렌디드 ROAS 비용에 합산(`performance-roas-core`는 매출/비용만 받으므로 비용 집계에 브랜드 `성공×단가`를 더하는 곳을 찾아 추가). 매출은 cdp_events 기준이라 자동 귀속.
- 코호트 귀속 전제: 브랜드 발송이 **수신 고객과 연결 기록**돼야 고객축 성과가 잡힌다. 현재는 phone 배열만 IMC_BM 적재 → 기존 채널(smsTargetedSent 등)이 고객-발송을 어떻게 기록하는지 확인 후 동일 방식으로 브랜드 발송 수신자를 기록(캠페인↔고객). 이 조사·정합을 WS-2에 포함.
- 통계 UI 무결: `ResultsModal`·`TodayStatsModal`·`PerformancePage` 등 채널 표기를 **채널 파라미터화**. 브랜드 채널 데이터가 0/부재이면 기존과 100% 동일 렌더, 존재하면 가로 스크롤·wrap-safe로 흡수(버그1 관리열 밀림과 동일 원칙: overflow-safe + nowrap 안전망). 채널 하나 추가로 줄바꿈·밀림 발생 방지.
- 채널 확장성: 위 집계·통계·성과의 채널 열거를 상수/설정 1곳으로 모아 향후 RCS 등 채널 추가가 그 목록 갱신으로 끝나게(RCS 전용 코드는 미추가).

### WS-3 · 발송 스펙 정합 (WS-0 실측 gated)
목표: 매뉴얼 v2.3.1 규약과 실제 도달 기준으로 JSON·필드·제약 정합.

- JSON 구조: `buildAttachmentJson`/`buildCarouselJson`를 매뉴얼 규약으로 — 쿠폰·아이템 flat(`url_mobile`/`url_pc`/`scheme_*`), 캐러셀 head `content`/`image_url`, 커머스 `discount_fixed` 지원·`currency_unit` 처리, `imc.img` 옵션. **단, WS-0 실발송 1건으로 실제 도달 확인 후 확정**(매뉴얼과 실동작 불일치 가능 — 실측 우선).
- `BUSINESS_CODE`: 필수로 확인되면 두 INSERT에 세팅(발신프로필/회사 식별코드 소스 확정 후).
- 제약값: WIDE_ITEM_LIST·CAROUSEL·MESSAGE 상한을 매뉴얼/실컬럼에 맞춤(프론트 `BUBBLE_TYPES`와 백엔드 `BUBBLE_TYPES` 양쪽 동기).

### WS-4 · 학습 정합
- 현재 `logCampaignTraining(..., messageType:'KAKAO', source_ref:'{campaignId}:brand')`로 KAKAO 공유 적재. 브랜드 고유 신호가 필요하면 `message_type='BRAND'` 분리 검토. 성과 신호 환류는 클릭추적 단계(후속)와 함께.

### WS-5 · 기본형(템플릿) 발송 UI 연결
- WS-2 집계 완료 후, 프론트에 기본형(템플릿 선택 + 변수 입력) 흐름 추가(`BrandMessageEditor` mode='template' 지원). 등록된 브랜드 템플릿 선택 → 변수 JSON 구성 → `POST /brand-send mode='template'`.

---

## 5. 데이터 모델

### 신규: `brand_message_prices`
```
brand_message_prices
  id            uuid pk
  company_id    uuid null      -- NULL = 전역 기본단가 / 값 = 회사별 오버라이드
  bubble_type   text           -- TEXT|IMAGE|WIDE|WIDE_ITEM_LIST|CAROUSEL_FEED|PREMIUM_VIDEO|COMMERCE|CAROUSEL_COMMERCE
  unit_price    numeric        -- 건당 단가(원)
  updated_at    timestamptz
  unique(company_id, bubble_type)   -- NULL company_id는 전역 1행/유형
```
조회 규칙: 회사 오버라이드 존재 → 사용 / 없으면 전역 기본 / 둘 다 없으면 0 + 발송 차단.

### 변경(값만): `balance_transactions.message_type`
- 브랜드 차감/환불은 `'BRAND'`로 태깅(기존 컬럼 재사용, 스키마 변경 없음).

### 기존(무변경): `companies.cost_per_*`, `campaigns`, `campaign_runs`, `IMC_BM_FREE/BASIC_BIZ_MSG`.

---

## 6. 기간계 영향 최소화 원칙 (전 WS 공통)
1. 기존 SMS/LMS/MMS/알림톡 발송·집계·정산·통계·선불 경로는 **무변경**. 브랜드는 새 분기/컬럼/테이블만 추가.
2. 신규 컬럼/테이블은 information_schema 실측 후 도입 + `column/table does not exist` fallback(503 DB_MIGRATION_PENDING 또는 워커 skip).
3. 통계·성과 UI는 브랜드 데이터 부재 시 기존과 동일(순수 가산).
4. 단가는 0원 → 과금 전환이라 배포 시점을 분리하고 Harold가 통제(공지 동반).
5. 각 WS 독립 배포. WS-2 집계 배포로 자유형 산식 회귀 0을 유닛 테스트로 고정.

---

## 7. 배포 순서 & 게이트
1. WS-0 실측(Harold) — 게이트.
2. WS-1(단가/선불/슈퍼관리자) + WS-2(집계/통계/성과) 병행 개발. WS-1 배포는 과금 시작이라 시점 별도.
3. WS-3(발송 스펙 정합) — WS-0 실발송 결과 확정 후.
4. WS-4(학습) / WS-5(기본형 UI).

---

## 8. WS-0 실측 SQL (Harold 실행)

IMC_BM 테이블은 **MySQL(QTmsg smsdb)** 소속이다(PG 아님). MySQL 콘솔에서 실행.

```sql
-- (1) IMC_BM 브랜드 테이블이 어느 스키마에든 존재하는가
--     ★ 2026-07-04 실측: smsdb.IMC_BM_FREE_BIZ_MSG 부재(ERROR 1146) → 전 스키마 확인
SELECT TABLE_SCHEMA, TABLE_NAME
FROM information_schema.TABLES
WHERE TABLE_NAME LIKE 'IMC_BM%';

-- (2) 존재 시에만: 컬럼/길이/BUSINESS_CODE (SCHEMA는 (1) 결과로 치환)
SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
FROM information_schema.COLUMNS
WHERE TABLE_NAME LIKE 'IMC_BM%'
  AND COLUMN_NAME IN ('MESSAGE','BUSINESS_CODE','ATTACHMENT_JSON','CAROUSEL_JSON')
ORDER BY TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME;

-- (3) 존재 + 발송 이력 있을 때: 결과 코드 분포(도달 실측)
SELECT CHAT_BUBBLE_TYPE, REPORT_CODE, COUNT(*) cnt
FROM IMC_BM_FREE_BIZ_MSG
GROUP BY CHAT_BUBBLE_TYPE, REPORT_CODE ORDER BY cnt DESC;
```
판정:
- (1) 0행 → 테이블 미설치 = IMC-Agent 브랜드메시지 미활성 → provisioning(휴머스온) 선행. 발송 WS 착수 보류.
- (1) 존재 → (2)(3)로 컬럼·도달 확정 후 WS-3 진행.
- 자유형 각 유형 1건 실발송(쿠폰/커머스/캐러셀 포함) → REPORT_CODE 확인(provisioning 후).
- 휴머스온에 브랜드메시지 BUSINESS_CODE 필수 여부 질의.

---

## 9. 후속 / 미결
- **RCS(젬텍 NGS) 실발송 통합**: 별도 설계서. 선행 = RBC 가입·브랜드/발신번호 인증·젬텍 대행사 지정·계정(clientId/secret)·IP/웹훅 등록. 현재 `rcs_templates` 로컬 테이블·등록요청 UI만 존재(발송 미구현). 채널 뼈대(WS-1/2)를 채널 파라미터화해 두면 RCS는 어댑터+웹훅 추가로 편입.
- **브랜드메시지 링크 클릭 단위 추적**: 코호트 성과로 이번엔 불요. 원하면 후속(버튼 URL 추적 링크 래핑).

---

## 10. 검증 시나리오(구현 후)
- WS-1: 선불 회사 유형별 1건씩 발송 → 유형별 단가 × 1 차감 실측 + balance_transactions `message_type='BRAND'` 확인. 실패분 환불 실측.
- WS-2: 자유형·기본형 각 1건 발송 → 발송결과/통계/정산/성과에 둘 다 집계됨 실측. 기존 SMS/알림톡 통계 회귀 0 확인. 통계 화면 채널 추가 레이아웃 무결 확인.
- WS-3: 각 유형 실발송 REPORT_CODE 정상(도달) 확인.
