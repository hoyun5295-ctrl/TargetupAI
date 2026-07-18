# 2026-07-18 프론트 번들 스플리팅 배포 사고 — 핸드오프 (다음 세션 SoT)

> 진입 호출어: **"한줄로 최적화 이어가자"** (memory/project_hanjul_optimization.md 경유)
> 상태: **서비스 정상(롤백 완료)** · 원인 확정 · 재발 방지 미구현 · 서버 git 작업트리 dirty(정리 필요)
> 관련: status/BUGS.md B-0718-1 · status/lessons/LESSONS_FRONTEND.md 사고 절 · memory/project_2026_0717_dashboard_performance.md(성능 트랙 전 이력)

## 1. 사고 개요

| 항목 | 내용 |
|------|------|
| 발생 | 2026-07-17 23:25 배포 → 2026-07-18 00:40경 Harold·고객 다수 인지 |
| 증상 | hanjul.ai 로그인 후 첫 화면(/dashboard 등)에서 "화면을 불러오지 못했습니다" 오류 카드 — 전 고객 대면 |
| 영향 | 프론트 화면 진입 불능(약 1시간 반). 발송·정산·데이터·백엔드는 전 시간 정상(무관 확정) |
| 복구 | 00:5x 프론트만 f8ac12f6로 원복(`git checkout f8ac12f6 -- packages/frontend` + build:safe) — 외부 실측으로 정상 서빙 확인 |

## 2. 근본 원인 (증거로 확정)

**난독화 stringArray × 동적 import의 상호작용 = 비결정(확률적) 빌드 결함.**

- vite.config의 기존 난독화 설정(6/15부터 운영) `stringArrayThreshold: 0.5` = 문자열 리터럴의 50%를 **무작위로** base64 배열로 치환.
- M1이 처음 도입한 라우트 동적 import(`import('./pages/Dashboard')`)의 **경로 문자열이 치환 대상에 걸리면** rollup이 해당 페이지를 정적 분석하지 못해 **청크를 아예 생성하지 않고**, 런타임에 원시 경로를 그대로 요청하게 됨.
- 50% 확률이 빌드마다 다르게 떨어지므로 **같은 코드가 빌드마다 다른 산출물**이 됨: 로컬 빌드=76청크(우연히 온전, Node 실행 검증까지 통과) / 서버 빌드=63청크(Dashboard 등 ~13페이지 청크 미생성).

### 증거 (전부 실측)
1. **nginx access log: `GET /assets/pages/Dashboard` 4회** — 해시 청크가 아닌 소스 경로 요청 = 번들에 없는 페이지를 런타임이 원시 경로로 요청한 직접 증거.
2. **dist-old(깨진 빌드 보존본)에 `Dashboard-*.js` 부재** — `ls dist-old/assets | grep -i dashboard` → JourneyStatsPage·PredictiveDashboardPage(이름 겹침)만 존재.
3. dist-old JS 63개(단일 시각 23:25:29 — 단일 빌드·내부 일관) vs 로컬 동일 커밋 빌드 76개.
4. nginx SPA fallback(`try_files ... /index.html`)이 없는 .js에 **200 + HTML**을 반환 → 브라우저 "Unexpected token '<'" → lazy-page 가드 새로고침 1회 → 재실패 → PageErrorBoundary 오류 카드. (이 fallback이 404를 가려 진단을 지연시킴)
5. 소거된 가설: 서비스워커 없음(소스 grep 0·라이브 프로브 HTML) / dist 부분 스왑 불가(safe-build 원자 mv 확인) / 청크 간 바인딩 손상 없음(로컬 76청크 전수 Node import 실행 — 실패는 전부 "document is not defined" = 브라우저 전용 코드의 정상 신호).

### 왜 사전 검증이 못 잡았나
- tsc 0·vitest·로컬 빌드 성공·로컬 청크 실행 검증까지 전부 통과 — 그러나 **빌드가 비결정이라 로컬 산출물이 서버 산출물을 대표하지 못함**. "빌드 성공 ≠ 배포 가능".
- **★0718 후속 실측(게이트 구현 중 발견 — 판정 정정)**: "온전"으로 봤던 로컬 76청크 빌드도 동적 import 38지점 중 **19지점이 `import(W(491))` 형태**(stringArray 조회 = 경로 암호화)로 남아 있었다. 즉 로컬 빌드 역시 라우트 상당수가 런타임에 원시 경로를 요청하는 불량이었고, 청크 수·Node 실행 검증으로는 못 잡는다(같은 페이지의 다른 literal import 지점 덕에 청크는 생성되므로). 산출물 게이트는 청크 실존(3-1)에 더해 **"비literal 동적 import 0건"(3-2)까지 검사**해야 한다 — 2026-07-18 safe-build.sh에 두 게이트 모두 구현.
- 연관 영향 검토 누락: 동적 import 도입 시 "기존 난독화 설정과의 상호작용"을 영향 지점 목록에 올리지 않음(impact_analysis_before_modification 위반).

## 3. 현재 서버 상태 (다음 세션이 이어받는 지점)

- 라이브 = f8ac12f6 프론트(단일 번들 5MB) + **HEAD(965a6618)의 백엔드 전부**(워밍·확정캐시 — 정상 동작, 사고 무관).
- `packages/frontend/dist-old` = 깨진 63청크 빌드 보존(증거물 — 정리 전 삭제 금지).
- **git 작업트리 dirty**: `git checkout f8ac12f6 -- packages/frontend`로 frontend 추적 파일들이 HEAD 대비 "수정됨" 상태 + 미추적 `src/lib/lazy-page.tsx` 잔존. **이 상태에서 서버 `git pull`을 하면 충돌** — 반드시 §4-1부터.

## 4. 다음 세션 작업 순서 (세부)

### 4-1. 서버 git 상태 정리 (최우선 — 다른 어떤 배포보다 먼저)
로컬에서 "frontend만 f8ac12f6로 되돌리는" revert 커밋을 만들어 서버와 정합:
```
# 로컬 PowerShell (targetup 루트)
git checkout f8ac12f6 -- packages/frontend
git rm --cached packages/frontend/src/lib/lazy-page.tsx   # 신규 파일 추적 제거(작업본은 유지됨 — 필요시 백업)
tp-push "M1 스플리팅 롤백 정합 — 프론트를 f8ac12f6로 원복(사고 B-0718-1)"
```
서버에서: `cd /home/administrator/targetup-app && git status` 확인 → 로컬 커밋과 동일 내용이므로 `git stash && git pull`(또는 `git checkout -- packages/frontend && git pull`) — **실행 전 git status 출력을 보고 판단**(dirty 내용이 revert 커밋과 동일해야 함). pull 후 frontend 재빌드 불필요(dist는 이미 롤백 상태).

### 4-2. 재발 방지 게이트 (스플리팅과 무관하게 먼저 구현·배포) — ★2026-07-18 구현 완료(Codex 5라운드 통과)
> 구현물: `safe-build.sh` 3-1(lazy 청크 실존 1:1 대조) + 3-2(번들 전체 "비literal 동적 import" 검출 — 청크가 있어도 다른 import 지점이 암호화된 경우까지 차단) + `scripts/verify-live-chunks.sh`(배포 직후 라이브 전수: 산출물 스캔 + src lazy 대상 + index.html 참조 + 전 JS content-type·HTTP 200, 전부 fail-closed). 하네스 실측 = 사고 재현·이름 겹침 미끼·계산식 오인·curl 중단·node 부재·CSS-only 배포물 전부 차단 확인.
`safe-build.sh`에 **산출물 기계 검증** 추가 — 나쁜 주사위 빌드는 스왑 자체가 거부되게:
- 검증식: `src`의 lazy 대상 목록(`grep -oE "import\('\./pages/[A-Za-z]+'\)" src/App.tsx`)과 `dist-new/assets/<이름>-*.js` 실존을 1:1 대조. 하나라도 없으면 exit 1(옛 dist 유지).
- 단일 번들 상태(현재)에서는 lazy 0건이라 게이트가 자동 통과 — 지금 넣어도 무해.
- 추가 게이트: 배포 직후 라이브 전수 curl(`index.html`의 엔트리에서 청크 지도 추출 → 각 URL content-type이 javascript인지) 스크립트 — 수동 1커맨드로 제공.

### 4-3. 난독화 상호작용 제거 (스플리팅 재시도의 전제)
- 방안: vite.config 난독화 플러그인에서 **동적 import를 보유한 파일(src/App.tsx·src/lib/lazy-page.tsx)을 exclude** — 라우트 경로명은 비밀이 아님(번들 파일명으로 어차피 노출). 플러그인의 include/exclude 실동작은 **문서가 아니라 로컬 빌드 반복 실측**으로 확인(비결정성 검증 = 같은 코드 3회 빌드 → 게이트 3회 통과 + 청크 수 동일).
- 대안(방안이 실측 실패 시): stringArray를 유지하되 임계 하향이 아니라 — 임계는 확률이라 해법이 아님 — 동적 import 구간만 별도 비난독 모듈로 분리.

### 4-4. M1 재시도 판단 (Harold 승인 게이트)
4-2·4-3 완료 + 로컬 3회 연속 빌드 게이트 통과 후에만 재시도 승인 요청. 재배포 시: 심야·주말 등 저트래픽 시간 + 배포 직후 4-2의 라이브 전수 curl + 주요 페이지 실측 + 즉시 롤백 절차(이번에 검증된 `git checkout <직전정상> -- packages/frontend` + build:safe) 대기 상태로.

### 4-5. 성능 트랙 잔여 (사고 정리 후)
- ⑦ 백엔드분(워밍·확정캐시) 실측: 이새 진입 2회 → SLOW 확인(라이브 중이므로 바로 가능).
- 화~수: pg_stat_statements·slow log 상위 20 목록 → 사이클 재개.
- M2(company-frontend)·M3(Dashboard 분해+API 병합)·롤업은 그 뒤.

## 5. 영구 교훈 (LESSONS_FRONTEND 등재본 요지)
1. **난독화(stringArray)와 동적 import는 공존 금지** — 경로 문자열이 확률적으로 암호화되면 청크 미생성 = 비결정 빌드.
2. **"빌드 성공 ≠ 배포 가능"** — 산출물 스스로를 기계 검증하는 게이트 없이는 구조 변경 배포 금지. 비결정 요소(난독화 랜덤 등)가 있는 빌드는 로컬 결과가 서버를 대표하지 못한다.
3. **고객 대면 화면 전체가 기간계다** — "발송·돈 무접촉"만으로 "기간계 영향 0"을 말할 수 없다.
4. **SPA fallback은 자산 404를 가린다** — `/assets/`는 fallback 제외(404 반환) 검토 가치(진단성 + 가드 정확 동작).
