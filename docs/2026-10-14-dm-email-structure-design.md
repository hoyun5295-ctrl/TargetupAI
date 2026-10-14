# 모바일 DM · 이메일 마케팅 「결함이 반복되지 않는 구조」 설계서 (2026-10-14)

> 접수 = 임은지 1014 「모바일디엠 참여이벤트 설문」 2건(①선택지 줄바꿈 안 됨 ②완료 보상 문구 안 뜸).
> Harold 지시(1014) = "비토 구조체크로 결함이 지속되지 않도록 뿌리를 뽑자 · 구조체크 뒤 브레인스토밍 허용 · 그 안으로 설계서 쓰고 끝까지 구현해 Codex 리뷰까지".
> 절차 = 구조체크 보고서(scratchpad `structure-check-dm-email-1014.html` · R1~R12 · 편집기 속성 183 전수 대조표) → 브레인스토밍(기획·프론트엔드·백엔드·디자이너·회의론자) 1차 → 교차 토론 1R → 회의론자 최종 검증 → 주재자 수렴 → Harold 승인(1014).

## 0. 넘을 수 없는 것
- 기존 캠페인 출력 무회귀: 미지정 값 = 현행 출력 한 글자도 안 바뀜(계약 테스트 전통). 바뀌는 것은 「값을 넣은 행」뿐이고 그것이 접수 수정 자체다.
- 이메일 광고 footer·수신거부·`<img>` 규칙 불변. DDL 0(새 값은 jsonb 키 안). 고객 노출 문구에 내부 용어·모델명 0. native dialog 0.
- 프론트 테스트 러너 없음 → backend vitest가 프론트 소스를 읽어 검사한다(`m4-editor-label-gate` 전통).
- 서버 뜻 변경(수량·만료·필수·동의 강제·섹션 타입 서버 결정)은 이번 축 밖(§6 B2) + Codex.

## 1. 뿌리(구조체크 결론)
- R1 DM 속성 계약표 = 접수 뒤 손 등재 → 등재된 것만 보호. 편집기 속성 183 중 150(82%)이 DM 계약표 밖. 이메일은 0916 `email-editor-coverage.test.ts`가 기계 파생으로 뒤집었으나 DM에는 없다.
- R2 참여 8블록 완료 문구 장치가 셋(`data-success-text` / `data-claim-success` / 고정 문구) + 고정 문구 4곳 → 0722 이메일수집 수정이 설문에 안 퍼짐(접수 ②).
- R6 발행된 DM은 자동 저장이 막혀(0714 라이브 보호) 「편집기·무저장 미리보기 ≠ 라이브」 → 접수 ②의 단말 캡처에 정적 줄조차 없던 경로.
- 기본값 어긋남 3건: 설문·클릭 리워드 `show_progress ?? true`(편집기) vs 렌더러 참일 때만 · 이메일수집 `consent_required ?? true` vs SSR·서버 `=== true`.
- 1인 1회 토글(투표·룰렛)은 서버가 읽지 않는 장식(늘 UNIQUE). 서버는 클라이언트 `section_type`을 신뢰. 선착순 수량 미차감 · 즉시쿠폰 만료 무시 · 설문 필수 서버 미검증(R3).
- 이메일 지원 타입 목록 사본 4벌(렌더러 whitelist = 진실 · 편집기 상수 2벌 · AI 프롬프트 · 개인화 표). DM `%변수%` 치환표에 참여 블록 0.
- 참여 블록 목록이 코드에 세 벌(6·7·8).

## 2. 결정(이번 묶음 A1~A6)

### A1. DM 커버리지 테스트 = 이메일 커버리지(0916) 이식 + 보강
| 항목 | 결정 |
|---|---|
| 추출기 | `backend/src/utils/dm/__tests__/editor-keys.ts` `extractEditorKeys(src)` · **TS 구문 트리**(`ts.createSourceFile` · typescript ^5.9.3 보유). 수집 = `onUpdate({…})` 최상위 키 · `onAdd` 기본 객체 키 · 항목 세터(정의가 `(i: number, patch)` 모양인 함수 전부 · 고정 6종 X)의 patch 키. 축약 `{ ...o, label }`은 키 `label`. 계산 키 `[k]`·식별자 전개·비객체 인자 = 즉시 실패. `PollEditor.tsx` `setItem(i, v)` → `setItem(i, { label: v })`. 추출기는 fixture 소스로 고정 · 전체 개수 하한 183. 이메일 커버리지 `editorProps`도 이 함수로 교체 |
| 판정 | `dm/__tests__/dm-editor-coverage.test.ts` · 섹션마다 `renderSection(SECTION_DEFAULTS[type] + 항목 1 + [prop]=탐침)`를 `TREATMENTS[type]` 전 구도로 돌려 기본 출력과 달라야 통과(행동 탐침 · 구도별 함수 분기 = 0904 CTA ghost 재발 차단) · 기본 렌더 '' = 실패 · 탐침 = 기본값 타입 파생(boolean 반전 · number +7 · `*_color` · `*url` · 문자열 '탐침_'+prop) · 열거형·구도 문맥만 `DM_PROBE_CONTEXT` 표(빠지면 실패) · 문자열 탐침은 태그·`data-*` 걷어낸 가시 텍스트 안에 있어야 통과 · 섹션당 it 1(누락 목록 일괄) |
| 캔버스 | 컴포넌트 함수 본문 이름 대조(근사)라고 원장에 명기(React 렌더 불가) |
| 이메일 | 같은 탐침으로 `renderEmailSections` 행동판 1개(지원 12타입) |
| 예외 원장 | `dm-property-contract.ts` `DM_PROP_EXEMPT {section, prop, surface:'ssr'\|'canvas'\|'email'\|'viewer', kind:'server'\|'viewer'\|'n/a'\|'removed', why(20자+ · "아직 안 했다" 금지), reader?}` · `DM_REMOVED_DEAD_CONTROLS` 흡수 · kind=server는 `reader` 함수 본문에 `.prop` 실재(파일 전체 스캔 X · 룰렛 `probability` → `runRouletteDraw`) · 편집기에서 사라진 prop 행 = 실패 · removed = 편집기·SECTION_DEFAULTS 잔존 0 |
| 규칙 이름 걸림 | `DM_SERVER_RULES` + `DM_SERVER_RULES_PENDING_MAX`(현재 개수로 고정 · 줄기만). 이름 = `one_*` · `required` · `quantity` · `expires*` · `probability` · `*_count` · `consent_*` → kind=server + reader 실재로만 통과, 못 대면 pending 목록 |
| 미검토 래칫 | `DM_PROP_UNREVIEWED_MAX`(첫 실행 빨강 수 N 고정 · 줄기만 · kind 4종 밖 금지) |
| 기본값 검사 | 편집기 `props.X ?? D` 추출 → "미지정 렌더 = D 렌더". 지금 3건 수정 = 설문·클릭 리워드 `show_progress ?? false` · 이메일수집 `consent_required ?? false`(표시만 사실대로 · 동의 강제 정책은 §6 B2) |
| 타입 미러 | backend registry ↔ frontend defaults 27타입 키·기본값 동일 1 it(지금 4키 어긋남 정리: 즉시쿠폰·탭카드 버튼색) |

### A2. 참여 8블록 완료 문구 = 장치 하나(접수 ②의 뿌리)
- 대상 = `PARTICIPATION_TYPES`(8종 · `dm-section-registry.ts` 소유) · 프론트 미러 상수 · 백엔드 테스트가 "렌더러 `data-dm-result` 8종 = 상수" 대조.
- 키 = `success_text` 하나(정적 · 8블록 공용 칸이 씀). 설문 `completion_reward_text`는 「제출 전 안내 (선택)」 칸으로 유지(정적 줄 1190 그대로) · 완료 문구 읽기 = `doneTextOf(type, p) = p.success_text || (survey ? p.completion_reward_text : '')` → 옛 설문 보상 문구가 재입력 없이 완료 문구로(접수 ② 종결). 이메일수집 기존 칸은 공용 칸으로 이동(키 동일).
  - 갈림 → 택: `success_text` 단일(기획·프론트·백엔드 2R) vs 블록별 맵 쓰기(디자이너·회의론자). 이유 = 새 키 0 · 동적 키 0 · 두 칸은 뜻이 다르므로 비운 칸의 `??` 문제 없음.
- 마커 = 기존 `data-success-text` · 자리 = `renderSection` 래퍼 한 곳(참여 타입 + 값 있을 때만 · 미지정 = 바이트 불변). 이메일수집 안쪽 속성(1205)은 제거 · 계약 상수(`DM_WIRED_ORPHAN_MARKERS.email_success_text`)·테스트는 같은 변경에서 래퍼 출력으로(옛·새 공존 X). 이메일수집 기존 행은 속성 위치만 이동(보이는 출력 동일 · 바이트 변경은 §5에 기록).
- 뷰어 = `wrapInfo`가 래퍼에서 `done`을 함께 돌려주고 `doneText(info, fallback)` 하나가 8 핸들러에 쓰인다. 상태 표: **완료 = 회사 문구 있으면 그 문구(없으면 현행 고정 문구 · 바이트 동일) · 당첨·이미 참여 = 현행 문구 + 둘째 줄 회사 문구 · 꽝·입력 검증·오류·수신자 전용·마감 = 불변**. 회사 문구 = textContent + `white-space:pre-line`. 즉시쿠폰 = 회사 문구 있으면 `usage_instructions` 합성 문구 대체(두 번 노출 X). 룰렛 = 당첨 때만.
- 받는 사람 화면 모양 = showMsg 유지(글자·style 불변). 디자이너 「상자·회색 통일」은 미지정 캠페인 출력도 바꾸므로 §6 C(Harold 승인).
- 편집기 = `<DoneTextField>` 한 곳(`SectionPropsEditor` 분기 뒤 · 8종만 · 선착순 `signup_url` 있으면 숨김) · 라벨 「완료 문구 (선택)」(룰렛 「당첨 시 안내 문구 (선택)」) · 힌트 「참여가 끝나면 버튼 아래에 떠요 · 비우면 '{기본 문구}'」 · placeholder 「예: 매장 카운터에 이 화면을 보여주세요」 · 변수 칩 없는 TextArea.
- 변수 치환 = `dm-variable-resolver` 표에 8종 `success_text`(+설문 `completion_reward_text`) 등재(변수 없으면 출력 불변 · 69행 판정).
- 팔레트 설명 「실시간 결과 %」 → 「질문 + 선택지 · 1인 1회」.
- 테스트 = `dm/__tests__/dm-participation-viewer.test.ts`(뷰어 참여 블록을 표식으로 잘라 가짜 DOM·fetch로 8타입 실제 클릭 · 회사 문구/미지정 현행 문구 단정 · `doneText` 빼는 회귀 주입) · 파리티 루프 8종(지정 = 래퍼 마커 · 비움 = 없음).

### A3. 설문 선택지 줄바꿈(접수 ①)
- `FormControls.tsx` `LineListInput`(초안 문자열 자기 state · 바깥 값이 「초안 정리 결과」와 다를 때만 초안 교체 · 쓰기 = `toLines` 한 곳 · 줄 끝 공백 보존 → "매우 만족" 결함 함께 종결) · `key={q.id}` · placeholder 「선택지를 한 줄에 하나씩 (Enter = 다음 줄)」 · 힌트 「빈 줄은 빠져요」 · `SurveyEditor.tsx:48` 토글 배치 결함 수정.
- 게이트 = 편집기 `onChange` 안 `split('\n')…filter` 0건(LineListInput 밖) 소스 스캔.
- 갈림(RepeatableList / 줄마다 칸) → 택 = textarea 초안 state(접수자 기대 동작 · 한글 조합 Enter 위험 0 · 저장 모양 불변).

### A4. 발행본 편집 1단계 가드(⑧ 0단계 · 저장 구조 불변)
- `save()` 실제 저장 여부 boolean 반환 · `DmEditScreen` 스냅샷 오기록(silent 저장 막혀도 「남겼어요」) 차단 · [테스트] 확인창([반영하고 테스트] / [수정 전 화면으로 테스트] · 기존 [보내기] 패턴) · 나가기 창 [저장하고 나가기] · 셀렉터 하나(`liveGap` = 발행 · 수정 있음 · 중지 아님)가 세 곳 문구(DmEditScreen 머리 「보낸 DM · 받는 사람은 아직 고치기 전 화면이에요」 + [반영] · 휴대폰 위 띠 「이 휴대폰은 수정본이에요 · 받는 사람에게는 아직 안 보여요」 · DmTopBar).
- 소스 스캔 테스트: 확인창 처리기는 `save()` 외 다른 쓰기를 부르지 않는다.
- ⑧ 본체(두 상태) = §6 B1 · 착수 조건 5.

### A5. 이메일 사본 묶기(테스트만)
- `EMAIL_BLOCK_WHITELIST`(`email-blocks.ts`) = 유일 진실. registry `channels` 축 X.
- `email/__tests__/email-block-copies.test.ts`: AI 프롬프트 `^- (\w+):` 집합 == `EMAIL_AI_BLOCK_TYPES`(같은 파일 상수) ⊆ 화이트리스트 · FE `make-flow.ts` 사본 == 화이트리스트 · `EmailVisualEditor.tsx`는 make-flow 값을 import(사본 1벌).

### A6. 문서·등재
- 기능 문서 신설 `docs/FEATURE-DM-EMAIL-BUILDER.md`(계약·예외 원장·래칫·완료 문구 규약 소유) + `status/SOT-INDEX.md` 등재.
- BUGS 등재(기록만): 발행본 저장 라우트 게이트 없음(`routes/dm.ts` PUT /:id) · 버전 복원 게이트 없음 · `version_number` MAX+1 비원자 · 즉시쿠폰·선착순이 참여형 발행비 목록 밖 · R3 항목(선착순 수량 · 즉시쿠폰 만료 · 설문 필수 · 섹션 타입 서버 결정 · 동의 기본값) · 1인 1회 토글 장식.

### A7. 회의론자 최종 검증 반영(같은 묶음에 넣는 막은 형태)
- 동적 키 걸림쇠 대상 = `onUpdate` 첫 인자 객체의 최상위 속성 + 세터 호출부 둘째 인자 객체 두 곳뿐. 세터 = "본문의 `onUpdate` 안에서 둘째 인자를 전개하는 함수"로 판정(removeBtn·removeCh 같은 삭제 함수는 세터 아님 · 세터 본문·배열 전개는 대상 아님).
- 개수 하한 = 새 추출기 첫 실측값(근사 183이 아님) · 규칙은 fixture로 고정.
- 래칫 = 이름 목록 + 길이 상한(개수만 X · 목록 항목이 통과하게 되면 실패시켜 목록에서 빼게).
- 가시 텍스트 규칙의 거짓 실패: 값이 `data-*`로만 나가고 뷰어가 그 속성 이름을 읽으면 kind=viewer 자동 판정(참여 8종 `success_text` · 룰렛 `segments[].label` · 투표 `options[].id`).
- 공통 칸 사각: 추출 입력에 "공통 칸 키 × PARTICIPATION_TYPES"를 합친다(`<DoneTextField>`는 편집기 파일 밖).
- removed 잔존 0: `show_result_after_vote` · `enable_user_location` · `auto_slide` · `slide_interval_ms`를 두 기본값 표·타입에서 같은 변경에 삭제(렌더러 미독 · 출력 불변).
- 기본값 검사의 "미지정" = 그 키를 지운 바탕으로 렌더(SECTION_DEFAULTS에 `show_progress:true`가 이미 있음).
- 룰렛 이미 참여 분기 불변(남는 사람 = 꽝 손님) · 둘째 줄은 당첨 분기만.
- 뷰어 둘째 줄 = 소스에 `'\\n'`(TS 템플릿 문자열 안) · 하네스는 `renderDmViewerHtml` 출력에서 잘라 실행.
- 설문 문항 key = `q.id ?? i`(렌더러 `q.id || qi` 선례).
- 중지된 DM: 저장 안내는 `autosaveBlocked` 셀렉터(= save() 차단 조건 · 중지 포함)를 보고, `liveGap`은 문구 뜻에만.
- 발행된 룰렛·추첨 섹션이 바뀐 상태의 [저장]·[반영하고 테스트] 확인창에 "경품 재고는 반영되지 않아요" 한 줄(쓰기 경로 불변 · 실제 동기화 = ⑧ [반영] 첫 항목).
- A5: 프롬프트 상수 export(또는 파일 읽기) · 정규식 m 플래그.
- 기능 문서에 "원장이 지키는 것은 소비까지(실제 보임은 접수 회사 킷 fixture 방식)" 명기.
- [범위 밖] BUGS 등재: 영업 생성기가 제거된 `auto_slide`를 계속 실음(`sales-outreach-slices.ts`) · 테스트 발송이 라이브 링크라 직원 참여가 재고·1인 1회·열람 수를 씀 · 설문 선택지 빈 값 거르기 없음(렌더러 1175).

## 3. 영향표(수정 전 전수)
| 대상 | 소비처 | 영향 |
|---|---|---|
| `renderSection` 래퍼(마커 추가) | 뷰어 `wrapInfo` · 파리티 테스트 · 캔버스(래퍼 미사용) | 참여 타입 + 값 있을 때만 속성 1개 · 그 밖 바이트 동일 |
| `renderEmailCapture` 1205 속성 제거 | 뷰어 807(→ wrapInfo로 이동) · contract:94 · parity 253-262 | 속성 위치 이동 · 테스트 갱신 |
| 뷰어 성공 분기 8곳 | 받는 사람 화면 | 회사 문구 없으면 문자열 동일 |
| `dm-variable-resolver STRING_FIELD_KEYS` | 뷰어 개인화 | 변수 없으면 출력 불변 |
| `SurveyEditor`·`EmailCaptureEditor`·`ClickRewardsEditor`·`PollEditor`·`SectionPropsEditor`·`FormControls`·`dm-section-defaults` | DM 빌더 · 이메일 편집기(공용 패널) | 표시·입력만 · 저장 모양 불변 |
| 타입(`SurveyProps` 등 6종에 `success_text?`) | registry · defaults · dm-ai 허용 목록(`success_text` 이미 앎) | 선택 키 추가 |
| `dmBuilderStore.save` 반환형 | DmBuilderPage · DmEditScreen · DmTopBar | 호출부는 반환 무시 가능 · 스냅샷 분기만 반환 사용 |
| `email-blocks.ts` 상수 추가 · `make-flow.ts` 사본 · `EmailVisualEditor` import | 이메일 편집기 팔레트 | 값 동일 |

## 4. 구현 순서(단독·순차)
1. 백엔드 CT·원장(registry `PARTICIPATION_TYPES` · renderer `doneTextOf`+래퍼 · 1205 제거 · viewer `wrapInfo`/`doneText`/8분기 · resolver 표 · contract 표들 · email-blocks 상수) → 2. 테스트(추출기 + fixture · 커버리지 · 뷰어 하네스 · 사본 묶기 · S1 게이트 · A4 스캔 · 타입 미러) → 3. 프론트(FormControls · 편집기 5 · SectionPropsEditor · defaults · store/Page/EditScreen/TopBar · EmailVisualEditor) → 4. tsc 0(두 패키지) · 백엔드 전체 스위트 → 5. 자가 적대 검토 → Codex 적대 검토(Harold 지시) → 6. 문서(기능 문서 · SOT-INDEX · BUGS · STATUS · LESSONS) → tp-push 인계.

## 5. 바뀌는 출력(무회귀 예외 · 전부 "값을 넣은 행")
- 설문에 `completion_reward_text`가 있는 행: 제출 성공 문구가 고정 문구 → 그 문구(접수 수정).
- 이메일수집에 `success_text`가 있는 행: `data-success-text` 속성이 폼 → 래퍼로 이동(보이는 화면 동일).
- 편집기 토글 표시 3건: 키 없는 옛 섹션이 편집기에서 「켜짐」 → 「꺼짐」(발행물은 원래 꺼져 있었다).

## 6. 다음 축(기록)
- B1 ⑧ 본체: 초안 = `dm_versions` `version_number=0` 예약 1행 UPDATE(advisory lock · 목록·복원 제외 · snapshot 컬럼 없으면 503 분기로 꺼짐) · [반영] = 발행 코어 경로(게이트 + 경품 동기화 · 크레딧 0 · `restoreDmVersion` 재사용 X) · 착수 조건 5 = 응답 있는 참여 섹션 id 변경 차단 · 초안 링크 추적·참여 끔(noindex·서명 만료) · 중지분 재개 시 초안 비노출 · 미반영 초안 + [보내기] 경고 · 무저장 미리보기 위 「라이브와 다름」 띠(바뀐 블록 N · [수정 전으로]).
- B2 R3 서버 뜻: `dm-interaction-core` `decideSubmission(서버 섹션, data, now, state)` 표 주도 · 선착순 차감은 1인 1회 INSERT와 한 문장(CTE) · 즉시쿠폰 만료 · 설문 필수 · 섹션 타입 서버 결정(`dm.ts:3086`) · 동의 기본값(미지정 행 수 SQL 실측 뒤 · 무회귀 예외 승인) + Codex.
- B3 ⑨ 신원 판정 함수(`resolveDmIdentity` · 판정 사실만 · 키 조립은 소비처 · 6사례 캡처 · ON CONFLICT 문자열 고정) + `viewer_count` 새 필드(`view_count` 값·뜻 동결 · 화면 「열람 N회 · N명」 · 신규 발행분부터).
- B4 이메일 렌더러 switch→표(hero `bOnDark` 회귀 주의) · R10 개인화 치환 칸을 커버리지 탐침에서 파생.
- C Harold 승인 항목: 완료 문구 「상자」·이미 참여 회색 통일(미지정 캠페인 출력 변경) · 편집기 칸 아래 미리보기 상자 · 동의 강제 기본값.

## 8. 구현 기록 (2026-10-14)
- 코드 = 설계 A1~A7 전부(§4 순서대로 · 단독·순차). DDL 0 · 새 쓰기 경로 0 · 새 의존성 0(`typescript` 기존 보유).
- 실측 수치: 추출기 키 총수 206(편집기 27개 198 + 공용 완료 문구 칸 × 8) = 하한 고정 · 첫 탐침 빨강 159 → 문맥(DM_PROBE_CONTEXT base 18 · with 20 · enums 40) · n/a 면제 45행 · server 3행 · removed 5행 · 미검토 래칫 31 · 서버 규칙 대기 7 · 표시 기본값 어긋남 5건 편집기 정정(설문·클릭 리워드 `show_progress` · 이메일수집 `consent_required` · 투표·룰렛 1인 1회) · 미러 어긋남 5(즉시쿠폰 버튼색 2 · 탭 활성색 2 → 백엔드 타입에 추가 · 헤더 `align` → 프론트 기본값에서 제거).
- 검증: backend tsc 0 · frontend tsc 0 · backend vitest 606파일 8662 통과(신규 `dm-editor-coverage` 43 · `dm-participation-viewer` 40 · `email-block-copies` 3 · 갱신 `email-editor-coverage`·`dm-editor-parity`). em-dash 불변식 1건(추출기 오류 문구) 정정.
- 설계와 달라진 점: ⑧ 1단계의 [테스트] 확인창·[저장하고 나가기]는 공용 `ConfirmModal`에 둘째 동작(`altLabel/onAlt`)을 더해 구현(새 모달 0 · 옛 `ConfirmDiscardModal` 삭제). 경품 재고 한 줄은 "발행된 룰렛·추첨이 바뀐 상태" 대신 "룰렛·추첨 블록이 있는 발행본을 저장할 때"(저장본 diff 없이 판정 · 더 넓고 정직). 스냅샷은 발행 DM의 silent 저장이 막히면 **남기지 않고 안내**(비 silent 저장을 대신 부르지 않는다 = 새 라이브 쓰기 0).
- 범위 밖 기록 = BUGS B-1014-3(①~⑦) · Codex 적대 검토 = §8-1.

### 8-1 Codex 적대 검토
- **1R(gpt-6-astra · working tree · 7분 26초)**: critical 0 · high 0 · medium 5. 전부 수용.
  ① [저장하고 나가기]·[저장하고 보내기]가 저장 응답 지연 중 다른 DM 을 열면 그 DM 을 초기화/전송할 수 있다 → 저장 시작 때 `dmId` 를 잡고 끝난 뒤 같은 세션(`st.dmId === id`)일 때만 진행 · `ConfirmModal` 은 실행 중 ESC/X 닫기 차단.
  ② [반영하고 테스트]/[수정 전 화면으로 테스트] 확인창이 닿지 않는 코드였다 — 옛 상단바(`TopBarWithBack`)는 0927 개편 뒤 `hidden` 고정이고 새 흐름(`DmEditScreen`)엔 DM 테스트 발송 입구가 없다 → 확인창·`DmTopBar` 문구 변경을 되돌리고 입구 부재를 BUGS B-1014-3 ⑧로 기록(새 입구 = 새 기능 · 착수 판단 Harold님). 소스 게이트 라벨은 둘(저장하고 보내기 · 저장하고 나가기).
  ③ kind=server 행(`consent_required`)이 SSR 탐침 면제로도 쓰여 `data-consent` 출력 회귀를 가릴 수 있었다 → server 행은 이름 걸림의 근거일 뿐 면제가 아니게(EXEMPT 에서 제외) · 룰렛 재고는 칩 탐침값(2) · 확률은 "발행물에 안 싣는 것이 정답" n/a 행을 따로.
  ④ `EMAIL_HIDDEN_EDITOR_FIELDS`(중복 컨트롤 숨김)를 이메일 면제 근거로 쓰면 이메일 전용 컨트롤로 계속 편집되는 헤드라인 강조의 구도별 회귀를 놓친다 → 면제는 `EMAIL_PROP_EXEMPT`·`DM_PROP_EXEMPT` 만.
  ⑤ `showMsg` 가 줄바꿈 있는 모든 글자에 pre-line 을 켜서 미지정 캠페인의 여러 줄 합성 문구(즉시쿠폰 usage_instructions)·서버 오류 모양이 바뀌었다 → `showDone` 하나가 회사 문구를 실제로 쓴 때만 pre-line · 회귀 사례 2건 테스트 추가.
- 정정 뒤 검증: frontend tsc 0 · backend tsc 0 · backend vitest 전체 606파일 8663 통과.
- **2R(1R 정정 줄 범위 · 5분 7초)**: critical 0 · high 0 · medium 2(둘 다 A 세션 가드 · B~E 추가 차단 사유 없음). 같은 뿌리 = **"dmId 는 편집 세션 식별자가 아니다"**(같은 DM 재진입 = 같은 id 다른 세션 · 신규 DM 첫 저장 = null → 발급 id 같은 세션) → 개별 땜질 대신 구조 정정: 스토어에 편집 세션 토큰(`editSession` · `loadDm`·`createNew`·`reset` 마다 증가 · `getEditSession()`)을 두고 두 확인창이 "열 때 잡은 토큰 == 저장 뒤 토큰"으로 판정.
- **★1014 Harold: 「라운드 상한 없어 · 닫힐 때까지」** → CLAUDE.md·런북 개정 뒤 계속.
- **3R**: medium 1 = 늦은 `loadDm` 응답이 현재 세션을 덮어씀(+[범위 밖] 늦은 POST 가 dmId 덮어씀 · 같은 뿌리) → `loadDm` 요청별 토큰(응답 때 세션이 다르면 폐기) · `save` 도 요청 뒤 세션이 다르면 결과를 적지 않음.
- **4R**: 판정 JSON 없이 중간 메시지("세션 초기화가 진행 중 PUT 을 끝내지 않는다 → 같은 DM 저장 직렬화 확인 중")로 끝남 → 선제 반영: `loadDm` 이 isSaving 을 내리지 않음(옛 PUT 이 끝날 때까지 가드가 직렬화).
- **5R**: medium 1 = 폐기된 옛 저장 완료가 새 세션의 isSaving 을 내려 신규 DM POST 가 겹침 → 요청 소유 잠금(`activeSave`).
- **6R**(429 두 번 → 5분 뒤 재실행): medium 2 = 잠금에 막힌 새 세션 자동 저장이 재개되지 않음 · 무응답 요청이 뒤 세션 전부를 잠금. 같은 뿌리 = "막힌 저장을 버린다" → **저장 차례**(`inflight` Promise · 진행 중 저장이 끝날 때까지 기다렸다 들어감 · 기다리는 동안 세션이 바뀌면 그 세션 내용을 대신 저장하지 않음) + 저장 요청 timeout 30초(시간 초과 안내 토스트) + `finally` 로 차례·표시 해제 보장. 잠금 코드는 삭제.
- 6R 정정 뒤 검증: frontend tsc 0 · 커버리지 소스 게이트·em-dash 불변식 통과 · backend vitest 전체 606파일 8663 통과.
- **7R**: **approve · No material findings**(복수 대기자 직렬화 · 세션 가드 · 자동 저장 재개 · timeout 뒤 차례 해제 확인). [범위 밖] 1 = timeout 뒤 서버에 늦게 닿은 PUT 이 그 뒤 저장을 덮어쓰는 것은 서버 버전 비교 축 → BUGS B-1014-3 ⑨.
- 종결: 7라운드 · 지적 13건(1R 5 · 2R 2 · 3R 1+1 · 4R 미완 · 5R 1 · 6R 2) 전부 수용 · 불수용 0.

## 7. 회의에서 갈렸던 곳과 택한 근거
- 추출기: 구문 트리(프론트·기획·백엔드 2R) vs 정규식(회의론자) → 구문 트리(축약·다중 키·세터 파생을 한 규칙으로). 회의론자 조건(Poll 세터 정정 · 세터 정의 파생 · fixture · 하한)은 전부 수용.
- 완료 문구 키·마커: 위 A2.
- 받는 사람 화면: showMsg 유지(기획·백엔드·회의론자·프론트) vs 완료 카드(디자이너 → 스스로 접음).
- ⑧: 1단계만(전원 2R 일치) · 저장소 = dm_versions 예약 1행(기획·회의론자·백엔드 · 프론트 철회).
- ⑦: 화이트리스트 유지(백엔드·회의론자·프론트 · 기획 철회).
