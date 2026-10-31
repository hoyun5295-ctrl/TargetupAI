# 싱크에이전트 Node 보안판 · 설치 마법사 이 PC 전용 (설계 · 2026-10-29)

> 접수 = Harold 1029 「한국모바일인증 공지(PHP · Node 취약점) 체크」 → 「설계안 써 줘(마법사 127.0.0.1 · Node 판 올림 · 엠티 1.7.3 전달 전 반영)」.
> 상태 = 1029 Harold 동의 → 구현 · 시험 · 빌드 · 엠티 1.7.4 묶음 · Codex 적대 3R approve · 커밋 35966174 · 서버 등록 0(원장 C80-G1) · 기록 = §8 · STATUS C80.
> ★1029 오후 VM 재검증에서 표준 날짜 칸 하루 당김 발견 → **1.7.5**(§9 · 원장 C81 · ec8b59d4) · 1.7.4 는 보내지 않는다.

## 0. 축 대조표

| 접수 항목 | 이 축이 없으면 닫히나 | 축 |
|---|---|---|
| A. 웹 설치 마법사가 9876 을 모든 네트워크에 열고 인증이 없다 | 안 닫힘 — 같은 망에서 설정 저장(`/api/setup/save`) · DB 접속 시험까지 된다 | 2-1 |
| B. 마법사가 Brotli 압축 본문을 푼다(CVE-2026-111497 입력 자리) | 안 닫힘 — Node 판을 못 올리는 구형 티어에 남는다 | 2-2 |
| C. 실린 Node 20.20.0 = 지원 끝(2026-04-30) · 보안판 없음 | 안 닫힘 | 2-3 |
| D. 엠티 전달본(1.7.3 · 미전달)에 반영 | 안 닫힘 — 고친 소스가 고객 PC 에 안 간다 | 2-4 |
| E. KMC 모듈 · PHP · .62 서버 | 확인만 · 조치 0 | 1 |

빠진 축 0.

## 1. 현재 사실 (근거)

| 사실 | 근거 |
|---|---|
| KMC 연동 = KMC 발급 리눅스 실행 파일을 spawn 해 표준 입출력으로 주고받음 · PHP · Node 모듈 아님 | 코드 `packages/backend/src/utils/kmc-crypto.ts:71` (가) |
| 우리 서버에 PHP 없음(저장소 · 서버 원장) · PHP 파일 = 우커머스 플러그인(고객사 워드프레스에서 돎) | grep (가) |
| .62 실행 중 Node = 24.22.1(공지 해결 판) | Harold 출력 `node -v` · `pm2 describe` (나) |
| 1.7.3 exe 에 실린 Node = 20.20.0 · Brotli 1.1.0 | exe 안 `nodejs.org/download/release/v20.20.0` · 빌드 캐시 실행 파일 `process.versions` (가) |
| 구형 티어 Node = 16.16.0 · 12.22.11 · Brotli 1.0.9 | 빌드 캐시 실행 파일 (가) |
| 마법사 = `app.listen(9876)` 주소 없음 → 모든 네트워크 · 인증 없음 · 주소 7개 | `sync-agent/src/setup/server.ts:388` (가) |
| 마법사 본문 해석 = express 5.2.1 / body-parser 2.2.2 → `br` 를 `zlib.createBrotliDecompress` 로 품 | `node_modules/body-parser/lib/read.js:222` (가) |
| 웹 마법사가 뜨는 곳 = Windows 10/11 데스크톱 · Windows Server · 구형 · 리눅스는 CLI | `sync-agent/src/main.ts` `resolveSetupMode` (가) |
| 평소 운영 = `https://hanjul.ai`(도메인) 으로만 나감 · TLS 우회 3건은 IP 주소 접속 조건 | `config/schema.ts:19` · Node 공지 (가) |
| CVE-2026-111497 = 공격자 Brotli 를 `node:zlib` 로 풀 때 · 지원 끝 판은 「언제나 영향」 | nodejs.org 2026-10-21 보안 공지 |
| 설치된 pkg 6.12.0 / pkg-fetch 3.5.32 = Node 24.13.0 · 22.22.0 · 20.20.0 만(해결 판 없음) | `node_modules/@yao-pkg/pkg-fetch/patches/patches.json` (가) |
| pkg 6.24.0 · pkg-fetch 3.6.7(2026-10-23 공개) = v24.22.1 · v22.23.4 · v26.12.1 · release v3.6 에 win-x64 · linux-x64 실행 파일 | npm 게시 시각 · GitHub patches.json · 릴리스 자산 목록 |
| Node 24 · 20 OS 바닥 같음 = Windows 10/Server 2016 · glibc 2.28 · kernel 4.18 | nodejs BUILDING.md v24.x · v20.x 대조 |
| 지원 끝 = 20 2026-04-30 · 22 2027-04-30 · 24 2028-04-30 | nodejs/Release schedule.json |
| oracledb 6.10.0 .node = Node 22.17.1 로 빌드된 것을 지금 Node 20 이 읽음(Node-API · 판 독립) | `oracledb-6.10.0-win32-x64.node-buildinfo.txt` (가) |
| 엠티 안내서에 9876 · localhost 언급 0 · 판 문자열만 | `build-guide-mt.js` grep (가) |

## 2. 설계

### 2-1 마법사 입구 = 이 PC 의 브라우저만 (A)

- `app.listen(PORT, '127.0.0.1', …)` · 브라우저 열기 · 콘솔 안내 · IE 안내 화면 주소를 `http://127.0.0.1:9876` 으로 맞춘다.
- Host 머리 허용 목록(`127.0.0.1:9876` · `localhost:9876`) — 그 밖은 403.
  - 넣는 이유: 127.0.0.1 로 묶어도 이 PC 브라우저가 연 악성 페이지가 DNS 재바인딩으로 같은 출처가 되어 들어오는 길이 남는다. Host 대조가 그 길을 닫는다.

### 2-2 압축 본문 거절 (B)

- `express.json({ inflate: false })` → 압축 본문 = 415(풀기 전에 거절).
- 마법사 화면(브라우저 fetch)은 압축 본문을 보내지 않는다 → 기능 영향 0.
- Node 판과 무관하게 이 입력 자리를 닫는다 → 판을 못 올리는 구형 티어(16 · 12)의 처방이 이것이다.

### 2-3 실리는 Node = 24.22.1 (C)

| 후보 | 지원 끝 | 비고 |
|---|---|---|
| **24.22.1 (추천)** | 2028-04-30 | .62 서버와 같은 판 · OS 바닥 20 과 같음 · exe 약 +47MB(빌드 캐시 24.13.0 = 89MB · 20.20.0 = 42MB) |
| 22.23.4 | 2027-04-30 | 1년 먼저 끝남 · 크기 미측정 |
| 20 유지 | 끝남 | 보안판 없음 · 불가 |

추천 = 24.22.1 — 지원이 1년 길고 서버와 같은 판이라 판 하나만 추적한다. 크기 증가는 zip 약 150MB → 약 200MB(미측정 · 빌드 뒤 실측).

바꾸는 곳:
- `@yao-pkg/pkg` 6.12.0 → 6.24.0(잠금 파일 · pkg-fetch 3.6.7).
- `scripts/build-tier.js` win-modern · linux-modern = `node24` · `node24-win-x64` · `node24-linux-x64`.
- `scripts/build-tiers.js` `TIER_NODE` modern 두 칸 24.
- `package.json` `build:exe` · `build:linux` · `build:all` 의 node20 표적 → node24(같은 뿌리 전수).
- `esbuild.config.js` 기본 target → node24.
- 빌드 manifest 에 실제 실린 판 `nodeVersion` 을 찍는다(exe 안 `nodejs.org/download/release/vX.Y.Z` 를 읽어 기록). 판정 자리 = 산출물.
- 외부 코드 관문: pkg 6.24.0 · pkg-fetch 3.6.7 을 설치하기 **전에** 네트워크 · 비밀값 · 설치 스크립트 grep 결과를 보고한다.

구형 티어(win-mid 16 · win-legacy 12 · linux-legacy 16)는 OS 바닥 때문에 Node 판을 못 올린다 → 2-1 · 2-2 로 입력 자리를 닫는 것이 그 티어의 처방.

### 2-4 엠티 전달본 = 1.7.4 (D)

| 후보 | 비고 |
|---|---|
| **1.7.4 로 올림 (추천)** | 1.7.3 zip sha256 이 FEATURE-SYNC-AGENT §7-2 · 원장에 적혀 있다 · 같은 번호에 다른 실행 파일 두 벌이 생기면 고객 PC 판 보고와 장애 대조가 틀린다 |
| 1.7.3 그대로 다시 빌드 | 문서 sha256 만 갈아 끼움 · 같은 번호 두 벌 |

- 안내서 = `VERSION` 1.7.4 · 본문 변화 0 · PDF 다시 · 렌더 검사.
- 서버 등록 0(C76-G1 과 같은 규칙 · 엠티 개별 전달 · 다른 회사 영향 0).
- 서버 룰표 `agent-build-tiers.ts`(modern `node: 20`)는 서버가 내주는 1.7.2 를 설명하므로 그대로 둔다. Node 24 판을 서버에 올리는 날 같은 배포에 24 로 바꾼다(R1 두 벌 방지).

### 2-5 전 회사 배포 (이번 축 밖 · 결정만)

- 다른 회사 설치본(1.7.2 · Node 20.20.0 / 16 / 12)은 설정이 끝나 마법사가 떠 있지 않다 → A · B 경로는 마법사를 다시 띄울 때만 열린다.
- 추천 = 엠티 VM 재검증 통과 뒤 1.7.4 를 서버 등록(sync_releases) · VERIFIED 스모크 절차로 전 회사에 올림 — 별도 단계 · Harold 결정.

## 3. 영향표

| 바꾸는 것 | 소비처 | 영향 |
|---|---|---|
| listen 주소 127.0.0.1 | 브라우저 자동 열기 · 콘솔 안내 · IE 안내 화면 · 안내서(언급 0) | 주소 글자만 127.0.0.1 로 · 사용자가 `localhost:9876` 을 쳐도 Chrome · Edge 가 127.0.0.1 로 넘어가는지 = 미검증 → VM 재검증 항목 |
| Host 허용 목록 | 마법사 화면 fetch(같은 출처 상대 경로 `/api/setup/…`) | Host = `127.0.0.1:9876` 또는 `localhost:9876` → 통과 |
| `inflate: false` | 마법사 주소 7개(전부 `express.json` 을 지남) | 화면은 압축 안 함 → 0 |
| Node 24 | 드라이버 4종(mssql 11 · mysql2 · pg · oracledb 6.10 thin/thick) · sql.js wasm · node-windows · winston · nodemailer 8 · xlsx · express 5 | oracledb .node = Node-API · 그 밖은 순수 JS · 실행 확인 = 시험 ④ ⑤ |
| pkg 6.24.0 | 빌드 스크립트만(런타임 아님) | 빌드 산출물 크기 · 실린 판 · manifest |
| 서버(백엔드) | — | 바뀜 0 |
| 다른 회사 | — | 0(서버 등록 없음) |

## 4. 뿌리

- A · B = 새 뿌리 **R28 「인증 없는 내부 입구가 망에 열림」**.
  - 판정 기준 = 인증 없이 쓰는 내부용 서버(`listen`)는 127.0.0.1 에 연다 · 그 입구는 압축 본문을 풀지 않는다.
  - 계약 시험 = 백엔드 · 싱크에이전트 소스의 `.listen(` 호출을 구문 트리로 뽑아 둘째 인자가 루프백 글자인지 본다.
  - 면제 = `packages/backend/src/app.ts`(공개 API · 인증 · nginx 뒤 · ufw 외부 차단 · 이유 줄 주석).
  - 전수 grep = 4곳 — `app.ts`(면제) · `outreach-render-worker.ts` ×2(이미 127.0.0.1) · `setup/server.ts`(고침).
- C = **R21 넓힘** — 점검표 「서버 Node 가 지원 중 LTS 인가」에 「고객 PC 에 실리는 싱크에이전트 modern 티어 Node 도」를 더한다. 기계 시험 없음(산출물 판정이라 오프라인 시험이 못 본다) → manifest `nodeVersion` 으로 사람이 본다.

## 5. 시험

1. 싱크에이전트 단위 시험(새 파일) — 마법사 앱을 127.0.0.1:0 에 띄워
   - Host 남의 이름 → 403 · Host `127.0.0.1:포트` → ping 200.
   - `Content-Encoding: br` 본문 → 415.
   - 시험을 위해 앱 만들기를 `startSetupWizard` 에서 떼어 내보낸다(`createSetupApp`) · 동작 변화 0.
2. 계약 시험 R28(`root-ledger.test.ts`) + 변이(host 인자를 빼면 실패).
3. 빌드 — pkg 6.24.0 로 win-modern 빌드 → exe 안 Node 판 = 24.22.1 · 캐시 실행 파일 Brotli 판 · manifest `nodeVersion`.
4. 실행 판 시험 — 받은 Node 24.22.1 실행 파일로 싱크에이전트 vitest 전체(되면) · 지금 Node 20 전체도.
5. VM 재검증(Harold 승인 단계 · 원래 예정)에 합침 — 엠티 VM 에서 1.7.4 로 Oracle 연결 · 동기화 · 서비스 등록 · 웹 마법사가 뜨는 OS 면 `netstat` 에 `127.0.0.1:9876` 만.
6. tsc 0 · 싱크에이전트 vitest 전체 · 백엔드 계약 시험 · Codex 적대 리뷰(approve 까지).

## 6. 하지 않는 것 (범위 밖 기록)

- .65 게이트웨이 관리 API(Node 18.19.1 · 원장 10-06) · .66 발송 콘솔(engines Node 20 고정) 의 Node 판 = 그 저장소 과제 · 실행 판 확인 명령은 따로.
- 백엔드 `app.ts` 를 127.0.0.1 로 묶기 = 공개 API · R28 면제 · 별도 판단.
- 싱크에이전트 axios 응답 압축 해제 끄기 = 상대가 우리 도메인(TLS 검증 정상)이라 넣지 않음.
- 전 회사 배포 = 2-5.

## 7. 구현 순서 (동의 뒤)

0. 외부 코드 관문 보고(pkg 6.24.0 · pkg-fetch 3.6.7).
1. 시험 먼저(5-1 · 5-2) → 빨강 확인.
2. `setup/server.ts` 고침 → 초록.
3. pkg 올림 · 티어 표 · manifest `nodeVersion`.
4. 1.7.4 빌드 · 5-3 · 5-4.
5. 안내서 1.7.4 · PDF · 렌더 검사.
6. Codex 적대 → approve.
7. Downloads 엠티 폴더 교체 · FEATURE-SYNC-AGENT §7 · 배포 원장 카드 · ROOT-LEDGER R28 · R21.

## 8. 구현 기록 (2026-10-29 · Harold 「싱크에이전트 메트로시티 것부터 제대로 마무리 · 코덱스 닫힐 때까지 · 서버 명령 빼고 전부」)

### 8-1 외부 코드 관문 (pkg 6.24.0 · pkg-fetch 3.6.7)

| 본 것 | 결과 |
|---|---|
| 설치 스크립트 | pkg · pkg-fetch = 0 · 새 의존성 중 esbuild 0.28.1 만 `node install.js`(esbuild 표준 바이너리 점검 · 지금 devDependency esbuild 0.24 와 같은 스크립트) · postject · @roberts_lando/vfs · undici · @babel/traverse · into-stream 9 · resolve.exports = 0 |
| 네트워크 | pkg-fetch = Node 실행 파일을 `github.com/yao-pkg/pkg-fetch/releases/download/` 에서 받고 내장 `EXPECTED_HASHES` 와 대조(지금과 같은 동작) · 소스 빌드 대체 길 = `nodejs.org/dist` · pkg `sea.js` = nodejs.org · unofficial-builds(SEA 모드 전용 · 우리는 안 씀) |
| 비밀값 · 환경변수 | 프록시(HTTP(S)_PROXY) · 빌드 플래그(CFLAGS 등) · PKG_* 만 · 토큰 · 키 · .env 읽기 0 |
| 새 꾸러미 @roberts_lando/vfs 0.3.3 | 관리자 = @yao-pkg/pkg 와 같은 roberts_lando · pkg 의 SEA 경로(sea-*.js)에서만 씀 · 네트워크 · 환경변수 · child_process 0 |
| 빌드 PC Node | pkg 6.24.0 engines `>=22` · 이 PC 기본 Node 20.19.4 → 공식 Node 24.22.1 압축본(nodejs.org · SHASUMS256 대조 일치)을 작업 폴더에 풀어 빌드에만 씀(시스템 설치 0) · `build-tier.js` 가 modern 빌드를 Node 22 미만에서 시작 전에 멈춘다 |

### 8-2 바뀐 곳

- `sync-agent/src/setup/server.ts` — `createSetupApp(port, onSaved)`(Host 대조 미들웨어 → `express.json({ inflate: false })` → 주소 7개 · 화면) · `startSetupWizard` 는 `app.listen(PORT, SETUP_HOST)` + 저장 뒤 닫기 · Agent 시작(동작 그대로) · 안내 주소 `http://127.0.0.1:9876`.
- `sync-agent/src/setup/server-guard.test.ts`(새) — Host 통과 2 · 403(남의 이름 · 다른 포트 · 이름 덧붙임 × 핑 · 화면 · 저장) · br · gzip · deflate 415 · 압축 안 한 JSON 통과.
- `packages/backend/src/utils/__tests__/root-ledger.test.ts` — R28 describe(`.listen(` 전수 · 같은 파일 const 이름도 풀어 읽음 · 면제 = backend/app.ts).
- `sync-agent/scripts/build-tier.js` — modern 두 티어 node24 · Node 22 미만 가드 · 주석. `scripts/build-tiers.js` — `TIER_NODE` modern 24 · `embeddedNodeVersion`(exe 안 `nodejs.org/download/release/vX.Y.Z`) → manifest `nodeVersion` · 못 읽음 · 메이저 어긋남 = blocker.
- `sync-agent/esbuild.config.js` 기본 target node24 · `package.json` 1.7.4 · `build:exe` · `build:linux` · `build:all` node24 · `@yao-pkg/pkg` ^6.24.0 · `package-lock.json`.
- `sync-agent/build-guide-mt.js` — `VERSION` 1.7.4 · 머리 주석.

### 8-3 시험 · 변이

- 빨강 먼저: 마법사 시험 4건 실패(createSetupApp 없음) · R28 실패(`sync-agent/setup/server.ts` 한 곳).
- 초록: 마법사 4/4 · R28 통과 · sync-agent tsc 0 · sync-agent vitest 33 파일 288 건(Node 20).
- 변이(파일 복사 · 되돌림 cmp 확인): M1 `inflate: false` 제거 → 415 시험 실패 · M2 Host 대조 제거 → 403 시험 실패 · M3 listen 주소 인자 제거 → R28 실패 · M4 `SETUP_HOST = '0.0.0.0'` → R28 실패.

- 빌드(win-modern · 빌드 PC = 받은 Node 24.22.1): manifest 4 꾸러미 `nodeVersion` 24.22.1 · blocker 0 · exe `--version` 1.7.4 · pkg 경고 = `node_modules/open/index.js` 바이트코드 실패(@azure/identity 대화형 브라우저 로그인의 `await import("open")` 에서만 · SQL 접속 경로 아님) · 동적 require `mod` · xdg-open(1.7.3 이전과 같은 부류).
- 싱크에이전트 vitest 33파일 288건 = Node 20.19.4 · Node 24.22.1 둘 다 통과 · 백엔드 tsc 0 · root-ledger 전체 통과.

### 8-5 엠티 전달 묶음 · Codex

- `Downloads\엠티콜렉션_SyncAgent_v1.7.4\` = `SyncAgent_v1.7.4_엠티콜렉션.zip`(oracle zip · 168,916,499B · sha256 `273f65706ef7c4490da64f26ee82f95e29bfc6a43d56275d1da9c1a1f471ab15`) · `SyncAgent_v1.7.4_설치안내서_엠티콜렉션.pdf`(11쪽 · 1.7.4 표기 16 · 1.7.3 0 · 가운뎃점 · 줄표 0 · 안내서 해시 = zip 해시). 1.7.3 폴더는 남겨 두되 보내지 않는다. 전달 = 1.7.4 로 VM 재검증(Harold 승인) 뒤.
- Codex 적대 1R(전체) = medium 1 — R28 주소 이름을 파일 전체 const 이름표로 찾아 같은 이름 매개변수가 가리는 경우를 루프백으로 오판 → 수용 · TypeScript 심벌(valueDeclaration 이 const 글자일 때만).
- 2R(증분) = medium 1 — 파일 고르기 글자 거름(`includes('.listen(')`)이 주석 낀 호출을 버림 → 수용. 1R 과 같은 부류(R28 이 서버 여는 곳을 놓침) 두 번째 = 뿌리는 판정을 글자 꼴에 맡긴 것 → 수집 · 판정을 구문 트리 판정 `isListenCall` 하나로(거름 `hasListenCall` 도 같은 판정 · `['listen']` 꼴 포함) · 변이 M5(실제 마법사 줄을 주석 낀 꼴 + 주소 없음) 실패 확인.
- 3R(증분) = approve — 남은 한계 = 구조 분해 `listen(...)` · `listen.call/apply` · bind 뒤 호출(이 저장소 사용 0 · 대장에 한계로 적음).

### 8-4 범위 밖 기록 (착수 안 함)

- 싱크에이전트 운영 의존성 `npm audit --omit=dev` = 16건(치명 1 proxy-addr · 높음 axios · body-parser · form-data · mysql2 · nodemailer · path-to-regexp · xlsx · zod · 보통 7) — 1.7.3 부터 그대로(이번에 운영 의존성 바뀜 0) · 백엔드 1026 보안판(C67)이 싱크에이전트를 덮지 않았다 · R21 점검표 「운영 의존성 audit 0」에 싱크에이전트가 빠져 있다.

## 9. 1.7.5 (2026-10-29 오후 · VM 재검증에서 나온 날짜 결함 · Harold 「진행해」)

### 9-1 VM 재검증(1.7.4 · win2016-ko-x64 + 11g 엠티 구성 · 테스트계정)

- 통과: 설치 경로(게시자 경고 → UAC → VC80 0 → 예약 작업 SYSTEM) · Node 24 + oracledb thick + IC 11.2 · 다른 스키마 뷰 · 키 지정 · 유일성 · AI 매핑 27/27 · 6/6 · P2 값 확인 정확한 건수 · config.enc · SYSTEM 작업 실행 · 듣는 포트 0 · 고객 198/200.
- 운영 PG(Harold 실행): 고객 198 · 수신동의 153/45 · purchase_count 합 4,223 · 누계 217,701,000 · 이름 · 성별 · 생일 · 매장 198.
- **결함 = 표준 날짜 칸 하루 당김**: 생일 · 최근구매일이 원본보다 하루 앞(Harold 실행 3행 · custom 날짜 칸은 맞음). 뿌리 = PG · Oracle 어댑터가 드라이버 로컬 Date 를 `toISOString()` 으로 넘김(KST 자정 → 전날 15:00Z) → `normalizeDate` 가 앞 10글자를 자름(R16). 0913 custom 경로 처방은 `'postgresql'` 과 비교해(어댑터 dbType = `'postgres'`) PG 에서 한 번도 돌지 않았다.
- 기록만: 국외 접근 통제 허용 목록에 없는 에이전트 IP = AI 매핑 403(ORIGIN_NOT_ALLOWED) 뒤 마법사가 말없이 로컬 매핑으로 내려감 · 로컬 매핑이 엠티 컬럼 다수를 못 잡음 · 판매 뷰 휴대폰 없음(P1) = 구매 0.

### 9-2 처방

- 날짜 되돌림 = **매핑(`mapRow`)에서 원본 컬럼 타입으로**. `ISO_DATE_CONNECTORS`(`db/types.ts` · postgres · oracle) 커넥터만 `getColumns` dataType `date` · `datetime` 컬럼 값을 `adapterIsoToWallClock` 으로 벽시계 글자로. 어댑터 값 · `source_row_key` · 커서는 그대로(어댑터에서 고치면 `engine.ts` 의 `source_row_key` 가 바뀌어 구매 중복 적재).
- 글자 모양 추측 삭제(`normalizeSyncCustomFieldValue` 는 Date · bigint 만 · TEXT 컬럼의 ISO 꼴 원문 불변).
- 컬럼 타입을 못 읽으면 = 실행 시작에서 `DATE_COLUMN_TYPE_UNKNOWN` 잠금(fail-closed · 1.7.4 값으로 내려가지 않음). 캐시 = 실행마다 새로(`runDateCols`) · 미리보기는 캐시 안 씀.
- 경보 = `SyncError.operational` 을 만드는 자리가 정한다(전송 실패 · 상태 저장 실패 잠금 · 날짜 타입 잠금) · `lockedResult` 는 `kind` 필수 · `logResult` 는 표시만 읽음(손 등재 코드 목록 삭제).
- 바뀐 곳: `normalize/index.ts` · `mapping/index.ts` · `sync/engine.ts` · `db/types.ts` · `types/sync.ts` · `normalize/connector-date.test.ts`(새) · `normalize/custom-fields.test.ts` · `package.json` · `package-lock.json` 1.7.5 · `build-guide-mt.js` `VERSION` 1.7.5.

### 9-3 시험 · Codex · 빌드

- 빨강 먼저(날짜 · 죽은 갈래 · 잠금 · 경보) → 초록. sync-agent tsc 0 · vitest 34파일 305건 = Node 20.19.4 · 24.22.1 둘 다. 변이 14(파일 복사) 전부 잡힘. 계약 = toISOString 을 쓰는 어댑터 집합 = `ISO_DATE_CONNECTORS`.
- Codex 적대 1R medium 1(PG 원본 ISO 글자까지 날짜로 오인 → 글자 추측 삭제 · 타입 기준) → 2R medium 2(타입 조회 실패 때 Oracle custom 날짜가 1.7.4 와 달라짐 → 잠금 · 늦게 끝난 미리보기가 실행 중 캐시를 덮음 → 실행별 캐시 · 미리보기 무캐시) → 3R medium 1(날짜 잠금이 경보에 성공으로 감 · 손 등재 운영 실패 목록이 뿌리 → 만드는 자리 표시) → **4R approve**.
- 빌드(win-modern · Node 24.22.1) blocker 0 · exe `--version` 1.7.5 · `Downloads\엠티콜렉션_SyncAgent_v1.7.5\` = zip 168,916,963B · sha256 `494d081d3467ed88ed7bbc312dfd8ce19b04326a10ae44cc17777b4bbc5ab58c` · 안내서 PDF 11쪽(1.7.5 표기 16 · 옛 판 번호 0 · 가운뎃점 · 줄표 0).

### 9-4 VM 재확인(1.7.5)

- 같은 VM 에 1.7.5 · 예약 작업 1회: 고객 198/200 · 구매 0/0 · 잠금 없음 · 새 오류 0(시험 판매 행은 경보 문자 누적을 막으려 비움 · 작업은 다시 끔).
- 운영 PG(Harold 실행 · 198명 원본 계산식 대조): 생일 198 · 최근구매일 198 · custom 첫구매일 198 · custom 등급일 198 = 전원 일치.

### 9-5 남은 것 (착수 안 함 · 판단 = Harold)

- 엠티 출고 조건: 엠티 서버 공인 IP 를 국외 접근 통제(company_agent)에 먼저 등록 · 판매 뷰 휴대폰(P1 · 없으면 구매 0).
- 마법사 403 무음 내려감 · 로컬 매핑 품질 · PG · Oracle 원본을 쓰는 다른 회사의 날짜 칸 하루 당김 여부(운영 대조 = 그 회사 서버 등록 때) · Codex 범위 밖 `db/postgresql.ts:133` · `db/oracle.ts:395` · 엠티는 시각 컬럼이 없어 매 주기 전량.
