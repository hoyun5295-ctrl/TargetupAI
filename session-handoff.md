# 2026-02-13 세션 핸드오프 (새 채팅용)

> **⚠️ 2026-03-04 확인: 아래 미해결 항목 전부 해결 완료. 이 문서는 아카이브 상태.**

## ✅ 해결됨 (2026-03-04 확인) — tsc 빌드 정상, dist 직접 수정 불필요

### 1. tsc 빌드 에러 (백엔드) — ✅ 해결
`npm run build` 실행 시 app.ts에서 모듈 못 찾는 에러 13개 발생.
dist 직접 수정으로 임시 해결했지만, tsc 빌드가 깨진 상태.
**→ 2026-03-04: tsconfig.json 경로 수정 + defaults.ts 중앙화로 해결. tsc --noEmit 통과.**

```
src/utils/app.ts:1:22 - error TS2307: Cannot find module './routes/ai'
src/utils/app.ts:9:24 - error TS2307: Cannot find module './routes/auth'
... (13개)
```

**원인 추정**: tsconfig.json의 paths/rootDir 설정 문제 또는 파일 구조 불일치
**영향**: 소스 수정 후 정상 빌드 불가 → dist 직접 수정 해야 하는 상황
**우선순위**: 높음 (이게 해결 안 되면 모든 백엔드 수정이 dist 직접 수정 필요)

### 2. dist/routes/spam-filter.js 파일 꼬임 — ✅ 해결
서버에서 sed로 여러 번 수정하면서 파일이 꼬진 상태.
**→ tsc 빌드 정상화로 자동 해결.**

### 3. campaigns.ts — prepaidDeduct UUID 에러 수정 — ✅ 해결 (src 반영됨)
**파일**: `packages/backend/src/routes/campaigns.ts` 454줄
**에러**: `invalid input syntax for type uuid: "test"`

**수정 전:**
```typescript
const testDeduct = await prepaidDeduct(companyId, managerContacts.length, testMsgType, 'test');
```

**수정 후:**
```typescript
const testDeduct = await prepaidDeduct(companyId, managerContacts.length, testMsgType, '00000000-0000-0000-0000-000000000000');
```

**현재 상태**: dist만 수정됨, src는 아직 'test'일 수 있음 → 소스에서도 수정 후 빌드 필요

### 4. SpamFilterTestModal.tsx — messageType body 전달
**파일**: `packages/frontend/src/components/SpamFilterTestModal.tsx`

**수정 전:**
```typescript
body: JSON.stringify({ callbackNumber, messageContentSms: messageContentSms || null, messageContentLms: messageContentLms || null }),
```

**수정 후:**
```typescript
body: JSON.stringify({ callbackNumber, messageContentSms: messageContentSms || null, messageContentLms: messageContentLms || null, messageType }),
```

**현재 상태**: 서버에서 sed로 수정 → 로컬 pull 시 반영됨, 프론트 빌드 완료

---

## ✅ 해결 완료

### 스팸필터 테스트 시스템 — 발송 성공
**파일**: `packages/backend/src/routes/spam-filter.ts`

**핵심 문제**: insertSmsQueue 함수가 담당자 테스트(campaigns.ts)와 다른 형식으로 MySQL INSERT
- `sendreq_time`에 KST 시간 넣음 → MySQL은 UTC → Agent가 미래시간으로 판단 → 예약발송 대기
- `msg_instm`에도 JS 시간 넣음
- `status_code` 미지정

**수정 전:**
```typescript
async function insertSmsQueue(
  destNo: string,
  callBack: string,
  content: string,
  msgType: string,
  testId: string
): Promise<void> {
  const testTable = getTestSmsTable();
  

  if (msgType === 'SMS') {
    await mysqlQuery(
      `INSERT INTO ${testTable}
       (dest_no, call_back, msg_contents, msg_instm, sendreq_time, msg_type, rsv1, app_etc1)
       VALUES (?, ?, ?, ?, ?, 'S', '1', ?)`,
      [destNo, callBack, content, testId]
    );
  } else {
    // LMS
    const subject = content.substring(0, 30);
    await mysqlQuery(
      `INSERT INTO ${testTable}
       (dest_no, call_back, msg_contents, msg_instm, sendreq_time, msg_type, title_str, rsv1, app_etc1)
       VALUES (?, ?, ?, ?, ?, 'L', ?, '1', ?)`,
      [destNo, callBack, content, subject, testId]
    );
  }
}
```

**수정 후 (담당자 테스트와 동일 형식):**
```typescript
async function insertSmsQueue(
  destNo: string,
  callBack: string,
  content: string,
  msgType: string,
  testId: string
): Promise<void> {
  const testTable = getTestSmsTable();
  const mType = msgType === 'SMS' ? 'S' : 'L';

  await mysqlQuery(
    `INSERT INTO ${testTable} (
      dest_no, call_back, msg_contents, msg_type, sendreq_time, status_code, rsv1, app_etc1
    ) VALUES (?, ?, ?, ?, NOW(), 100, '1', ?)`,
    [destNo, callBack, content, mType, testId]
  );
}
```

**현재 상태**: ✅ 소스 수정 완료, 로컬 push → 서버 pull → 빌드 완료, 발송 성공 확인

### Agent 10 문제 해결
- Agent 10이 "이미 실행중" 상태에서 DB 폴링 안 함
- `./fkill.sh` → `./startup.sh`로 강제 재시작하여 해결
- Agent 10 경로: `/home/administrator/agent10/`

### 스팸필터 테스트 — messageType별 발송
**파일**: `packages/backend/src/routes/spam-filter.ts` 91~96줄

**수정 전:**
```typescript
const messageTypes: string[] = [];
if (messageContentSms) messageTypes.push('SMS');
if (messageContentLms) messageTypes.push('LMS');
```

**수정 후:**
```typescript
const messageTypes: string[] = [];
if (messageType === 'LMS' || messageType === 'MMS') {
  if (messageContentLms) messageTypes.push('LMS');
} else {
  if (messageContentSms) messageTypes.push('SMS');
}
```

**현재 상태**: ✅ 소스 수정 완료

---

## 📋 STATUS.md 업데이트 필요 항목

기존 1573~1574줄:
```
- [x] Android 앱 개발 완료 (스팸필터 자동 테스트, APK 빌드 완료)
- [ ] 테스트폰 3대 설치 + 실제 테스트 (SKT/KT/LGU)
```

→ 변경:
```
- [x] Android 앱 개발 완료 (스팸필터 자동 테스트, APK 빌드 완료)
- [x] 스팸필터 테스트 시스템 서버 배포 완료 (2026-02-13)
  - DB 테이블, 백엔드 API, 디바이스 등록, SMS 발송 + 수신 확인 (LGU+ 성공)
  - insertSmsQueue를 담당자 테스트(campaigns.ts)와 동일 형식으로 통일
  - Agent 10 재시작 (fkill.sh → startup.sh)
- [ ] 테스트폰 3대 설치 (현재 LGU+ 1대만, SKT/KT 추가 필요)
```

---

## 🔧 서버 상태 참고

- **Agent 10**: 정상 실행 중 (`/home/administrator/agent10/`)
- **PM2**: `pm2 restart all`로 재시작 완료
- **MySQL**: Docker `targetup-mysql`, UTC 시간대
- **PostgreSQL**: Docker `targetup-postgres`, user: `targetup`
- **SMSQ_SEND_10**: 테스트 데이터 정리 완료 (DELETE)

### QTmsg 핵심 포인트 (매뉴얼 기반)
- `rsv1`: 1=발송대기, 2=처리중, 3=전송완료, 4=결과수신, 5=월별처리완료
- `status_code`: 100=대기, 6=SMS성공, 1000=LMS성공
- `sendreq_time`: **반드시 MySQL NOW() 사용** (서버가 UTC이므로 JS에서 KST 넣으면 미래시간 됨)
- Agent는 seqno 기반으로 폴링 → 이전 seq보다 큰 것만 처리
- Agent 재시작 필요 시: `./fkill.sh` → `./startup.sh` (shutdown.sh가 안 될 때)
