# LESSONS — Deploy / SSH / 빌드 / 의존성 사고

> **참조**: 배포 명령어 안내 / SSH / 빌드 / 의존성 작업 시 우선 정독.
> **원본**: 옛 `LESSONS_LEARNED.md` §3 안 배포 관련 사고 분할 (D215+ 도메인 분할 — 2026-05-24).

---

## 핵심 원칙

- **`atomic safe-build` 강제** — `npm run build:safe` 만 허용. `tp-deploy-full` 절대 금지 (D145 9시간 사고)
- **AI SSH 직접 실행 절대 금지** — D93 IP 차단 사고
- **`sudo` 안내 절대 금지** — root 권한 = Harold 본인 직접 진입
- **devDependencies 자동 보정** — safe-build.sh 안 `npm install --include=dev` (D151-6)
- **vite.config.ts / tsconfig.json import 추가 시 package.json 의존성 grep 자가 검증 의무** (D184-fix)
- **표준 출력 형식 의무** — tp-push + 절대 경로 build:safe (`/home/administrator/targetup-app/...`)
- **PM2 process 변경 안내 룰** — pm2 delete + pm2 start 패턴 절대 금지 (D183 사이트 다운 사고). atomic pm2 reload / startOrReload 우선
- **신규 파일 작성 후 git pull 단독 안내 절대 금지** — tp-push 표준 종료 멘트만

---

## 사고 이력

### 2026-06-19 (싱크에이전트 INSTALL bat 한글 → 2008R2 cp949 파싱 깨짐 = 설치 실행 실패)
- **사례**: 싱크에이전트 1053 수정 때 INSTALL bat에 한글 안내문(`chcp 65001` 동반)을 추가 → 2008R2(cp949 콘솔)에서 bat 명령들이 깨져 "X은(는) 명령 아님" 연발 + diagnose.txt 생성 실패 = 설치 자체가 실행 불가.
- **Root cause**: cmd.exe는 배치파일을 현재 콘솔 코드페이지로 파싱한다. UTF-8 한글이 든 bat는 cp949 콘솔에서 명령 파싱이 깨진다(`chcp 65001`이 있어도). cp949 콘솔 실측 — 한글 bat = 명령 깨짐 / ASCII bat = 정상.
- **대책**: **배포되는 .bat는 ASCII 영문 전용.** 화면에 보여줄 한글은 bat가 아니라 데이터 파일(diagnose.txt)에 두고 `chcp 65001` + `type`으로. diagnose.txt에 실리는 exe 콘솔 출력도 영문 권장.
- **교훈**: **콘솔/설치 검증은 실제 cp949 콘솔에서.** Win11 기본 UTF-8 콘솔 통과는 2008R2 보장이 아니다(1차 검증을 Win11에서만 해서 못 잡음). 구형 OS 대상 산출물은 그 OS의 코드페이지 조건에서 검증.

### D184-fix (vite.config.ts import vs package.json devDependencies 불일치 — 2달+ 누적)
- **사례**: 운영 서버 company-frontend `npm run build:safe` 실패 — `ERR_MODULE_NOT_FOUND: Cannot find package 'vite-plugin-javascript-obfuscator'`.
- **Root cause**: `1ca6ee8 코드난독화` commit (2026-03-08) 영역 `packages/company-frontend/vite.config.ts` import 추가 + `package.json` devDependencies 등록 누락. 2달+ 누적 (운영 빌드 영역에서 처음 발현 — 로컬 node_modules cache).
- **대책**: `vite.config.ts` / `tsconfig.json` / 모든 config 파일 import 추가 시 `package.json` 의존성 등록 grep 자가 검증 의무.
- **교훈**: atomic safe-build가 옛 dist 유지로 사이트 차단 0초 안전했지만, 검증 시점이 운영 빌드까지 지연 = 2달+ 누적 사고.

### D183 (PM2 process 변경 시 사이트 다운 사고)
- **사례**: ecosystem.config.js 신규 영역에서 git push 절차 누락 + pm2 delete 박은 영역 = 사이트 영역 다운 사고.
- **대책**: pm2 delete + pm2 start 패턴 절대 금지. atomic `pm2 reload` / `startOrReload` 우선. 신규 파일 작성 후 = tp-push 표준 종료 멘트만 (git pull 단독 안내 X).

### D151-6 (devDependencies skip — 한 세션 2회 반복)
- **사례**: 운영 서버 `NODE_ENV=production` → `npm install`이 devDependencies skip → tsc 빌드 1,310 에러(backend) → 21,328 에러(frontend) 한 세션에서 동일 패턴 반복.
- **Root cause**: atomic safe-build (D145)가 옛 dist 유지로 사이트 차단 0초였지만 새 dist 미진입 = 운영 stale. 메모리 박는 것만으론 동일 세션 2회 반복 차단 불가.
- **대책**: `packages/backend/scripts/safe-build.sh` + `packages/frontend/scripts/safe-build.sh` 첫 단계에 `if [ ! -d "node_modules/typescript" ]; then npm install --include=dev; fi` 추가 — 다음 빌드부터 자동 보장.

### D145 (5/7 배포 사고 — 가장 치명적)
- **사례**: `tp-deploy-full` 스크립트 실행 중 frontend vite 빌드 실패 → `dist` 폴더 빈 채로 종료 → **9시간 거래처 차단 장애**.
- **대책**:
  1. `tp-deploy-full` 안내 절대 금지
  2. 빌드 = 반드시 `atomic safe-build` (`npm run build:safe`)
  3. dist-new → 검증 → atomic swap. 빌드 실패 시 옛 dist 유지 = 차단 0초

### D93 (서버 SSH 계정 잠금)
- **사례**: AI가 스스로 SSH 접속 시도 → 비밀번호 오류로 IP 차단 → Harold님 접속까지 막힘.
- **대책**: AI의 SSH 접속 + 시스템 명령어 직접 실행 일절 금지.

---

## 표준 출력 형식 (`feedback_push_and_deploy_commands` § 4-1)

매 수정 완료 시 답변 끝에 다음 매트릭스 출력 (D188 Harold 명시 — 무조건 이 형식):

### 한줄로 (targetup)

```
작업이 완료되었습니다. Harold님, 아래 명령어로 푸시 + 배포 진행해 주세요.

## 1. 로컬 PowerShell 푸시
tp-push "작업내용 한 줄 요약"

## 2. 서버 SSH 풀 + 빌드 (Harold님 직접 진행)
ssh administrator@58.227.193.62
cd /home/administrator/targetup-app && git pull

### backend 변경 시
cd /home/administrator/targetup-app/packages/backend && npm run build:safe
pm2 restart all

### frontend 변경 시 (hanjul.ai + sys.hanjullo.com)
cd /home/administrator/targetup-app/packages/frontend && npm run build:safe

### company-frontend 변경 시 (app.hanjul.ai)
cd /home/administrator/targetup-app/packages/company-frontend && npm run build:safe
```

### 한줄전단 (hanjulDM)

```
작업이 완료되었습니다. Harold님, 아래 명령어로 푸시 + 배포 진행해 주세요.

## 1. 로컬 PowerShell 푸시
hdm-push

## 2. 서버 SSH 풀 + 빌드 (Harold님 직접 진행)
ssh administrator@58.227.193.62
cd /home/administrator/hanjuldm-app && git pull

### backend 변경 시
cd /home/administrator/hanjuldm-app/packages/backend && npm run build:safe
pm2 restart hanjuldm-api

### 로그 확인
pm2 logs hanjuldm-api --lines 100
```

---

## 금지 사항

- `tp-deploy-full` 안내 (D145 9시간 사고)
- `npm run build` 안내 (atomic 아닌 일반 빌드 — dist 임시 빈 상태 사고 위험)
- `ssh administrator@...` 직접 실행 (D93 IP 차단 사고)
- `sudo` 안내 (root 권한 = Harold 직접 판단)
- backend 변경 누락 시 pm2 재시작 누락 (옛 코드 그대로 동작)
- 한줄로 작업에 `hdm-push` 안내 (혼용)
- 한줄전단 작업에 `tp-push` 안내 (혼용)
- 변경 안 한 영역 빌드 안내 (자원 낭비)
- 한줄전단에 `pm2 restart all` 안내 (한줄AI까지 재시작되어 영향 사고) — 반드시 `pm2 restart hanjuldm-api`
- preview 도구 (mcp__Claude_Preview__*) 사용 (Harold 명시 D187-fix2 절대 금지 — `feedback_no_preview_verification`)

---

## 자가 검증 매트릭스 (배포 안내 시)

- [ ] `tp-deploy-full` 단어 포함 X
- [ ] `ssh administrator@...` 명령어 안내 (Harold 직접 실행 명시 — AI 실행 X)
- [ ] `sudo` 단어 포함 X (`feedback_no_sudo_use_echo` 정합)
- [ ] 절대 경로 (`/home/administrator/targetup-app/packages/backend/...`) 명시
- [ ] backend 변경 시 `pm2 restart all` 포함
- [ ] 변경 안 한 영역 빌드 명령어 미포함
- [ ] 한줄로 ↔ 한줄전단 혼용 X (working dir로 식별)
- [ ] preview 도구 사용 X
- [ ] 새 config 파일 import 추가 시 package.json devDependencies 등록 grep 검증
- [ ] PM2 변경 시 `pm2 delete` 패턴 X (`pm2 reload` 또는 `startOrReload` 우선)
