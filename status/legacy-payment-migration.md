# 레거시 이니시스 결제모듈 → 한줄로 이전 (SoT)

> **작성일**: 2026-05-20 (D183 세션 종결)
> **다음 세션**: 즉시 구현 진입 (1~2일 코드 영역 본질)
> **목적**: 레거시 invitobiz.com 영역의 이니시스 결제 영역을 한줄로(TargetUp) 영역 카드결제 영역에 통합
> **진실의 원천**: 본 문서가 SoT. 다음 세션 = 본 문서 정독 후 즉시 구현 진입.

---

## 0. 영구 원칙 정합

| 원칙 | 본질 |
|---|---|
| 영구 룰 7건 정합 | [no_target_auto_relax] + [ai_operator_model_isolation] + [jondaetmal_to_harold] + [no_bakkeum_usage] + [push_and_deploy_commands] + [no_pm2_delete_before_git_push] + [sql_command_must_check_schema_first] |
| 기간계 영향 0건 | 무통장입금 영역 유지 + 카드결제 영역 신규 + 가상계좌 영역 영구 제거 |
| D182 영구 안전망 영향 0 | mysql-refund-sweeper / campaign-lifecycle / Phase 1 UI 영향 0건 |
| [user_hanjul_vs_hanjuldm_service_distinction] | 한줄로(TargetUp) 영역만, 한줄전단 영향 0 |
| 사용자 신뢰 | 결제 영역 검증 영역 단계별 (테스트 → 운영 점진) |

---

## 1. 레거시 환경 매트릭스 (invitobiz.com)

| 영역 | 본질 |
|---|---|
| **운영 서버** | SSH `ssh -p 27153 root@27.102.203.143` |
| **Tomcat6 위치** | `/usr/local/tomcat6` (PID 8389, 2022~ 가동, 2043시간 누적) |
| **WebApp 위치** | `/home/pay/` (Context path="" = ROOT) |
| **Java 버전** | JDK 1.7.0_45 |
| **DB** | MySQL (RSRM_FillAmtHist 영역, `usom_user@orcl` 별 영역) |
| **별 영역** | `/www/usom/`, `/www/pay/`, `/var/lib/docker/.../invito/` = 백업/구버전 가능성 |

---

## 2. 이니시스 운영 키 영역 ★

| 영역 | 값 |
|---|---|
| **위치** | `/home/pay/resources/key/usomsms001/` |
| **Merchant ID (운영)** | **`usomsms001`** |
| **Merchant ID (테스트)** | `INIpayTest` |
| **Key Password** | `1111` |
| **Admin Password** | `1111` |
| **인증서 3종** | `mcert.pem` + `mpriv.pem` + `keypass.enc` |
| **가맹점 admin** | https://iniweb.inicis.com (로그인 ID = `usomsms001`) |

**한줄로 이전 영역 = 위 3 인증서 파일 + readme.txt 영역 그대로 복사 본질**

---

## 3. 레거시 결제 흐름 완전 매트릭스

### 3-1. URL 흐름 (4 단계)

```
[/page2_charging] 충전 페이지
    ↓
[/page2_card] 카드 결제 진입 (이니시스 SDK 호출 form view)
    ↓
[이니시스 결제 처리] (외부 = plugin.inicis.com)
    ↓
[/INIsecureresult] 이니시스 callback (form submit → /success 영역)
    ↓
[/success] payRegistChk (중복) → payRegist (DB INSERT) → paysuccess.jsp
또는 [/fail] payfail.jsp
```

### 3-2. Controller 영역 (Spring MVC)

| 영역 | 본질 |
|---|---|
| 파일 | `/home/pay/WEB-INF/classes/com/invito/controller/InvitoController.java` (655 라인) |
| 결제 URL | `/page2_card` (L202), `/INIsecureresult` (L228), `/success` (L241), `/fail` (L260) |
| Service 호출 | `InvitoService.priceList(req)`, `payRegistChk(req)`, `payRegist(req, session)` |
| View 매핑 | `page2_card.jsp` + `INIsecureresult.jsp` + `paysuccess.jsp` + `payfail.jsp` |

### 3-3. JSP form 영역 (`page2_card.jsp`, 475 라인)

```java
// 이니시스 SDK 호출 패턴
import com.inicis.inipay.*;

INIpay50 inipay = new INIpay50();
inipay.SetField("inipayhome", "/www/pay/resources");  // 한줄로 = 새 경로 정합
inipay.SetField("admin", "1111");                       // 키패스워드
inipay.SetField("type", "chkfake");                     // 고정
inipay.SetField("enctype", "asym");                     // 비대칭 고정
inipay.SetField("checkopt", "false");                   // 고정
inipay.SetField("mid", "usomsms001");                   // 운영 MID
inipay.SetField("price", pri);                          // 금액 (request amount)
inipay.SetField("nointerest", "no");                    // 무이자 X
inipay.SetField("quotabase", "lumpsum:00:02:03:06");    // 할부

inipay.startAction();

// session 저장
session.setAttribute("INI_MID", inipay.GetResult("mid"));
session.setAttribute("INI_RN", inipay.GetResult("rn"));
session.setAttribute("INI_ENCTYPE", inipay.GetResult("enctype"));
session.setAttribute("INI_PRICE", inipay.GetResult("price"));
session.setAttribute("admin", inipay.GetResult("admin"));

String ini_encfield = inipay.GetResult("encfield");
String ini_certid = inipay.GetResult("certid");
```

**외부 JS**: `https://plugin.inicis.com/pay61_secunissl_cross.js` (이니시스 보안 결제 JS)

**form 필드**: goodname (상품명) + buyername (구매자명) + buyer 이메일/전화 + amount

---

## 4. DB INSERT 영역 매트릭스

### 4-1. payRegist (결제 INSERT) — `invito.xml` L590

```sql
INSERT INTO RSRM_FillAmtHist SET
    StoreId  = #{storeId}       -- 사용자 ID (한줄로 = user_id)
    , FillAmt  = #{TotPrice}    -- 충전 금액
    , FillDtTm = NOW()          -- 충전 일시
    , PayMethod = #{pay_method} -- 결제 수단 (card/vbank 등)
    , PayFkey  = #{ApplNum}     -- 이니시스 거래번호 (idempotency key)
```

### 4-2. payRegistChk (중복 chk) — L599

```sql
SELECT COUNT(*) FROM RSRM_FillAmtHist WHERE PayFkey = #{ApplNum}
```

### 4-3. bankRegist (가상계좌) — L603 — **영구 제거 본질** ✗

---

## 5. 한줄로 영역 현재 상태 (BalanceModals.tsx)

| 위치 | 영역 | 현재 상태 | 이전 후 본질 |
|---|---|---|---|
| `packages/frontend/src/components/BalanceModals.tsx` (332 라인) | — | — | — |
| L118-128 | 카드결제 | **준비 중 (클릭 X)** | **이니시스 onClick 영역 활성 ★** |
| L129-139 | 가상계좌 | 준비 중 | **영구 제거** |
| L140-153 | 무통장입금 | 활성 (계좌 `585-028893-01-011`) | **유지** |
| L163-250 | 무통장입금 폼 | 활성 | 유지 |

**디자인 영역** = Harold 명시 "진정 깔끔 디자인 변경" 본질.

---

## 6. 진정 이전 설계 매트릭스 (다음 세션 구현 영역)

### 6-1. DB schema 신규 (PG)

```sql
-- 한줄로 결제 영역 (RSRM_FillAmtHist 대응)
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  amount numeric(15,2) NOT NULL,
  method varchar(20) NOT NULL,           -- 'card' / 'vbank' / 'deposit'
  status varchar(20) NOT NULL DEFAULT 'pending',  -- pending/completed/failed/cancelled
  inicis_mid varchar(50),
  inicis_tid varchar(100),                -- ApplNum (idempotency)
  inicis_result_code varchar(10),
  inicis_result_msg text,
  card_company varchar(50),               -- 카드사
  card_quota integer,                     -- 할부 개월
  raw_response jsonb,                     -- 이니시스 전체 응답 보관
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (inicis_tid)                     -- idempotency
);

CREATE INDEX IF NOT EXISTS idx_payments_company_created ON payments(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status, created_at DESC);
```

### 6-2. utils 컨트롤타워 신규

**`utils/inicis-client.ts` (CT-41)** — 이니시스 API + signature 영역:
- `prepareInicisPayment({ companyId, userId, amount, productName, buyerName, buyerEmail, buyerTel })` → form 영역 데이터 + signature 반환
- `verifyInicisCallback(req)` — 이니시스 callback 영역 검증 (signature + 금액 + tid)
- `getInicisKeyPath()` — 환경변수에서 키 경로 영역 반환
- INIpay50 SDK = Java 영역 = **Node.js HTTP API 직접 호출 본질** (서명 = SHA256 + 환경변수 mid + signKey)

**`utils/payment-processor.ts` (CT-42)** — 결제 흐름 통합:
- `processPaymentSuccess({ tid, amount, method, companyId, userId })` — payments INSERT (idempotent) + balance_transactions `charge` 추가 + 회사 balance 증가
- `processPaymentFailure({ tid, resultCode, resultMsg })` — payments status=failed
- idempotency = `UNIQUE inicis_tid` 영역

### 6-3. routes/payments.ts 신규

| Method | Path | 본질 |
|---|---|---|
| POST | `/api/payments/inicis/prepare` | 결제 진입 (form data + signature 반환) |
| POST | `/api/payments/inicis/return` | 이니시스 callback (사용자 결제 완료 후) |
| POST | `/api/payments/inicis/noti` | 이니시스 noti (가상계좌 입금 통지 — 단, 가상계좌 영역 = 한줄로 = 제거 본질) |
| GET | `/api/payments` | 결제 이력 조회 (회사 admin) |
| GET | `/api/payments/:id` | 결제 상세 조회 |

### 6-4. Frontend 영역 (BalanceModals.tsx)

| 영역 | 작업 |
|---|---|
| L118-128 카드결제 | `<div opacity-60>` → `<button onClick={openInicisPayment}>` 변환 + 이니시스 진입 흐름 (form POST + redirect 또는 새 창) |
| L129-139 가상계좌 | **영구 제거** (L129-139 영역 통째 삭제) |
| L140-153 무통장입금 | **유지** |
| 디자인 | **깔끔한 디자인 영역 변경** (Harold 명시) — 카드결제 강조 + 무통장 = 보조 영역 |

### 6-5. 환경변수 매트릭스

```bash
INICIS_MID=usomsms001              # 운영 MID
INICIS_KEY_PASSWORD=1111           # 키 패스워드
INICIS_KEY_PATH=/home/administrator/targetup-app/keys/usomsms001    # 인증서 3종 위치
INICIS_SIGN_KEY=<이니시스 영역 발급 영역>   # 서명 키 (운영 영역)
INICIS_MODE=production              # 또는 'test' (INIpayTest 영역)
INICIS_RETURN_URL=https://app.hanjul.ai/payments/return
INICIS_NOTI_URL=https://app.hanjul.ai/api/payments/inicis/noti
```

### 6-6. 이니시스 키 영역 한줄로 운영 서버 복사 본질

```bash
# Harold님 직접 본질 (다음 세션 = 비토 = 명령어만 안내)
# 1) 레거시 서버에서 키 복사
scp -P 27153 root@27.102.203.143:/home/pay/resources/key/usomsms001/* /tmp/usomsms001/

# 2) 한줄로 운영 서버에 업로드
scp /tmp/usomsms001/* administrator@<한줄로IP>:/home/administrator/targetup-app/keys/usomsms001/

# 3) 권한 영역
chmod 600 /home/administrator/targetup-app/keys/usomsms001/*
```

---

## 7. 진정 진행 순서 (다음 세션 1~2일 본질)

### Day 1 (코드 영역)

| Step | 영역 | 분량 |
|---|---|---|
| 1 | DB schema 신규 (payments 테이블) | 30분 |
| 2 | utils/inicis-client.ts (CT-41) | 2~3시간 |
| 3 | utils/payment-processor.ts (CT-42) | 1~2시간 |
| 4 | routes/payments.ts (5 endpoint) | 2~3시간 |
| 5 | BalanceModals.tsx (카드결제 활성 + 가상계좌 제거 + 디자인) | 2~3시간 |
| 6 | 환경변수 영역 + 키 영역 운영 서버 복사 (Harold 직접) | 1시간 |

### Day 2 (검증 영역)

| Step | 영역 |
|---|---|
| 1 | 이니시스 테스트 영역 (INIpayTest mid) 결제 흐름 검증 |
| 2 | 운영 영역 점진 진입 (1 회사 = 본인 영역 먼저) |
| 3 | 이니시스 검수팀 = 운영 서버 IP 변경 신고 (Harold 직접) |
| 4 | 6,000사+ 사용자 영역 점진 노출 (배너 또는 토글) |

---

## 8. 진정 위험 영역 매트릭스

| 위험 | 본질 | 완화 영역 |
|---|---|---|
| 이니시스 검수 영역 | IP 변경 시 검수팀 신고 본질 (1~3일) | Harold 직접 사전 신고 본질 |
| INIpay50 Java SDK 영역 | Node.js 직접 대응 불가 시 | HTTP API 직접 호출 + SHA256 서명 영역 본질 |
| 운영 결제 실패 영역 | 사용자 영향 큰 영역 | 테스트 영역 완료 + 점진 노출 본질 |
| balance_transactions 중복 충전 | 동일 tid 영역 중복 호출 | `UNIQUE inicis_tid` + processPaymentSuccess idempotent |
| 가상계좌 영역 잔존 코드 | 정정 누락 영역 | `grep -niE "vbank|가상계좌|bankRegist"` 전수 chk |

---

## 9. 한줄로 영역 영향 0건 매트릭스

| 영역 | 영향 |
|---|---|
| D182 영구 안전망 (mysql-refund-sweeper) | 0건 (변경 영역 X) |
| 무통장입금 영역 | 0건 (기존 흐름 유지) |
| balance_transactions 영역 | charge 영역만 추가 (기존 영역 보존) |
| companies.balance 영역 | 기존 영역 정합 |
| 한줄전단(hanjulDM) 영역 | 0건 (한줄로만) |

---

## 10. 다음 세션 진입 명령어

```
status/legacy-payment-migration.md 정독 + status/STATUS.md CURRENT_TASK 정독 → 진정 이니시스 결제모듈 한줄로 이전 즉시 구현 진입 (Day 1 Step 1~6 순차 진행). 진정 본질 = SoT 문서 = 본 영역만 정합. 추측 X = SoT 문서 본질만 사용.
```

---

## 11. 참조 문서

- 레거시 압축 해제 영역: `C:\Users\ceo\projects\invito-legacy\` (invitobiz.com 영역 소스)
- 레거시 zip: `C:\Users\ceo\invito-src.zip` (84MB)
- 한줄로 BalanceModals: `packages/frontend/src/components/BalanceModals.tsx`
- 한줄로 balance routes: `packages/backend/src/routes/balance.ts`
- 한줄로 D-Day 영역: `migrate-legacy/D-DAY-PREPAID-RUNBOOK.md`
- 영구 룰: `memory/feedback_*.md` 매트릭스
- 운영 환경: `status/OPS.md`
- DB 스키마: `status/SCHEMA.md`

---

> **본 문서는 다음 세션 진실의 원천(SoT)입니다.** 다음 세션 진입 시 본 문서 정독만 = 진정 헛소리 0건 + 즉시 구현 진입 가능. 추가 정독 = SCHEMA.md (payments 테이블 신규 영역) + STATUS.md (CURRENT_TASK).
