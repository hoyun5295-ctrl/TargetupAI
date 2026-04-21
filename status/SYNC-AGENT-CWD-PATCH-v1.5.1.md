# SYNC-AGENT v1.5.1 CWD 패치 — 다음 세션 착수 지시서

> **작성**: 2026-04-21 (D131)
> **목적**: Windows 서비스 실행 시 1053 에러 근본 해결
> **범위**: Agent 코드 3줄 패치 + 빌드 + 배포

---

## § 1. 작업 원칙 (세션 시작 시 암기)

1. **이 문서만 보고 바로 실행**. 별도 조사/추측 금지.
2. 팩트는 § 2에서 이미 확정됨. 재검증 불필요.
3. **수정 대상 파일은 `sync-agent/src/index.ts` 단 1개**. 다른 파일 건드리지 않음.
4. 빌드 후 **실제 Windows 서비스 등록 → 시작 → 1053 없이 기동 확인**될 때까지 배포 금지.
5. Harold님께 **① tsc 통과 로그 ② 새 exe 빌드 성공 로그 ③ 수란님께 전달 방법** 세 개 보고 후 진행 승인.

---

## § 2. 근본 원인 (팩트 확정 — 2026-04-21 D131 실측)

### 2-1. 증상
- `sync-agent.exe`를 **콘솔에서 수동 실행** → 정상 동작 (1500건 sync 471ms 성공)
- **Windows 서비스로 시작** → `1053 (서비스가 시작 또는 제어 요청에 제때 응답하지 않았습니다)` 에러
- 서비스 등록은 성공 (services.msc에 "Sync Agent / 자동 / 중지됨" 표시)

### 2-2. 근본 원인 코드 (3곳)
```
sync-agent/src/logger/index.ts:16      → LOG_DIR = path.resolve(process.cwd(), 'logs')
sync-agent/src/config/encryption.ts:23 → DATA_DIR = path.resolve(process.cwd(), 'data')
sync-agent/src/sync/state.ts:14        → DATA_DIR = path.resolve(process.cwd(), 'data')
```

### 2-3. 왜 서비스에서만 실패하는가 (Windows 팩트)
- Windows Service Control Manager가 서비스를 시작할 때 **현재 작업 디렉토리를 `C:\Windows\System32\` 로 설정**함 (SC 명령으로 등록된 서비스의 기본 동작, MSDN 문서 확정).
- Agent 코드가 `process.cwd()` 기반 → `C:\Windows\System32\data\config.enc` 를 찾음 → 파일 없음 → 크래시 → Service Control Manager에 "시작 완료" 신호 보내지 못함 → **30초 타임아웃 → 1053 반환**.
- **콘솔 실행은** `cd "<설치폴더>"` 후 실행하므로 cwd가 올바름 → 성공.

### 2-4. 클라이언트 증상 매트릭스

| 실행 방식 | cwd | config/data/logs 경로 | 결과 |
|---------|-----|---------------------|------|
| 관리자 cmd/PowerShell에서 `cd 설치폴더 && .\sync-agent.exe` | 설치폴더 | 올바름 | ✅ 정상 |
| services.msc에서 시작 (SC 등록된 서비스) | `C:\Windows\System32` | `System32\data\config.enc` (없음) | ❌ 1053 |
| 작업 스케줄러 "시작 위치" 지정 시 | 지정한 폴더 | 올바름 | ✅ 정상 (우회책) |

---

## § 3. 수정 코드 (단일 파일, 3줄)

### 3-1. 대상 파일
`sync-agent/src/index.ts`

### 3-2. 추가 위치
파일 **최상단 import 블록 직후, 모든 로직 실행 전**. `initLogger()` 호출이나 다른 초기화보다 **무조건 먼저**.

### 3-3. 추가할 코드 (그대로 복붙)

```ts
// ★ v1.5.1: Windows 서비스 실행 시 cwd=C:\Windows\System32 → config/data/logs 경로 틀어짐
//   → 바이너리 실행 경로(process.execPath) 기준으로 cwd 강제 설정
//   (콘솔 실행 시에도 동일하게 동작 — 멱등, 부작용 없음)
try {
  const __execDir = require('path').dirname(process.execPath);
  process.chdir(__execDir);
} catch (err) {
  // chdir 실패는 치명적 아님 — 콘솔 실행 경로에서는 기존 동작 유지
  console.error('[startup] chdir failed:', (err as Error)?.message);
}
```

### 3-4. 왜 `process.execPath` 인가 (팩트)
- `process.execPath` = Node.js/pkg로 빌드된 실행 바이너리의 **절대 경로** (`C:\Program Files (x86)\INVITO\SyncAgent\sync-agent.exe`).
- 이 값은 **실행 방식(콘솔/서비스/스케줄러)과 무관하게 동일**. 
- `path.dirname()` 적용 → 설치 폴더 절대경로.
- `process.chdir()` → 프로세스 cwd를 그 폴더로 변경.
- 이후 `process.cwd()` 호출하는 기존 3곳 코드는 **전부 자동으로 올바른 경로** 반환.

### 3-5. 수정하지 말 것
- `logger/index.ts`, `config/encryption.ts`, `sync/state.ts` — **절대 수정 금지**. chdir로 해결됨. 파일별 수정은 누락/일관성 깨짐 원인.
- 다른 initialization 순서 변경 금지.

---

## § 4. 검증 체크리스트 (순서 엄수)

### 4-1. TypeScript 체크
```cmd
cd C:\Users\ceo\projects\targetup\sync-agent
npx tsc --noEmit
```
→ 에러 0건 확인. 에러 있으면 수정 멈춤.

### 4-2. 로컬 단위 테스트 (선택)
```cmd
npm test
```
→ 기존 테스트 스위트 통과 확인. chdir이 다른 테스트에 영향 주는지 체크.

### 4-3. 빌드
```cmd
cd C:\Users\ceo\projects\targetup\sync-agent
node build-manual-v1-5.js
```
또는 기존 빌드 스크립트(`esbuild.config.js`) 그대로 사용.
→ `release/` 또는 `dist/` 폴더에 새 `sync-agent.exe` 생성 확인. 파일명/크기 기록.

### 4-4. 릴리스 버전 업데이트
- `sync-agent/package.json` version: `1.5.0` → `1.5.1`
- `sync-agent/src/index.ts` 또는 버전 상수 파일에 `1.5.1` 반영
- `status/SYNC-AGENT-V1.5.0-RELEASE-NOTES.md` 또는 신규 `v1.5.1-RELEASE-NOTES.md` 작성

### 4-5. 로컬 Windows에서 서비스 실행 시뮬레이션 (선택 but 권장)
Harold님 로컬 Windows 머신 있으시면:
```cmd
REM 1) 새 exe를 별도 테스트 폴더에 복사
mkdir C:\sync-agent-test
copy release\sync-agent.exe C:\sync-agent-test\
cd C:\sync-agent-test

REM 2) 수동으로 data\ 폴더 + config.enc 더미 만들거나 --setup 실행
.\sync-agent.exe --setup

REM 3) 서비스 등록 (관리자 PowerShell)
.\sync-agent.exe --install-service
.\sync-agent.exe --service-status
REM → Running 확인. 1053 안 뜨면 패치 성공.
```

---

## § 5. 배포 (수란님께 전달)

### 5-1. 전달 파일
- `sync-agent-v1.5.1.exe` (또는 SyncAgent-Setup-1.5.1.exe)
- 이 문서의 § 5-2 단계 안내문 (복붙 가능 포맷)

### 5-2. 수란님 업그레이드 절차 (그대로 복사해서 전달)

```
수란님, SyncAgent v1.5.1 업그레이드 안내드립니다.

Windows 서비스 시작 시 1053 에러 해결한 버전입니다.

## 절차
1) 현재 콘솔에서 실행 중인 sync-agent.exe가 있으면 해당 창에서 Ctrl+C로 종료

2) 서비스 등록되어 있으면 제거 (관리자 PowerShell)
   cd "C:\Program Files (x86)\INVITO\SyncAgent"
   .\sync-agent.exe --uninstall-service

3) 새 exe 파일로 교체
   전달받은 sync-agent.exe를 C:\Program Files (x86)\INVITO\SyncAgent\ 에 덮어쓰기
   (data\ 폴더와 agent.key는 그대로 유지 — 기존 설정 재사용)

4) 서비스 재등록
   cd "C:\Program Files (x86)\INVITO\SyncAgent"
   .\sync-agent.exe --install-service

5) 서비스 시작
   .\sync-agent.exe --service-status
   → 상태가 Running 이면 성공

6) 로그 확인
   Get-Content logs\sync-2026-04-21.log -Tail 30
   → "MSSQL 연결 성공" + "Heartbeat 전송 성공" 메시지 확인

## 재부팅 테스트
위 5단계 성공 후 서버 재부팅 한 번 하신 뒤, 재부팅 완료 후 services.msc 열어서
Sync Agent 상태 Running 이면 완벽. (재부팅 시 자동 시작 검증)
```

### 5-3. 롤백 절차 (문제 발생 시)
```cmd
REM 구 버전 exe 백업해둔 것을 다시 덮어쓰기
copy sync-agent-v1.5.0.exe.bak "C:\Program Files (x86)\INVITO\SyncAgent\sync-agent.exe" /Y

REM 서비스 재등록
cd "C:\Program Files (x86)\INVITO\SyncAgent"
.\sync-agent.exe --uninstall-service
.\sync-agent.exe --install-service
```

---

## § 6. 서버측 검증 (Harold님이 배포 후 실행)

수란님이 v1.5.1 설치 완료 보고 후, 한줄로AI 서버에서:

```bash
# 1. 새 sync 성공 기록 + heartbeat 갱신
docker exec -i targetup-postgres psql -U targetup targetup -c "
  SELECT agent_name,
         last_heartbeat_at AT TIME ZONE 'Asia/Seoul' AS 하트비트,
         last_sync_at AT TIME ZONE 'Asia/Seoul' AS 마지막동기화,
         total_customers_synced AS 누적
    FROM sync_agents WHERE agent_name='sync-agent-001';"

# 2. 최근 sync_logs 성공 여부
docker exec -i targetup-postgres psql -U targetup targetup -c "
  SELECT started_at AT TIME ZONE 'Asia/Seoul', sync_type, total_count, success_count, fail_count
    FROM sync_logs
   WHERE agent_id=(SELECT id FROM sync_agents WHERE agent_name='sync-agent-001')
   ORDER BY started_at DESC LIMIT 5;"

# 3. nginx access 로그 — Agent 요청 도달 여부
sudo grep "/api/sync/" /var/log/nginx/access.log | tail -15
```

**판정 기준**: `success_count == total_count` AND `last_heartbeat_at` 갱신 중이면 v1.5.1 정상 배포 완료.

---

## § 7. 릴리스 노트 (`sync-agent/RELEASE-NOTES.md` 또는 별도 파일)

### v1.5.1 (2026-04-2?)
- **버그 수정**: Windows 서비스로 실행 시 1053 에러 해결. 서비스 시작 시 cwd가 `C:\Windows\System32`로 설정되어 `data/config.enc` 파일을 찾지 못해 기동 실패하던 문제 수정.
- **변경 내용**: `process.chdir(path.dirname(process.execPath))`를 startup 최상단에 추가하여 실행 경로와 무관하게 cwd가 설치 폴더로 고정되도록 함.
- **영향**: Windows 서비스 정상 자동 시작. Linux systemd 환경에도 영향 없음 (systemd는 WorkingDirectory 지원으로 원래 문제 없었음).
- **업그레이드 절차**: 기존 `data/` 폴더 유지하고 exe만 교체. 서비스 재등록 필요. § 5-2 참조.

---

## § 8. 이 문서를 본 다음 세션 AI의 행동 순서 (요약)

1. ✅ 이 문서 § 2 팩트 읽기 (재검증 금지)
2. ✅ § 3-3 코드 복붙 → `sync-agent/src/index.ts` 최상단에 추가
3. ✅ § 4-1 `tsc --noEmit` 실행 → 에러 0건 확인
4. ✅ § 4-3 빌드 실행 → 새 exe 확인
5. ✅ § 4-4 버전 번호 1.5.0 → 1.5.1 업데이트
6. ✅ Harold님께 "빌드 완료. 새 exe 경로: {path}. 수란님께 전달 OK?" 보고
7. ✅ 배포 진행 승인 → § 5-2 안내문을 Harold님께 전달 (수란님 전달용)
8. ✅ 수란님 설치 완료 보고 → § 6 서버측 검증 쿼리 Harold님께 안내
9. ✅ 검증 통과 → § 7 릴리스 노트 작성 → STATUS.md 업데이트 → 완료

---

## § 9. 이 문서의 진입점 (세션 시작 멘트)

```
이 세션은 다음 지시서 단일 문서를 기준으로 진행합니다:
status/SYNC-AGENT-CWD-PATCH-v1.5.1.md

§ 1 작업 원칙을 읽고 § 8 순서대로 실행합니다. 
§ 2 팩트는 재검증 없이 신뢰합니다. 
§ 3 코드 한 덩어리만 추가하고 빌드합니다.
빌드 완료 후 Harold님께 배포 승인 요청합니다.
```

---

## § 10. 연관 문서

- [`status/SYNC-AGENT-TROUBLESHOOTING.md`](SYNC-AGENT-TROUBLESHOOTING.md) — 싱크에이전트 이슈 진단 일반 가이드 (이 문서 작업 완료 후 § 4 에러 유형 표에 "1053 에러: v1.5.1에서 해결됨" 라인 추가)
- [`status/SYNC-AGENT-V1.5.0-DESIGN.md`](SYNC-AGENT-V1.5.0-DESIGN.md) — v1.5.0 설계 원문
- [`sync-agent/SyncAgent_설치매뉴얼_v1_5.docx`](../sync-agent/SyncAgent_설치매뉴얼_v1_5.docx) — 고객 배포 매뉴얼 (v1.5.1 반영 시 버전 번호만 갱신)

---

**끝. 세션 시작 시 § 1 → § 8 순서대로. 추측/우회/다른 옵션 탐색 금지.**
