# isae 원격 교체 runbook (내일 실행용 · 확정본)

대상: isae, company_id=682956b7-37a3-46b5-9868-b63011bda47b. 박스=Windows Server 2008 R2(win32 6.1.7601, IP 125.141.198.22). 서버=58.227.193.62(/home/administrator/targetup-app). 원격 담당=서수란 팀장.

핵심 원칙: 원격은 1~2분 안에 끝냅니다. 다만 "통째 한 방 복붙"은 금지합니다. 손상된 exe로 박스를 브릭하지 않도록 **진단(A) → 저의 판정(30초) → 교체(B) 2단계**로 나눠 붙입니다. (A) 결과 4가지를 저에게 주시면 즉시 판정해 (B)를 붙일지 알려드립니다. 원격을 다시 여는 것이 아니라, 이미 붙은 한 세션 안에서 A→B 순서로 진행하는 구조입니다.

> 근거: 이 runbook의 경로·작업명·로그 패턴·페이로드는 sync-agent/backend/frontend 소스와 status 문서에서 확정했고, 서버 SQL(테이블·컬럼·접속)은 2026-07-01 세션 실측 + SCHEMA.md/OPS.md로 재대조했습니다. 박스 로컬 절대경로(설치 폴더)만은 소스에 고정값이 없어 진단 블록 첫 명령으로 현장 확정합니다.

## 1) 목표 & 현재 상태

- 목표: 서팀장 원격 1회로 (1) 실패 로그·상태 확보 (2) 잔존 프로세스 정리 (3) 박스 temp에 이미 받아둔 1.5.7 exe로 교체 (4) 재시작 → 서버 heartbeat에 `agent_version=1.5.7`. 이후 Harold님이 슈퍼관리자 "매핑" 버튼으로 15개 custom 매핑 전송.
- 현재 상태: 박스가 20:05:14 last_heartbeat 이후 멈춤. 1.5.6 updater가 `temp\update.bat`으로 실행 중 exe 교체+재시작을 시도했으나 2008 R2 파일 잠금/재시작 결함으로 실패, 자력 복구 불가.
- 진실 소스: 보고되는 버전은 config.enc가 아니라 실행 exe(AGENT_VERSION) 기준. exe만 1.5.7로 바꾸면 서버에 `agent_version=1.5.7`로 보고됩니다.

주의(적대적 검증 반영 — 이 두 가지 때문에 통째 복붙을 금지함):
- `update.bat`은 copy 전에 현재 exe를 `sync-agent.exe → sync-agent.exe.old`로 rename합니다. 실패 지점이 rename 이후라면 현재 `sync-agent.exe`가 없거나 손상본이고, 진짜 1.5.6 원본은 `sync-agent.exe.old`에 있습니다. 그래서 진단(A) **[5]**에서 `.old` 존재 여부를 먼저 확인합니다.
- 진단(A) **[4]**의 체크섬이 불일치하면 교체(B)를 붙이면 안 됩니다(손상본으로 덮으면 프로세스는 이미 죽은 상태라 박스 브릭). 반드시 저의 판정을 거칩니다.

---

## 2) [Harold님 — 원격 붙기 전, 서버에서 미리 확인]

준비물: 체크섬 `178e37f471e7d9fafa09d06841b65f21411d9c6f0e54c5180c8de2ada2c73cef`, 슈퍼관리자 로그인.

**① win-legacy 1.5.7 릴리즈 단독 활성 재확인** — win-legacy 한 줄만, checksum·download_url 정상이어야 함:
```
docker exec targetup-postgres psql -U targetup targetup -c "SELECT id, version, tier, is_active, checksum, download_url FROM sync_releases WHERE is_active = true ORDER BY released_at DESC;"
```

**② isae 에이전트 생존/버전/heartbeat 재확인** — 여전히 20:05에서 멈춰 있는지:
```
docker exec targetup-postgres psql -U targetup targetup -c "SELECT agent_name, agent_version, status, os_info, last_heartbeat_at, last_sync_at, now()-last_heartbeat_at AS since FROM sync_agents WHERE agent_name='isae';"
```

**③ nginx에서 어제 /version·/download 마지막 요청 확인** (nginx는 호스트에 있음 — docker 아님):
```
grep -E "api/sync/(version|download)" /var/log/nginx/access.log | tail -30
```

---

## 3-A) [서팀장 — 진단 블록. Administrator 권한 cmd.exe에 통째 복붙. 파괴 명령 0, 읽기·조회만]

설치 폴더가 `C:\SyncAgent`, exe가 `sync-agent.exe`라는 전제입니다. 다르면 첫 두 줄(SET)만 실제 경로로 바꿉니다. 실제 경로는 이 블록 **[1]** `schtasks /Query /TN SyncAgent /XML`의 `<Command>`·`<WorkingDirectory>`로 그 자리에서 확인됩니다.

이 블록은 아무것도 정지·삭제·교체하지 않습니다. 여러 번 실행해도 안전합니다.

```bat
@echo off
SET DIR=C:\SyncAgent
SET EXE=%DIR%\sync-agent.exe

echo ===== [0] PowerShell version =====
powershell -command "$PSVersionTable.PSVersion"

echo ===== [1] schtasks Query (Command / WorkingDirectory 로 실제 경로 확정) =====
schtasks /Query /TN SyncAgent /XML

echo ===== [2] current process state (read-only) =====
tasklist /FI "IMAGENAME eq sync-agent.exe" /V

echo ===== [3] latest sync/error log - last 40 lines (파일 전문은 별도로 전달) =====
powershell -command "$d='%DIR%\logs'; if (Test-Path $d) { $f = Get-ChildItem (Join-Path $d 'sync-*.log') | Sort-Object LastWriteTime | Select-Object -Last 1; if ($f) { Write-Host ('--- ' + $f.FullName + ' ---'); Get-Content $f.FullName | Select-Object -Last 40 } else { Write-Host '(no sync-*.log)' } } else { Write-Host ('(no logs dir: ' + $d + ')') }"
powershell -command "$d='%DIR%\logs'; if (Test-Path $d) { $f = Get-ChildItem (Join-Path $d 'error-*.log') | Sort-Object LastWriteTime | Select-Object -Last 1; if ($f) { Write-Host ('--- ' + $f.FullName + ' ---'); Get-Content $f.FullName | Select-Object -Last 40 } }"

echo ===== [4] temp 1.5.7 checksum (expect 178e37f4...73cef) =====
if exist "%DIR%\temp\sync-agent-1.5.7.exe" (certutil -hashfile "%DIR%\temp\sync-agent-1.5.7.exe" SHA256) else (echo MISSING temp\sync-agent-1.5.7.exe)

echo ===== [5] file existence (rename 여부 = 롤백 원본 판정 핵심) =====
if exist "%EXE%" (echo FOUND sync-agent.exe) else (echo MISSING sync-agent.exe)
if exist "%DIR%\sync-agent.exe.old" (echo FOUND sync-agent.exe.old) else (echo none: sync-agent.exe.old)
if exist "%DIR%\temp\update.bat" (echo FOUND temp\update.bat) else (echo none: temp\update.bat)
if exist "%EXE%.1.5.6.bak" (echo FOUND sync-agent.exe.1.5.6.bak) else (echo none: 1.5.6.bak)

echo ===== [6] dir listing =====
dir "%DIR%"
dir "%DIR%\logs"
dir "%DIR%\temp"

echo ===== DIAG DONE =====
```

### 3-A-report) 진단 후 저에게 줄 것 — 4가지

1. **[3]** 최근 sync-log / error-log 마지막 40줄 (콘솔 화면은 한글이 cp949로 깨질 수 있으니, 가능하면 `logs\sync-*.log` 파일 자체를 그대로 전달 — winston JSON이라 UTF-8 원문이 정확)
2. **[4]** certutil 해시 한 줄
3. **[5]** 4개 파일 존재 여부 (sync-agent.exe / .old / temp\update.bat / 1.5.6.bak)
4. **[2]** tasklist 결과

이 4가지로 제가 (a) 체크섬 일치 (b) 롤백 원본이 무엇인지(.old vs 현재 exe) (c) 교체(B)를 붙여도 되는지를 30초 안에 판정합니다.

---

## 4) [판정표 — 제가 사용, 서팀장은 결과만 대기]

**체크섬([4]):**

| [4] 결과 | 판정 | 조치 |
|---|---|---|
| `178e37f4…73cef` 정확히 일치 | temp exe 정상 | 교체(B) 진행 |
| 다른 해시 | temp exe 손상 | 교체(B) 금지. temp의 exe 삭제 후 재수신·재검증 |
| MISSING | temp exe 없음 | 교체(B) 불가. 재다운로드 필요 |

**로그([3]) 마지막 라인(JSON message 필드 기준):**

| 마지막 로그 | 의미 |
|---|---|
| `다운로드 완료:` 까지만 | exe는 temp에 받힘, 체크섬 검증 전/중 멈춤 |
| `체크섬 검증 통과` | 검증 통과, bat 생성 직전 |
| `업데이트 스크립트 생성:` / `…재시작됩니다` / `Agent 종료 — v1.5.7…재시작 예정` | process.exit(0) 후 bat이 exe rename/copy 또는 schtasks 재시작에 실패(2008 R2 결함 지점) — 수동 교체가 정확히 필요한 케이스 |
| `체크섬 검증 실패 — 업데이트 취소` | 다운로드 파일 손상 — 교체 금지, 재다운로드 |
| `업데이트 실패:` (다운로드 쓰기/스트림) | 다운로드 자체 실패 — temp에 온전한 exe 없음 |

**롤백 원본([5]):**

| sync-agent.exe | sync-agent.exe.old | 롤백 원본 | 교체 블록 백업 처리 |
|---|---|---|---|
| 있음 | 없음 | 현재 exe(1.5.6) | %EXE% → .1.5.6.bak |
| 있음 | 있음 | sync-agent.exe.old(진짜 1.5.6) 우선 | .old를 .1.5.6.bak로 |
| 없음 | 있음 | sync-agent.exe.old(진짜 1.5.6) | .old를 .1.5.6.bak로 |
| 없음 | 없음 | 없음 | **교체 중단·보고** (롤백 원본 전무) |

---

## 3-B) [서팀장 — 교체 블록. 제가 "체크섬 일치·교체 진행" 확인 뒤에만 붙임]

진단 [4] 체크섬이 `178e37f4…73cef`와 일치할 때만 실행합니다. 블록 자체에도 `findstr` 게이트가 있어, 만에 하나 손상본이면 copy·재시작을 스스로 건너뛰고 `CHECKSUM MISMATCH - ABORT`를 출력합니다(브릭 방지).

```bat
@echo off
SET DIR=C:\SyncAgent
SET EXE=%DIR%\sync-agent.exe
SET NEW=%DIR%\temp\sync-agent-1.5.7.exe
SET SUM=178e37f471e7d9fafa09d06841b65f21411d9c6f0e54c5180c8de2ada2c73cef

echo ===== [B0] checksum gate =====
if not exist "%NEW%" ( echo MISSING new exe - ABORT & goto :END )
certutil -hashfile "%NEW%" SHA256 | findstr /i "%SUM%" >nul
if errorlevel 1 ( echo CHECKSUM MISMATCH - ABORT & goto :END )
echo checksum OK

echo ===== [B1] stop task =====
schtasks /End /TN SyncAgent >nul 2>&1

echo ===== [B2] kill leftover process =====
taskkill /F /IM sync-agent.exe >nul 2>&1
timeout /t 3 /nobreak >nul

echo ===== [B3] preserve 1.5.6 rollback source =====
if exist "%EXE%.1.5.6.bak" (
  echo backup already exists - skip
) else (
  if exist "%DIR%\sync-agent.exe.old" (
    copy /y "%DIR%\sync-agent.exe.old" "%EXE%.1.5.6.bak"
    echo rollback source = sync-agent.exe.old
  ) else (
    if exist "%EXE%" (
      copy /y "%EXE%" "%EXE%.1.5.6.bak"
      echo rollback source = current sync-agent.exe
    ) else (
      echo WARNING - no rollback source found ^(no .old, no current exe^)
    )
  )
)

echo ===== [B4] replace with 1.5.7 =====
copy /y "%NEW%" "%EXE%"
if errorlevel 1 ( echo COPY FAILED ^(file lock?^) - rerun B1/B2 then retry - ABORT & goto :END )

echo ===== [B5] verify replaced exe hash =====
certutil -hashfile "%EXE%" SHA256 | findstr /i "%SUM%" >nul
if errorlevel 1 ( echo REPLACED EXE HASH MISMATCH - ABORT & goto :END )
echo replaced exe = 1.5.7 OK

echo ===== [B6] restart task =====
schtasks /Run /TN SyncAgent

echo ===== [B7] wait then verify process =====
timeout /t 10 /nobreak >nul
tasklist /FI "IMAGENAME eq sync-agent.exe" /V

:END
echo ===== REPLACE BLOCK DONE =====
```

### 3-B-report) 교체 후 저에게 줄 것

- **[B4]~[B5]** copy·해시 결과(교체된 exe가 1.5.7 해시와 일치하는지)
- **[B7]** tasklist (sync-agent.exe가 `NT AUTHORITY\SYSTEM` 세션 0으로 떠야 정상)
- 중간에 `ABORT`/`FAILED`/`MISMATCH`가 찍혔으면 그 줄 그대로

> 버전 확정은 로컬에서 `exe --version`을 직접 돌리지 않습니다(미지원 시 2차 인스턴스 기동 위험). 재시작 후 **서버 heartbeat의 `agent_version=1.5.7`**(6절)로 확인합니다.

---

## 5) [교체 성공 후 — Harold님, 슈퍼관리자 "매핑" 입력]

박스가 1.5.7로 살아난 뒤에만 유효합니다(매핑 명령은 큐에 쌓였다가 박스의 다음 config 조회 때 실행 — 박스가 죽어 있으면 적용 안 됨).

"매핑" 편집에서 고객 매핑 각 행에 **소스컬럼 / 타겟슬롯 / 라벨**을 입력합니다. 슬롯·라벨은 핸드오프(§4-D-2)에 확정돼 있고, 이 DB는 한국어 컬럼명을 쓰므로 **소스 컬럼 = 라벨 문자열**이 원칙입니다. 철자만 원격 중 `sync-agent.exe --show-config`로 재확인하세요(등록일자/신규등록일자, 마일리지 계열처럼 유사 컬럼 혼동 방지).

| 슬롯 | 라벨(=소스 컬럼) | 비고 |
|---|---|---|
| custom_1 | 등록일자 | |
| custom_2 | 마일리지사용액 | |
| custom_3 | 고객번호 | 현재도 값 존재(유지) |
| custom_4 | 마일리지발생액 | |
| custom_5 | 신규등록일자 | **현재 매장코드(SP12/SF43) 오적재 → 신규등록일자로 교정** |
| custom_6 | 신규마일리지 | |
| custom_7 | 추가마일리지 | |
| custom_8 | 소멸마일리지 | |
| custom_9 | 인증여부 | 현재도 값 존재 |
| custom_10 | 인증매장 | |
| custom_11 | CI | 민감계열 — 고객사 판단 여지 |
| custom_12 | 카카오인증매장 | |
| custom_13 | 고객상태 | 현재도 값 존재 |
| custom_14 | 최종접속일자 | |
| custom_15 | 이관이력 | |

매핑 제외(custom 미포함): 비고·주민등록번호·최종수정일자·나이대·인증일시·최초인증일시.

저장 후 흐름: "매핑" 저장 → 백엔드가 `POST /api/admin/sync/agents/:agentId/command`로 `{ type:"update_config", mapping }`를 `sync_agents.config.commands[]`에 큐잉 → 박스 다음 heartbeat/config 조회(최대 60분) 때 수령 → 런타임 매핑 교체 + config.enc 영구 저장 + 필드정의(라벨) 재등록 + **바뀐 타겟(customers)만 full_sync** → custom 정상 적재.

---

## 6) [최종 검증 — 서버]

**① 버전·생존:**
```
docker exec targetup-postgres psql -U targetup targetup -c "SELECT agent_name, agent_version, status, last_heartbeat_at, last_sync_at, now()-last_heartbeat_at AS since FROM sync_agents WHERE agent_name='isae';"
```
`agent_version=1.5.7` + `last_heartbeat_at`이 방금이면 교체·재시작 성공.

**② nginx 재기동 직후 /version 다시 들어오는지:**
```
grep -E "api/sync/(version|download)" /var/log/nginx/access.log | tail -20
```
`current_version=1.5.7`로 요청이 찍히면 교체 확정.

**③ 매핑 full_sync 완료 뒤 custom 정상 적재** — custom_5 매장코드형 잔존 0, 다른 슬롯 채워짐:
```
docker exec targetup-postgres psql -U targetup targetup -c "SELECT COUNT(*) AS 전체, COUNT(*) FILTER (WHERE custom_fields->>'custom_5' ~ '^S[PF][0-9]') AS custom5_매장코드형, COUNT(*) FILTER (WHERE custom_fields IS NOT NULL AND custom_fields <> '{}') AS custom_채워짐 FROM customers WHERE company_id='682956b7-37a3-46b5-9868-b63011bda47b';"
```

**④ 필드정의 15개·라벨 재생성 확인:**
```
docker exec targetup-postgres psql -U targetup targetup -c "SELECT field_key, field_label FROM customer_field_definitions WHERE company_id='682956b7-37a3-46b5-9868-b63011bda47b' ORDER BY field_key;"
```

---

## 7) [실패 시 fallback]

**재시작이 계속 실패** → 예약작업 커맨드라인 직접 확인:
```bat
schtasks /Query /TN SyncAgent /XML
```
`<Command>`(exe 절대경로)·`<Arguments>`(예: --service)·`<WorkingDirectory>`가 3)에서 쓴 경로와 일치하는지 확인. 다르면 실제 경로로 SET을 바꿔 3-B 재시도. 예약작업 자체가 없으면(sc 서비스로 설치된 케이스) `sc query SyncAgent`로 교차 확인.

**롤백(1.5.7이 정상 기동 못 하면 1.5.6으로):** 원본은 3-B [B3]에서 보존한 `.1.5.6.bak`:
```bat
schtasks /End /TN SyncAgent >nul 2>&1
taskkill /F /IM sync-agent.exe >nul 2>&1
timeout /t 3 /nobreak >nul
if exist "C:\SyncAgent\sync-agent.exe.1.5.6.bak" (
  copy /y "C:\SyncAgent\sync-agent.exe.1.5.6.bak" "C:\SyncAgent\sync-agent.exe"
) else (
  if exist "C:\SyncAgent\sync-agent.exe.old" copy /y "C:\SyncAgent\sync-agent.exe.old" "C:\SyncAgent\sync-agent.exe"
)
schtasks /Run /TN SyncAgent
```

---

## 부록 A) 원격 전 이미 확정된 사실(소스·문서 근거)

- 다운로드 파일 = `{설치폴더}\temp\sync-agent-1.5.7.exe` / 실행 exe = `{설치폴더}\sync-agent.exe` (updater가 process.execPath 기준으로 처리).
- 재시작 방식 = 작업 스케줄러(2026-06-18 서비스 sc→예약작업 교체, 1053 에러 해소). 작업명 `SyncAgent`, 실행 계정 SYSTEM, action = `<exe> --service`.
- updater가 `temp\update.bat` 생성 → 자신을 `process.exit(0)` → bat이 exe rename/copy + schtasks 재기동. 이 bat 단계가 2008 R2에서 실패한 것으로 추정(로그로 확정).
- 로그 = `{cwd}\logs\sync-YYYY-MM-DD.log`(winston JSON, 로컬 타임존). cwd는 작업 스케줄러 기동 위치에 종속 → 실제 위치는 진단 [1] WorkingDirectory로 확인.
- 매핑 페이로드 = `{ type:"update_config", mapping:{ customers, purchases, customFieldLabels } }`. 라벨은 필드정의 재등록 경로로 반영, 런타임 매핑값에는 customers/purchases만.
- 서버 릴리즈 테이블 = `sync_releases`(win-legacy 1.5.7 단독 활성). sync_agents 컬럼 = agent_version·last_heartbeat_at·os_info·status. psql = `docker exec targetup-postgres psql -U targetup targetup`. nginx access log = 호스트 `/var/log/nginx/access.log`.

## 부록 B) Harold님께 확인받을 항목(원격 전/중)

원격 첫 명령이 대부분 자동 확정하지만, 미리 알면 더 빠릅니다.
1. 박스 설치 폴더 = `C:\SyncAgent` **(2026-07-01 Harold 확정)**. 진단 블록 첫 두 줄 수정 없이 그대로 실행. (참고: 진단 [1] `<WorkingDirectory>`/`<Command>`로 로그·exe 실제 경로 교차 확인은 가능)
2. 박스 PowerShell 버전 — 2008 R2 순정이면 2.0. 진단 [0]으로 확인(이 runbook은 PS2.0 전제).
3. 15개 custom 소스 컬럼 철자 — 원격 중 `sync-agent.exe --show-config`로 재확인(라벨=컬럼명 원칙).
4. 예약작업 `SyncAgent`가 실제 등록돼 있는지(vs sc 서비스) — 진단 [1] + 필요 시 `sc query SyncAgent`.
