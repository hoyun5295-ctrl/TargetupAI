# 🚨 D-Day 예약발송 이관 런북 (2026-05-05 D143 작업, 다음 세션 인수인계)

> **작성**: 2026-05-05 D143 세션 (컨텍 80% 도달, 다음 세션에서 INSERT 작업 진행)
> **실행자**: Harold님 + 다음 세션 Claude (AI는 SQL 안내만, SSH/git 절대 금지)
> **작업 디렉토리**: `C:\Users\ceo\projects\targetup\migrate-legacy\`

---

## ✅ 이번 세션 완료 사항

### 1. 한줄로 PG 사전 등록 (D143 Phase 1 — 완료)
- `sender_numbers` 7건 INSERT 완료 (is_verified=true, is_active=true)
- `callback_numbers` 7건은 D135에서 이미 등록됨 (label='레거시', assignment_scope='assigned' 6건 + 'all' 1건)
- `callback_number_assignments` 7명 사용자 매핑 모두 확인됨

### 2. 레거시 데이터 추출 완료 (Phase 2)
- ✅ `migrate-legacy/data/recipients_final.csv` — **397KB, 1454행** (5/6 이후 70건 캠페인의 수신자 명단)
- ✅ `migrate-legacy/data/mms_files.tar.gz` — **647KB, 9개 MMS 이미지**
- ✅ `migrate-legacy/data/mms_files.list` — 9개 이미지 절대경로 목록
- ✅ `migrate-legacy/data/user-map.json` — USERID 매핑 (D134 자산)

---

## 📊 확정된 사실 (다음 세션에서 그대로 사용)

### 이관 대상 70건 캠페인 — USERID 분포
| USERID | 회사 | 건수 | user_id (한줄로) | company_id |
|--------|------|------|------------------|------------|
| laprairieak | 라프레리 AK분당 | 34 | 32133d0f-375e-4c43-b371-6c73e40ccb44 | df63bcb0-3900-4a1c-8ad0-93c6b5a1db04 |
| lpkhdpg | 라프레리 현대판교 | 15 | 04f8bc6a-e30b-4daf-b86a-ca934bc8e07a | df63bcb0-3900-4a1c-8ad0-93c6b5a1db04 |
| hddg2135 | 라프레리 현대대구 | 13 | 38e28ba2-6678-4f47-b007-2fa5a413ca08 | df63bcb0-3900-4a1c-8ad0-93c6b5a1db04 |
| lpkltjs | 라프레리 잠실 | 3 | b6b7c0a3-f5ad-455d-be5c-44862512b95a | df63bcb0-3900-4a1c-8ad0-93c6b5a1db04 |
| choisun | DYB최선어학원 송파 | 2 | e4b4824c-6357-4e23-afe1-7bd371f0b2b1 | 0d20b03b-4c66-4205-ae81-a3b53a70481d |
| lphdmd | 라프레리 현대목동 | 2 | 47930a43-cd91-452a-bec0-d9fafedb9562 | df63bcb0-3900-4a1c-8ad0-93c6b5a1db04 |
| bhappy4 | 캐럿글로벌4 | 1 | 60da2b1d-8fe4-4bc8-8b95-915dfb67d94f | e8f0ffa7-2e59-4e2c-ad9f-b762c1d81f98 |
| **합계** | **3개 회사** | **70** | | |

### 라인그룹 (확정)
| company_id | 회사 | 라인그룹 | sms_tables |
|-----------|------|---------|-----------|
| df63bcb0-3900-4a1c-8ad0-93c6b5a1db04 | 라프레리 | 대량발송(1) | SMSQ_SEND_1, SMSQ_SEND_2, SMSQ_SEND_3 |
| 0d20b03b-4c66-4205-ae81-a3b53a70481d | 최선어학원 | 대량발송(2) | SMSQ_SEND_4, SMSQ_SEND_5, SMSQ_SEND_6 |
| e8f0ffa7-2e59-4e2c-ad9f-b762c1d81f98 | 캐럿글로벌 | 대량발송(2) | SMSQ_SEND_4, SMSQ_SEND_5, SMSQ_SEND_6 |

### billing_type — 모두 postpaid (잔액 차감 미발생, 안전)

### 발신번호 등록 (D143 완료)
- 7개 phone_number(`0317099742`, `03151702120`, `0532452135`, `0221437187`, `0221631152`, `024247094`, `01038065467`) 모두 sender_numbers + callback_numbers 등록됨
- callback_number_assignments에 7명 사용자 매핑 완료 (laprairieak/lpkhdpg/hddg2135/lpkltjs/choisun/lphdmd/bhappy4 모두)

---

## 📁 CSV 형식 (`recipients_final.csv`)

파이프(`|`) 구분자, 11개 컬럼:
```
APP_ETC1 | APP_ETC2 | DEST_NO | CALL_BACK | MSG_TYPE | SENDREQ_TIME | MSG_CONTENTS | TITLE_STR | FILE_NAME1 | FILE_NAME2 | FILE_NAME3
```

| 컬럼 | 의미 | 예시 |
|------|------|------|
| APP_ETC1 | 레거시 MSGSUMMARY.CODE | `724142` |
| APP_ETC2 | 레거시 USERID (발송자) | `laprairieak` |
| DEST_NO | 수신번호 | `01052750003` |
| CALL_BACK | 회신번호(=발신번호) | `0317099742` |
| MSG_TYPE | S=SMS, L=LMS, M=MMS | `M` |
| SENDREQ_TIME | 예약시각 (KST) `YYYYMMDDHH24MISS` | `20260506110000` |
| MSG_CONTENTS | 메시지 본문 (개행은 `\n` 문자열로) | `권지수 고객님\n안녕하세요...` |
| TITLE_STR | LMS/MMS 제목 | `[AK분당 라프레리]` |
| FILE_NAME1~3 | MMS 첨부 절대경로 (레거시 서버) | `/home/storysom/WebContent/files/laprairieak/202604240248310910.jpg` |

---

## 📁 MMS 이미지 9개 (`mms_files.tar.gz` 안)

```
home/storysom/WebContent/files/choisun/202604300213357100.jpg     (CODE 724876, 902명)
home/storysom/WebContent/files/choisun/202604300214331780.jpg     (CODE 724879, 469명)
home/storysom/WebContent/files/laprairieak/202604240248310910.jpg (CODE 724154, 724156)
home/storysom/WebContent/files/lphdmd/202503311147100690.jpg      (CODE 724949)
home/storysom/WebContent/files/lphdmd/202503311150047570.jpg      (CODE 724941)
home/storysom/WebContent/files/lpkhdpg/202411141153054190.jpg     (CODE 724691)
home/storysom/WebContent/files/lpkhdpg/202509210458223930.jpg     (CODE 721067, 721070~)
home/storysom/WebContent/files/lpkhdpg/202601040807037490.jpg     (CODE 724692~724695)
home/storysom/WebContent/files/lpkltjs/202507150537218490.jpg     (CODE 724396~724400)
```

---

## 🎯 한줄로 SMSQ_SEND INSERT 패턴 (검증 완료, sms-queue.ts:910 `bulkInsertSmsQueue`)

### 컬럼 매핑 (한줄로 표준)
```js
INSERT INTO SMSQ_SEND_X (
  dest_no, call_back, msg_contents, msg_type, title_str,
  sendreq_time, status_code, rsv1, app_etc1, app_etc2,
  file_name1, file_name2, file_name3
) VALUES (?, ?, ?, ?, ?, ?, 100, '1', ?, ?, ?, ?, ?)
```

### bulkInsertSmsQueue rows 형식 (배열)
```js
[
  dest_no,         // [0] CSV.DEST_NO
  call_back,       // [1] CSV.CALL_BACK
  msg_contents,    // [2] CSV.MSG_CONTENTS (\n 복원)
  msg_type,        // [3] CSV.MSG_TYPE ('S'/'L'/'M')
  title_str,       // [4] CSV.TITLE_STR
  sendTime,        // [5] CSV.SENDREQ_TIME → 'YYYY-MM-DD HH:mm:ss' KST
  app_etc1,        // [6] 새 PG campaign_id (UUID, INSERT 후 받음)
  app_etc2,        // [7] company_id (한줄로 패턴, sms-queue.ts:760 `r.companyId`)
  file_name1,      // [8] CSV.FILE_NAME1 → 한줄로 경로로 변환
  file_name2,      // [9] CSV.FILE_NAME2 (보통 빈값)
  file_name3,      // [10] CSV.FILE_NAME3 (보통 빈값)
]
```

### 호출 패턴
```js
import { bulkInsertSmsQueue, getCompanySmsTables } from 'utils/sms-queue';

const tables = await getCompanySmsTables(companyId);  // 회사별 라인그룹 자동 조회
const sentCount = await bulkInsertSmsQueue(tables, rows, /*useNow=*/false);
```

---

## 🎯 PG campaigns INSERT 패턴

```sql
INSERT INTO campaigns (
  id, user_id, company_id, campaign_name, message_type, message_content,
  subject, message_subject, callback_number, target_count, send_type, status,
  scheduled_at, message_template, created_by, mms_image_paths, send_channel, is_ad, created_at
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $7, $8, $9, 'direct', 'scheduled',
  $10, $6, $2, $11, 'sms', $12, NOW()
)
```

### 캠페인별 매핑 규칙
| PG 컬럼 | 매핑 |
|---------|------|
| id | `gen_random_uuid()` (이게 SMSQ_SEND.app_etc1 됨) |
| user_id | user-map.json[USERID].user_id |
| company_id | user-map.json[USERID].company_id |
| campaign_name | `[레거시이관] ${TITLE_STR || '제목없음'} ${SENDREQ_TIME 변환}` |
| message_type | S→'SMS' / L→'LMS' / M→'MMS' |
| message_content | 캠페인 첫 행의 MSG_CONTENTS (CSV 그대로, `\n` 복원) |
| subject / message_subject | TITLE_STR |
| callback_number | CALL_BACK (중복 제거 후 1개) |
| target_count | 캠페인별 수신자 수 (CSV에서 GROUP BY APP_ETC1 카운트) |
| scheduled_at | `${SENDREQ_TIME 변환} KST` ISO |
| mms_image_paths | MMS이면 `[한줄로_mms_경로]` JSON 배열, 아니면 NULL |
| send_channel | 'sms' (default) |
| is_ad | MSG_CONTENTS가 `(광고)`로 시작하면 true (D143 정책: 사용자 입력 그대로) |

⚠️ **D143 정책**: `is_ad` 자동 승격 폐지됨. 사용자가 본문에 박은 (광고)는 그대로 보존. message_content에 (광고) 박혀있어도 sanitize 안 함.

---

## 🛠 다음 세션 즉시 작업 — INSERT 스크립트

### 파일: `migrate-legacy/scripts/migrate-reservations.js`

골격:
```js
// 1. CSV 읽기 → 캠페인별 그룹핑 (APP_ETC1 기준)
const fs = require('fs');
const path = require('path');
const userMap = require('../data/user-map.json');

const lines = fs.readFileSync(path.join(__dirname, '../data/recipients_final.csv'), 'utf8')
  .split('\n').filter(l => l.trim());

const campaignMap = new Map();  // APP_ETC1 → { meta, recipients[] }
for (const line of lines) {
  const cols = line.split('|');
  if (cols.length < 11) continue;
  const [legacyCode, userid, dest, callback, msgType, sendTime, msg, title, f1, f2, f3] = cols;
  if (!campaignMap.has(legacyCode)) {
    campaignMap.set(legacyCode, {
      legacyCode, userid, callback, msgType, sendTime, msg, title,
      mmsFiles: [f1, f2, f3].filter(f => f && f.startsWith('/home/')),
      recipients: [],
    });
  }
  campaignMap.get(legacyCode).recipients.push({ dest, msg, title, f1, f2, f3 });
}

// 2. 캠페인별 처리 (70개)
for (const [legacyCode, camp] of campaignMap) {
  const userInfo = userMap[camp.userid];
  if (!userInfo) { console.error(`USERID 매핑 누락: ${camp.userid}`); continue; }

  // 2-A. PG campaigns INSERT
  const newCampaignId = await pgInsertCampaign(camp, userInfo);

  // 2-B. MySQL SMSQ_SEND INSERT (수신자별 N건)
  const tables = await getCompanySmsTables(userInfo.company_id);
  const rows = camp.recipients.map(r => [
    r.dest, camp.callback,
    decodeMsg(r.msg),  // \n → 실제 개행
    camp.msgType, camp.title,
    convertSendTime(camp.sendTime),  // 'YYYYMMDDHHMMSS' → 'YYYY-MM-DD HH:mm:ss'
    newCampaignId,
    userInfo.company_id,
    convertMmsPath(r.f1),  // 한줄로 경로로 변환
    convertMmsPath(r.f2),
    convertMmsPath(r.f3),
  ]);
  await bulkInsertSmsQueue(tables, rows, false);
}
```

### 헬퍼 함수
```js
function decodeMsg(s) {
  return s.replace(/\\n/g, '\n');
}

function convertSendTime(yyyymmddhhmiss) {
  // '20260506110000' → '2026-05-06 11:00:00'
  const m = yyyymmddhhmiss.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
}

function convertMmsPath(legacyPath) {
  if (!legacyPath || !legacyPath.startsWith('/home/storysom/WebContent/files/')) return null;
  // 레거시: /home/storysom/WebContent/files/{USERID}/{filename}.jpg
  // 한줄로: /home/administrator/targetup-app/uploads/mms/legacy/{USERID}/{filename}.jpg (예시)
  const filename = path.basename(legacyPath);
  const userid = legacyPath.split('/').slice(-2, -1)[0];
  return `/uploads/mms/legacy/${userid}/${filename}`;  // ⚠️ 한줄로 실제 경로 확인 필요
}
```

⚠️ **MMS 경로 변환 주의**: 한줄로 mms_image_paths 컬럼 형식과 실제 파일 저장 경로 매핑 다음 세션에서 코드(MMS 업로드 라우트) 확인 후 확정.

---

## 🚀 다음 세션 작업 순서 (체크리스트)

- [ ] **0. 12시 차단 확인** — 레거시 Agent가 정말 멈췄는지 Harold님 확인 (안 멈췄으면 중복 발송 위험)
- [ ] **1. MMS 경로 변환 결정** — 한줄로 backend MMS 업로드 라우트 grep으로 mms_image_paths 형식/저장경로 확정
  - `grep -rn "mms_image_paths" packages/backend/src`
  - `grep -rn "uploads/mms" packages/backend/src`
- [ ] **2. MMS 이미지 한줄로 서버 업로드** (Harold님 직접 SCP)
  ```powershell
  scp migrate-legacy\data\mms_files.tar.gz administrator@58.227.193.62:/home/administrator/
  ssh administrator@58.227.193.62
  cd /home/administrator/targetup-app/uploads/mms/legacy/  # 또는 확정된 경로
  tar xzf /home/administrator/mms_files.tar.gz --strip-components=4 -C ./
  # 또는 USERID별 폴더 구조 보존
  ```
- [ ] **3. INSERT 스크립트 작성** `migrate-legacy/scripts/migrate-reservations.js`
- [ ] **4. dry-run** — `--dry-run` 옵션으로 INSERT 안 하고 70건 캠페인 + 1454 수신자 정합 확인
- [ ] **5. 실제 INSERT 실행** (단일 트랜잭션)
- [ ] **6. 검증 SQL** (아래 §검증 참조)
- [ ] **7. 한줄로 UI에서 예약대기 모달 70건 표시 확인**
- [ ] **8. 1~2건 실 발송 테스트** (가까운 5/6 캠페인 1건)

---

## 🔍 검증 SQL

### PG (한줄로)
```sql
-- INSERT된 캠페인 70건 확인
SELECT id, campaign_name, message_type, target_count, scheduled_at, callback_number,
       u.login_id, c.company_name
FROM campaigns ca
JOIN users u ON ca.created_by = u.id
JOIN companies c ON ca.company_id = c.id
WHERE ca.campaign_name LIKE '[레거시이관]%'
ORDER BY ca.scheduled_at;

-- USERID별 캠페인 수 (laprairieak 34, lpkhdpg 15 ...)
SELECT u.login_id, COUNT(*) AS cnt, SUM(ca.target_count) AS total_recipients
FROM campaigns ca
JOIN users u ON ca.created_by = u.id
WHERE ca.campaign_name LIKE '[레거시이관]%'
GROUP BY u.login_id
ORDER BY cnt DESC;
-- 기대: 7명 / 합계 70건 / 수신자 1454명
```

### MySQL (한줄로)
```sql
-- 라인그룹별 SMSQ_SEND INSERT 건수
USE smsdb;
SELECT 'SMSQ_SEND_1' AS T, COUNT(*) FROM SMSQ_SEND_1 WHERE app_etc2 = 'df63bcb0-3900-4a1c-8ad0-93c6b5a1db04' AND status_code=100
UNION ALL SELECT 'SMSQ_SEND_2', COUNT(*) FROM SMSQ_SEND_2 WHERE app_etc2 = 'df63bcb0-3900-4a1c-8ad0-93c6b5a1db04' AND status_code=100
UNION ALL SELECT 'SMSQ_SEND_3', COUNT(*) FROM SMSQ_SEND_3 WHERE app_etc2 = 'df63bcb0-3900-4a1c-8ad0-93c6b5a1db04' AND status_code=100
UNION ALL SELECT 'SMSQ_SEND_4', COUNT(*) FROM SMSQ_SEND_4 WHERE app_etc2 IN ('0d20b03b-4c66-4205-ae81-a3b53a70481d','e8f0ffa7-2e59-4e2c-ad9f-b762c1d81f98') AND status_code=100
UNION ALL SELECT 'SMSQ_SEND_5', COUNT(*) FROM SMSQ_SEND_5 WHERE app_etc2 IN ('0d20b03b-4c66-4205-ae81-a3b53a70481d','e8f0ffa7-2e59-4e2c-ad9f-b762c1d81f98') AND status_code=100
UNION ALL SELECT 'SMSQ_SEND_6', COUNT(*) FROM SMSQ_SEND_6 WHERE app_etc2 IN ('0d20b03b-4c66-4205-ae81-a3b53a70481d','e8f0ffa7-2e59-4e2c-ad9f-b762c1d81f98') AND status_code=100;
-- 합계 1454건 기대
```

---

## ⚠️ 절대 주의

1. **AI는 SSH/git/배포 절대 금지** — 명령어만 안내, Harold님이 직접 실행
2. **추측 절대 금지** (CLAUDE.md 0번 끌로드원칙) — 데이터/코드 검증 후에만 답
3. **MMS 경로 변환** — 한줄로 backend 코드에서 mms_image_paths 형식 확인 전 INSERT 금지
4. **dry-run 먼저** — INSERT 70건 + 1454건 한 번에 실행 전 dry-run으로 검증
5. **단일 트랜잭션** — PG INSERT 70건은 BEGIN/COMMIT으로 묶기 (실패 시 ROLLBACK)
6. **MySQL은 별도** — bulkInsertSmsQueue는 트랜잭션 X, 라인그룹별 분배. 실패 batch는 미집계

---

## 📌 레거시 차단 (이관 후)

```bash
ssh -p 27153 root@27.102.203.143
su - oracle
sqlplus usom_user@orcl
```

```sql
-- 5/6 이후 70건 예약 차단 (RESERVEYN=0)
UPDATE MSGSUMMARY SET RESERVEYN='0', FINAL_UPD_ID='legacy_migration', FINAL_UPD_DT=TO_CHAR(SYSDATE,'YYYYMMDDHH24MISS')
WHERE RESERVEYN='1' AND SENTYN='0' AND RESERVEDT >= '20260506000000';

COMMIT;
SELECT COUNT(*) FROM MSGSUMMARY WHERE RESERVEYN='1' AND SENTYN='0' AND RESERVEDT >= '20260506000000';
-- 0 기대
```

⚠️ **이 UPDATE는 한줄로 INSERT 검증 + 발송 테스트 통과 후에만 실행.**

---

## 📚 관련 메모리/문서

- `feedback_no_speculation_verify_first.md` — 추측 금지 (D143)
- `feedback_no_apology_no_filler.md` — 사과/추측/누락 표현 회피
- `user_collaboration_role.md` — Harold 기획·비토 구현 협업 구조
- `project_legacy_migration.md` — 레거시 이관 전체 정책
- `reference_invito_infra.md` — 레거시 인프라 (SSH 27153)
- `status/LEGACY-MIGRATION.md` — 이관 설계서
- `migrate-legacy/D-DAY-PREPAID-RUNBOOK.md` — 선불 잔액 이관 (별건)

---

## 🎬 다음 세션 시작 시 첫 행동

1. 이 문서(`D-DAY-RESERVATION-RUNBOOK.md`) 정독
2. `recipients_final.csv` 첫 5행 head로 형식 재확인
3. 한줄로 `mms_image_paths` 형식 grep
4. INSERT 스크립트 골격 작성 시작

**컨텍 절약 위해 위 §"한줄로 SMSQ_SEND INSERT 패턴" + §"PG campaigns INSERT 패턴" + §"INSERT 스크립트" 섹션을 먼저 보면 즉시 작업 시작 가능.**
