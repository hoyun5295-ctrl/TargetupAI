# 2026-06-19 핸드오프 — 싱크에이전트 재점검 + 나머지 디버깅(A/C/D)

> 다음 세션 할 일: ① 싱크에이전트 cp949 런타임 재점검 → 통과 시 배포 ② 나머지 디버깅 A(모바일 DM 4건) · C(발송관리 복사) · D(템플릿관리 3건).
> 이번 세션 배포 완료: #1 DM 완성이미지, #2 자동마케팅 권한, #3 AI Operator 문안편집. 싱크에이전트(#4)만 미배포 — 다음 세션 배포.

## 0. 이번 세션 상태 한눈에
- **배포 완료**: #1(DM 완성이미지 업로드) · #2(자동마케팅 일반사용자 생성) · #3(AI Operator 문안 직접편집). frontend build:safe + backend pm2 restart 완료(Harold 직접).
- **싱크에이전트(#4)**: 1차 수정(작업 스케줄러 전환) 후 2008R2에서 INSTALL bat 실행 실패 재발견 → 근본 = bat 안 한글이 cp949 콘솔에서 cmd 파싱을 깨뜨림 → **ASCII 전용으로 재수정 완료(정적 검증 통과)**. 런타임 cp949 실측 + 배포 = 다음 세션.
- **미착수 디버깅**: A(모바일 DM 4건) · C(발송관리 번호 복사) · D(템플릿관리 3건).

## 1. 싱크에이전트 (B) — 최우선 재점검 + 배포

### 1-1. 경위
1. 원 문제: 2008R2(오라클 최저사양 서버) `INSTALL-run-as-admin.bat` 실행 시 `[SC] StartService 실패 1053` + 콘솔 mojibake.
2. 1차 수정(이번 세션): 1053 근본 = Node pkg 단일 exe가 SCM 핸드셰이크(SERVICE_RUNNING 보고)를 못 함 → Windows 서비스로는 어느 환경에서도 1053. WinSW(.NET 의존)·NSSM(외부 바이너리·공식 배포처 차단) 둘 다 "모든 환경" 부적합 → **Windows 작업 스케줄러(schtasks)로 전환**(OS 내장, .NET·외부 바이너리·SCM 0). 콘솔 mojibake용으로 bat에 chcp 65001 + 한글 안내문 추가.
3. 2차 재발(서팀장 재테스트): 2008R2에서 bat가 아예 실행 안 됨. 캡처 = bat 명령들이 깨져 "X은(는) 명령 아님" 연발 + diagnose.txt 생성 실패.
4. **2차 근본(확정·양방향 재현)**: **bat 안 한글이 2008R2 cp949 콘솔에서 cmd 명령 파싱을 깨뜨린다.** cp949 콘솔 실측 — 한글 bat = 명령 깨짐(서팀장 캡처와 동일) / ASCII bat = 정상. 1차 수정 때 bat에 한글 408바이트를 더한 게 원인. (1차 검증을 Win11 UTF-8 콘솔에서만 해서 못 잡음 = 검증 구멍.)
5. **2차 수정(이번 세션)**: 모든 .bat를 ASCII 전용으로. 정적 검증 통과.

### 1-2. 수정 파일 (이번 세션 누적)
- `sync-agent/scripts/INSTALL-run-as-admin.bat.tpl` — **전부 ASCII 영문**. chcp 65001 + UAC 자동 권한 승격(`Start-Process -Verb RunAs`) + `--version` 게이트 + `--install-service`(작업 등록) + `schtasks /Query` 검증 + `type diagnose.txt` + pause. 한글 0.
- `sync-agent/src/service/index.ts` — Windows 경로를 sc-create → **작업 스케줄러(schtasks /Create /XML)**. XML: BootTrigger+2분 지연(D142 보존)·SYSTEM(S-1-5-18)·HighestAvailable·ExecutionTimeLimit PT0S(기본 72h 종료 함정 차단)·RestartOnFailure(1분/3회). install/uninstall/status + 레거시 sc 서비스 자동 정리 + 프로세스 효과 검증. **콘솔 출력 전부 영문**(diagnose.txt 무깨짐). Linux systemd 무변경.
- `sync-agent/src/main.ts` — `--service`/`RUNNING_AS_SERVICE` 가드: 설정 없으면 설치 마법사(웹서버) 대신 즉시 종료. 출력 ASCII.
- `sync-agent/src/updater/index.ts` — Windows stop/start를 `net`→`schtasks /End`·`/Run`. 생성하는 update.bat(Windows)도 **전부 영문**(같은 cp949 위험 차단). Linux shContent는 무변경(bash/UTF-8라 무관).
- `sync-agent/src/setup/edit-config.ts` — 재시작 안내문을 schtasks 기준으로.
- `sync-agent/package.json` — version 1.5.5 → **1.5.6**.

### 1-3. 이번 세션 검증 상태
- [통과] tsc 0
- [통과] 빌드된 bat 3종(dist-tiers) 한글 0건 (grep `[가-힣]` No matches) + 새 내용(chcp/RunAs/install-service/schtasks)
- [통과] exe 설치 출력 소스 전부 영문 / updater Windows bat 전부 영문
- [통과] 새 tpl 비ASCII 0 + **cp949 콘솔 파싱 0오류**(stub 실행 실측)
- [통과] 5종 재빌드 완료(release/*.exe + dist-tiers zip 5 + manifest 1.5.6)
- [미완 — 도구 일시 차단으로 보류, 다음 세션 1순위] 빌드된 exe 3종을 cp949 콘솔에서 직접 실행 → `--version`=1.5.6 + `--service-status` 영문(무깨짐) / Linux 2종 WSL 실행 / zip 안 bat 비ASCII 0 재확인.

### 1-4. 다음 세션 싱크에이전트 재점검 절차 (cp949 런타임)
```
cd C:\Users\ceo\projects\targetup\sync-agent\release
# 1) Windows exe 3종 cp949 실행
for t in win-modern win-mid win-legacy; do
  ./sync-agent-$t.exe --version                                      # 1.5.6 기대
  cmd.exe //c "chcp 949 >nul & sync-agent-$t.exe --service-status"   # 영문·무깨짐 기대
done
# 2) Linux 2종 WSL
for t in modern legacy; do wsl.exe -e bash -lc "cd /mnt/c/Users/ceo/projects/targetup/sync-agent/release && ./sync-agent-linux-$t --version"; done
# 3) zip 안 bat 비ASCII 0 재확인 (PowerShell ZipFile)
# 4) cp949 콘솔에서 새 INSTALL bat 파싱 stub 실행 0오류 재확인
```
실 2008R2 최종 확인 = 서팀장 새 zip 재설치(배포 후).

### 1-5. 싱크에이전트 배포 (다음 세션, 재점검 통과 후)
- 로컬: `cd C:\Users\ceo\projects\targetup\sync-agent && npm run upload:agents` (zip 5종 → 서버 agent-builds/).
- **주의**: 서버 다운로드 zip은 현재 1차(한글 bat·깨짐) 버전일 수 있음(Harold가 1차 배포 단계를 돌렸을 가능성). 다음 세션 upload:agents로 **ASCII 버전 덮어쓰기 필수**, 그 전엔 서팀장 재설치 X.
- 서팀장: 새 zip 재다운로드 → `INSTALL-run-as-admin.bat` 관리자 실행 → 2008R2 정상 등록 확인. (기존 설치 PC는 새 zip 재설치해야 적용 — 자동 교체 아님.)

## 2. 나머지 디버깅 (A / C / D) — 다음 세션

### A. 모바일 DM — 버그 4건 (운영 고객사 시세이도, frontend)
- A1. 완성 이미지가 자동 슬라이드쇼 가로 박스에 잘리고 축소됨. **이번 세션 #1이 완성이미지→`slideshow` 자동생성으로 만들었는데, slideshow 박스가 세로 긴 완성본을 자름.** 완성 이미지는 풀폭 원본 그대로 렌더 필요 → slideshow 대신 풀이미지/스크롤 렌더 방식 검토. (`stores/dmBuilderStore.ts` · `utils/dm-section-defaults.ts` · `pages/DmBuilderPage.tsx` · 백엔드 렌더 `utils/dm/dm-section-registry.ts`/`dm-builder`.)
- A2. 테스트 전송: 담당자 번호 저장됐는데 "담당자 번호가 비어있거나 유효하지 않아요"로 차단. (담당자 번호 검증 경로 확인.)
- A3. 직접발송 저장/발행 → 크레딧만 차감, 단축 URL 확인 불가.
- A4. 내 DM 현황 발행 0 (크레딧은 차감). (발행 카운트 + 단축 URL 생성 경로.)
- 자료: `C:\Users\ceo\Downloads\한줄로_모바일_DM_업데이트_요청_건 (2).zip` (시세이도 완성 4페이지 02~05 + 캡처 06~08). 재현 단축URL https://bit.ly/4vTdWOW. 환경 Edge.

### C. 슈퍼관리자 발송관리 — 기능 1건 (frontend)
- 캠페인관리 상세에서 수신/발신번호 드래그 복사 불가 → 복사 가능하게(select-text). D188 AlimtalkPreview select-none→select-text 패턴 참고.

### D. 슈퍼관리자 템플릿관리 — 기능 3건 (frontend, 템플릿 관리 화면)
- D1. 고객사/템플릿명 검색.
- D2. 템플릿코드(B_XX_…) 드래그 복사.
- D3. 관리 열 [상세] 버튼 → 고객 업로드 템플릿 정보 확인(발송/승인 내용, 반려 사유 대응).
- 자료: `C:\Users\ceo\Downloads\슈퍼관리자_발송관리_템플릿관리_수정_요청_사항.zip`.

## 3. 교훈 (영구)
- **배포되는 .bat는 ASCII 전용.** 한글이 들어가면 2008R2 등 cp949 콘솔에서 cmd가 명령 파싱을 깨뜨려 bat 자체가 실행 실패. 화면 한글은 bat가 아니라 데이터(diagnose.txt)에 두고 chcp 65001 + `type`으로.
- **콘솔/설치 검증은 실제 cp949 콘솔에서.** Win11 기본 UTF-8 콘솔 통과는 2008R2 보장이 아니다(이번 1차 검증 구멍).

## 4. 다음 세션 진입 명령어
```
지난 세션(2026-06-19) 핸드오프 읽고 시작:
- docs/superpowers/handoffs/2026-06-19-sync-agent-recheck-and-remaining-debug.md
- memory/project_2026_0618_4bug_rootcause.md
- status/lessons/LESSONS_DEPLOY.md

1순위 = 싱크에이전트 cp949 런타임 재점검(핸드오프 1-4) → 통과 시 배포(1-5, upload:agents, ASCII 버전 덮어쓰기 필수).
그 다음 = 나머지 디버깅 A(모바일 DM 4건) → C(발송관리 복사) → D(템플릿관리 3건).
핵심 교훈: 배포 .bat는 ASCII 전용(한글 bat = 2008R2 cp949 파싱 깨짐). 검증은 cp949 콘솔에서(Win11만 X).
한 건씩, 수정 전 승인. 워크플로우 4-1 + 6원칙.
```
