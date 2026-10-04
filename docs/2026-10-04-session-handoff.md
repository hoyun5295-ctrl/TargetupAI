# 1004 세션 인계: 마케팅 플래너 전수점검 → 보강 설계 확정 → 화면 목업 1차 (2026-10-04 작성)

> 이 문서는 **Harold님이 실행할 순서와 명령**, 다음 세션이 이어받을 자리만 담는다. 사실·근거·결정의 소유 문서는 [설계서](2026-10-04-planner-material-approval-design.md)다.
> 착수 첫 명령은 **현재 상태 확인**이다(이 문서의 상태는 작성 시점 값). 명령마다 실행 위치를 적었다. 한 번에 하나씩 실행하고 결과를 본 뒤 다음으로 간다.

## 0. 먼저 읽을 것

1. 이 문서 전체
2. [설계서](2026-10-04-planner-material-approval-design.md) **§0 → §2 → §3 → §5 → §12** (화면 작업이면 §5가 기준 · 구현이면 §6~§10 · §13 단계)
3. 화면 작업 직전: `status/lessons/LESSONS_FRONTEND.md` "디자인 최소 기준" 절 · impeccable 스킬 `reference/craft-floor.md`

## 1. 이번 세션에서 한 것

| 축 | 무엇 | 상태 | 소유 문서 |
|---|---|---|---|
| 전수점검 | 플래너 코드 약 9,500줄 직접 읽기 · 코드 확정 결함 F1~F10 · 계약 테스트 5파일 117건 로컬 통과 | 완료(코드 수정 0) | 설계서 §1 · §9 |
| 운영 실측 2건 | 접점 상태 분포 17행 · 승인 원장 4행(Harold 실행) → 사용 회사 = 사내 2곳 · 끝까지 돈 것 = 문자(+DM 링크)뿐 | 완료 | 설계서 §1 |
| 비토 구조체크 | 구조 후보 5개 HTML 보고서(1순위 = 채널 준비 판정 단일화) | 완료 · 설계에 흡수 | 설계서 §6-10 |
| 보강 방향 결정 | Harold Q1~Q6(재료 창 · 행사별 승인 · 문안 사전 생성 · 확인 링크 · D-3 · 1차 채널) | 확정 | 설계서 §2 |
| 브레인스토밍 | 5역할 1차 → 토론 1라운드 → 회의론자 최종 검증(critical 3 · high 4 → 전부 반영) | 완료 | 설계서 §11 |
| 설계서 | `docs/2026-10-04-planner-material-approval-design.md` | **확정**(D1~D3 Harold 결정 · 추천대로) | 설계서 §12 |
| 화면 목업 1차 | 4종(캘린더 · 행사 담기·재료 · 휴대폰 확인 · 행사 상세·승인) · PC 1440 + 375 | 보여 드림 · **Harold "디자인 개선 아예" → 새 세션에서 개선** | 아래 §3 |

## 2. Harold님 실행 순서

1. impeccable 스킬 업데이트(4.1.1 → 최신). 마켓 목록 갱신은 이번 세션에서 끝났다(`Successfully updated marketplace: impeccable`).

▶ 실행 위치: 로컬 PowerShell
```powershell
claude plugin update impeccable@impeccable
```

2. 결과에 새 버전이 보이면 **Claude 앱을 재시작**한다(업데이트는 재시작 뒤 적용).
3. (선택) 이번 세션 문서 커밋: `docs/2026-10-04-planner-material-approval-design.md` · `docs/2026-10-04-session-handoff.md` · `status/STATUS-FEED.md`(N32 카드) · `docs/FEATURE-MARKETING-PLANNER.md`(§8·§10 포인터). 코드 변경은 없어 배포는 없다.
4. 새 세션 첫 말 = **「플래너 목업 디자인 개선」**.

## 3. 다음 세션이 할 일 (순서대로)

1. **상태 확인**: impeccable 새 버전이 실린 것을 `context.mjs` 출력으로 확인(`UPDATE_AVAILABLE`이 없어야 한다) · 실행 = `node <스킬 기준 경로>/scripts/context.mjs --target packages/frontend/src/pages/MarketingPlannerPage.tsx`.
2. **1차 목업 읽기**: `C:\Users\ceo\AppData\Local\Temp\claude\C--Users-ceo-projects-targetup\e3c24460-b462-4d25-9763-a04bb1129f99\scratchpad\mock\planner-mockups.html`
   (탭 4개 · 표본 = 2026년 10월 · 가상 브랜드 "마루 리빙" · 이달 대행료 기납 상황). **지워졌으면 설계서 §5로 다시 그린다.**
3. **비평 → 전면 개선**: impeccable 새 버전으로 1차 목업을 비평(critique)하고, 그 결과대로 4종을 다시 그린다.
   - 하한(못 내려가는 것) = AI 존 틀(남색 머리 띠 · 명령 카드 · 밝은 작업대) · 모바일 375 · native dialog 0 · Source caption · 1클릭 · 모델명 0 · 줄표 0.
   - 상한은 없다(CLAUDE.md `design_quality_minimum_ceiling_free`) · 기존 화면은 근거이지 모방 대상이 아니다.
   - 화면 구성·흐름은 설계서 §5가 소유한다(회의 합의 · 바꾸려면 Harold님께 먼저 말한다).
4. **보여 드리기**: scratchpad HTML → `SendUserFile` render. preview 도구로 내가 확인하지 않는다.
5. **승인 뒤**: 설계서 §5에 "목업 기준" 한 줄 등재(목업 경로) → §13 **B1(기반)부터 구현** · 단독·순차 · 묶음마다 tsc 0 + 전체 vitest · B4·B5·B6 Codex 적대.

## 4. 이어받을 규칙 (이번 세션에서 다시 확인된 것)

- 에이전트·워크플로는 Harold님이 명시로 발동할 때만(이번 브레인스토밍은 Harold 「필요하면 열어서」로 발동 · 그 회의 한 번에만 쓰인다).
- Harold님 로컬 창 = **Windows PowerShell 5.1** · `&&` 불가 · 한 블록 한 명령 · ```powershell 펜스(이번 세션에 한 번 어겼다).
- 무로그인 승인 화면은 이미 2종(대행발송 · 충전)이 있고 "로그인을 묻는 화면은 가짜" 고지를 갖는다 → 플래너 확인 화면과 함께 고지를 맞춘다(설계서 §5-3).
- 휴대폰 로그인 = 단일 세션 정책으로 PC 접속이 끊긴다(`session-manager.ts:407`) → 1차 승인 길은 PC 할 일.

## 5. 산출물 위치

| 무엇 | 위치 |
|---|---|
| 설계서(확정) | `docs/2026-10-04-planner-material-approval-design.md` |
| 화면 목업 1차 | 이번 세션 scratchpad `mock/planner-mockups.html`(§3-2 절대 경로) |
| 구조 진단 보고서 | 이번 세션 scratchpad `planner-architecture-review-20261004.html` |
| 회의 자료(토론 요약 · 수렴안) | 이번 세션 scratchpad `planner-brainstorm-round2.md` · `planner-brainstorm-converged.md`(소실돼도 설계서 §11이 판정과 근거를 소유) |
| 메모리 | `project_2026_1004_planner_audit_structure_check` |
