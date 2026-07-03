# D130 알림톡 — 다음 세션 착수 지시서

> **작성:** 2026-04-21 화요일 오전 (실점검 진행 중 스냅샷)
> **우선순위 순서대로 작업하세요. 중간에 Harold님 실점검 이슈가 들어오면 그쪽 우선.**
> **CLAUDE.md 4-7 원칙 엄수:** Agent 병렬 사용 금지. 파일 읽기·수정은 모두 직접 실행.

---

## 0. 현재 배포 상태 (2026-04-21 11:02:39 KST 기준)

| 레이어 | 상태 |
|--------|------|
| 서버 코드 | `tp-deploy-full` 완료, pm2 재시작됨 |
| 서버 `.env` | `IMC_API_KEY` + `IMC_BASE_URL_PRD` + `IMC_WEBHOOK_ALLOWED_IPS` + `IMC_ENV=PRD` 4개 주입 |
| PG DB `kakao_sender_categories` | L1=21 / L2=103 / L3=148 (총 272건 반영됨) |
| PG DB `kakao_template_categories` | 42건 |
| 알림톡 스케줄러 | 3종 가동 중 (카테고리 03:00 KST / 템플릿 5분 / 발신프로필 1시간) |
| **미수령 IMC 키** | `IMC_WEBHOOK_HMAC_SECRET` (폴링으로 커버됨) / `IMC_API_KEY_SANDBOX` (불필요) |

---

## 1. 이 세션에서 확정된 버그 수정 7건

`C:\Users\ceo\Downloads\imc_extracted\` 55개 IMC 공식 스펙 파일을 직접 대조한 결과:

| # | 버그 | 파일 | 수정 위치 |
|---|------|------|-----------|
| 1 | sender 카테고리 이중 래핑 `data.data` + flat 11자리 | `11_05_20_발신프로필 카테고리 전체 조회.txt` | `alimtalk-jobs.ts syncCategoriesJob` |
| 2 | `/comment-with-file` → `/comment/file`, multipart `file` → `attachment` | `10_57_41_문자 관리.txt` | `alimtalk-api.ts requestInspectionWithFile` |
| 3 | `/exposure` → `/show-yn`, body `exposureYn` → `showYn` | `10_58_41_문자 관리.txt` | `alimtalk-api.ts updateExposure` |
| 4 | `/comment-cancel` → `/comment/cancel` | `10_58_01_문자 관리.txt` | `alimtalk-api.ts cancelInspection` |
| 5 | Button/QuickReply camelCase → snake_case (IMC 전송 직전) | `10_57_49_문자 관리.txt` | `alimtalk-api.ts normalizeTemplateBodyForImc` |
| 6 | 알림수신자 `alarmUserId` → `alarmUserKey` (body + URL) | `10_56_14`, `10_56_22` | `alimtalk-api.ts` 타입 + `routes/alimtalk.ts` |
| 7 | 리포트 코드 1001~1004 오매핑 교정 + 11개 → 55개 확장 | `10_52_06_응답 코드.txt` | `alimtalk-result-map.ts IMC_REPORT_CODE_MAP` |

---

## 2. 남은 🔴 블로커 — 실점검 중 터질 가능성 (우선순위 순)

### 2-1. `createAlimtalkTemplate` 응답 이중 래핑 가능성 — **실제로 Harold님이 템플릿 등록 시 터질 수 있음**

우리 코드 (`routes/alimtalk.ts:623`):
```ts
if (r.code !== '0000' || !r.data?.templateCode) { ... }
```

sender 카테고리가 `data.data` 이중 래핑이었듯이, 템플릿 등록 응답도 동일 패턴이면 `r.data.templateCode`가 `undefined` → **등록 201인데 DB에 `template_code` null 저장**. 사용자 관점에서는 "등록 성공"인데 이후 조회/검수요청이 모두 실패.

**확인 방법:** Harold님이 처음 템플릿 등록 시도 후
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c \
  "SELECT id, template_name, template_code, template_key FROM kakao_templates ORDER BY created_at DESC LIMIT 3;"
```
실행해서 `template_code`가 null이면 이중 래핑 확정.

**수정:** `routes/alimtalk.ts` POST `/templates` 핸들러에서 `r.data.templateCode` 대신
```ts
const tplCode = r.data?.templateCode ?? (r.data as any)?.data?.templateCode;
```
fallback 추가. 또는 `alimtalk-api.ts createAlimtalkTemplate`이 `res.data`를 반환하기 전에 unwrap.

### 2-2. `listSenders()` 파라미터 불일치

**Agent 1 리포트 결과 (본 세션 첫 Agent 실행분):**
- `count` → `size` (IMC 정식 파라미터명)
- `yellowId` → `uuid` (IMC는 채널ID를 `uuid` 필드로 받음)
- `page` 베이스 0 (우리는 1로 호출 중일 수도 있음)
- 누락 필터 12개: `name/profileStatus/senderKey/status/uuid/customSenderKey/block/dormant/alimtalk/brandMessage/category/categoryCode`

**영향:** 발신프로필 **목록 조회**할 때 (Wizard 등록 후 다시 리스트 확인하는 경로). 등록 자체는 별도 엔드포인트라 영향 없음.

**참조 파일:** `C:\Users\ceo\Downloads\imc_extracted\11_04_55_발신프로필 목록 조회.txt` — **아직 직접 열어보지 않음. 먼저 Read 후 정확한 스펙 확인 필요.**

**수정 위치:** `alimtalk-api.ts:listSenders()` 파라미터 타입 전면 재작성.

### 2-3. `SenderData` 인터페이스 필드 불일치

**Agent 1 리포트:**
- `yellowId` → `uuid`
- 누락 필드: `profileStatus`(A/C/B/E/D), `block/dormant/alimtalk/brandMessage`(boolean), `category/categoryCode`
- 현재 `[key: string]: any` fallback이 있어 런타임 크래시는 없으나 프론트 타이핑 엉망

**참조 파일:** `11_05_12_발신프로필 조회.txt` — **직접 확인 필요**

**영향:** 발신프로필 상세 화면에서 일부 필드가 `undefined`로 나타남. Wizard 등록 직후 방금 만든 프로필 상세 조회할 때 치명적이진 않음.

### 2-4. 웹훅 HMAC 검증 강제

**현재 구조:** `verifyWebhookSignature(rawBody, sig, secret)` 에서 `if (!secret || !headerSignature) return false;` → 무조건 401 reject.

**영향:** 지금은 `IMC_WEBHOOK_HMAC_SECRET` 미설정 + 폴링(`syncPendingTemplatesJob` 5분 주기)으로 템플릿 승인 상태 자동 업데이트. **웹훅 사용 안 함 → 문제 없음.**

**Phase 2 전환 시점(실시간 웹훅 반영이 필요해지면)에 수정:**
- env 미설정 시 bypass (IP 화이트리스트 1차 방어만)
- 휴머스온에 공식 서명 방식 문의 필수 (문서에 HMAC 언급 0건)

**참조 파일:** `10_53_46_Webhooks (웹훅).txt` — 문서에 signature/HMAC/secret 단어 0건 확인됨 (Agent 3 리포트).

---

## 3. 직접 IMC 스펙 대조 **안 끝난** 파일 목록

이 세션에서 직접 Read한 파일:
- ✅ `11_05_20` 발신프로필 카테고리 전체 (Harold님 curl 실측 + 제가 직접 확인)
- ✅ `10_57_49` 알림톡 템플릿 등록
- ✅ `10_57_41` 검수요청 첨부파일
- ✅ `10_57_22` 검수요청
- ✅ `10_58_01` 검수요청 취소
- ✅ `10_57_14` 단건 조회
- ✅ `10_58_10` 수정
- ✅ `10_58_26` 휴면 해제
- ✅ `10_58_34` 관리코드 수정
- ✅ `10_58_41` 노출 여부 수정
- ✅ `10_58_53` 서비스 유형 수정
- ✅ `10_59_00` 삭제
- ✅ `10_56_14` 알림수신자 등록
- ✅ `10_56_22` 알림수신자 수정
- ✅ `10_52_06` 응답 코드

직접 Read **안 끝난** 파일 (다음 세션 필독):
- 🔴 `11_04_55` 발신프로필 목록 조회 ← **2-2 블로커 해결에 필수**
- 🔴 `11_05_12` 발신프로필 조회 ← **2-3 블로커 해결에 필수**
- ⚠️ `11_05_05` 브랜드메시지 타겟팅 여부 확인
- ⚠️ `11_05_27` 발신프로필 카테고리 단건
- ⚠️ `11_05_35` 발신프로필 등록 (Agent 1이 PASS 판정했지만 미직접 확인)
- ⚠️ `11_05_42` 브랜드메시지 타겟팅 신청
- ⚠️ `11_05_49` 발신프로필 토큰 요청 (Agent 1 PASS)
- ⚠️ `11_05_56` 고객사 발신프로필 키 수정 (Agent 1 PASS)
- ⚠️ `11_06_03` 무료수신거부 정보 입력 (Agent 1 PASS)
- ⚠️ `11_06_10` 발신프로필 휴면 해제 (Agent 1 PASS)
- ⚠️ `11_06_16` / `11_06_20` 템플릿 카테고리 단건/전체 (Agent 2 PASS, 이중 래핑 대응됨)
- ⚠️ `10_56_04` 알림수신자 목록 조회
- ⚠️ `10_56_31` 알림수신자 삭제
- ⚠️ `10_56_48` 알림톡 최근변경 템플릿 조회 (우리 코드에 함수 있는지 확인 필요)
- ⚠️ `10_56_57` 알림톡 템플릿 목록 조회
- ⚠️ `11_18_*` 발송 3개 (IMC 직접 호출 안 하므로 확인 불필요)
- 🟡 `11_19_*` 브랜드메시지 템플릿 5개 — **Phase 3 범위, 지금 미사용**
- ⚠️ `11_20_*` / `11_21_*` 이미지 업로드 9개 (Agent 3 PASS, 엔드포인트 prefix + `image`/`images` 필드명 확인됨)

---

## 4. 실점검 단계별 이슈 대응 가이드

### Step A — 발신프로필 Wizard 3-Step
**실패 징후:** Step 2 "인증번호 요청" 후 카톡 안 옴 or Step 3 "등록 완료" 에러

**대응:**
```bash
pm2 logs --lines 30 --nostream 2>&1 | grep -iE 'senders/token|POST /api/alimtalk/senders|imc|error' | tail -20
```
- `4001 AUTHENTICATION_FAILED` → `.env` IMC_API_KEY 오타 의심
- `4011 NOT_FOUND_PROFILE` → 등록 시도 후 조회 실패. 일반적으로 정상 flow
- `4012 NOT_FOUND_PROFILE_CATEGORY` → categoryCode 11자리 올바른지 재확인
- 400 에러 body 내용 보고 `11_05_35` / `11_05_49` 파일 Read로 body 스펙 재대조

### Step B — 슈퍼관리자 승인
내부 API(`PUT /api/alimtalk/senders/:id/approve`), IMC 호출 없음. 실패 가능성 거의 없음.

### Step C — 고객사 템플릿 등록 (버튼 포함)
**실패 징후:** Step 1에서 "승인된 발신프로필 없음" (이 경우 Step A/B 재확인) OR 등록 완료 후 템플릿 목록에서 template_code null

**대응:**
```sql
SELECT id, template_name, template_code, status, created_at
  FROM kakao_templates
 ORDER BY created_at DESC LIMIT 5;
```
- `template_code` null → **블로커 2-1 확정**. 즉시 `routes/alimtalk.ts:623` 수정 + 재배포
- 200 OK but 알림수신자 `alarmPhoneNumber`에 빈값 → body 필드명 재확인

### Step D — 검수요청
IMC 응답 `4015 NOT_AVAILABLE_COMMENT` = 템플릿 상태가 DRAFT/REJECTED 아님. UI에서 해당 상태 버튼 노출 로직 재확인.

### Step E — 5분 폴링으로 승인 상태 자동 업데이트
```bash
pm2 logs --lines 100 --nostream 2>&1 | grep -iE 'pendingTemplateSync|template.*status' | tail -10
```
`[alimtalk-jobs][pendingTemplateSync] env 미설정 — skip` 안 나와야 정상.

---

## 5. 우선순위 결정 가이드

**실점검이 Wizard Step A에서 막혔다:**
→ Step A 대응 명령어 실행 + 결과 붙여 Harold님께 확인 → `11_05_35` / `11_05_49` 파일 Read → 백엔드 수정 → 재배포

**실점검이 템플릿 등록에서 막혔다 (template_code null):**
→ 블로커 2-1 즉시 수정 + 재배포

**실점검 다 통과했다:**
→ 블로커 2-2, 2-3 순차 수정 (listSenders + SenderData) → 남은 파일 전수 Read

**실점검 진행 중이 아니다:**
→ §3 미직접 대조 파일 순차 Read 시작 (`11_04_55` → `11_05_12` → `11_05_05` → ...)
→ 각 파일 읽고 `alimtalk-api.ts` 해당 함수와 즉시 대조, 불일치 발견 즉시 수정

---

## 6. Harold님께 재확인·요청 필요 항목

- [ ] IMC_API_KEY_SANDBOX 수령 여부 (Phase 1 안 씀, Phase 2 앞두고 받아두면 좋음)
- [ ] IMC_WEBHOOK_HMAC_SECRET 수령 여부 (Phase 2 전환 시점 필요)
- [ ] 인비토 서버 공인 IP를 휴머스온에 방화벽 신청했는지 확인 (`curl ifconfig.me` 결과를 그쪽에 전달)
- [ ] 브랜드메시지 기능 착수 시점 (지금 범위 아님 — Phase 3 로드맵)

---

## 7. 절대 금지 사항 (CLAUDE.md 재확인)

- ❌ **Agent 병렬 사용 금지** — 이 세션에서 Agent 3개 병렬로 돌렸더니 "17개 문서 누락" 오판 리포트 받아서 Harold님 격노. 직접 파일 읽고 직접 코드 수정.
- ❌ `ssh administrator@...` SSH 접속 금지
- ❌ `git push` / `tp-push` / `tp-deploy-full` 금지 — Harold님이 직접 실행
- ❌ 서버 `.env` 직접 수정 금지 — Harold님에게 명령어만 안내
- ❌ 설계서 추측으로 IMC 스펙 결정 금지 — 반드시 `imc_extracted/` 파일 직접 Read

---

## 8. 참고 파일 경로 요약

- 로컬 프로젝트: `C:\Users\ceo\projects\targetup\`
- IMC 스펙 폴더: `C:\Users\ceo\Downloads\imc_extracted\` (55개 txt)
- QTmsg Agent 매뉴얼: `C:\Users\ceo\OneDrive\바탕 화면\bito-gateway\invitoMsg\doc\QTmsg-사용자메뉴얼ver4.0.pdf` (SMS INSERT 스펙)
- 본 세션 핸드오프: `status/D130-SESSION-HANDOFF.md`
- 본 세션 메모리: `.claude/projects/C--Users-ceo-projects-targetup/memory/project_d130.md`
- 서버 백엔드: `/home/administrator/targetup-app/packages/backend/` (dist/ 배포됨)
- 서버 PG: `docker exec -it targetup-postgres psql -U targetup targetup`
- 서버 `.env`: `/home/administrator/targetup-app/packages/backend/.env`
