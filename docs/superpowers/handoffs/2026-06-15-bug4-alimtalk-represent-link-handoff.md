# 버그4 핸드오프 — 알림톡 대표링크(represent_link) 발송 동봉 (2026-06-15)

> **상태: OPEN.** 형식·메커니즘은 이미 확정됨. 인비토 에이전트의 `link` 처리 여부 **1가지**만 확인하면 구현 들어감.
> **다음 세션 규칙: 아래 "1. 이미 확정" 그대로 받아들이고 STEP 1부터 시작. 재조사/추측 금지.** (형식·QTmsg 커스텀필드는 공식문서로 확정 끝났다.)
> 상위 = `docs/superpowers/handoffs/2026-06-15-5-bug-fix-handoff.md`(발송/싱크/알림톡 5건 중 4건 완료·배포, 버그4만 잔존). 근원 = `status/lessons/LESSONS_BACKEND.md` 2026-06-11(강조형 7300 = 대표링크 미동봉) + D234+(0609 sendercode).

---

## 0. 한 줄 요약
알림톡 템플릿에 등록된 **대표링크**(말풍선 클릭 시 이동)를 발송 때 안 실어서, 카카오가 등록값 불일치로 거부(7300)했다. 한줄로는 `kakao_templates.represent_link`를 **저장만** 하고 발송 경로에서 소비 0건. → 발송 시 `k_etc_json`에 `link` 변수로 동봉해야 한다.

---

## 1. 이미 확정된 사실 (재조사 금지)

### 1-1. 강조형 ≠ 대표링크 (절대 혼동 금지)
- **강조형(title)** = `k_etc_json`의 `{"title":"..."}`. 0609 fix(에이전트 `qtmsg.xml` select_sql의 sendercode concat NULL 가드) 이후 **정상**. 다른 업체·우리 모두 잘 나간다. **강조형 자체는 문제 없음.**
- **7300이 난 건** 그 템플릿에 **대표링크까지 등록**돼 있는데 발송 때 안 실어서. 대표링크 없는 강조형은 성공한다. (0611 대조 SQL로 확정 — 성공 템플릿 vs 실패 템플릿의 차이 변수 = `represent_link` 유무.)

### 1-2. 대표링크 형식 (휴머스온 IMC 공식문서로 확정)
출처: 연동규약서 v20251031(IMC TCP/IP) + IMC-Agent 메뉴얼 v2.3.1 (6.4.2.1 구조 / 6.4.2.2 필드정의 / 5.1.4 대표링크).
- 대표링크 = **ATTACHMENT_JSON 최상위 `link` 객체** (attachment/supplement와 형제). "말풍선 클릭 시 이동, 모바일/PC/iOS/안드로이드 지원, 웹링크(WL)/앱링크(AL) 버튼과 동일 기준, 고정링크(전체변수 불가)".
- 키는 **snake_case**:
  ```json
  { "link": { "url_mobile": "...", "url_pc": "...", "scheme_ios": "...", "scheme_android": "..." } }
  ```
- 한줄로 저장값 `kakao_templates.represent_link`(jsonb) = **camelCase** `{ urlMobile, urlPc, schemeIos, schemeAndroid }` (프론트 AlimtalkTemplateFormV2.tsx 저장). → **camel→snake 매핑만** 하면 됨.
- 옛 추정 정정: 5건 핸드오프의 `attachment_link`(래퍼명 틀림 → `link`가 맞음) / LESSONS의 camelCase·scheme 누락(틀림 → snake_case + scheme_ios/scheme_android 포함).

### 1-3. QTmsg 커스텀 필드 = `k_etc_json` (확장 json 변수) — Harold 지적으로 확정
- QTmsg 매뉴얼 ver4.0 p.196~206: `k_etc_json`은 **json 변수를 추가하는 확장 필드**. senderkey·sendercode는 "예시"일 뿐, 그 자리에 필요한 json 변수를 더 넣는 게 기본 사용법. → 대표링크도 같은 방식으로 `k_etc_json`에 `{"link":{...}}` 변수로 넣는다. ("k_etc_json은 senderkey/sendercode 전용"은 틀린 단정이었음 — 정정 완료.)
- QTmsg 알림톡 필드: `K_template_code` / `K_next_type` / `K_next_contents` / `K_button_json`(버튼 전용 — type 1배송조회·2웹링크·4봇키워드·5메시지전달, 최대 5) / `k_etc_json`(확장 변수). 별도 "대표링크 컬럼"은 없음 — 대표링크는 k_etc_json 변수로 가야 함.
- 0609 select_sql: `concat('{"sendercode":"', sender_code, '",', replace(k_etc_json,'{',''))` — **k_etc_json 내용을 sendercode와 합쳐 그대로 통과**시킨다. → `{"title":..,"link":{...}}`를 넣으면 합쳐진 JSON에 link가 실려 IMC 단으로 흘러갈 가능성이 높다(아래 STEP 1에서 확정).

---

## 2. 남은 단 하나의 미확인 (STEP 1에서 끝낼 것)
**인비토 커스텀 에이전트가 `k_etc_json`의 `link` 변수를 IMC ATTACHMENT의 link로 넘기는가?**
- **넘김(일반 통과)** → 한줄로가 k_etc_json에 link 넣으면 바로 됨 → STEP 2 즉시 구현.
- **안 넘김(알려진 변수만 매핑)** → 서팀장이 에이전트/엔진에 link 매핑 추가 필요(한줄로 단독 불가) → 추가 후 STEP 2.

---

## 3. STEP 1 — 확정 (둘 중 하나, 서버/Harold)
1. **(가장 빠름) 에이전트 설정 확인**: `agent1~11/conf/qtmsg.xml`의 알림톡 select_sql / `k_etc_json`→IMC 매핑을 본다. link 처리(또는 k_etc_json 일반 통과)가 있으면 그대로 통과된다.
2. **1건 실측**: 대표링크 등록된 템플릿에 `k_etc_json = {"title":"...","link":{"url_mobile":"...","url_pc":"..."}}` 넣고 테스트 1건 발송 → `SMSQ_SEND_X_YYYYMM`에서 `status_code` 확인(**1800 성공** / 7300 실패).
3. (옵션) 대표링크 등록 템플릿을 성공 발송하는 업체가 있으면 그 발송 행 `k_etc_json`을 본다 — 어떻게 싣는지 그대로 베낀다.

---

## 4. STEP 2 — 구현 (STEP 1이 "통과 OK"일 때 / 또는 서팀장 매핑 추가 후)

### 4-1. 코어 (`utils/alimtalk-emphasize.ts`)
- `buildAlimtalkEtcJson` 확장: 현재 `{ emphasizeTitle, substitute }` → `{title}` 생성. **`representLink` 인자 추가** → `{ title?, link?: {url_mobile,url_pc,scheme_ios,scheme_android} }`. (title 없고 link만 있으면 `{link}`, 둘 다 없으면 `undefined`.)
- represent_link **camelCase→snake_case 변환 순수 헬퍼** 추가(urlMobile→url_mobile 등, 값 없는 키는 생략).
- `__tests__/alimtalk-emphasize.verify.ts` 갱신(link 포함/title만/link만/둘다없음 케이스).

### 4-2. 5개 발송 경로 — 각 경로가 그 템플릿의 `represent_link`를 조회해 buildAlimtalkEtcJson에 전달
`buildAlimtalkEtcJson` 호출부(grep으로 재확인, 대략):
- `routes/campaigns.ts` — commit(≈1367, `g.temphasize_title` 등 템플릿 정보 조회 중), 즉시(≈2027)
- `utils/auto-campaign-worker.ts` (≈981)
- `utils/direct-send-processor.ts` (≈231 — staging: commit이 저장한 값 재사용)
- `utils/journey-executor.ts` (≈740)
- ★ `represent_link`는 `kakao_templates`에 있음. 각 경로가 템플릿을 어떻게 조회하는지 본 뒤 SELECT에 `represent_link` 추가 → buildAlimtalkEtcJson에 전달. **full_pattern_grep: 호출부 5곳 전수 + 각 호출부 템플릿 조회 SQL.**

### 4-3. 주의
- **강조형 없이 대표링크만 있는 템플릿도 처리** (title 없어도 link 동봉).
- `k_etc_json` varchar(1024) 한도 — link URL 4개(각 최대 1000자 스펙)이나 실제 짧음. 길이 가드 1줄.
- **0609 교훈**: k_etc_json에 에이전트가 모르는 키를 넣으면 etcJson 전체가 깨져 강조 title까지 소실(7300). → 반드시 STEP 1에서 link 통과 확인 후에만 구현.
- 발송·돈 닿는 변경 = dev_process 6원칙: 실측 1건 시나리오 + 효과 검증(status_code 1800) + 수정 전 승인.

---

## 5. 참고 자료
- 휴머스온 IMC 문서 텍스트 추출: `C:\Users\ceo\Downloads\_spec.txt`(연동규약서) · `_manual.txt`(IMC-Agent v2.3.1) · `_qtmsg.txt`(QTmsg ver4.0). 원본 PDF = Harold 다운로드/바탕화면(자체게이트웨이 폴더). 추출 스크립트 `_extract_pdf.py`(pdfplumber, pdftoppm 부재 대응).
- `status/lessons/LESSONS_BACKEND.md`: 2026-06-11(대표링크 미동봉 근본) + D234+(0609 sendercode concat).
- `docs/superpowers/handoffs/2026-06-09-alimtalk-emphasize-7300-imc-handoff.md` (0609 분기 — qtmsg.xml select_sql 원문).
- 메모리 `project_2026_0615_campaign_bito_5bugs.md` 버그4 항목.
- 부록(별건): 결과코드 xlsx + 메뉴얼 6.2 에러코드표 → `utils/sms-result-map.ts STATUS_CODE_MAP`(특히 7xxx 카카오) 공식값 대조·보정 후보.

---

## 6. 다음 세션 첫 행동 (요약)
1. 본 문서 1번(확정 사실) 그대로 수용 — 재조사 X.
2. STEP 1: Harold께 `agent1~11/conf/qtmsg.xml` 알림톡 select_sql / k_etc_json→IMC 매핑 요청 (또는 1건 실측 결과).
3. link 통과 OK → STEP 2 구현(4-1 코어 + 4-2 5경로). link 미통과 → 서팀장 에이전트 매핑 추가 대기.
