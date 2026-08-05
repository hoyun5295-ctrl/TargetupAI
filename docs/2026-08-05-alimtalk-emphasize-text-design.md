# 알림톡 강조표기형(TEXT) 입력 필드 정정 — 설계

> 접수 = 박성용 「강조표기형 텍스트 수정」(`cmse0xszy006gjnyw1usgeq9m`, 2026-08-04 11:13, P3)
> 기능 상설 = [FEATURE-ALIMTALK-TEMPLATE.md](FEATURE-ALIMTALK-TEMPLATE.md) · 착수 시 그 문서 §2 불변 원칙 먼저

---

## §1 접수 내용

1. **보조문구가 필수 값인데 화면에 `[선택]`으로 적혀 있다.** 필수로 고쳐야 한다.
2. **두 필드에 글자 수 제한 안내가 없다.** 아래 규격을 적어야 한다.

## §2 확정 규격

| 필드 | 안드로이드 | iOS | 비고 |
|---|---|---|---|
| **강조 타이틀** | 2줄 · 최대 23자 표시 (24자부터 말줄임) | 2줄 · **최대 21자 표시 (22자부터 말줄임)** | 한/영 구분 없이 띄어쓰기 포함 |
| **강조표기 보조문구** | **최대 18자 표시 (19자부터 말줄임)** | **최대 21자 표시 (22자부터 말줄임)** | 한/영 구분 없이 띄어쓰기 포함 · **변수 사용 불가** |

- **네 값 모두 2026-08-05 회신으로 확정**됐다. 영업팀장이 다시 받아온 값이 위 표이고, 접수 원문의 강조 타이틀 iOS "28자부터 말줄임"은 **오타**였다(실제 22자부터). 미확정 항목은 남아 있지 않다.

> 이 숫자는 **표시 잘림** 기준이지 입력 상한이 아니다. `maxLength=50`(카카오 API 상한)은 그대로 둔다 — 줄이면 기존 템플릿 수정 시 잘린다.

## §3 수정 지점 (조사 완료)

대상은 **`components/alimtalk/AlimtalkTemplateFormV2.tsx` 한 파일**이다.

| # | 위치 | 지금 | 바꿀 것 |
|---|---|---|---|
| 1 | TEXT 강조 블록(입력 2개) | 라벨 없이 placeholder만. 보조문구에 `(선택)` | 라벨 2개 신설(`*` 필수 표시는 기존 `text-red-500` 패턴) + 각 필드 아래 §2 설명 1줄. placeholder에서 "선택" 제거 |
| 2 | `validate()` | `emphasizeType === 'TEXT'`일 때 `templateTitle`만 검사 | `templateSubtitle` 빈값이면 `'강조표기 보조문구를 입력하세요'` |
| 3 | payload 조립 | `if (form.templateSubtitle)` 조건부 전송 | TEXT면 무조건 전송 |

**전수 grep 결과** — 같은 표기가 `components/AlimtalkTemplateFormModal.tsx`에도 있으나 **import 0건(미사용)**이라 대상이 아니다. 실사용 화면은 `AlimtalkManagementSection`이 렌더하는 V2 하나다.

## §4 영향

- 이미 등록된 TEXT 템플릿 중 **보조문구가 빈 건은 수정 모달에서 저장이 막힌다.** 필수화의 직접 결과이고 접수가 요구한 것이다.
  - 저장 버튼 하나가 **수정과 검수 요청을 겸한다**(`handleSave` 단일 경로 · 증빙파일 첨부도 그 안). 그래서 그 건들은 **검수 요청도 보조문구를 채우기 전에는 나가지 않는다.**
  - **0805 실측(Harold 실행) — 해당 건 0.** `emphasize_type` 분포 = NONE 4,518 · TEXT 42 · IMAGE 19이고, 그 TEXT 42건 중 `emphasize_subtitle IS NULL OR btrim(...)=''`인 행이 0건이다. **분모를 함께 본 판정**이다(0건만 보면 "TEXT 자체가 없어서 0"과 구분되지 않는다). ⇒ 배포로 저장이 막히는 기존 템플릿은 없다.
  - 재확인 SQL — `SELECT emphasize_type, COUNT(*) FROM kakao_templates GROUP BY emphasize_type ORDER BY 2 DESC;` + `SELECT COUNT(*) FROM kakao_templates WHERE emphasize_type='TEXT' AND (emphasize_subtitle IS NULL OR btrim(emphasize_subtitle)='');`
- 미리보기(`AlimtalkPreview`)는 값이 있을 때만 표시하는 구조라 그대로 둔다.
- 백엔드(`routes/alimtalk.ts`)는 받은 값을 그대로 저장한다. **서버 측 필수 검증은 이번 범위 밖** — 화면에서 막는 것으로 접수는 닫힌다.
- DDL 없음. 신규 컬럼 없음.

## §5 진행 상태

1. ~~강조 타이틀 iOS 값 재확인~~ — 2026-08-05 회신으로 확정(§2). 미확정 0
2. **§3 3지점 수정 → 0805 배포완료** — `frontend tsc 0` · 모델명·native dialog·박-단어 grep 0건
3. 남은 것 = **화면 실측** — ①강조유형 TEXT 선택 시 두 필드에 라벨(`*` 필수)과 안내 1줄이 보이는가 ②보조문구를 비우고 저장하면 `강조표기 보조문구를 입력하세요` 토스트로 막히는가 ③기존 TEXT 템플릿(보조문구 빈 건)을 열면 저장·검수 요청이 막히는가

### 5-1. 넣은 문구 (화면 실측 대조용)

- 강조 타이틀 — `2줄 표시 · 안드로이드 23자 · iOS 21자까지 표시되고 각각 24자·22자부터 말줄임 (띄어쓰기 포함)`
- 강조표기 보조문구 — `안드로이드 18자 · iOS 21자까지 표시되고 각각 19자·22자부터 말줄임 (띄어쓰기 포함) · 변수 사용 불가`

### 5-2. 범위 밖으로 남긴 것 (추가 과제)

- `components/AlimtalkTemplateFormModal.tsx` — 같은 TEXT 블록이 있고 보조문구에 필수 표시가 없다. **import 0건(죽은 파일)**이라 이번 접수 대상이 아니다. 파일 폐기 여부는 별건.
- **서버 측 필수 검증**(`routes/alimtalk.ts`) 미도입 — 화면에서 막는 것으로 접수는 닫힌다. API 직접 호출 경로는 여전히 빈 보조문구를 저장할 수 있다.
