# 세션 복구 기록 — 한줄로-0701 이새(isae) 원격 릴리즈 교체

> 보관된 세션 대화록(JSONL, 843줄)을 읽기 좋게 복원한 문서입니다.
> thinking·도구호출 원문은 제외하고, 실제 작업·결정·수정·명령어·파일의 요지만 시간순으로 보존했습니다.

## 메타

| 항목 | 값 |
|------|-----|
| 세션명 | 한줄로-0701 이새 원격 릴리즈 교체 |
| 원본 | `8216cfdb-2886-4c63-b5af-fa32f52fc3cc.jsonl` (843줄, 3.1MB) |
| 시각 | 2026-07-01 07:38 ~ 12:06 (UTC) / 16:38 ~ 21:06 (KST) |
| 대상 회사 | isae, `company_id=682956b7-37a3-46b5-9868-b63011bda47b` |
| 박스 IP | 125.141.198.22 (isae Oracle 호스트, `os_info=win32 6.1.7601` = Windows 7/2008 R2) |
| 서버 | 58.227.193.62 (포트 22, administrator) / `/home/administrator/targetup-app` |
| 참여자 | Harold(대표), 서팀장(원격 담당 직원), 비토(AI) — 저쪽 원격 담당자는 외주(비협조적) |

## 한 줄 요약

isae 싱크에이전트의 custom 15개 필드 매핑이 안 맞던 문제를, "다시는 원격 안 여는" 근본 구조(슈퍼관리자 원격 매핑 관리 + 자동 업데이트 파이프라인)로 전환. 서버 측(감지·티어·103MB 다운로드)은 실측으로 완벽 작동을 확인했으나, 박스 안 exe 교체·재시작 단계에서 1.5.6 updater 결함으로 실패해 박스가 20:05에 멈춤. 최종적으로 서팀장 원격 1회(한 줄 복붙)로 교체 대기하며 세션 종료.

---

## 배경과 목표

- **문제:** isae 고객 custom_5에 매장코드(SP12·SF43 등)가 들어가고 나머지 대부분 null. 계획한 15개 필드(고객상태·고객번호·등록일자·마일리지사용액·마일리지발생액·신규등록일자·신규마일리지·추가마일리지·소멸마일리지·인증여부·인증매장·CI·카카오인증매장·최종접속일자·이관이력)가 슬롯에 안 실림.
- **당일 실패 원인:** 에이전트를 멈추지 않고 서버에서 데이터를 지워, 다음 동기화 주기와 racing이 반복됨.
- **Harold 강한 요구:** 원격을 이미 7번 열게 만든 상황(외주 원격 담당자가 비협조적이라 매번 부담). "한 번에 제대로", 그리고 앞으로 원격 없이 슈퍼관리자에서 매핑·버전을 관리하는 근본 기능으로 만들 것.

시작 지시 순서(Harold): ① 에이전트 정지 → ② `--show-config`로 매핑 확인 → ③ 틀렸으면 `--setup-cli` 재설정 → ④ 서버 전체삭제(purchases→consents→unsubscribes→custom…) → 재동기화.

---

## 시간순 진행

### 1. 초기 진단 (07:38~07:53)

- 핸드오프 문서 `status/SYNC-AGENT-ISAE-2026-06-30-HANDOFF.md`와 `status/lessons/LESSONS_DB.md` 정독. `status/SCHEMA.md`로 컬럼 실재 확인(customers: `company_id`·`phone`·`custom_fields`·`updated_at` / purchases: `customer_phone`·`purchase_date`).
- 서버 상태: **고객 0 / 구매 1,103,233** — 구매 full sync가 도는 중.
- **Harold 방침 확정:** 구매가 다 들어올 때까지 기다린다 → 완료 후 전체 삭제 → 재동기화. (AI가 앞서 "완료 기다릴 필요 없다"고 한 판단을 철회하고 방침을 문서 상단에 기록.)
- 구매 완료 확정: `sync_logs`에서 마지막 배치 2864건(4000 미만=마지막 청크), 8분+ 무로그 → **1,103,233건 / 마지막 로그 07:36:15 고정**.
- 삭제 SQL 컬럼 검증. `customer_stores`만 SCHEMA.md에 문서화가 없어 `information_schema.columns`로 직접 확인 → `company_id` 존재 확인(삭제 키 유효).

### 2. 전체삭제 + 재동기화 (07:53~08:04)

- 전체삭제: `BEGIN; … COMMIT;` 트랜잭션으로 7개 테이블(purchases·consents·unsubscribes·customer_field_definitions·customer_stores·customers + companies.customer_schema 초기화)을 isae `company_id` 필터로만 삭제. (다른 회사 0 영향)
- 잔존 0 검증: 고객·구매·필드정의·매장 전부 0, 스키마 `{}` 확인 → field_definitions·schema까지 비운 **첫 완전 초기화**.
- 재동기화 순서 안내: 슈퍼관리자에서 "동기화 재개"(일시정지 해제) → "전체 동기화"(full 재적재). `Agent 재시작`은 full 보장 안 되니 사용 금지. 명령은 다음 heartbeat(최대 60분)에 실행.
- **fan-out 아님 확정(미결 과제 해소):** 원본 고객구매이력 225만 vs JOIN 뷰(고객구매이력_연동) 185만 → 뷰가 원본보다 적음 = 배수 뻥튀기 아님. 40만 차이는 `고객번호` INNER JOIN에서 탈퇴·삭제 고객번호가 빠진 것. **목표치: 고객 ≈ 137,351 / 구매 ≈ 1,858,898.**
- custom 판정(재동기화 후 raw 확인): custom_5에 여전히 매장코드(SF43·SF40·SF37), custom_1·2·4·6·7·8·10·11·12·14·15 = 전부 null. custom_3(고객번호)·9·13만 값 있음.
- **결론: 잔존이 아니라 config 매핑 문제(원인 ①).** 값 매핑은 박스 `config.enc`에만 있어 서버 조작으로는 못 고침.

### 3. 원격 0 방안 탐색 (08:05~08:21)

- 서버에서 `field_label`만 고쳐도 소용없음 확정: CT-07 `upsertCustomFieldDefinitions`(ON CONFLICT DO UPDATE)가 다음 동기화 때 config 라벨로 되돌리고, 값 없는 슬롯이라 라벨만 붙여도 빈 필드.
- `sync_agents.config` jsonb 확인 → `{"commands": []}` (명령 큐만, 매핑은 서버에 없음).
- **소스 조사(Harold 승인 후):**
  - `sync-agent/src/types/api.ts`: `update_config` 명령 유형 + `RemoteConfig.mapping` 필드가 **타입에는 존재**(122·111행).
  - `scheduler/index.ts`의 `processCommands`(241행)는 `full_sync·restart·pause·resume`만 처리, `update_config`는 **미구현**.
  - `applyRemoteConfig`는 동기화 주기만 반영, `RemoteConfig.mapping` 무시.
  - `config/index.ts`의 `updateConfigEncrypted`(로컬 config.enc 갱신·재암호화) 함수는 **이미 존재, 호출만 안 됨**.
  - `updater/index.ts`(191행): 자동 업데이트 경로 + Windows 2008 R2용 schtasks 기반 exe 교체 구현되어 있음.
  - 서버 `admin-sync.ts`: `/command` 허용 목록(348행)에 `update_config` 없음. `PUT /config`(274·308행)는 이미 `column_mapping`을 받아 config에 저장하나, **에이전트가 그걸 읽어 로컬 매핑을 갱신하는 배선이 끊겨 있음**.
- **원격 0 설계 성립:** ① 에이전트 `update_config` 핸들러 구현 ② 서버 명령 허용 ③ 슈퍼관리자 매핑 UI ④ 새 exe를 자동 업데이트로 무선 교체.

### 4. TDD 구현 (08:21~08:44)

`superpowers:test-driven-development` 스킬로 진행.

- **A. 에이전트(sync-agent)**
  - `sync/engine.ts` — `SyncEngine.updateMapping()`/`getMapping()` 추가. RED(`updateMapping is not a function`) → GREEN. `processBatch`가 `this.config.customerMapping`을 참조하므로 필드 교체 시 다음 배치부터 새 매핑 적용.
  - `scheduler/index.ts` — `update_config` 핸들러 추가. 매핑을 engine에 반영 + config.enc 영구 저장(콜백 주입) + **바뀐 타겟만 full_sync**(customers 매핑만 바뀌면 구매 185만 재적재 낭비 방지). RED→GREEN.
  - `types/api.ts` — `UpdateConfigPayload` 타입. 서버는 `params`, 에이전트는 `payload` 필드로 달라 → `payload`로 통일하고 둘 다 수용(하위호환).
  - `index.ts` — 부트스트랩 배선(config.enc 영구 저장 + 라벨 필드정의 재등록).
  - 검증: `npx tsc --noEmit` 0 errors + `vitest run` **30/30 통과**(engine.updateMapping 2 + scheduler update_config 3 + 기존 25).
  - 테스트 파일: `engine.updateMapping.test.ts`, `scheduler/update-config.test.ts`.
- **B. 서버(backend)**
  - `routes/admin-sync.ts` — `/command`에 `update_config` 허용 + mapping payload 필수검증·전달. heartbeat는 명령을 통째로 내려보내는 기존 경로(`sync.ts:468`) 재사용. 백엔드 단위테스트 인프라가 없어 tsc로 검증(admin-sync 에러 0).
- **C. 프론트(frontend)**
  - `pages/AdminDashboard.tsx` — 매핑 편집 모달(상태·핸들러·목록 "매핑" 버튼·편집 모달). 기존 흰색 gradient 헤더 모달 패턴 + `showAlert`/`showConfirm` 커스텀 사용. 자가 grep: native dialog·모델명 노출 0. tsc 에러 0.
- **D. 버전**
  - `sync-agent/package.json` — `1.5.6` → `1.5.7`(자동 업데이트 트리거용).
- `superpowers:verification-before-completion` → 버전 상향 후 fresh 재검증(tsc OK + 30/30).

**구현 흐름:** 슈퍼관리자 "매핑" 버튼 → 소스컬럼→슬롯+라벨 입력 → 저장 → `update_config`가 `sync_agents.config.commands`에 적재 → 에이전트 heartbeat(≤60분) pull → 런타임 매핑 교체 + config.enc 영구 저장 + 라벨 재등록 + 바뀐 타겟만 full_sync → custom 정상 적재.

### 5. 자동 업데이트 서빙 구현 — 진짜 원인 발견 (09:22~09:50)

- Harold: tp-push 완료. exe 빌드 완료(`sync-agent/release/`).
- 조사: `sync_releases`는 `GET /version` 조회만 있고 **exe 서빙·릴리즈 등록 라우트가 backend에 없음** → 그대로는 무선 배포 불가.
- 초반 오판(A#255): "티어 오배포로 막힌다 → 1.5.7 첫 배포는 박스 1회 직접 교체 불가피"로 판단. Harold "원격 안 한다며" 반발 → 재검토.
- **진짜 원인 발견(A#264, 코드 대조):**
  - 서버 `sync.ts:1280`: `res.json({ success, latest_version, update_available, download_url … })` — `data` 래핑 없이 최상위, **snake_case**.
  - 에이전트 `client.ts:237`: `return data.data ?? null` — `data.data`를 기대하고 필드는 `latestVersion`/`updateAvailable`/`downloadUrl` **camelCase**(`types/api.ts:147`).
  - → checkVersion이 항상 null → heartbeat이 매번 "새 버전 없음" 판단. **자동 업데이트가 한 번도 작동한 적 없음.** 이건 **서버만 고치면 됨(박스 무관).**
- **실증(nginx access.log):** 박스(125.141.198.22)가 **매시간 정각 `GET /api/sync/version` 호출**(axios, 200, 104바이트) — 자동 업데이트 로직은 살아서 돌고 있음. 104바이트는 `sync_releases`가 비어 "업데이트 없음"이고 응답이 snake_case라 파싱 실패한 상태.
- **`sync.ts` 수정:**
  - `/version` 응답을 `{ success, data: { latestVersion, currentVersion, updateAvailable, forceUpdate, downloadUrl, checksum, releaseNotes } }` camelCase 구조로 정합.
  - `/download/:version` 서빙 라우트 추가(경로 traversal 방어, `router.use(ipRateLimit, syncAuth, companyRateLimit)` 전역 인증 자동 적용, 헤더 `x-sync-apikey/secret`).
  - 소비처 전수 grep: `/sync/version`은 `sync.ts` 하나뿐 → 웹 영향 0.
- `sync_releases` 컬럼을 `information_schema`로 실측(version 필수 + download_url·checksum·force_update·is_active) 후 릴리즈 등록 라우트(`admin-sync.ts` POST) 추가.
- 프론트: `AdminDashboard.tsx` Sync Agent 모니터링 헤더에 **"버전 배포" 버튼 + 모달**(버전·체크섬·강제 업데이트). tsc 에러 0.

### 6. exe 업로드 (09:52~10:23)

- `.gitignore`에 `release/`·`*.exe` 명시 → exe는 git에 안 들어감. `git pull`로는 코드만 오고 exe는 별도 업로드 필요.
- 서버 `~/targetup-app/packages/backend/agent-releases/` 폴더는 배포 때 자동 생성됨(18:51) → 본체 배포는 정상 반영.
- 서버 주소는 `status/OPS.md`에서 확인: **58.227.193.62**(포트 22).
- 로컬 파일 실제 확인: 이미 `sync-agent-1.5.7.exe`(103MB, 102972602바이트)로 존재(win-legacy 이름이 아님).
- 업로드 명령(로컬 PowerShell):
  ```
  scp "C:\Users\ceo\projects\targetup\sync-agent\release\sync-agent-1.5.7.exe" administrator@58.227.193.62:~/targetup-app/packages/backend/agent-releases/sync-agent-1.5.7.exe
  ```
- 업로드 성공(102972602 일치). 체크섬:
  `178e37f471e7d9fafa09d06841b65f21411d9c6f0e54c5180c8de2ada2c73cef`

### 7. 티어 안전장치 (10:25~10:36)

- Harold 질문: 1회성이냐 계속이냐 / 다른 티어 업체 오배포 우려.
- 답: **영구 인프라**(앞으로 빌드→scp→"버전 배포" 버튼 3단계 반복이면 모든 박스가 매시간 자동 교체). 단 릴리즈가 전역 단일이라, 다른 OS 티어 업체가 낮은 버전으로 설치하면 win-legacy exe를 잘못 받을 위험 → 티어별 분리 필요.
- **구현:**
  - `packages/backend/src/utils/agent-build-tiers.ts`(CT) — `os_info → 티어` 판별 함수 추가(인라인 금지, 순수 문자열 파싱). 기존 buildTier 5종(win-legacy/mid/modern, linux-legacy/modern) 정의처.
  - `sync_releases`에 `tier varchar(30)` 컬럼 ALTER(`ADD COLUMN IF NOT EXISTS`). db_column_verify + db_alter_safety_net(`column does not exist` 분기) 준수.
  - `GET /version`: `agent_id → os_info(UPDATE … RETURNING) → 티어 판별` 후 `tier 일치 or tier=NULL(전역)`만 매칭(**fail-closed** — 판별 불가 시 제외).
  - 릴리즈 등록에 tier 저장 + 프론트 UI 티어 드롭다운. 티어별 독립 활성 관리.
  - 검증: backend·frontend tsc 에러 0, sync-agent 30/30(변경 없음).

### 8. 릴리즈 정리 (10:42~10:45)

- `sync_releases`에 1.5.7이 두 개 활성:
  - `07448922-376f-4d19-9411-467a44668873` tier **win-legacy** ← 유지(isae용)
  - `5d558734-bbcb-40e3-bcb3-b81453cce5e8` tier **NULL(전역)** ← 제거 대상(모든 티어가 받아버림)
- 정리 SQL(삭제 대신 비활성 — 이력 보존):
  ```sql
  UPDATE sync_releases SET is_active = false WHERE tier IS NULL AND is_active = true;
  ```
  롤백: `UPDATE sync_releases SET is_active = true WHERE id = '5d558734-…';`
- 결과: **win-legacy 1.5.7 하나만 활성**, checksum `178e37f4…73cef` 일치, download_url `/api/sync/download/1.5.7` 정상.

### 9. 자동 업데이트 실측 — 다운로드 성공, 교체 실패 (10:47~12:06)

- Harold 가능성 평가 요청 → 솔직 평가: 감지 95% / 파싱 수정 90% / 릴리즈 확정 / **nginx 103MB 다운로드 55%(최대 리스크)** / 교체 80% / 매핑 85%. "첫 정각 한 방에 다 되는 건 반반보다 조금 높은 정도, 결국(로그 보고 조정 포함) 되는 건 높게 봄."
- **20:00 정각 로그(실측):**
  - `/version` → **208바이트**(104에서 커짐 = 재배포 반영 + 티어 매칭 성공 + 1.5.7 감지)
  - `/download/1.5.7` → **200, 102972602**(103MB 전부 다운로드 — nginx 타임아웃 걱정 무의미)
  - → **감지·티어·다운로드 3단계 전부 통과.**
- 그러나 이후에도 `current_version=1.5.6` 유지 → **교체(exe 바꾸고 재시작) 단계에서 멈춤.**
- `os_info = win32 6.1.7601` 확인 → win-legacy 판별 정확(티어 문제 아님).
- `sync_agents` 조회: `last_heartbeat_at = 20:05:14`에서 고정, 21:00 정각에도 미도착, `last_sync_at = 20:05:03`.
- **판정: 박스가 죽음.** 다운로드까지 완료했으나 1.5.6 updater의 exe 교체·재시작 로직 결함(2008 R2 실행 중 파일 교체 / schtasks 재시작 실패)으로 프로세스가 내려간 뒤 재기동 실패. `status=active`는 DB에 남은 옛 플래그.
- **원격 0 시도(실패):** 1.5.7 exe는 이미 박스 `temp`에 받아져 있으니, 슈퍼관리자 "Agent 재시작" 명령으로 교체 재시도 유도 → 그래도 안 올라옴.
- **슈퍼관리자가 "정상"으로 보이는 이유:** 온라인 판정 기준이 "마지막 heartbeat 70분 이내면 정상"(60분 주기 + 여유). 20:05에서 57분밖에 안 지나 아직 "정상" 표시(착시). 21:15쯤 "지연" → 이후 "오프라인"으로 전환 예정.

---

## 세션 종료 시점 상태

**완료(서버 측):**
- 원격 0 매핑 관리(에이전트 `update_config` 핸들러 + 서버 명령 허용 + 슈퍼관리자 매핑 UI) — 코드 완료·배포·검증(tsc 0 + 30/30 테스트).
- 자동 업데이트 응답 정합(camelCase `data.data`) + `/download` 서빙 + 릴리즈 등록 UI — 배포 반영 확인(20:00 로그).
- 티어 안전장치(os_info 판별 + fail-closed 매칭 + tier 컬럼) — 배포·검증 완료.
- exe 서버 업로드(103MB) + win-legacy 릴리즈 단독 활성 정리 완료.
- **실측으로 감지·티어·다운로드 3단계 정상 작동 입증.**

**미완(박스 측):**
- 박스 1.5.6 updater의 exe 교체·재시작 결함 → 박스 20:05 멈춤(죽음). 자력 복구 불가.
- **다음 액션:** 서팀장 원격 1회로 한 줄 복붙 실행 — 남은 프로세스 정리 → 이미 받아둔 `temp\sync-agent-1.5.7.exe`로 교체 → 재시작. 실행 후 화면 로그 40줄 + 교체 완료 여부 확인.
  ```
  powershell -NoProfile -Command "Get-Content 'C:\SyncAgent\logs\sync-2026-07-01.log' -Tail 40; schtasks /End /TN SyncAgent; Stop-Process -Name sync-agent -Force; (temp의 1.5.7로 교체); (재시작)"
  ```
- 교체 성공(`current_version=1.5.7`) 후 → 슈퍼관리자 "매핑" 버튼으로 15개 custom 매핑 전송(`update_config`) → 다음 heartbeat에 custom 정상 적재 → 마무리.
- **후속 개선 과제:** 1.5.6 updater의 교체·재시작 결함을 박스 로그로 원인 확정해 근본 수정(다음 버전부터 완전 자동화).

---

## 이 세션에서 다룬 파일

**sync-agent (에이전트, 새 exe 1.5.7):**
- `src/sync/engine.ts` — `updateMapping()`/`getMapping()` 추가
- `src/scheduler/index.ts` — `update_config` 핸들러(런타임 반영 + config.enc 저장 + 바뀐 타겟만 full_sync)
- `src/types/api.ts` — `UpdateConfigPayload`(payload/params 수용)
- `src/index.ts` — 부트스트랩 배선(config.enc 영구 저장 + 라벨 재등록)
- `src/sync/engine.updateMapping.test.ts`, `src/scheduler/update-config.test.ts` — 신규 테스트
- `package.json` — 1.5.6 → 1.5.7

**backend (서버):**
- `src/routes/sync.ts` — `/version` 응답 camelCase 정합 + `/download` 서빙 + 티어 매칭 필터
- `src/routes/admin-sync.ts` — `/command`에 `update_config` 허용 + 릴리즈 등록 라우트 + tier 저장
- `src/utils/agent-build-tiers.ts`(CT) — `os_info → 티어` 판별 함수

**frontend (슈퍼관리자):**
- `src/pages/AdminDashboard.tsx` — 매핑 편집 모달 + "버전 배포" 모달 + 티어 드롭다운

**문서:**
- `status/SYNC-AGENT-ISAE-2026-06-30-HANDOFF.md` — Harold 확정 방침 + fan-out 해결 기록

## 커밋(세션 중 tp-push)

- `싱크에이전트 원격 매핑 관리(update_config) + 자동업데이트 응답정합/서빙/릴리즈등록 — 박스 원격 0`
- `싱크에이전트 자동업데이트 티어 안전장치 — os_info로 티어 판별해 자기 티어 exe만 배포(오배포 차단)`

## 주요 진단·검증 명령어

```sql
-- 고객·구매 건수
SELECT (SELECT COUNT(*) FROM customers WHERE company_id='682956b7-…') AS 고객,
       (SELECT COUNT(*) FROM purchases WHERE company_id='682956b7-…') AS 구매;

-- 컬럼 실측(정답 확정 전 필수)
SELECT column_name FROM information_schema.columns WHERE table_name='sync_releases';

-- 릴리즈 상태
SELECT id, version, tier, is_active, checksum, download_url FROM sync_releases WHERE is_active = true;

-- 에이전트 생존 판정
SELECT agent_version, status, last_heartbeat_at, last_sync_at FROM sync_agents WHERE agent_name='isae';
```

```bash
# 박스가 자동 업데이트를 실제로 호출/수령하는지 실증(서버)
grep -E "api/sync/(version|download)" /var/log/nginx/access.log | tail -20
```

---

## 교훈(이 세션이 남긴 것)

- **snake_case vs camelCase / `data.data` 래핑 불일치**가 "자동 업데이트가 한 번도 작동 안 함"의 진짜 원인. 초기 "티어 오배포" 가설은 오판이었고, **코드 양쪽을 직접 대조**하고 **nginx 로그로 실제 호출을 실증**한 뒤에야 확정됨.
- 서버 릴리즈 파이프라인이 완벽해도, **박스 안 exe 교체·재시작**은 서버 손이 안 닿는 마지막 단계 — 1.5.6 updater 결함이 걸리면 결국 박스 1회 접근이 필요.
- 슈퍼관리자 "정상" 표시는 heartbeat 70분 유예 기준이라, 실제 생존은 `last_heartbeat_at` SQL로만 확정해야 함(화면 착시 주의).
