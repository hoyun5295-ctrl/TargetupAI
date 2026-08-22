# 고객 360 v2: 2열 작업면 + 검색 (2026-08-22)

> 호출어 **"고객 360"**. 1차(Phase 0)의 확정 사실·불변 원칙·원천 카탈로그·API 골격은 [1차 설계서](2026-08-22-customer-360-timeline-design.md)가 소유한다. 이 문서는 **2차 개편(화면 재설계 + 검색·기간)** 의 결정·계약·이력만 소유한다.
> 경위: Harold "검색 기능도 없고, 디자인을 획기적으로 개선하고 싶다. 디자이너·프론트엔드만 브레인스토밍으로 소집해라" → 정보 구조 디자이너 · 시각 디자이너 · 프론트엔드 3인 Explore 회의 2라운드(회의론자 검증 = 주재자) → 합의안 1개 + 목업 → Harold "모달 맘에 든다, 제대로 하자"(승인).
> 회의 중 실측으로 드러난 **회사 격리 결함**(타사 발송 노출)은 이 축과 분리해 먼저 정정했다(1차 설계서 §6-R-2).

---

## 0) 한 줄 정의

같은 데이터를 **"누구인가"(좌 레일)와 "무슨 일이 있었나"(우 타임라인)로 갈라** 한 화면에 놓고, 타임라인에 **검색어·기간**을 준다. 같은 문자를 연달아 보낸 행은 한 줄로 접어 로그가 아니라 이야기로 읽히게 한다.

---

## 1) 확정 사실 (회의·실측)

| # | 사실 | 근거 |
|---|------|------|
| 1-1 | 부모(고객 DB 조회) 헤더 실측 높이 = 80px(py-4 32 + 제목 28 + 부제 20). 스크림 `bg-black bg-opacity-50` · 박스 `w-[1100px] max-h-[88vh] rounded-xl shadow-2xl` · 헤더 `px-6 py-4 border-b bg-gray-50` · 닫기 `w-8 h-8 rounded-full` | `CustomerDBModal.tsx:445-481` |
| 1-2 | 부모가 자식에 넘기는 유일한 마크업 `basicInfo`는 이미 neutral 스케일(`divide-neutral-100` · `text-neutral-400/800`) · `dt w-24`(96px) · `dd break-words` | `CustomerDBModal.tsx:404-420` |
| 1-3 | 부모 전체삭제 확인창이 `z-[60]`이라 360(`z-[60]`)과 같은 층 숫자 | `CustomerDBModal.tsx:723` |
| 1-4 | 부모는 `onOpenCampaign`을 넘기지 않아 "발송 결과 보기"는 한 번도 렌더된 적 없음 | `CustomerDBModal.tsx:783-790` |
| 1-5 | `(dest_no, sendreq_time)` 인덱스 103테이블 적용 완료. `type=ref · rows=1`. "84만 행 20초"는 인덱스 이전 수치 | 1차 설계서 §6-D-R |
| 1-6 | 서버가 12원천을 각각 `limit+1`로 잘라 메모리 병합 후 50건만 돌려준다. **화면이 가진 50건은 검색 모집합이 아니다** → 클라이언트 검색 불가 | `customer-timeline.ts buildCustomerTimeline` |
| 1-7 | `nextBefore`는 마지막 **원행**의 (at, kind, id). 서버에서 행을 접으면 커서가 깨진다 → 접기는 클라이언트 | 같은 파일 |
| 1-8 | `summary.lastActivityAt`은 현재 페이지 첫 사건으로 덮여 종류 탭을 바꾸면 값이 바뀐다 · `sends`는 못 세도 `?? 0`으로 접힌다 | 같은 파일 |
| 1-9 | 화면 `expanded` Set이 `id`만 쓰는데 id는 원천 안에서만 유일(행 key는 `kind:id`) | `Customer360Panel.tsx:79,120,291,294` |
| 1-10 | `CUI_CHIPS`는 `overflow-x-auto`, `CUI_INFO`·`CUI_NOTICE`는 `mt-3`, `CUI_MENU`는 `animate-in zoom-in-95`(transform) | `console-ui.ts:121,167,211,215` |
| 1-11 | `timeLabel`이 `hour12` 기본이라 "오전 04:35" → 시각 열 세로 정렬 불가 | `timeline-kinds.ts:76-79` |
| 1-12 | 스크린샷의 "같은 LMS 연속 6건"은 live·log 중복이 아니라 실제 별개 발송(테이블별 seqno 상이). 접기가 맞는 처방 | 1차 설계서 §6-R-2 실측 |
| 1-13 | Tailwind 3.4.1(`dvh` 사용 가능). 불변식: `disabled:opacity` ∈ {30,40,50,60} · `text-white/N`은 5단위 · 클래스 동적 조립 금지 | `ui-token-invariants.test.ts` · `console-ui.ts` |

---

## 2) 불변 원칙 (1차 §2에 더한다)

1. **⛔ 껍데기는 부모 언어, 작업면은 360 규칙.** 두 창이 겹쳐 보이는 면적은 스크림·모서리·그림자·폭·헤더 띠·닫기 자리뿐이다. 이 여섯은 부모 리터럴 그대로(1-1). 그 안쪽(레일·툴바·행·카드)은 `CUI_*` + 이 창 전용 리터럴로 올린다. **부모 파일은 무접촉**(0822 롤백 경위).
2. **⛔ 검색은 서버가 한다.** 화면이 받은 50건 안에서 찾는 반쪽 검색은 "없다"는 오답을 준다(1-6). 서버 `q`가 없는 빌드에서는 검색 입력을 그리지 않는다(같은 릴리스에 함께 나간다).
3. **⛔ 접기는 클라이언트가 한다**(1-7). 접힌 행은 서버가 준 첫 사건의 `title`·`subtitle` 원문 + 건수 + 시각 범위만 보여준다. 화면이 새 문구를 짓지 않는다(1차 §2-5 유지).
4. **⛔ 성공과 실패를 한 묶음으로 접지 않는다.** 접기 키에 `status`가 들어간다. 실패 1건이 "6건" 뒤에 숨으면 마케터가 찾아야 할 것이 사라진다.
5. **요약(좌 레일)은 필터·검색·기간을 따르지 않는다.** 기준 = 최근 12개월 고정(`summary.basis`). 타이핑마다 "이 고객이 누구인가"가 흔들리면 읽을 수 없고, 집계에 LIKE를 얹으면 4초 제한에 늘 걸려 요약이 통째로 빈다.
6. **빼기로 퀄리티를 올리지 않는다**(0821 판정). 요약 4칸 유지 · 0인 칸 유지 · 성공 점 유지 · 칩 9개 유지. 층을 더한다: 레일 면 · 축선 · 묶음 펼침 · 상세 안 흰 면 · 월별 막대 · 스켈레톤.
7. **1클릭 하한**: 종류 칩을 드롭다운 뒤로 접지 않는다. 기간은 세그먼트 4칸(달력 팝오버 0). 검색은 확정 버튼 없이 250ms 디바운스.
8. **가로 스크롤 0**: 칩은 줄바꿈(1차 6-R 2번 재발 방지). `CUI_CHIPS` 사용 금지.
9. **transform 금지 경계 유지**: 껍데기·스크림·상세 래퍼에 `transform`·`filter`·`backdrop-filter`·`animate-in` 계열 0. 행 펼침은 `grid-template-rows` + opacity. 상세 안에서 fixed 오버레이(발송 결과)가 열릴 날을 전제로 둔다.

---

## 3) 구조

### 3-1) 화면 (데스크톱 1100px)

```
┌ 헤더 80px · bg-gray-50 ───────────────────────────────────────────────────┐
│ [이니셜] 이름 19px / 번호 · 매장                   [등급][수신 상태] │ [X] │
├ 레일 320 · bg-neutral-50 ┬ 타임라인 779 · bg-white ─────────────────────┤
│ 지표 2x2(24px 숫자)      │ 검색(CUI_FIELD) · 기간 세그먼트 4칸      48px  │
│  받은 메시지 + 12개월 막대│ 전체 발송 DM열람 구매 행동 자동화 동의 … 40px │
│  반응 · 구매 · 마지막 활동│ [원천 안내 배너: 잘림 = INFO / 실패 = NOTICE] │
│ 기본 정보(접이식, 데스크톱 │ ┌ 어제 ·············· 발송 6 (sticky) ┐     │
│  기본 펼침)               │ │ 16:37  (●) LMS 발송 · …  [4건]   ˅ │     │
│                           │ │ ~16:35     └ 하위 4줄(시각·상태)    │     │
│ Data source (mt-auto)     │ │ 16:36  (●) LMS 발송 · …          ˄ │     │
│                           │ │         [상세 카드: 본문 흰 면 + 메타] │     │
└───────────────────────────┴─ 더 보기 ─────────────────────────────────────┘
```

- 헤더: `h-20` 고정 · 이니셜 타일 `h-11 w-11 rounded-xl bg-white ring-1 ring-neutral-200 text-indigo-600` · 이름 `text-[19px] font-bold tracking-[-0.03em]` · 2행 번호 `font-mono tabular-nums` + 헤어라인 + 매장(2곳 이상이면 "매장 N곳"). 칩은 우측 정렬 `CUI_PILL_*`(등급 neutral · 수신동의 green · 수신거부 rose). 닫기 = 부모와 같은 `w-8 h-8 rounded-full`에 lucide `X`(글리프 baseline 문제 제거).
- 레일: 지표 타일 `rounded-xl bg-white border border-neutral-200 p-3.5`, 라벨 12px, 값 `text-[24px] font-bold tabular-nums`, 0은 `text-neutral-400`, 맥락 줄 11.5px("최근 12개월" / "열람률 n%" / "누적" / 실제 날짜). 마지막 활동은 `N 일 전` 숫자형. 받은 메시지 타일에 12개월 막대(`summary.monthly`, 없으면 맥락 줄). 못 센 값은 "집계 중". 기본 정보는 레일 안 접이식(데스크톱 기본 펼침, 모바일 기본 접힘). Source caption `mt-auto`.
- 툴바: 1행 `h-12` = `CUI_FIELD`(flex-1, max-w 320) + 세그먼트(30일 · 3개월 · 12개월 · 전체, 기본 12개월) + 조건이 있을 때만 "조건 지우기". 2행 `min-h-[40px] flex-wrap` = 전체 + 종류 칩 8(단일 선택 · 재클릭 전체 복귀 유지). 배너는 툴바 아래 `shrink-0`(마진 없는 전용 리터럴).
- 행: `grid-cols-[52px_28px_1fr_20px] gap-x-3 px-5 py-2.5 min-h-[56px]`. 1열 시각 24시간제 우측 정렬 · 2열 타일(`ring-2 ring-white`) + 축선(2열 안 `absolute left-1/2 w-px bg-neutral-200`, 그룹 첫·끝 행 리터럴 2종) + 상태 점 타일 우하단(`sr-only` 상태 문구) · 3열 제목 13.5px/부제 12px · 4열 chevron. 실패·대기는 제목 뒤 `CUI_PILL` 승격. 날짜 머리 `sticky top-0 h-8 bg-gray-50` + 그날 집계.
- 접기: 누적 배열 전체에 `useMemo`. 키 = `kind + (ref?.id ?? title) + status`, 정렬 인접 · 첫·끝 간격 10분 이내 · 3건 이상 · 상한 50. **꼬리 규칙**: 묶음이 배열 끝에 닿고 `nextBefore`가 있으면 접지 않는다(더 보기 뒤 건수가 사후에 늘지 않게). 접힌 행 = 카운트 배지 + 시각 범위(`16:37` / `~16:35`) · 펼치면 하위 줄(시각 + 상태)만, 본문은 대표 1회. 하위 줄은 버튼 밖(버튼 중첩 금지).
- 상세: `pl-[124px]`(20+52+12+28+12) · 카드 `rounded-xl border bg-neutral-50 p-3.5` 안에 본문 흰 면 `line-clamp-[10]` + "전문 보기" · 메타 `grid-cols-2 md:grid-cols-4` · `dd break-words`(truncate 제거) · "발송 결과 보기" `CUI_ACT`(배선은 별건).
- 로딩·빈·오류: 첫 로드 스켈레톤(헤더는 fallback으로 실물, 타일 4 + 행 6, 제목 폭 리터럴 4종 배열 인덱스) · 재조회는 목록 유지 + `opacity-40` · 빈 상태 3분기 각 1클릭 복구("전체 보기" / "검색어 지우기" / "기간 전체로") · 더 보기 실패 인라인 표시 · `aria-live="polite"`.
- 모바일(<768): 레일이 위로 쌓임(지표 2x2 유지 · 기본 정보 접힘) · 툴바 3줄 · 시각 열 44px · 상세 인덴트 제거 · 껍데기 `rounded-none max-h-[100dvh] p-0`.
- 검색어 강조: 제목·부제의 부분 일치 구간만 `<mark>`(`bg-indigo-100 text-indigo-900`). 본문만 맞은 건은 강조가 없다(스니펫은 2단계).

### 3-2) API 계약 변경 (`GET /api/customers/:id/timeline`)

| 쿼리 | 형식 | 규약 |
|---|---|---|
| `q` | 1~40자, trim | 단일 구 부분 일치 · 대소문자 무시. 원천별 대상 고정: 발송 = `msg_contents`·`title_str` / 구매 = `product_name`·`product_code`·`store_name` / 행동 = `event_name`·`properties` / 인앱·DM 열람 = 메시지 제목 / DM 응답 = `section_type`·`response_data` / 여정 = 여정명 / 문의 = `transcript`·`ai_response` / 이메일 = 캠페인명·`url`. **동의·수신거부·등록은 검색 대상 없음**(q가 있으면 빈 결과) |
| `from` / `to` | `YYYY-MM-DD` | KST `[from 00:00:00, to 23:59:59.999]`. 화면은 `months`를 보내지 않는다. 서버가 `from`에서 MySQL log 개월 수를 역산(`clamp(ceil, 1, 24)`). `from` 없음 = 24개월 상한 → `sources.send.rangeCapped = true` |
| `summary` | `0` | 요약 집계 생략. 화면은 첫 로드(조건 없음)에서만 요약을 받고 이후 재조회는 `summary=0` |
| `before` · `kinds` · `limit` | 무변경 | 커서 포맷 무변경. 상한이 둘이면 서버가 `min(cursor.at, to)`를 쓴다. 조건이 바뀌면 화면이 `before`를 버린다 |

응답 변경:
- `summary.sends: number | null`(못 세면 null → "집계 중") · `summary.basis: { months: 12 }` · `summary.monthly: [{ ym: 'YYYYMM', sends }]` 12칸(오래된 달부터). monthly는 발송 집계 쿼리를 `DATE_FORMAT(sendreq_time,'%Y%m') GROUP BY`로 바꿔 **추가 쿼리 0**으로 얻는다(비토 라인 13~15는 live에 전 기간이 있어 테이블 접미사로 달을 정하면 틀린다 → 행의 시각으로 정한다).
- `sources.send.rangeCapped?: boolean`.
- 2단계(이번에 넣지 않음): `kindCounts` · `summary.recent`(30일 대비) · `matched.total` · 매칭 스니펫.

### 3-3) 소유 파일

| 파일 | 역할 |
|---|---|
| `backend/src/utils/customer-timeline.ts` | `q`·`from`·`to` 술어(원천별) · months 역산 · `rangeCapped` · `sends null` · `monthly` |
| `backend/src/routes/customers.ts` | `q`·`from`·`to`·`summary` 파싱·검증 |
| `backend/src/utils/__tests__/customer-timeline.test.ts` | 날짜 파싱·months 역산·LIKE 이스케이프 + 기존 |
| `backend/src/utils/__tests__/customer360-fold.test.ts` | 접기 순수 함수 계약(성공·실패 분리 · 10분 창 · 꼬리 규칙 · 상한) |
| `frontend/src/components/customer360/Customer360Modal.tsx` | 껍데기(z-[70] · 모바일 분기) |
| `frontend/src/components/customer360/Customer360Panel.tsx` | 조립만 |
| `frontend/src/components/customer360/useCustomerTimeline.ts` | 훅 1개: 조회·디바운스·reqSeq·페이지·오류 |
| `frontend/src/components/customer360/timeline-fold.ts` | 순수: 접기 · 날짜 묶기 · 하이라이트 분할(React 의존 0) |
| `frontend/src/components/customer360/c360-ui.ts` | 이 창 전용 리터럴(헤더 · 레일 · 행 격자 · 축선 · 배지 · 마진 없는 배너). `CUI_*`는 import해 쓰고 복제하지 않는다 |
| `frontend/src/components/customer360/Customer360Header.tsx` · `Customer360Rail.tsx` · `TimelineToolbar.tsx` · `TimelineList.tsx` · `TimelineStates.tsx` | 표시 조각(훅 0, props만) |
| `frontend/src/components/customer360/timeline-kinds.ts` | `timeLabel` 24시간제 · 기간 옵션 표 |

---

## 4) 접기 알고리즘 (순수 함수 계약)

```
foldRuns(events, { windowMs: 600000, minRun: 3, maxRun: 50, hasMore })
  입력은 정렬된 누적 배열(최신 먼저). 같은 날짜 묶음 안에서만 묶는다.
  key(e) = `${kind}|${ref?.id ?? title}|${status ?? ''}`
  run = 인접하면서 key가 같고, run 첫 사건과 다음 사건의 |at 차| <= windowMs 인 연속 구간
  run.length >= minRun → { type:'run', first, items, count, fromAt, toAt }  (maxRun 초과는 새 run)
  단, run이 배열 꼬리에 닿아 있고 hasMore 이면 접지 않는다(각 행 single)
  그 외 → { type:'single', event }
```

---

## 5) 게이트·테스트

- 백엔드: tsc 0 · `customer-timeline.test.ts`(기존 12 + 날짜·months·LIKE 이스케이프) · `customer360-fold.test.ts`(접기 5건).
- 프론트: tsc 0 · `build:safe` · 불변식 테스트(토큰·표면) 통과 · 모델명·native dialog·이모지·줄표 0 · 검출기 1회.
- 실측(Harold): ①테스트계정 법인폰 고객 열기 → 받은 메시지 4건, 2열, 막대 ②검색어 1개 입력 → 250ms 뒤 자동 조회, 제목 강조 ③기간 "전체" → "발송은 최근 24개월까지" 안내 ④발송 500건 이상 고객에서 검색어 + 전체 기간 응답 2초 이내(넘으면 기간 강제 조항을 켠다) ⑤"더 보기" 뒤 접힌 건수가 사후에 변하지 않는다 ⑥375px에서 가로 스크롤 0.
- Codex: 조회 전용 + DDL 0 → 대상 제외(`feedback_codex_scope_write_path_or_ddl_only`).

---

## 6) 회의록 요약 (2라운드 수렴)

| 쟁점 | 1차 갈림 | 수렴 |
|---|---|---|
| 부모 톤 충돌 | 별도 토큰 전면 소유(정보 구조) vs CUI 재사용(프론트) | 껍데기 6값 부모 리터럴 + 내부 CUI 재사용 + 전용 리터럴만 `c360-ui.ts` |
| 접기 위치 | 서버 `groupKey`(시각) vs 클라(프론트) | 클라. 커서가 원행 기준이라 서버 접기 불가. 꼬리 규칙으로 경계 결함 종결 |
| 종류 칩 | 5 + 더 메뉴(시각) / 4 + 그 외(프론트) / 9 한 줄(정보 구조) | 9 한 줄, 2행 툴바. 메뉴는 2클릭 + `CUI_MENU` transform |
| 요약 칸 | 폐기 + 0 미렌더(정보 구조) vs 4칸 유지 | 4칸 유지, 레일 2x2, 0은 색만 내림 + 설명 줄 |
| 검색 시 기간 강제 | 90일 강제(시각·정보 구조) vs 없음(프론트) | 없음. 인덱스 적용 후 LIKE는 그 고객 행에만 걸린다. 실측 게이트 ④ |
| 레일 폭 | 300(정보 구조) vs 320 | 320(값 영역 180px 계산) |
| 헤더 높이 | 64 / 72 / 80 | 80(부모 실측) |
| 시각 열 | 우측 38/44 vs 좌측 52 | 좌측 52(세로 기준선 + 낭독 순서) |

**확인된 사실 오류 정정**: "본문 LIKE는 인덱스를 못 탄다 84만 행 20초"는 인덱스 이전 수치(1-5). "`?customer=` 진입에서 레일이 빈다"는 코드상 거짓 — 비는 것은 `fallbackName`뿐(부모가 `selectedRow`를 안 채움) → 이름 자리를 스켈레톤으로.

---

## 7) 상태·잔여

- 2026-08-22 설계 승인(Harold "모달 맘에 든다, 제대로 하자") → **같은 세션에 구현 완료 → 같은 날 배포완료(Harold).** 남은 것 = §5 실측 ①~⑥.
  - 백엔드: `customer-timeline.ts`(`SourceFilter` 술어 12원천 · `likePattern`·`kstDateToIso`·`minIso`·`monthsBack` · `rangeCapped` · `sends null` · `basis`·`monthly`(월별 GROUP BY, 추가 쿼리 0)) · `routes/customers.ts`(`q`·`from`·`to`·`summary=0`).
  - 프론트: `customer360/` 11파일 — `c360-ui.ts`(전용 리터럴) · `timeline-fold.ts`·`timeline-query.ts`(순수) · `useCustomerTimeline.ts`(훅 1개) · `Customer360Header`·`Rail`·`TimelineToolbar`·`TimelineList`·`TimelineStates`(훅 0) · `Panel`(조립) · `Modal`(껍데기 z-[70]·모바일). `timeline-kinds.ts` 24시간제 + `STATUS_PILL`·`STATUS_SR`. 부모 `CustomerDBModal` 무접촉.
  - 게이트 결과: 백엔드 tsc 0 · 프론트 tsc 0 · vitest **190파일 2,911건 통과**(`customer-timeline.test.ts` 18 + `customer360-fold.test.ts` 8 포함) · 프론트 `build:safe` 성공 · 검출기(impeccable detect) 지적 0 · 모델명·native dialog·화면 이모지·줄표 0 · `disabled:opacity`·`text-white/N` 사용 0 · 클래스 동적 조립 0.
  - 구현 중 정정 2건: ①`buildCustomerTimeline`의 지역 변수 `toIso`가 모듈 헬퍼 `toIso`를 가려 tsc가 잡았다(`toLimitIso`로) ②첫 로드 판정을 `events.length`가 아니라 `hasSummary`(요약 보유 여부)로 — 같은 창에서 고객이 바뀔 때 옛 목록 길이로 판정하면 스켈레톤 대신 빈 상태가 잠깐 비친다.
  - 남은 것 = **§5 실측 ①~⑥(Harold)**. 특히 ④ 검색 성능(500건+ 고객 · 검색어 + 전체 기간 2초)과 2열 첫인상.
- 별건 정리(2026-08-22 Harold 동의): 부모 `CustomerDBModal.tsx` **2줄만** 반영 — 선택 행 `emerald-50` → `indigo-50`(638) · 박스 `max-w-full`(446, 375px 넘침). 로직·나머지 톤 무변경. 남은 별건 = `onOpenCampaign` 배선(연결 시 발송 결과 창 z 티어 확인 필요: ResultsModal 상세가 `z-[70]`) → 다음 축.
- 2단계: `kindCounts` · `summary.recent` · `matched` · 스니펫 · AI 한 줄 요약(1차 §3-6).
