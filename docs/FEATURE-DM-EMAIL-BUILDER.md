# 모바일 DM · 이메일 편집기(블록 빌더) — 기능 상설 SoT

> **호출어: "DM 편집기 / 이메일 편집기 / 블록 빌더 / 완료 문구 / 커버리지 테스트"** — 편집기·발행 렌더·뷰어·이메일 렌더의 **계약과 원장**을 이 문서가 소유한다.
> 시점 설계서가 근거를 소유하고 여기엔 링크만 둔다. 상태·잔여는 STATUS §2 카드(STATUS-FEED)가 소유한다. 여기엔 **구조와 원칙**만 남긴다.
> 블록 조립(쪽 템플릿·효과·칩)은 [블록 조립 설계서 2026-09-16](2026-09-16-dm-block-assembly-design.md)이, 만들기 흐름은 [2026-09-27 만들기 개편](2026-09-27-make-redesign-design.md)이 따로 소유한다.

| 시점 설계서 | 소유하는 것 |
|---|---|
| [2026-07-14 DM 속성 계약 신설](../packages/backend/src/utils/dm/dm-property-contract.ts) (코드 머리 주석) | 「편집기 ≠ 발행」 이음새 차단의 첫 장치 — 손 등재 표 + 파리티 테스트 |
| [2026-09-16 이메일 커버리지](../packages/backend/src/utils/email/__tests__/email-editor-coverage.test.ts) (코드 머리 주석) | 등재를 사람 손에서 뺀 첫 사례(이메일 12타입 · 토큰 대조) |
| [2026-10-14 구조 설계서](2026-10-14-dm-email-structure-design.md) | **현행 전량** — 뿌리 R1~R12 · 결정 A1~A7 · 영향표 · 바뀌는 출력 · 다음 축(B1~B4 · C) · 회의 갈림과 근거 |

---

## 1) 무엇인가

담당자가 블록(섹션 27종)을 쌓아 모바일 DM(발행 URL · 뷰어 스크립트)과 이메일(정적 HTML)을 만드는 공용 편집기다.
같은 속성 패널(`SectionPropsEditor`)을 DM·이메일이 함께 쓰고, 한 속성은 **네 면**에서 소비된다: 편집 캔버스(React) · DM 발행 렌더(SSR) · DM 뷰어 스크립트(단말 동작) · 이메일 렌더.
결함은 거의 전부 "편집기에는 있는데 어느 한 면이 안 읽는다"에서 났다(0713~0714 연결부·줄바꿈 · 0722 완료 문구 · 0904 CTA 배치 · 0916 이메일 6건 · 1014 설문 2건).

## 2) 불변 원칙 (필독)

1. **편집기 속성 전수는 기계가 뽑는다.** 손 등재 표는 등재된 것만 지킨다(1014 실측: 편집기 속성 183 중 150이 표 밖). 전수는 편집기 소스에서 구문 트리로 뽑아(`__tests__/editor-keys.ts`) 네 면에 대조한다(`dm-editor-coverage.test.ts`). 새 편집기 컨트롤을 붙이면 이 테스트가 그 속성을 자동으로 밟는다 — **등재 절차가 없다.**
2. **판정은 행동 탐침이다.** 값을 바꿔 렌더해 출력이 달라져야 소비다. 섹션이 가진 **구도 전부**로 돌린다(0904 CTA ghost = classic만 읽던 결함). 문자열은 태그·data-*를 걷어낸 가시 텍스트에 있어야 하고, data-*로만 나가도 뷰어가 그 속성 이름을 읽으면 통과한다.
3. **안 읽는 것이 정답인 속성은 원장에 사유와 함께.** `DM_PROP_EXEMPT {section, prop, surface, kind, why, reader?, treatment?}` — kind = server(reader 함수 본문에 `.prop` 실재) · viewer · n/a · removed. 사유에 "아직·예정·미구현"은 금지다. 편집기에서 사라진 속성의 행은 실패한다(원장 부패 차단).
4. **미검토는 래칫이다.** `DM_PROP_UNREVIEWED`(이름 목록 · 2026-10-14 첫 실측 31) + `_MAX`. 항목이 통과하게 되면 실패시켜 목록에서 빼게 하고, 길이는 줄이기만 한다. kind 4종 밖의 새 분류를 만들지 않는다.
5. **"서버 규칙"처럼 읽히는 이름은 서버가 읽어야 통과한다.** `one_*` · `consent_required` · `required` · `quantity` · `probability` · `expires*` · `*_count` · `*_quantity`. 발행물에 나오든 말든 kind=server + reader 실재로만 통과, 못 대면 `DM_SERVER_RULES_PENDING`(7 · 줄기만). 이 목록이 곧 R3(서버 뜻) 다음 축의 할 일이다.
6. **편집기 표시 기본값 = 미지정 렌더.** `props.X ?? D`의 D는 키 없는 발행물과 같아야 한다(테스트 고정). 발행물이 진실이고 편집기는 사실대로 보여 준다(1014: 설문·클릭 리워드 진행률 · 이메일수집 동의 필수 · 1인 1회 두 토글을 `?? false`로).
7. **참여 8종 완료 문구는 장치 하나다.** 대상 = `PARTICIPATION_TYPES`(registry 소유 · 렌더러가 `data-dm-result`를 내는 타입과 같음을 테스트가 고정 · 프론트 미러). 키 = `success_text` 하나(설문은 옛 칸 `completion_reward_text`를 완료 문구로도 읽음 = `doneTextOf`). 마커 = `renderSection` 래퍼 `data-success-text` 하나(값 있을 때만 · 미지정 바이트 불변). 뷰어 = `wrapInfo().done` 하나를 8 분기가 읽는다. **상태 표**: 완료 = 회사 문구로 대체(없으면 현행 고정 문구) · 당첨·이미 참여 = 현행 문구 + 둘째 줄 회사 문구 · 꽝·검증·오류·수신자 전용·마감 = 불변 · 룰렛은 당첨 때만. 즉시쿠폰은 회사 문구가 사용 안내 합성 문구를 대체한다.
8. **줄 목록 칸은 `LineListInput` 하나다.** 초안 문자열을 자기 state로 들고 저장값(string[])은 `toLines` 한 곳에서만 만든다(빈 줄만 뺀다 · 줄 안 공백 보존). 편집기 onChange 안의 `split('\n')`은 0건(테스트 고정).
9. **발행된 DM의 편집은 라이브와 다르다.** 자동 저장은 막혀 있고(0714 라이브 보호) 명시 저장만 라이브 URL을 덮는다. "자동 저장이 막히는가"(`selectAutosaveBlocked` · 중지분 포함)와 "받는 사람 화면과 다른가"(`selectLiveGap` · 중지 아님)는 셀렉터 둘이 소유하고, 머리 문구·휴대폰 띠·상단바가 그것만 읽는다. `save()`는 실제 저장 여부(boolean)를 돌려주고, 스냅샷·보내기·나가기는 그 값으로만 진행한다. **저장은 차례다** — 진행 중인 저장(어느 세션이든)이 끝날 때까지 다음 저장은 기다렸다 들어가고(`inflight` · 막힌 저장을 버리지 않는다 = 자동 저장 유실 0), 요청마다 30초 timeout, 응답이 왔을 때 편집 세션 토큰(`getEditSession` · `loadDm`·`createNew`·`reset` 마다 증가)이 바뀌었으면 결과를 새 세션에 적지 않는다(늦은 GET·PUT·POST 폐기). 확인창 2곳([저장하고 보내기] · [저장하고 나가기])은 **기존 `save()` 외 다른 쓰기를 부르지 않고**, 저장이 끝난 뒤 **같은 DM 편집 세션일 때만** 진행한다(소스 스캔 테스트 고정 · 새 라이브 쓰기 경로 0 · Codex 1R). 새 만들기 흐름엔 DM 테스트 발송 입구가 없다(옛 상단바는 hidden 고정 · BUGS B-1014-3 ⑧).
10. **이메일 지원 블록 목록은 한 벌이다.** 진실 = `EMAIL_BLOCK_WHITELIST`. AI 프롬프트 줄 집합 = `EMAIL_AI_BLOCK_TYPES` ⊆ 화이트리스트 · 프론트 팔레트(`make-flow`) = 화이트리스트 · `EmailVisualEditor`는 그 값을 import(사본 0). `email-block-copies.test.ts`가 고정.
11. **원장이 지키는 것은 "소비"까지다.** 값이 출력에 실리는지를 지키지, 실제 단말·메일 클라이언트에서 보이는지는 지키지 않는다. 실제 보임은 접수 회사 킷 fixture 방식(실물 DOM 리허설)으로 따로 본다.
12. **출력 무회귀.** 미지정 값 = 현행 출력 한 글자도 안 바뀐다. 바뀌는 것은 "값을 넣은 행"뿐이고 그것이 접수 수정 자체다. 바뀌는 출력은 설계서 §5에 적는다.

## 3) 구조 — 한 속성이 지나는 네 면

```
편집기(frontend/components/dm/panels/editors/*.tsx · SectionPropsEditor 공용 칸)
  └─ 저장 props(jsonb) ─┬─ 편집 캔버스(frontend/components/dm/canvas/*)            ← 이름 대조(근사)
                        ├─ DM 발행 렌더(backend dm-section-renderer renderSection)  ← 행동 탐침 · 구도 전부
                        │    └─ 래퍼 data-* ─ DM 뷰어 스크립트(dm-viewer.ts)         ← kind=viewer 자동 판정
                        ├─ 이메일 렌더(backend email-section-renderer)              ← 행동 탐침(12타입)
                        └─ 서버 판정(dm-interaction*.ts · dm-publish-core.ts)      ← kind=server reader 실재
```

| 자리 | 파일 | 소유하는 것 |
|---|---|---|
| 타입·기본값·참여 목록 | `backend/src/utils/dm/dm-section-registry.ts` | `SECTION_TYPES` · `PARTICIPATION_TYPES` · Props 타입 · `SECTION_DEFAULTS`(프론트 `utils/dm-section-defaults.ts`와 키·값 동일 = 테스트 고정) |
| 원장 | `backend/src/utils/dm/dm-property-contract.ts` | `DM_PROP_EXEMPT` · `DM_REMOVED_DEAD_CONTROLS`(파생) · `DM_SERVER_RULE_NAME` · `DM_SERVER_RULES_PENDING(_MAX)` · `DM_PROP_UNREVIEWED(_MAX)` · `DM_PROBE_CONTEXT`(base·with·enums) + 옛 손 등재 표들(그대로 유지) |
| 완료 문구 | `dm-section-renderer.ts doneTextOf` · `renderSection` 래퍼 · `dm-viewer.ts` 표식 `dm-participation:begin~end` · `dm-variable-resolver.ts`(치환 키) · `SectionPropsEditor.tsx DoneTextField` | §2-7 |
| 줄 목록 칸 | `frontend/components/dm/panels/FormControls.tsx LineListInput · toLines` | §2-8 |
| 발행본 편집 가드 | `stores/dmBuilderStore.ts save · selectAutosaveBlocked · selectLiveGap` · `DmEditScreen` · `DmBuilderPage` 확인창 · `DmTopBar` · `ConfirmModal onAlt` | §2-9 |
| 이메일 목록 | `backend/src/utils/email/email-blocks.ts EMAIL_BLOCK_WHITELIST · EMAIL_AI_BLOCK_TYPES` · `frontend/utils/make-flow.ts EMAIL_PALETTE_TYPES` | §2-10 |

## 4) 테스트 — 무엇이 무엇을 고정하는가

| 테스트 | 고정하는 것 |
|---|---|
| `dm/__tests__/dm-editor-coverage.test.ts` | §2-1~6 전부(추출기 키 총수 하한 206 · 27타입 매핑 파생 · 바탕 렌더 비어 있지 않음 · 참여 8종 = data-dm-result 타입 = 프론트 미러 · 원장 규율 · 전수 탐침 · 래칫 stale · 서버 규칙 이름 · 표시 기본값 · 백엔드↔프론트 미러 · 소스 게이트 2) |
| `dm/__tests__/dm-participation-viewer.test.ts` | §2-7(래퍼 마커 · 뷰어 실제 클릭 8타입 × 완료/미지정/이미 참여/오류 · 줄바꿈 pre-line · 프론트 힌트 표 = 뷰어 글자 · 죽은 검사 차단) |
| `email/__tests__/email-block-copies.test.ts` | §2-10 |
| `email/__tests__/email-editor-coverage.test.ts` | 이메일 토큰 대조(키 뽑기 = 같은 추출기) |
| `dm/dm-editor-parity.test.ts` | 옛 손 등재 표(배경면·연결부·개행·색 표 등) + 제거된 죽은 컨트롤 잔존 0 |
| `dm/dm-tab-viewer-parity.test.ts` | 탭 카드 뷰어 클릭 = 발행 렌더(0910 · 표식 블록 실행의 선례) |

## 5) 이력 색인

| 시점 | 무엇 | 근거 |
|---|---|---|
| 2026-07-14 | DM 속성 계약표 신설(손 등재) + 파리티 테스트 | `dm-property-contract.ts` 머리 |
| 2026-07-21 | 고아 토글 전수 배선 · 죽은 컨트롤 2 제거(`show_result_after_vote` · `enable_user_location`) | 같은 파일 `DM_WIRED_ORPHAN_MARKERS` |
| 2026-07-22 | 이메일수집 완료 문구(`success_text` · 폼 속성) — **설문엔 안 퍼짐**(1014 접수 ②의 뿌리) | 같은 파일 |
| 2026-09-16 | 이메일 커버리지(기계 파생 · 토큰 대조) | `email-editor-coverage.test.ts` |
| 2026-10-14 | **구조 묶음**: DM 커버리지(구문 트리 · 행동 탐침 · 원장 · 래칫) · 완료 문구 장치 하나 · LineListInput · 발행본 편집 1단계 가드 · 이메일 사본 묶기 · 죽은 키 4개 기본값·타입에서 제거 · 미러 키 4개 정합 | [설계서](2026-10-14-dm-email-structure-design.md) · BUGS B-1014-2 |

## 6) 다음 축(기록 · 착수 판단 = Harold님)

설계서 §6: B1 발행본 편집 본체(초안 1행 · [반영] = 발행 코어 · 착수 조건 5) · B2 R3 서버 뜻(`DM_SERVER_RULES_PENDING` 7 = 할 일 목록) · B3 신원 판정 함수 · B4 이메일 렌더러 switch→표 · C Harold 승인 항목(완료 카드 · 이미 참여 회색 · 동의 강제 기본값) · `DM_PROP_UNREVIEWED` 31건(히어로 오버레이 프리셋이 full_bleed만 · 분할·겹침 구도의 이미지 속성 · 지도 좌표 입력칸 등).
