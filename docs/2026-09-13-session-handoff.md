# 0912~0913 세션 인계: MDM·대행발송 접수 4건 · 싱크에이전트 보안 · 비토 에이전트 점검 (2026-09-13 작성)

> 이 문서는 **다음 세션이 이어받는 순서와 명령**만 담는다. 사실·경위의 소유 문서는 아래 링크가 가진다(여기 복사하지 않는다).
> 착수 첫 명령은 **현재 상태 확인**이다. 이 문서의 "상태"는 작성 시점 값이므로 믿지 말고 §2-0 명령으로 다시 확인한다.
> 명령마다 **실행 위치**를 적었다. `.62`·`.65` 호스트명이 둘 다 `invito`라 프롬프트 계정으로 구분한다.

## 0. 먼저 읽을 것 (이 순서)

1. 이 문서 전체
2. [FEATURE-SYNC-AGENT.md](FEATURE-SYNC-AGENT.md) **§2 불변 마지막 두 행**(시크릿은 해시만 · 마스킹은 최종 출력으로 검사) · §6 · **§10**
3. [BUGS.md](../status/BUGS.md) **B-0912-3·4**(MDM) · **B-0912-5·6**(대행발송): 각 항목 끝의 "실측" 줄
4. [FEATURE-AGENCY-SEND.md](FEATURE-AGENCY-SEND.md) **§2 불변 24·25** · §4 "명단 크기" 행
5. Codex를 돌릴 때: [CODEX-RUNBOOK.md](../status/CODEX-RUNBOOK.md) §1·§2 (의무)
6. 게이트웨이 작업일 때만: [FEATURE-GW-SECURITY.md](bito-gateway/FEATURE-GW-SECURITY.md) **§8**

## 1. 이 세션에서 끝난 것 (작성 시점 · 근거 = 세션 중 실측 출력)

| 항목 | 커밋 | 상태 | 소유 문서 |
|---|---|---|---|
| MDM 문자 제목을 DM 제목과 분리 | `b3ef3c31` | 푸시 · 백엔드 배포 확인 · **프론트 빌드 반영 미확인** · 운영 실측 대기 | BUGS B-0912-3 |
| MDM 타겟 추출에 조건 직접 선택 탭 | `b3ef3c31` | 같음 | BUGS B-0912-4 |
| 대행발송: 회신번호가 달라도 접수 하나 | `54feb18d` | 푸시 · 백엔드 배포 확인 · DDL `agency_send_recipients.callback varchar(20)` 실행완료 · 실측 대기 | BUGS B-0912-5 · 불변 24 |
| 대행발송: 행수 상한 전량 제거 · 크기 50MB | `54feb18d` | 푸시 · 백엔드 배포 확인 · 실측 대기 | BUGS B-0912-6 · 불변 25 |
| 싱크에이전트: 시크릿 해시 저장 · 로그 마스킹 정정 | `650bca7c` | **배포 0912 23:55 KST**(pm2 `created at 14:55:02Z`) · DDL `companies.api_secret_hash varchar(64)` 실행완료 · **이새 인증 운영 실측 3단 통과**(원문 폴백 HTTP 200 → `해시전환 t` → 해시 비교 HTTP 200) | FEATURE-SYNC-AGENT §2 · SCHEMA `companies` |
| 싱크에이전트: 42703 판정 보강 | **미커밋** | 로컬에만 있다. `packages/backend/src/routes/sync.ts` 수정 · `utils/db-column-probe.ts` 삭제 · tsc 0 · 백엔드 테스트 274파일 4,276건 통과(0913 마무리 시 재실행) | §2-2 |
| 비토 에이전트 역분석·서명 공급망 점검 | **미커밋** | 설계 §8 신설(이 저장소) · 게이트웨이 저장소 `status/STATUS.md` `0-G` 행 · 코드 변경 0 | FEATURE-GW-SECURITY §8 |

**"백엔드 배포 확인"의 근거**: 운영에서 `650bca7c`의 새 인증 코드가 이새 해시를 실제로 채웠다. 세 커밋은 일렬이라 앞선 두 커밋의 백엔드도 같은 배포에 들어 있다. **프론트 빌드 반영은 이 근거로 판정할 수 없다**(§2-5에서 화면으로 확인).

## 2. 다음 세션 할 일 (순서대로 · 각 단계 착수 전 Harold님 승인)

### 2-0. 현재 상태 확인 (착수 첫 명령)

**로컬 · 한줄로 저장소**
```bash
git status --short
```
`routes/sync.ts`(M) · `db-column-probe.ts`(D) · `docs/bito-gateway/FEATURE-GW-SECURITY.md`(M)가 보이면 0913 마무리 push가 아직 안 된 것이다. 없고 `git log`에 올라가 있으면 §2-2의 커밋 단계는 건너뛴다.

**한줄로 운영 서버 · `administrator@invito` · `~/targetup-app`**
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "SELECT c.name, s.agent_version, s.updated_at, NOW() - s.updated_at AS 경과, (c.api_secret_hash IS NOT NULL) AS 해시전환 FROM sync_agents s JOIN companies c ON c.id = s.company_id ORDER BY s.updated_at DESC;"
```
판정: 이새 `경과`가 1시간 이내면 동기화가 돌아온 것. 작성 시점 값 = 이새 `해시전환 t` · 아난티 `f`(9/2 이후 미접속 · 설치 재시도 회신 대기).

### 2-1. 이새 동기화 정지 판정

**작성 시점 사실(0912 밤 실측 · 시각은 `sync_agents.updated_at` 기준)**
- 이새 에이전트(1.5.7) 마지막 통신 = 0912 23:30 KST. 그 뒤 30분·1시간 주기 배치가 오지 않았다.
- 서버는 원인이 아니다: 실제 키로 `/api/sync/version`을 두 번 호출해 둘 다 HTTP 200(원문 폴백 1회 · 해시 비교 1회).
- 배포(23:55)는 에이전트 요청 사이라 끊긴 요청이 없었다. 시점 인과는 약하다.

**할 일**
- §2-0에서 `경과`가 계속 늘어 있으면 **고객사 서버에서 에이전트 재시작**이 필요하다(고객사 연락 경로는 Harold님).
- 1.5.7은 원격 업데이트를 못 받는 구버전이다. 교체는 1.7.1 신규 설치(FEATURE-SYNC-AGENT §6 이새 줄).
- ⛔ **롤백은 해결책이 아니다.** 인증 통과가 운영에서 실측됐다.

### 2-2. 42703 판정 보강 커밋·배포

**무엇**: 운영 중인 초기 버전은 `information_schema`로 컬럼 존재를 미리 조회해 갈래를 고른다. 그 조회가 한 번 실패하면 5분간 "컬럼 없음"이 캐시되어 옛 쿼리(`api_secret` 원문 매칭)로 내려간다. **원문을 지운 뒤라면 그 5분 동안 전 에이전트가 401이 된다.** 보강본은 실제 SELECT가 `42703`으로 떨어질 때만 옛 경로를 탄다.

**커밋(로컬 · §2-0에서 미커밋일 때만)**
```bash
tp-push "0913 싱크에이전트 인증 - 컬럼 존재 사전 탐지 제거, 42703로만 옛 경로 판정(탐지 실패가 전면 401이 되던 구멍 차단)"
```
배포 절차는 [OPS.md](../status/OPS.md) §2-2 기준(빌드 = atomic safe-build).

**배포 후 실측 · 한줄로 운영 서버 · `administrator@invito`** (키가 화면에 찍히지 않게 파이프로 넘긴다)
```bash
docker exec -i targetup-postgres psql -U targetup targetup -tAc "SELECT api_key || ' ' || api_secret FROM companies WHERE name = '이새에프앤씨'" | { read K S; curl -s -o /dev/null -w "HTTP %{http_code}\n" -H "X-Sync-ApiKey: $K" -H "X-Sync-Secret: $S" "https://hanjul.ai/api/sync/version?current_version=1.5.7"; }
```
기대 = `HTTP 200`(이새는 이미 해시가 있어 해시 비교 경로를 탄다).

### 2-3. Codex 적대검토 (이 세션 미이행)

규칙(`codex_review_after_code_change`)상 대상인데 돌리지 않았다.

| 축 | 커밋 | 대상 이유 |
|---|---|---|
| 대행발송 적재 전환 + 회신번호 1건 접수 + 발송 직전 등록 재검증 | `54feb18d` | 발송 직전 경로 · DDL |
| 싱크에이전트 인증 해시 전환 + 42703 보강 | `650bca7c` + §2-2 | 보안 · DDL |

착수 전 CODEX-RUNBOOK §1·§2 정독. 1라운드 = 변경분 전체, 2라운드부터 증분. 종료 = critical·high 0 · 최대 2라운드.

### 2-4. 원문 시크릿 제거 (조건부)

**선행 조건 전부 충족 시에만**: §2-2 배포 · §2-3 critical/high 0 · 설치된 에이전트 `해시전환 t`.
- ⛔ **이 단계부터는 이전 커밋 롤백으로 인증이 복구되지 않는다.**
- ⛔ memory 규칙 **운영 PG 직접 UPDATE 금지**: 제거 방식은 착수 때 설계해 승인받는다(SQL 한 줄로 바로 하지 않는다).
- 미사용 키 82개는 원문을 지우면 재발급해야 쓸 수 있다. 발급·재발급 화면은 이미 "발급 시 1회 노출"로 바뀌어 있다.

### 2-5. 운영 실측 (접수자 확인분 · Harold님)

| 버그 | 실측 | 기대 |
|---|---|---|
| B-0912-3 | MDM 발송에서 제목을 DM 제목과 다르게 고쳐 1건 · 안 고친 1건 | 수신함 제목 = 고친 문장 · 안 고친 건은 DM 제목(폴백) |
| B-0912-4 | 타겟 추출 → 조건 직접 선택 → 조건 1개 | 인원 자동 표시 · 진행 후 발송 대상 수 일치 · 이메일·인앱에는 탭 없음 |
| B-0912-5 | 회신번호 열이 있는 파일로 요청서 접수 | 목록 1건 · 담당자 테스트 문자·승인 요청 1회 · 발송 결과에서 수신자별 발신번호 |
| B-0912-6 | 3만 초과(예: 5만) 명단을 **이메일**로 접수 | 반려 없음 · 인원 = 파일 · 50MB 근처 메일이 메일 서버를 통과하는지 |
| 프론트 빌드 | Ctrl+F5 후 화면 3곳 | MDM 문안 위 "문자 제목" 칸 · 타겟 추출 "조건 직접 선택" 탭 · 원스텝 확인 화면 "회신번호 N종 · 접수는 1건입니다" |

### 2-6. 비토 게이트웨이 §8 (별도 게이트웨이 세션)

순서 = **A1 복구 루트 개인키 오프라인 분리**(운영 · root · 코드 0) → A4·A5·A6 주석을 1.0.28 릴리즈에 합류 → A2 Windows 코드 서명(인증서 조달 · 서명 뒤 해시) → A3 설치 묶음 해시 공개.
게이트웨이 저장소 규칙(`CODEX.md`)을 따른다: DESIGN+PLAN 문서 쌍 금지 · 배포는 `scripts/gw` 경유 · 커밋은 대표님 지시 시에만.

### 2-7. 이월 (이 세션에서 손대지 않음 · 상태 미확인)

- 0912: 한빛주택종합관리 발신프로필 [사용 중지] → 재등록 → 감사 로그 실측
- 0912 미결: `HREJ`가 담당자 알림 선택 조건에 없음([alimtalk-jobs.ts:245](../packages/backend/src/utils/alimtalk-jobs.ts)) · 과거 HREJ 건수 확인 선행
- [0911 인계](2026-09-11-session-handoff.md) §2: 이모지 브랜드 1건 실측 → P3-4 → P3-2 → P3-3
- 아난티 설치 재시도 회신 대기(FEATURE-SYNC-AGENT §10)

## 3. Harold님 판단 대기

- **하이웍스 메일 첨부 상한**: 코드는 50MB 가정(`agency-send-mail-worker.ts` `MAX_ATTACH_TOTAL` · `routes/agency-send.ts` `ONE_STEP_FILE_LIMIT`). 확인값이 더 낮으면 낮은 쪽으로 맞춘다.
- 원문 시크릿 제거 방식과 미사용 키 82개 처리(§2-4).
- 비토 §8 A1 착수 여부 · A2 인증서 종류(OV/EV).

## 4. 하지 말 것

- 원문 시크릿 제거를 §2-4 선행 조건 전에 하지 않는다.
- 대행발송 접수를 회신번호로 쪼개지 않는다(불변 24).
- 대행발송 행수 상한을 되살리지 않는다. exceljs 스트리밍 파서로 바꾸지 않는다(실측: 100만 행 RSS 310MB 대 1,574MB · 불변 25).
- 싱크 인증 전환기 갈래를 `information_schema` 사전 조회로 고르지 않는다(§2-2).
- 비토: `init-authority` 운영 중 재실행 금지 · Garble 금지(0717 결정 · Defender PUA) · 코드 서명은 해시 산출 전에.
- 서버 명령에 키·비밀번호가 출력되게 하지 않는다(대조는 파이프로 넘긴다).

## 5. 다음 세션 진입

**한줄로 세션** (작업 디렉터리 `C:\Users\ceo\projects\targetup`)
```text
0913 인계 이어가자. docs/2026-09-13-session-handoff.md 먼저 정독하고 §2-0 현재 상태 확인부터 시작해
```

**비토 게이트웨이 세션** (작업 디렉터리 `C:\Users\ceo\projects\bito-gateway`)
```text
게이트웨이 보안 §8 이어가자. 한줄로 저장소 docs/bito-gateway/FEATURE-GW-SECURITY.md §8 정독하고 A1 복구 키 분리 착수 전 현재 상태 확인부터
```
