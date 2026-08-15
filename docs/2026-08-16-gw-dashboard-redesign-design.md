# 게이트웨이 대시보드 — 구성 개편 + 확정 결함 3건 작업 지시서

> 2026-08-16 작성. **다음 세션의 착수 원장** — 완료 후 이 문서는 삭제하고 결과는 허브 §7-2·그쪽 STATUS로.
> 소스 = `C:\Users\ceo\projects\bito-gateway` (git · main `005e979`). 배포 = `status/DEPLOY-RUNBOOK.md` §3-1(api)·§3-2(dashboard).
> 검증 게이트 = `bash scripts/gw/check.sh` → `GW_CHECK_OK` + 대시보드 계약 테스트(`npm run test:*` 12종).

## 0. Harold 지시 원문과 이번 세션의 실패

Harold 지시 = **"색깔놀이가 아니라 전체 디자인 구성 자체를 손보라"**. 직전 세션(0815~16)은 토큰 통일·다크→라이트 전환까지만 했고 **화면 구성(레이아웃·컴포넌트 형태)은 손대지 않았다.** 이번 세션의 본론은 §2다. §1은 그 전에 닫아야 할 확정 결함.

**직전 세션이 만들어 둔 것(재사용, 재작업 금지)** — `src/tokens.css`(토큰 단일 소유) · `src/components/console.css`(gw-* 클래스) · `src/components/charts.jsx`(SVG 차트) · `src/pages/ConsolePage.jsx`(관제) · `theme.js`(토큰 참조로 재작성됨, 키 이름 불변) · Pretendard 자체 호스팅(`public/fonts/`).

---

## 1. 확정 결함 3건 (코드 좌표 실측 완료 — 커밋 단위 분리)

### 1-1. 「가동 중」 칩이 안 보인다 — 다크 잔재 rgba + 알파 테두리색을 글자색으로

`web/dashboard/src/App.jsx:253-265` `statusBadge`:

```js
border: … 'rgba(125, 231, 192, 0.44)' …
background: active ? 'rgba(12, 84, 61, 0.55)' : 'rgba(127, 29, 29, 0.42)',   // 다크용 짙은 채움
color: active ? 'var(--gw-ok-line)' : 'var(--gw-fail-line)',                  // 30% 알파 '테두리' 토큰을 글자색으로!
```

두 겹으로 깨졌다: ①배경이 다크 시절 짙은 rgba라 라이트 전환 스윕(hex만 치환)에서 빠졌고 ②`-line` 토큰(알파 30%)은 테두리 전용인데 전경으로 썼다. **처방** = `gw-chip--ok`/`--fail` 패턴과 동일하게 — 배경 `--gw-ok-wash`, 테두리 `--gw-ok-line`, 글자 `--gw-ok`. `dot()`(266행~)도 함께 확인.

**전수 grep 의무** — 같은 부류가 더 있다: `grep -rn "rgba(12, *84\|rgba(127, *29\|color:.*-line)" src --include=*.jsx --include=*.css`. `-line` 토큰이 `color:`에 쓰인 곳은 전부 결함이다(직전 세션이 `-wash` 전경만 잡고 `-line` 전경은 안 잡았다).

### 1-2. ★돈·신뢰 축 — 라인이 끊겨 대기 중인 발송이 "전송 성공"으로 표시된다

**증상 실측**(Harold 스크린샷): 젬텍단문-01 미접속 상태에서 상태 `SENDING`, 표준결과 **"SMS 전송 성공 raw - · cust 6"**. Harold 판단("대기중이 맞겠지?")이 **맞다** — provider write조차 없는 건이다.

**원인 = Go에서 0815(2)에 닫은 A 결함(빈 코드 fail-open)의 네 번째 복제본이 web/api SQL에 있다.**
`web/api/routes/admin-messages.js:234-245` (동일 블록이 `:439` 부근에 한 벌 더, `web/api/routes/public-messages.js:55` 부근·`:453` 부근에도):

```sql
LEFT JOIN standard_result_code src ON src.standard_code = COALESCE(
  prm.standard_code,
  CASE
    WHEN COALESCE(NULLIF(BTRIM(mr.report_code_raw),''), NULLIF(BTRIM(mr.ack_code_raw),''), '') IN ('', '0', …)
      -- ↑ report도 ack도 없으면 '' → 빈 문자열이 성공 목록에 걸려 SMS_0006_DELIVERED(cust 6)
```

**처방 원칙** (Go `internal/common/resultcode`와 동일 — "빈 값은 성공이 아니라 '모름'"):
1. **미종결 상태는 결과를 매기지 않는다.** `norm_status`가 `QUEUED`/`SENDING`(및 REPORT 전 단계)이면 표준결과 = **「대기중」** 뱃지(중립색). 성공 매핑 자체를 타지 않는다.
2. **빈 코드를 성공 목록에서 뺀다.** `IN ('', …)`의 `''` 제거. report/ack 둘 다 빈 종결 건은 「미분류」로.
3. 프론트 `ResultCodeStack`(`MessageHistoryPage.jsx:101-119`)은 `standard_result_code`가 없으면 raw 줄도 `raw -`로 노출하지 말 것(대기 중엔 의미 없는 소음).

**주의** — ①이 블록은 admin-messages 2곳 + public-messages 2곳, **전수 grep**: `grep -n "IN ('', '0'" web/api/routes/*.js` ②`DELIVERED`(ACK 수락)도 최종 성공이 아니다 — 표준결과 확정은 REPORT 이후(`DONE`/`FAILED`)만. `DELIVERED`·`REPORTED`는 「전달 중」으로 가르는 것까지가 정답이나, 최소 수정은 ①의 두 상태만이라도 막는 것 ③**web/api 수정 = 빌드 0, 런북 §3-1** ④이 축은 **조회 표시**라 Codex 의무 대상 아님(`codex_scope_write_path_or_ddl_only`) — 단 1-2는 결과 표시 신뢰 문제이므로 수정 후 실측 1건(라인 끊긴 상태의 발송이 「대기중」으로 보이는지) 필수.

### 1-3. 유형 뱃지 — 이름·줄바꿈·카카오 브랜드색

Harold 지시 3항:
1. **「브랜드톡(자유형)」 → 「브랜드(자유형)」** (기본형도 동일: 「브랜드(기본)」)
2. **줄바꿈은 어절 단위로** — 좁으면 「브랜드」 / 「(자유형)」 두 줄. 현재는 `브랜드톡(자` / `유형)`으로 글자 중간이 깨진다. 라벨을 두 토막으로 렌더하거나 `word-break: keep-all` + `<wbr>`.
3. **카카오 계열 뱃지 = 카카오 테마색** — 배경 카카오옐로(`#FEE500`), 글자 진갈색(`#371D1E`). 알림톡·친구톡·브랜드 전부. **상태색이 아니라 유형색이므로 tokens.css에 `--gw-kakao`/`--gw-on-kakao`로 등재** 후 참조(리터럴 금지). 대비 실측 확인: #371D1E on #FEE500 ≈ 10:1 — 통과.

**라벨 맵 전수 grep 의무** — `grep -rn "브랜드톡" src --include=*.jsx` 실측 = `MessageHistoryPage.jsx:26-27·49-50`, `PipelinePage.jsx:22-23·43`. 그 외 유형 라벨 맵(`TYPE_ROWS` 등 ConsolePage 포함)과 필터 select 옵션도 함께. **이름은 화면 라벨만 바꾼다 — API 값(`kakao_brand_free` 등)·필터 파라미터는 불변.**

---

## 2. 구성 개편 (본론 — 색이 아니라 형태)

> 원칙: **공통 패턴을 console.css의 `gw-*` 클래스로 정의하고 페이지가 그것을 쓰게 한다.** 페이지마다 인라인으로 다시 그리는 것(1,126곳 사태의 뿌리)을 반복하지 않는다. 신규 인라인 style 금지 — 필요한 모양이 없으면 console.css에 추가.

### 2-1. 상단 헤더 — 8개 아이템 클러스터 정리

현재(App.jsx 헤더): `가동중 칩 · API 칩 · 시계 · 새로고침 버튼 · 버전 · 사용자명 · 설정 · 로그아웃` 8개가 한 줄 나열. 정리안:
- **시스템 상태는 칩 하나로 합친다** — 정상이면 「● 정상」 하나(엔진+API 둘 다 OK일 때). 이상일 때만 갈라서 「엔진 정지」/「API 오류」. 정상 상태를 두 칩으로 상시 점유할 이유가 없다.
- 시계·버전은 **설정 드롭다운 안으로**. 운영자가 매초 볼 정보가 아니다.
- 새로고침은 아이콘 버튼으로 축소.
- 헤더 중앙의 페이지 제목(`pageKicker`+`pageHeaderTitle`)은 유지하되, **본문 상단의 페이지 제목과 중복되는 페이지는 본문 쪽을 제거**(제목이 두 번 보이는 화면 다수).

### 2-2. 페이지 헤더 패턴 통일 — `gw-page-head` 신설

지금은 페이지마다 제목 스타일·액션 위치가 제각각. `console.css`에 한 벌 정의: 좌측 제목+한 줄 설명, 우측 주요 액션(버튼 1~2개). 전 페이지가 이 클래스를 쓴다.

### 2-3. 검색·필터 패턴 — 카드 래핑 제거

발송 이력의 「검색 조건」처럼 필터가 제목 달린 카드로 포장돼 화면 1/4을 먹는다. **인라인 필터 바**(`gw-filter-bar`)로: 라벨은 placeholder 또는 필드 위 10px, 검색 버튼은 우측 끝, 높이 한 줄. 적용 대상 = 발송 이력 · 감사 로그 · 통계 · 과금 계열 등 목록형 전 페이지.

### 2-4. 테이블 패턴 — `gw-tbl` 확장

- **Trace ID를 두 줄 전체 노출하지 않는다** — 앞 8자 + 복사 아이콘(`f01952fd… ⧉`). 클릭 = 상세(현행 유지).
- **「보기」 버튼 열 제거** — 행 전체 클릭으로 상세 진입(이미 trace 클릭이 그 역할). 열 하나가 통째로 준다.
- 시간 포맷 통일: `08-15 23:10:58` (연도는 올해면 생략).
- 숫자·시각 열은 우측 정렬 + tabular-nums(gw-tbl `.n` 기존 규약).
- 행 밀도: 페이지당 20행 기준 스크롤 없이 더 보이게 상하 패딩 11px→8px.
- 상태·결과·유형은 전부 뱃지 규약(§1-3 포함)으로 — 페이지별 색 재정의 금지.

### 2-5. 사이드바
- 그룹 뱃지(숫자)는 **의미 있는 것만** — 「운영 6」처럼 메뉴 개수를 세는 뱃지는 정보가 아니다. 제거. 알림 수처럼 상태를 나르는 뱃지만 유지.
- 하단 고정 영역에 버전·사용자 이동(2-1과 연동).

### 2-6. 이식 순서 (한 커밋 = 한 패턴)
①`console.css`에 `gw-page-head`·`gw-filter-bar`·테이블 확장 정의 → ②발송 이력(스크린샷의 화면, 체감 최대) → ③감사 로그·통계 → ④과금·정산 → ⑤나머지. 각 단계마다 빌드+해당 계약 테스트. **한 세션에 다 못 하면 ②까지만 하고 끊는 것이 맞다** — 패턴이 서면 나머지는 기계적 이식.

---

## 3. 작업 순서·커밋 단위

| # | 커밋 | 범위 | 검증 |
|---|---|---|---|
| 1 | fix: 상태 칩 다크 잔재 (1-1) | App.jsx + `-line` 전경 전수 | 빌드 + 육안 |
| 2 | fix: 미종결 발송 표준결과 fail-open 폐쇄 (1-2) | admin-messages.js·public-messages.js 4곳 + ResultCodeStack | `npm test`(api) + **실측 1건** |
| 3 | feat: 유형 뱃지 개명·카카오 브랜드색 (1-3) | 라벨 맵 전수 + tokens.css `--gw-kakao` | 빌드 + 계약 테스트 |
| 4~ | feat: 구성 패턴 (2-1~2-5, 패턴당 1커밋) | console.css → 페이지 이식 | 빌드 + 계약 12종 |

배포 = api(§3-1, 커밋2)와 dashboard(§3-2, 나머지) 두 단위. **커밋 2가 끝나면 먼저 배포해도 된다** — 결과 표시 신뢰 문제라 구성 개편을 기다릴 이유가 없다.

## 4. 이 세션이 남긴 함정 (다음 세션 주의)

- **일괄 치환의 사각** — hex만 치환하면 rgba 리터럴이 남는다(1-1이 그 사례). 색 스윕은 `#hex`와 `rgba(` 둘 다.
- `-wash`는 채움 전용, `-line`은 테두리 전용. **전경(color)에는 본색 토큰만.**
- 계약 테스트가 메뉴 라벨을 고정한다(`test-remote-deploy`가 `label: '원격배포'` 문자열 매칭). 라벨을 바꾸려면 테스트가 계약인지 먼저 판단 — 직전 세션은 라벨을 되돌리는 쪽을 택했다.
- 정적 Pretendard 9종에 없는 `fontWeight: 450` 같은 값 금지(가변 폰트 로드 전 폴백에서 반올림).
- `statementExports.js`(거래명세서 출력)는 **인쇄물이라 라이트 유지** — 다크·토큰화 대상 아님.
