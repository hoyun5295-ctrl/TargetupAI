# 레거시 → 한줄로 이관 설계서

> **작성일**: 2026-04-20 / **최종 갱신**: 2026-04-22 (D135)
> **진행 상태**: ✅ 계정(D134) + ✅ 회신번호·수신거부(D135) 완료 / ⏳ 예약발송+Agent차단 5/5 D-Day 남음
> **D-Day**: 2026-05-05 새벽 (Harold님 + Claude 공동 작업) — 예약발송 76건 + 레거시 Agent 중지
> **레거시**: INVITO 다우클라우드 서버 (Oracle 11g)
> **관련 문서**: `C:\Users\ceo\Downloads\INVITO-INFRA-HANDOVER.md`, 메모리 `project_d134_legacy_migration.md` / `project_d135_legacy_callbacks_unsubs.md`

---

## 🎯 완료 진행 현황 (2026-04-22 시점)

### 데이터 이관
| 종류 | 예상 건수 | 실제 이관 | 세션 | 비고 |
|---|---:|---:|---|---|
| 계정 (companies) | 62 | **62** | D134 | 단독 44 / 다중 18 |
| 계정 (users) | 141 | **141** | D134 | admin 69(기존 7+신규 62) / user 93 |
| 회신번호 callback_numbers | 1,492 | **1,492** | D135 | label='레거시' |
| 회신번호 assignments | 1,051 | **1,051** | D135 | 다중회사만, assigned_by=company admin |
| 수신거부 unsubscribes | 321,389 | **321,389** | D135 | source='legacy_migration' (user 265,619 + admin 합집합 55,770) |
| 주소록 | — | ⛔ 포기 | — | 고객사 직접 재업로드 정책 |
| **선불 잔액 (billing_type+balance)** | 34사 / 20,398,110원 | ⏳ | 2026-05-05 | 4/22 스냅샷 준비 완료, D-Day 재조회 후 UPDATE (`D-DAY-PREPAID-RUNBOOK.md`) |
| 예약발송 | 76 | ⏳ | 2026-05-05 | 한줄로 INSERT → 레거시 RESERVEYN=0 순서 엄수 |

### 레거시 서버 전환 안내 UI (D135 저녁 배포 완료)
| 항목 | 경로 | 크기 | 상태 |
|---|---|---:|:---:|
| 팝업 (전 페이지 footer include) | `/www/usom/WebContent/inc/migration-popup.jsp` | 13,924 bytes | ✅ |
| 랜딩 페이지 | `https://www.invitobiz.com/transition` = `/usr/local/nginx/html/transition.html` | 47,736 bytes | ✅ |
| Nginx location 추가 | `charset utf-8;` 앵커 sed 삽입 + reload | — | ✅ |
| 쿠키 동작 | `hanjul_popup_closed=1` 당일 만료 — "오늘 다시 보지 않음" | — | ✅ |
| 브라우저 실화면 검증 | Harold님 시크릿창 전 항목 통과 | — | ✅ |

**로컬 원본** (git 추적 권장): `docs/legacy-popup.html` / `docs/transition.html` / `docs/migration-popup.jsp`
**서버 백업**: `migration-popup.jsp.bak.20260422_154934` + `nginx.conf.bak.20260422_153900` 자동 생성

**정합성 검증**: D135 141명 login_id 전원 expected vs actual 완전 일치 PASS (`migrate-legacy/data/verification-report.json`)

**이관 작업 디렉토리**: `migrate-legacy/` — scripts 7종 + data(JSON/CSV/SQL) 전부 보존. 5/5 예약발송 이관 시 재활용 가능.

---

## 🚨 최종 정책 요약 (2026-04-20, 영업팀장 컨펌 완료)

### 이관 대상 — 3종만
- **수신거부 (BLOCKEDNUM 33만건)** — 정보통신망법 파기 의무 준수
- **회신번호 (MEMBER_SEND_NUM 3천건, STATUS='1' 활성만)**
- **예약발송 (MSGSUMMARY RESERVEYN=1 AND SENTYN=0, 76건)** + 레거시 차단

### 이관 제외 — **주소록 전체 (450만건 전부)**
- **사유**: 레거시 "쌓아두기" 관행 확인 (gwss 샘플 CREATEDT 2.5년 전) → 법적 파기 대상
- **대안**: 각 고객사가 한줄로에 **신규 엑셀 업로드**로 클린 스타트
- **영업팀장**이 고객 안내 담당
- 주소록 이관 스크립트 전면 폐기 (`migrate-legacy/scripts/test-migrate-gwss.js` 포함 — gwss 테스트 중단)

### FREE 플랜 상한 확정
- **주소록 저장 상한 = 10만명** (Brevo 10만 / 솔라피 PRO 15만 벤치마크)
- 10만 초과 필요 업체는 유료 플랜 설득 대상 (영업팀)

### D-Day 절차 (2026-05-05 새벽)
1. **03:00** 레거시 Agent 중지 → 발송 차단 → 수신거부 유입 멈춤
2. **03:10** 레거시 MSGSUMMARY 예약 UPDATE RESERVEYN=0 (차단)
3. **03:30** BLOCKEDNUM/MEMBER_SEND_NUM/예약 76건 스냅샷 → 한줄로 INSERT
4. **05:00** pre/post count 검증 (누락 0 확인, 샘플 10건 1:1 비교, 발송필터 테스트)
5. **05:30** 5/5 낮 유입분 2차 동기화 (수동)
6. **5/6** 전체 이관 완료

### 정합성 체크 3단
- **Pre-flight**: USERID별 BLOCKEDNUM/MEMBER_SEND_NUM count 스냅샷 → 기준값 파일 저장
- **In-flight**: `ON CONFLICT (user_id, phone) DO NOTHING` + `source='legacy_migration'` 태깅 + 배치 로그
- **Post-flight**: 한줄로 count = 레거시 count 1:1 비교 + 샘플 10건 phone 일치 + 발송필터 테스트

### 서팀장 작업 (대기 중)
- `whitelist-template.xlsx` 기반 그룹핑 리스트 수령 예정
- **결과물**: 레거시 USERID → 한줄로 user_id 매핑 테이블 (같은 회사 매장별 USERID 통합 포함)
- 수신거부/회신번호 이관 스크립트는 **이 매핑 수령 후** 본격 설계 착수

---

## 1. 배경 및 제약

- **레거시 QTmsg Agent는 2026-05-01 종료 예정** → 그 이후 레거시 발송 불가
- 레거시 서버 자체는 한줄로 전환 완료 시점(~2026-06)까지 읽기 전용 유지
- **이관 시점**: 한줄로 오픈(2026-04-20) 이후, 5/1 전까지 미리 이관
- **고객사**: 133개 발급 / 최근 30일 활성 118개 / 최근 7일 활성 94개

---

## 2. 이관 범위 (최종 확정 2026-04-20)

### ✅ 이관 대상
- **수신거부** (BLOCKEDNUM) → 한줄로 `unsubscribes` — 법적 의무
- **회신번호** (MEMBER_SEND_NUM, STATUS='1' 활성만) → 한줄로 `callback_numbers`
- **예약발송** (MSGSUMMARY RESERVEYN=1 AND SENTYN=0, 76건) → 한줄로 `campaigns` + 레거시 차단
- **옵션** (MC_MEMBER_OPT): 발송 시간제한/일 한도 → 한줄로 `users.settings` (검토 후 결정)

### ❌ 이관 포기 (2026-04-20 확정)
- **주소록** (ADDRBOOK 450만건) — 레거시 "쌓아두기" 관행(gwss 샘플 2.5년 전 데이터) → **법적 파기 대상, 각 고객사가 한줄로에 신규 엑셀 업로드**
- **주소록 그룹** (ADDRGROUP) — 주소록 미이관에 따라 자동 제외
- **과거 발송 이력** (MSGSUMMARY 3개월치, MSGRECIPIENT, SMSQ_SEND_*) — 2,000만 건+ 규모 과다
- **대안**: 레거시 서버 2026-06-30까지 읽기 전용 유지 → 과거 이력 필요 시 레거시 URL 안내

---

## 3. 레거시 테이블 구조 (파악 완료)

### 3-1. MEMBER (518건) — 사용자 마스터
```
CODE (NUMBER, PK)
USERID (VARCHAR2 30) ★ 로그인 ID
NAME (VARCHAR2 255) ← 회사명으로 쓰임 (예: "(주)광원시스틱")
PASSWD (VARCHAR2 255) ← 해시 알고리즘 불명 (복사 불가)
EMAIL, TEL, MOBILE, SENDMOBILE
MBER_FXNUM ← 대표 회신번호 가능성
TOTALAMTCHARGED ← 총 충전액
TOTALAMTUSED ← 총 사용액
JOINDT ← 가입일 (YYYYMMDDHHMMSS)
LASTLOGDT ← 마지막 로그인
STATUS, USEACCYN
MANAGER_NM ← 담당자명
```

### 3-2. ADDRBOOK (4,497,405건) — 주소록
```
CODE (PK)
USERID ★ 업체 구분
ADDRGROUPCODE → ADDRGROUP.CODE FK
NAME (이름)
MOBILE (전화번호)
ETC1~ETC6 (VARCHAR2 4000) ← 커스텀 필드 6개
CREATEDT
```

### 3-3. ADDRGROUP (1,129건) — 주소록 그룹
```
CODE (PK)
USERID
ADDRGROUPNAME (예: "0426_스킨케어_타겟2")
CREATEDT
```

### 3-4. BLOCKEDNUM (573,621건) — 수신거부
```
CODE (PK)
USERID
BLOCKEDNUM (차단번호)
CREATEDT
```

### 3-5. MEMBER_SEND_NUM (7,188건) — 회신번호
```
SEQ (PK)
USERID
SEND_NUM
STATUS (1=활성)
REG_DT, REG_ID, DEL_DT, DEL_ID, REG_METHOD
```

### 3-6. MSGSUMMARY (722,306건) — 캠페인 마스터 (예약만 이관)
```
CODE (PK)
USERID
TITLE, CONTENT
MSGDV (1=SMS, 2=LMS, 3=MMS 추정)
SENDMOBILE, TOTALNUM, SUCCESSNUM, FAILNUM
AMOUNT, REQDT, SENTDT
RESERVEYN (1=예약), SENTYN (0=미발송), RESERVEDT
```

### 3-7. MC_MEMBER_OPT (522건) — 발송 옵션
```
USERID
TIME_LIMIT_STATUS, BEGIN_TIME_LIMIT, END_TIME_LIMIT (발송 시간 제한)
COM_REJECT_STATUS (회사 차단)
SEND_DAY_CNT (일 발송 한도)
REG_DATE, MOD_DATE
```

---

## 4. 실측 데이터 규모 (118개 활성 업체 기준)

| 항목 | 건수 | 비고 |
|------|-----:|------|
| 주소록 | **2,029,020** | 업체별 편차 큼 (TOP 1 benjefe 75만) |
| 수신거부 | **330,486** | |
| 회신번호 | **2,927** | STATUS='1' 활성만 |
| 그룹 | 514 | |
| 예약발송 대기 | **76** | 4/30 전 처리 필수 |

### 주소록 TOP 10 (전체의 77% 차지)
| USERID | ADDR_CNT |
|--------|---------:|
| benjefe | 751,901 |
| cats0901 | 409,567 |
| babynews | 404,262 |
| lumourkorea | 96,397 |
| efolium | 82,201 |
| gwss | 58,582 |
| skincure | 32,999 |
| nain | 24,853 |
| Treksta | 24,434 |
| comvita | 24,343 |

---

## 5. gwss 테스트 대상 (검증용 1건)

- **USERID**: gwss
- **회사명**: "(주)광원시스틱" (NAME 한글 깨짐 표시는 터미널 이슈, DB는 UTF-8/EUC-KR로 정상 저장)
- **CODE**: 4471
- **EMAIL**: chris.yang@gwss.co.kr
- **MOBILE**: 010-9058-9139
- **잔액**: 약 85만원 (TOTALAMTCHARGED 201,310,774 - TOTALAMTUSED 200,455,632)
- **이관 규모**: 주소록 58,582 / 수신거부 4,332 / 그룹 34 / 회신번호 2 / 옵션 1 / 예약 0

### 검증 샘플 캠페인 (발송 이력 이관 테스트용 — 현재는 포기 방향이나 가능성 남겨둠)
- CODE=722599, MSGDV=2(LMS), 1건, 성공 1, 25.85원
- SMSQ_SEND_20260420.APP_ETC1='722599'에 건별 데이터 1건 (SEQNO 197026087, DEST_NO 01085860708)

---

## 6. 매핑 설계 (결정 완료)

### 6-1. 계정 매핑
```
레거시 USERID 1개 (예: gwss)
    ↓
한줄로:
  companies 1개 (company_name = MEMBER.NAME)
  users 1개 (login_id = MEMBER.USERID, user_type='admin')

주의: user_type='user'(브랜드 담당자)는 차후 고객이 UI에서 직접 추가
```

### 6-2. 비밀번호
- 레거시 PASSWD 해시 알고리즘 불명 → **복원 불가**
- **임시 비번 생성** + 고객 안내 + 로그인 후 필수 변경
- 예: 전화번호 뒤 4자리 + '!invito' (미정)

### 6-3. 데이터 이관
```
ADDRBOOK → customers (NAME/MOBILE + ETC1~6 → custom_fields JSONB)
ADDRGROUP → tags (한줄로 그룹 개념 유무에 따라)
BLOCKEDNUM → unsubscribes (source='legacy_migration')
MEMBER_SEND_NUM → callback_numbers (STATUS='1' only)
MSGSUMMARY[RESERVEYN=1] → campaigns (scheduled_at + 수신자 포함)
MC_MEMBER_OPT → users.settings JSONB
```

---

## 7. 미결정 사항 (2026-04-20 토론 세션 업데이트)

### ✅ 결정 완료 (2026-04-20)

**0. 이관 대상 필터링 정책 (2026-04-20 최종 확정):**
- **1년 이내 발송이력 없는 업체 = 이관 제외** (정보통신망법 파기 의무 준수)
- **주소록 10만 건 초과 업체 = 이관 제외** (FREE 플랜 상한, 업계 표준)
  - FREE 플랜 상한을 10만명으로 확정 (Brevo 10만 / 솔라피 PRO 15만 벤치마크)
  - 10만 초과 업체는 유료 플랜 가입 의사 없으면 레거시 소멸과 함께 자연 탈락
  - 유료 전환 가능한 업체는 영업팀(서팀장) 개별 접촉
- **이관 예상 규모:** 1년 내 157개 USERID × 317만건 → 10만 초과 4개 제외 후 **153개 / 약 60~70만건**
- **10만 초과 제외 대상 (추정 4개):** louisquatorze (100만) / benjefe (75만) / cats0901 (40만) / babynews (40만) — 영업 설득 대상


1. **선불/후불 판별** — `MEMBER.TOTALAMTCHARGED > 0` 기준
   - 결과: **활성 118개 중 선불 40개 / 후불 78개**
   - 선불 총 잔액: 2,046만원 (업체당 평균 51만원)
   - 후불: 잔액 0원 (당연)
   - 근거: `MC_USER_RATE` 빈 테이블(UR_CHARGE_TYPE_CD 사용 불가), PAYMENTDV는 결제방식(Etc/Card/VCard)일 뿐

2. **단가 소스** — `MSGSUMMARY` **역산** + 시장평균 fallback
   - 업체별: `SELECT AVG(AMOUNT/NULLIF(TOTALNUM,0)) FROM MSGSUMMARY WHERE USERID=? AND SENTYN='1' GROUP BY MSGDV`
   - MSGDV: 1=SMS, 2=LMS, 3=MMS
   - 발송이력 없는 업체 fallback: SMS=10원, LMS=28원, MMS=60원 (시장평균)
   - gwss 역산 검증: SMS 8.04원 / LMS 24.79원 / MMS 56.25원 (시장 평균 범위)

3. **단가 테이블 폐기** — `MC_USER_RATE`(빈 테이블) + `INFO_COMPANY`(옛 소스 잔재) 모두 미사용
   - INFO_COMPANY 4건(tonymoly/innisfree/storysom/thesaem)은 현재 계약업체 아님, 과거 소스 잔재
   - 단가 판별 로직에서 두 테이블 모두 제외

4. **잔액 이관** — 선불 업체만 `MEMBER.TOTALAMTCHARGED - TOTALAMTUSED`를 `companies.balance`로
   - 음수일 경우 0으로 캡핑
   - 후불은 balance=0 고정

5. **080 번호 이관** — **없음**
   - 레거시에 080 자동연동 개념이 없음 (한줄로에서 신규 개발된 기능)
   - 이관 스크립트에서 080 번호 컬럼 처리 스킵
   - 고객이 한줄로 UI에서 각자 080번호/auto_sync 설정
   - **단, 수신거부 목록(BLOCKEDNUM 33만건)은 당연히 이관** — admin user_id로 일괄 INSERT, source='legacy_migration'

6. **임시 비번** — `qwer1234` 일괄 지정
   - `users.must_change_password=true` 세팅으로 로그인 즉시 강제 변경
   - 레거시 사이트에 팝업 띄워 한줄로로 유도
   - 팝업에 "로그인 안될 시 문의" 안내 → 수동 대응

7. **그룹 변환** — `ADDRGROUP` → 한줄로 `tags` 또는 group 개념
   - 한줄로 스키마 확인 후 tag 방식이 기본 (그룹 개념 명확하지 않음)

### 🔴 다음 세션 착수 전 결정 필요

1. **기본 plan_id** — `BASIC` 기본 지정 OK? (기능 잠금 상태 → 고객이 자발적 업그레이드 유도)
   - `plans.plan_code`: FREE/STARTER/BASIC/PRO/BUSINESS/ENTERPRISE
2. **SMSQFLAG 라인그룹 매핑** — 레거시 5종 → 한줄로 `sms_line_groups` 대응
   - SMSQ_SEND(336), SMSQ_SEND_01(24), SMSQ_SEND_02(33), SMSQ_SEND_03(19), SMSQ_SEND_GYEONGNAM(36)
   - 한줄로에 대응 라인그룹 5개 사전 세팅 필요 → `line-group-map.json` 수동 작성
3. **이관 제외 리스트** — `storysom`(Harold님 과거 회사) + `tonymoly/innisfree/thesaem`(INFO_COMPANY 잔재)이 활성 118개에 실제 포함되는지 확인 후 제외 처리
4. **고객 안내 세부** — 팝업에 임시비번 명시 여부
   - 명시: 문의 최소화 (보안상 허용 범위)
   - 미명시: "문의하세요"만 → 직원 수동 대응

---

## 8. 다음 세션 착수 순서 (2026-04-20 업데이트)

1. **§7 남은 결정 4가지 확정** (Harold님 컨펌)
   - 기본 plan_id = BASIC?
   - SMSQFLAG → 한줄로 라인그룹 5개 매핑 (수동)
   - 제외 리스트(storysom/tonymoly/innisfree/thesaem) 활성 여부 쿼리
   - 팝업에 임시비번 명시 여부
2. **Node.js 이관 스크립트 스캐폴딩** (`migrate-legacy/` 디렉토리)
   ```
   migrate-legacy/
   ├─ config.js           (환경변수/DB 접속정보)
   ├─ migrate.js          (메인 엔트리 — Phase 1~5 순차)
   ├─ lib/
   │  ├─ legacy.js        (Oracle 연결 — node-oracledb)
   │  ├─ targetup-pg.js   (PG 연결 — pg)
   │  └─ targetup-mysql.js (MySQL 연결 — mysql2)
   ├─ mappers/
   │  ├─ accounts.js      (Phase 1 — companies + users + user-map.json)
   │  ├─ pricing.js       (Phase 2 — 역산 단가 + 선불/후불)
   │  ├─ line-groups.js   (Phase 3 — SMSQFLAG 매핑)
   │  ├─ addressbook.js   (Phase 4a — customers)
   │  ├─ unsubscribes.js  (Phase 4b — BLOCKEDNUM)
   │  ├─ callbacks.js     (Phase 4c — MEMBER_SEND_NUM)
   │  ├─ tags.js          (Phase 4d — ADDRGROUP)
   │  └─ scheduled.js     (Phase 4e — 예약 76건)
   ├─ data/
   │  ├─ user-map.json           (USERID → UUID — 자동 생성)
   │  ├─ line-group-map.json     (SMSQFLAG → line_group_id — 수동 작성)
   │  ├─ exclude-list.json       (이관 제외 USERID 목록)
   │  └─ report.json             (이관 결과 리포트)
   └─ README.md
   ```
3. **Phase 1 (계정 생성) 먼저 구현 + gwss 1건 dry-run**
4. **Phase 2~4 순차 구현 + gwss 검증**
5. **검증 통과 시 117개 일괄 실행** (gwss 포함 118개 중 gwss는 이미 완료)
6. **레거시 5/1 Agent 종료 전 예약 76건 안전 이관** (중복 발송 방지)
   - 순서: 한줄로에 예약 INSERT → 레거시 `UPDATE MSGSUMMARY SET RESERVEYN=0 WHERE ...` → QTmsg Agent 중지

### Phase 설계 상세

```
Phase 1: 계정 생성
├─ MEMBER 118건 SELECT → PG companies + users INSERT
├─ companies.company_name = MEMBER.NAME
├─ companies.company_code = 'LGC_' + USERID (추적 마커)
├─ companies.billing_type = TOTALAMTCHARGED>0 ? 'prepaid' : 'postpaid'
├─ companies.balance = MAX(0, TOTALAMTCHARGED - TOTALAMTUSED) — 선불만
├─ companies.plan_id = BASIC 플랜
├─ users.login_id = MEMBER.USERID
├─ users.password_hash = bcrypt('qwer1234')
├─ users.must_change_password = true
├─ users.user_type = 'admin'
├─ users.name = MEMBER.MANAGER_NM
├─ users.email = MEMBER.EMAIL
├─ users.phone = MEMBER.MOBILE
└─ user-map.json 생성: { "gwss": { company_id, admin_user_id } }

Phase 2: 단가 세팅
├─ 118개 업체 각각 MSGSUMMARY 역산
│  └─ MSGDV별 AVG(AMOUNT/TOTALNUM) → cost_per_sms/lms/mms
├─ 역산 결과 NULL이면 시장평균 (SMS=10, LMS=28, MMS=60)
└─ 선불 40개는 검증 필수 (잔액 차감 계산 정확성)

Phase 3: 라인그룹 매핑
├─ SMSQFLAG 5종 → line-group-map.json 기반 users.line_group_id 세팅
└─ 한줄로 sms_line_groups 5개 사전 세팅 필요

Phase 4: 데이터 이관
├─ ADDRBOOK 200만건 → customers (bulk INSERT 5000 × 400배치)
│  └─ NAME/MOBILE → customers.name/phone
│  └─ ETC1~6 → custom_fields JSONB
├─ BLOCKEDNUM 33만건 → unsubscribes
│  └─ user_id = admin_user_id, source = 'legacy_migration'
│  └─ ON CONFLICT (user_id, phone) DO NOTHING
├─ MEMBER_SEND_NUM → callback_numbers (STATUS='1'만)
├─ ADDRGROUP → tags
├─ MSGSUMMARY[RESERVEYN=1,SENTYN=0] 76건 → campaigns (scheduled)
│  └─ 수신자는 MSGRECIPIENT에서 함께 이관
└─ MC_MEMBER_OPT → users.settings JSONB

Phase 5: 안전 종료
├─ 레거시 MSGSUMMARY 예약 76건 UPDATE RESERVEYN=0 (중복 발송 방지)
├─ 5/1 QTmsg Agent 중지
└─ 이관 결과 report.json 저장
```

---

## 9. 핵심 리스크

1. **예약발송 중복 발송** — 한줄로에 이관 후 레거시에서 반드시 취소/삭제
2. **한글 인코딩** — Oracle KO16MSWIN949 또는 AL32UTF8 확인 필요 (`NLS_LANG` 설정)
3. **대용량 업체 타임아웃** — benjefe 75만건은 배치 사이즈 5000 × 150배치
4. **비밀번호 복원 불가** — 모든 고객이 임시 비번으로 첫 로그인 필요 → 고객 안내 실패 시 접속 불가

---

## 10. 참고 — 작업 경로

- **레거시 접속**: `ssh -p 27153 root@27.102.203.143` (문서에 따른다)
- **레거시 Oracle**: `su - oracle` → `sqlplus usom_user@orcl` (비번 프롬프트)
- **한줄로 PG**: `docker exec -it targetup-postgres psql -U targetup -d targetup`
- **한줄로 MySQL**: `docker exec -it targetup-mysql mysql -u root -p`
- **이관 스크립트 위치 (예정)**: `C:\Users\ceo\projects\targetup\migrate-legacy\`
