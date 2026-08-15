# 비토 게이트웨이 — 설치·전환·업데이트 축 (GW-AGENT-DEPLOY)

> 허브 = [FEATURE-BITO-GATEWAY.md](../FEATURE-BITO-GATEWAY.md) (§9 등재). **막던 결함 6종·전환 절차·전환 이력은 허브 §4·§5·§6이 소유한다 — 여기 복사하지 않는다.**
> 이 문서는 그 아래 계층(설치기·bootstrap·릴리즈·원격 업데이트·canary)의 구조와 축 고유 결함을 소유한다. 최초 작성 = 2026-08-15 점검.

## 1. 정체성

고객사 서버의 Agent를 설치·전환(legacy→bootstrap 관리형)·원격 업데이트하는 층. 우리 결함 6종(허브 §4)이 전부 이 축에서 나왔다. 규모가 가장 크다(installer 4,003 + bootstrap 3,169 + update 2,600 + canary 4,581 + release 1,532 LOC).

## 2. 구조 (소스 실독)

**설치·전환** (`installer/`·`installerruntime/`·`installerconfig/`)
- `Migrator.Migrate()` = 저널 기반 단계 상태 기계: Begin → FilesInstalled → SupervisorInstalled → CredentialEnrolled → ServiceSwitched → HealthPassed → Committed. 각 단계 전이가 저널에 영속
- `Recover()`는 저널 phase별로 롤백·재개를 구분(무작동이 아니라 phase 기반 — 단 **Committed/RolledBack이면 아무것도 안 하고, journal이 남아 있으면 `Migrate()`가 거부**(migrate.go:31) → 허브 §8-7 "재시도 불가 구조"의 실체)
- 설치 실패 롤백은 실측 2회 검증됨(허브 §4-1)

**릴리즈 무결성** (`release/`)
- 서명(ed25519)·trust policy·canonical 아카이브 검증. **`hostile_archive_test.go` 존재** — 적대적 아카이브(경로 탈출·심링크 등) 방어를 테스트로 보증. 이 축에서 가장 성숙한 부분
- `payload_profile`(`agent-child-v1`)은 manifest·`release/types.go`에만 있고 **DB `agent_release`에는 능력 컬럼이 없다**(허브 §4-2와 연결)

**원격 업데이트** (`update/`·`bootstrap/`)
- child↔bootstrap IPC = Linux unix socket(**peer credential 검사**) / Windows named pipe. 프레임 고정
- 단계: PrepareHandoff → handoff 커밋 → activation intent → **probation**(신뢰 관찰 기간) → activation 커밋. 취소·불명(`MarkHandoffUnknown`) 경로 분리
- bootstrap `Supervisor.Recover()`는 pending command의 intent·fence·plan을 대조해 불일치면 **blocked**(임의 재개 금지)

**단계적 배포** (`canary/`·`canaryrollback/`·web/api rollout)
- canary → pilot → general 스테이지, 스테이지 승인 게이트, 적격성 14종 판정(관리 플레인 축 문서 §3-7·허브 §6 CANARY_LANE_MISSING 가림 참조)
- smoke 증거 구조(`evidence.go`): 발송 1건의 Received·ReportDelivered·CustomerResultCode·ReportAcked·JournalCleared 전부 참이어야 verdict 통과 — **허브 §5의 "실측 1건 후 확정"과 같은 사상이 코드에 있다**

## 3. 확정 사실·위험 (축 고유분 — 허브 §4 결함 6종 제외)

| # | 내용 | 위치 |
|---|---|---|
| 1 | 재시도 불가의 정확한 경계 — journal 존재 = Migrate 거부, Committed/RolledBack journal은 Recover도 무작동. 인스턴스 정리 도구는 owner 키트(gen1 하드코딩)뿐 | `installer/migrate.go:31`·`recovery.go:22` |
| 2 | 에이전트가 enrollment 실패 응답 본문을 버림(`enrollment HTTP %d`만) — 서버 로그 부재(관리 플레인 축)와 겹쳐 양쪽 다 침묵이었음. 서버 쪽은 0815 로그 추가로 절반 해소 | `control/enroller.go:240` |
| 3 | `internal/agent/control/update_client.go:48` — 저장소 유일한 `panic(err)` | 동 파일 |
| 4 | 패키지 `upgrade.sh`는 `/opt/vito-agent` 레이아웃 전제 — 우리 설치(`/opt/bito-agent*`)에 그대로 못 씀 | 허브 §8-5와 연결 |
| 5 | cmd/agent-bootstrap Windows DACL 테스트 3건 로컬 실패 — 환경 요인 유력, 코드 결함 여부 미검증 | 허브 §7-1 |

## 4. 테스트 증거 (2026-08-15 로컬)

installer·installerconfig·installerruntime·bootstrap·update·release·canary·canaryrollback·cmd/agent-installer·cmd/agent-release·cmd/agent-canary 전부 PASS(hostile archive 테스트 포함). 예외 = cmd/agent-bootstrap 3건(§3-5).

## 5. 착수 원장 (허브 §8과 중복 항목은 허브가 원장)

1. [ ] 실패 인스턴스 안전 정리 서브커맨드(§3-1) — owner 키트 의존 제거. "고객사 설치 1회 실패 = 사람 투입" 구조 해소. 허브 §8-7과 동일 항목
2. [ ] enroller 응답 본문 로그(§3-2) — 1줄. 서버 쪽 0815 조치와 짝
3. [ ] update_client panic 제거(§3-3)
4. [ ] bootstrap 버전 격차·원격 업그레이드 실측 = 허브 §8-5·6이 원장
