# 콘솔 화면 톤 통일 — 라이트 + 인디고 (2026-08-17 ~ 08-18)

> **호출어 = 콘솔 톤**
> 관리·조회 화면(카카오&RCS · 발송결과 · 수신거부 · 회사설정)을 한 톤으로 다시 그린 트랙.
> 값의 소유는 코드(`packages/frontend/src/utils/console-ui.ts`)이고, **여기는 왜 그렇게 정했는지와 함정을 소유한다.**
> 재사용 규칙 한 줄 요약은 `status/lessons/LESSONS_FRONTEND.md` 핵심 원칙에 있다(거기는 규칙, 여기는 경위).

---

## §1 확정 사실 — 재검증 불요

| 사실 | 근거 |
|---|---|
| 액센트 = **인디고**(`indigo-600` = #4f46e5) | `utils/dm-tokens.ts`의 `DM_COLOR_TOKENS.brand.primary`와 같은 값 — 새로 정한 색이 아니라 이미 있던 브랜드 값 |
| **바이올렛은 AI 기능 화면 색** — 관리 화면에 쓰지 않는다 | `LESSONS_FRONTEND.md` 톤앤매너(AI 자율 진단 카드·다크 violet 액센트). 이 선이 두 색을 가르는 유일한 기준 |
| Pretendard·lucide·Tailwind가 이미 설치돼 있다 | `index.html:35` CDN · `package.json` lucide-react ^0.563 · lucide 사용 파일 175개 |
| `campaigns` 화면들의 탭 색이 **런타임 조립**이었다 | `border-${tab.color}-500` — Tailwind 스캐너가 못 읽는 형태. 다른 파일에 같은 클래스가 있어 우연히 살아 있었다(`safelist` 없음 실측) |
| 앱 표준 `disabled:opacity`는 {30,40,50,60} | `backend/src/utils/__tests__/ui-token-invariants.test.ts` 1번 규칙이 강제 |

---

## §2 불변 원칙 (⛔ — 어기면 되돌아온다)

1. **값은 `console-ui.ts`(`CUI_*`)가 소유한다.** 화면은 이름만 부른다. 색·높이·라운드를 화면 파일에 적는 순간 다음 수정부터 갈라진다.
2. **이름이 범위를 말해야 한다.** 처음엔 `kakao-ui.ts`였는데 쓰는 표면이 넷이 되자 이름이 범위를 속였다 → `console-ui.ts`/`CUI_`로 승격(식별자 104개·소비처 15파일, 원본 복사 후 접두사 치환 — 기억으로 다시 쓰지 않았다).
3. **모달 껍데기에 `backdrop-filter`·`transform`·`filter`·`will-change`를 넣지 마라.** 그 안의 `fixed` 자손이 갇힌다(§4-3 P0). 되살리려면 중첩 오버레이를 `createPortal`로 먼저 빼라.
4. **색은 의미가 있을 때만 남긴다.** 성공 emerald · 실패 rose · 대기/주의 amber. 그 밖의 초록·보라·주황은 액센트가 아니라 소음이다.
5. **채널마다 색을 다르게 주지 않는다.** 같은 위계에 색이 셋이면 "지금 어디"가 색이 아니라 위치로만 읽힌다.
6. **다크 규약을 침범하지 않는다.** 여정·AI 기능 화면과 40개 파일이 쓰는 `ConfirmModal`은 slate-950 그대로다. 그래서 흰 화면 위에 어두운 확인 모달이 뜬다 — 새 불일치가 아니라 앱 전역 규약이다.

---

## §3 구조 — 무엇이 어디를 소유하나

| 것 | 소유 | 비고 |
|---|---|---|
| 색·높이·라운드·모션 토큰 | `frontend/src/utils/console-ui.ts` | `CUI_*` 접두사. 모달 토큰 주석에 ⛔ 3번이 박혀 있다 |
| 행 액션(대표 1 + `⋯`) | `frontend/src/components/console/RowActions.tsx` | 표 3곳 공용. `actions[0]`이 대표 — 호출부가 상태에 맞는 것을 0번에 놓는다. **파괴적 액션은 0번 금지** |
| 상태 칩 | `components/console/StatusPill.tsx` | 앞에 점을 달아 색맹 대비. tone 5종은 `console-ui.ts`가 소유 |
| 빈 상태 | `components/console/EmptyState.tsx` | 아이콘 + 제목 + 설명 + **바로 시작 버튼**. 권한 없으면 버튼 없이 안내만 |
| 채널 칩 색·아이콘 판정 | `utils/campaign-axis.ts` | `resolveChannelChipClass` / `resolveChannelIconName`(이름만 반환 — 유틸이 lucide를 import하면 소비처 전부가 아이콘 번들을 끈다) |

**적용 표면(11파일)** — `pages/KakaoRcsPage` · `components/RcsTemplateFormModal` · `components/alimtalk/*`(9) · `components/ResultsModal` · `components/CampaignDetailModal` · `pages/Unsubscribes` · `pages/Settings`

---

## §4 이력

### 4-1. 0817 카카오 & RCS 전면 재작성 (배포완료)

목록 3탭 + 폼 모달 3종 + 부속 모달 3종 + 폼 내부 편집기 3종. 이모지 8곳 → lucide 0건 · 탭 3색(amber/blue/purple) → 인디고 1색 + 밑줄 슬라이드 · 관리 열 버튼 최대 6개 → 대표 1 + `⋯` · 모바일 카드 전환 · 삭제 확인을 공용 `ConfirmModal`로 통일(인라인 중복 폐기).

**되돌린 것 1건** — `AlimtalkVariableMappingPanel`에 토큰을 입혔다가 소비처를 보니 이 화면 트리엔 없고 발송 화면 4곳(직접발송·타겟발송·자동발송·알림톡발송)만 쓰는 공용이었다. 원문 그대로 복구(`git diff` 0 확인). **범위 밖 공용은 손대지 않는다**(`scope_discipline_one_ticket_axis` ③).

**유지하되 알린 것 1건** — `SenderRegistrationWizard`는 슈퍼관리자 발송 관리 탭도 쓴다. 스타일 prop이 없어 호출부에서 막을 수 없어 함께 밝은 톤이 됐다.

**부수로 잡은 결함** — 상태 폴백이 옛 `cls` 모양이라 모르는 상태값이 오면 `st.tone`이 `undefined`가 되어 칩 색이 통째로 빠지던 것.

### 4-2. 0817(2) 토큰 승격 + 발송결과·수신거부·설정 (배포완료)

`kakao-ui.ts` → `console-ui.ts`, `KUI_` → `CUI_`, `components/kakao/` → `components/console/`.

- **발송결과** — 채널 칩의 이모지 문자(`📨`·`💬`·`📱`)를 lucide로. OS·브라우저마다 다르게 그려지고 글꼴 크기에 안 맞아 뭉갠다(Harold 지적). 탭 3색 → 인디고 하나 + 밑줄 슬라이드. 요약 카드 5장의 그라데이션 타일 제거 — **숫자를 읽는 카드인데 아이콘이 제일 진했다.** slate 198곳 → neutral, violet/fuchsia 45곳 → indigo.
- **수신거부** — 검정 primary → 인디고. 표 헤더의 `uppercase tracking-wider` 제거(한글엔 대문자가 안 먹고 자간만 벌어진다).
- **회사설정** — 헤더 violet→fuchsia 그라데이션 → 인디고 단색. 섹션 아이콘 타일 5색 → 무채색 하나.

### 4-3. 0818 P0 — 발송 결과 조회창 잘림 (접수 `cmsxx7k3q04rjjnywhv3ciirt`)

**증상** — 상세보기를 누르면 화면창이 커지지 않고 결과창 크기로 고정·스크롤 불가·닫기 버튼도 못 눌러 F5 말고는 못 빠져나옴.

**원인(내가 만든 회귀)** — 4-2에서 스크림에 `backdrop-blur-[2px]`, 흰 박스에 `animate-in zoom-in-95`를 넣었다. CSS에서 이 둘은 **`position: fixed` 자손의 기준 박스를 자기 자신으로 바꾼다.** 그 흰 박스에는 `overflow-hidden`이 있어 결과창 안에서 `fixed inset-0`로 뜨던 오버레이 6개가 뷰포트가 아니라 **결과창 박스로 잘렸다.** 접수 스크린샷의 잘린 경계가 정확히 그 박스다.

**조치** — 두 토큰에서 그 속성을 전부 제거(코드가 줄었다). 등장 애니메이션은 잃었고, 되살리는 조건을 토큰 주석에 ⛔로 박았다. 같이 잡힌 것 = `CUI_MODAL`에 `max-h-[95vh]`를 덧붙여 이미 있는 `max-h-[92vh]`와 충돌하던 것(승자는 생성된 CSS 순서가 정한다), 그리고 `AlimtalkTemplateFormV2` 드롭다운의 바깥클릭 캐처가 모달 안에 갇혀 있던 것.

**위험 화면 판정법** — `grep -c "fixed inset-0"`로 중첩 오버레이 수를 센다(실측: 발송결과 6, 나머지 0~1).

---

## §5 남은 것

- **등장 애니메이션 복구** — 하려면 `ResultsModal`의 중첩 오버레이 6곳 + `CampaignDetailModal` + `CalendarModal` 호출부를 `createPortal`로 뺀 뒤에야 `CUI_MODAL`에 transform을 되돌릴 수 있다. 지금은 뺀 상태가 정상이다.
- **`SenderRegistrationWizard` 톤** — 슈퍼관리자 화면과 공유. 되돌릴지 Harold 판단 대기.
- **Source caption** — `design_quality_minimum_ceiling_free` 하한 항목이지만 이 표면들은 차트·지표 카드가 없어 붙이지 않았다. 지표가 생기면 그때 붙인다.

---

## §6 뒤집힌 판단

| 처음 생각 | 실제 | 왜 |
|---|---|---|
| 다크 slate-950이 하한이니 그대로 간다 | 라이트로 갔다 | Harold 명시 지시 + `/manage` 계열이 이미 라이트. 하한은 상한이 아니다 |
| `backdrop-blur`만 빼면 된다 | 속성을 전부 뺐다 | 하나만 빼면 다음에 누가 transform을 넣는 순간 돌아온다. 원인 제거가 우회보다 코드도 줄었다 |
| 필터 select 옵션 4개를 손으로 늘린다 | CT 순회로 바꿨다 | 백엔드에 유형이 늘었을 때 화면만 안 늘어 그 유형이 필터에서 사라지던 형태다(계약 테스트가 잡았다) |
