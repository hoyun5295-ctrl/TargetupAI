# C119 할인 · 혜택 템플릿 8 → 24(혜택 꼴 × 보편 디자인 · 배치 둘 · 기존 8 보편화 · 예시 24장 = 빈 제품 자리) 설계서

> 작성 2026-11-08 · 카드 C119 · 접수(Harold 1108 원문 순서) =
> 「이런 형태로 한 12종 추가해서 20개 · 다른 거에 비해 너무 빈약」 → 「바로 진행하자」 →
> 「마지막 두 개 화장품+의류 / 의류+커피 말이 되냐」 · 「브랜드명은 빼 · 할인이고 컨셉만」 →
> 「뷰티 의류 커머스 고 뭐고 보편적으로 쓸 수 있는 템플릿 · 기존 템플릿들 안 보고 했냐」 · 「2+1 이면 2+1 이고 할인이면 할인이지」 →
> (bhc 인앱 화면) 「얼마나 깔끔하냐 · 이미지 템플릿 자체가 · 왜 이렇게 단순하게만 하냐」 →
> 「여기도 브랜드네임 넣지 말고 깔끔하게 · 제품이 들어가는 공간만 확실하게 보여주면서」 → 「오케이 그렇게 진행해」 →
> 「화려한 것도 좋지만 저런 베이직한 걸 4~5개 정도 추가로 배치해도 나쁘지 않을 것 같다」 · 앞 접수 「예시 이미지 · GPT 로」
> 관련 = C114(할인 트랙 · 고정 틀 · 혜택 CT `studio-discount.ts`) · C118 §10 E3 · E6(할인 = 인앱 글 자리 고정 · 안전 칸)

## §0 접수 · 닫는 조건

| # | 접수 | 닫는 조건 |
|---|---|---|
| J1 | 12종 추가 · 20개 + 베이직 4~5 | 할인 · 혜택 24개(지금 8 + 연출형 12 + 베이직 4) |
| J2 | 보편 · 혜택 꼴 · 기존 템플릿 기준 | 템플릿 = 혜택 꼴 × 디자인 컨셉(기존 「세일·이벤트」 = 볼드 세일 임팩트 · 블랙 & 골드 특가 · 타임 세일 · 세트 구성 강조 기준) · 이름 · desc · useCase · 장면 · textStyle 에 업종 0 · 기존 8개도 |
| J3 | 단순함 · bhc 수준 깔끔함 | 배치 둘(위 글형 = 지금 · 왼쪽 글형 = 왼쪽 정렬 한 기둥 큰 제목 · 가격 줄 · 날짜 줄 + 제품 = 오른쪽 아래 크게 · 조건 = 왼쪽 아래 작은 알약) · 새 12 = 사진 연출 장면(깊은 색 · 한쪽 빛 · 질감 · 보편 소품) |
| J4 | 예시 = 브랜드 0 · 제품 자리만 또렷 | 예시 24장 = 제품을 그리지 않고 빛 모인 빈 자리 · 제목 「상품명」 · 세트 구성 「상품 A + 상품 B(+ 상품 C)」 · 숫자(가격 · 할인율 · N+M · 기간)는 그대로 |
| J5 | 세트 예시 말이 되게 · GPT | 세트 예시 = 업종 섞인 제품 0(빈 자리 · 상품 A · B) · 배포 뒤 GPT 24장 |

## §1 현황(코드 사실)

| 자리 | 사실 |
|---|---|
| 카탈로그 | `image-studio-templates-discount.ts` 8개(price 4 · nplus 2 · set 2) · 카테고리 `할인·혜택` · 업종 박힘 = useCase(뷰티 · 의류 · 카페 · 스킨케어 · 생활용품) · 장면 첫머리(cosmetics · fashion · cafe · skincare) · 「가격 할인 웜 카페」(for the cup · coffee beans · appetizing · menu) |
| 배치 고정 | `studio-discount.ts:176` 고정 틀 = 「글 = 위 40% · 제품 = 아래 55% 가운데 · overrides every placement direction above」 · 혜택 줄 = 「centered」 · 날짜 알약 「very top」 · 증정 「very bottom」 → 템플릿 장면과 무관하게 한 구도 |
| 인앱 글 자리 | C118 E3 = 할인이면 서버가 textPosition 위 · 인앱 문장 「upper part … copy · subject lower」 · 화면 = 「위쪽에 글 · 할인 템플릿은 글이 위, 제품이 아래」 |
| 공개 목록 | `listTemplatesPublic`(`image-studio-templates.ts:5824`) = 열거한 칸만 내보냄(배치 칸 없음) |
| 예시 스크립트 | `scripts/discount-template-samples.ts` = 제목 따로(가상 브랜드) · 누끼 3장 섞음 · 일부만 다시 만들기 없음 |
| 사진 없는 OpenAI | `generatePoster` = 사진 없으면 `OPENAI_NO_INVENTED_SUBJECT`(제목이 이름 대지 않은 제품은 그리지 않고 제품 자리 = 빛 모인 빈 진열면) → **J4 와 같은 뜻 = 예시는 이 길 그대로**(고객이 사진 없이 만드는 길과 같다) |
| 카드 자리표 | 예시 없는 카드 = `sample.title` 을 그림 자리에 씀(`TemplatePicker.tsx:291` · `StudioMake.tsx:316`) |

## §2 처방

**D1 배치 = 템플릿 속성 · CT 한 곳**: `StudioTemplate.layout?: 'stack' | 'side'`(할인만 · 없음 = stack) · 공개 목록에 `layout`.
- `discountPromptLines(offer, brandColor, safe, layout)` · `discountFixedLayoutLine(offer, safe, layout)`:
  - stack = 지금 글자 그대로(인앱 안전 칸 = C118 E6 그대로).
  - side = 혜택 줄 정렬 `left-aligned`(centered 0) · 날짜 알약 = 글 기둥 맨 위(제목 위) · 증정 = 왼쪽 아래 작은 알약 · 고정 틀 = 「왼쪽 55% 안 한 기둥 · 모든 글 같은 왼쪽 여백 · 제목 → 혜택 줄 순서 · 제품 = 오른쪽 아래 크게 · 받침 · 바닥 위에 연출 · 글과 겹침 0」 · 인앱(safe) = 바깥 띠 문장 + 제품도 가운데 80% 안(가장자리로 걸치기 0) · 인앱 아님 = 제품이 오른쪽 · 아래 가장자리로 걸쳐도 됨.
- `buildPosterPrompt` 인앱 글 자리: 할인 + side = 「왼쪽 = 글 · 주제 = 오른쪽 아래」(textPosition 지점 문장 0) · 할인 + stack = 지금(위).
- 화면(고르기 창 · 편집기 안 스튜디오 창) 고정 표시 = 템플릿 배치대로(stack 「위쪽에 글 · 글이 위, 제품이 아래」 · side 「왼쪽에 글 · 글이 왼쪽, 제품이 오른쪽 아래」).

**D2 새 12개**(사진 연출 장면 · 보편 소품만 · 업종 0)

| id | offer | layout | 이름 | 장면 · 색 |
|---|---|---|---|---|
| discount-price-bold-red | price | side | 가격 할인 볼드 레드 | 짙은 크림슨 무대 · 오른쪽 위 따뜻한 빛 · 오른쪽 아래 어두운 돌판 |
| discount-price-minimal-white | price | stack | 가격 할인 미니멀 화이트 | 오프화이트 회벽 · 사선 창빛 그림자 · 흰 돌 원기둥 받침 |
| discount-price-vivid-yellow | price | stack | 가격 할인 비비드 옐로 | 선명한 옐로 무대 · 흰 광택 받침 · 짙은 그림자 · 팝 |
| discount-price-gradient | price | side | 가격 할인 그라데이션 | 보라 → 핑크 그라데이션 · 은은한 빛 번짐 · 오른쪽 아래 반투명 아크릴 블록 |
| discount-period-orange | price | stack | 타임세일 오렌지 | 선명한 오렌지 · 가장자리 큰 시계선 무늬 · 흰 받침 · 기간 알약 |
| discount-nplus-neon | nplus | side | 하나 더 블랙 네온 | 짙은 블랙 · 바닥 끝 네온 그린 선 · 오른쪽 아래 무광 블랙 블록 |
| discount-nplus-mint | nplus | stack | 하나 더 민트 | 페일 민트 · 흰 원형 받침 · 맑은 빛 |
| discount-nplus-lavender | nplus | stack | 하나 더 라벤더 | 라벤더 · 가장자리 새틴 주름 · 원형 받침 |
| discount-nplus-charcoal | nplus | side | 하나 더 차콜 | 차콜 콘크리트 벽 · 오른쪽 주황 윤곽 빛 · 오른쪽 아래 낮은 콘크리트 블록 |
| discount-set-black-gold | set | side | 세트 묶음 블랙 골드 | 블랙 벨벳 · 은은한 금빛 · 오른쪽 아래 넓은 블랙 대리석 판 |
| discount-set-pale-blue | set | stack | 세트 묶음 페일 블루 | 파우더 블루 · 넓고 낮은 흰 받침 |
| discount-set-sage | set | side | 세트 묶음 세이지 | 세이지 회벽 · 오른쪽 위 잎 그림자 · 오른쪽 아래 리넨 덮인 낮은 테이블 |

**D2-b 베이직 4개**(Harold 「베이직한 걸 4~5개 추가」 · 기존 크림 · 하늘처럼 단색 무대 + 가운데 받침 하나 · stack · 군더더기 0)

| id | offer | layout | 이름 | 장면 · 색 |
|---|---|---|---|---|
| discount-price-basic-gray | price | stack | 가격 할인 베이직 그레이 | 밝은 그레이 무대 · 흰 원형 받침 · 검정 글자 |
| discount-price-basic-blue | price | stack | 가격 할인 베이직 블루 | 맑은 코발트 블루 · 흰 받침 · 흰 글자 |
| discount-nplus-basic-white | nplus | stack | 하나 더 베이직 화이트 | 순백 무대 · 검정 원 표지 |
| discount-set-basic-gray | set | stack | 세트 묶음 베이직 그레이 | 그레이 무대 · 넓고 낮은 흰 받침 |

→ 24개 = price 11(기간 둘) · nplus 7 · set 6 · stack 18 · side 6 · useCase = 혜택 꼴 쓰임(「원래 가격과 판매가를 크게」 「1+1 · 2+1 처럼 하나 더 주는 행사」 「여러 제품을 묶어 세트가로」) · 장면 = 「plain」 비움 · 제품 자리 문구(`for the product` · `holding all the products`).

**D3 기존 8개 보편화**(id · offer · 색 · 무대 · 배치 stack 그대로): useCase · desc · 장면 첫머리 · textStyle 의 업종 말 0 · 「가격 할인 웜 카페」 → 「가격 할인 웜 우드」(cup · coffee beans · appetizing · menu 0 · `for the product`).

**D4 예시 24장**: 카탈로그 `sample.title` = 「상품명」(24개 · 예시 없는 카드 자리표도 같은 글) · 스크립트 = 제목 칸 · 누끼 칸 삭제 · 제목 = `sample.title` · 사진 없음 = 고객과 같은 `generatePoster`(OpenAI = 빈 진열면 문장) · 세트 구성 = 「상품 A · 상품 B(· 상품 C)」 · 혜택 값만 템플릿마다 · `--only id,id` · **엔진 = OpenAI 고정 · 저장 = 실제 엔진이 openai 인 결과만**(서버 기본 엔진 · ENV 무관 · OpenAI 실패 → Gemini 대체 결과 = 파일만 · 예시 저장 0 · `--both` = 비교용 Gemini 도 그리되 저장 0 · Codex 설계 2R ①) · 배포 뒤 24장(약 $1.61).

## §3 영향표

| 대상 | 쓰는 곳 | 영향 |
|---|---|---|
| `StudioTemplate.layout` · 공개 목록 | 카탈로그 · `listTemplatesPublic` · 화면 `StudioTemplatePublic` | 할인만 · 없음 = stack(다른 785 템플릿 무관) |
| `discountPromptLines` · `discountFixedLayoutLine` | `buildPosterPrompt` 하나 · C114 · C118 시험 | stack = 글자 그대로(시험 그대로 통과) · side = 새 문장 |
| `buildPosterPrompt` 인앱 갈래 | 생성 라우트 | 할인 + side 만 새 문장 |
| 화면 고정 표시 | `StudioUsePicker` · `StudioInsertModal` · `ImageStudioPage` | 배치별 문구 |
| 카탈로그 문구 · `sample.title` | 카드 · 예시 카드 자리표 | 글만 |
| 예시 스크립트 | 서버 실행만 | 운영 코드 무관 |
| 미가입 · 직접발송만 | 스튜디오 = 유료 | 변화 0 |

## §4 계약 시험 · 변이

| # | 시험 | 변이 |
|---|---|---|
| T1 | 할인 24 · id 유일 · 표의 id · offer · layout · price 11 · nplus 7 · set 6 · side 6 · 그 밖 템플릿 layout 0 · 공개 목록 layout | 하나 빼기 · layout 바꿈 |
| T2 | 할인 24 = 이름 · desc · useCase · 장면 · textStyle 에 업종 말 0(금지 표: 뷰티 · 화장품 · 스킨케어 · 기초 · 의류 · 패션 · 카페 · 디저트 · 음료 · 커피 · 메뉴 · 생활용품 · 간식 · cosmetic · skincare · fashion · cafe · coffee · cup · dessert · menu · apparel · garment · appetizing) · 장면 = plain + 제품 자리 문구 · sample.title = 「상품명」 | 업종 말 하나 · 제품명 예시 |
| T3 | stack 문장 = 지금 글자 그대로(C114 · C118 E6 시험 통과) · side 문장 = centered 0 · left-aligned · 「left 55%」 · 제품 「lower right」 · 인앱 side = 바깥 띠 + 제품 가운데 80% · 가장자리 걸치기 문장 0 · 인앱 side 프롬프트 = 「left part … copy」 · upper third 0 | side 에 centered · 인앱 side 에 걸치기 |
| T4 | 화면 고정 표시 = 배치별 문구 · 공개 목록 layout 을 읽음(소스 계약) | side 에 위 문구 |
| T5 | 스크립트 = 할인 24 전부 혜택 값 · 제목 칸 0 · 누끼 칸 0 · `generatePoster(prompt, preset, null, …)` · 세트 구성 = 상품 A · B · `--only` · 요청 엔진 = 'openai' 고정(`studioImageEngine()` 0) · 저장 조건 = `img.engine === 'openai'`(기본 엔진 Gemini · 대체 결과 · --both 의 Gemini = 저장 0) · 가상 브랜드 0 | 누끼 되살림 · 제목 칸 · 저장 조건 = 기본 엔진 |
| T6 | 카탈로그 전체 계약(금액 · 비율 · 쿠폰 · 무료 · 프롬프트 노출) 그대로 통과 | desc 에 「30%」 |

## §5 직원 지시문(로드맵 묶음 끝 시트)

| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 이미지 스튜디오 → 할인 포스터 → 할인·혜택 | 총 24종 · 예시 = 제품 없는 빈 자리 · 「상품명」 · 업종 · 브랜드 글 없음 |
| 2 | 「하나 더 블랙 네온」 → 제품 사진 · 2+1 넣고 만들기 | 글 = 왼쪽 한 기둥 · 「2+1」 표지 · 제품 = 오른쪽 아래 크게 |
| 3 | 같은 템플릿 · 인앱 메시지 용도 | 「왼쪽에 글」 고정 표시 · 정사각 · 가장자리 10% 에 글 · 제품 0 |

## §6 구조체크

- K1 배치 = 템플릿 속성 하나 · 문장 = CT 한 곳(카탈로그 장면은 장면만 · 배치 문장은 CT).
- K2 stack 무변경(지금 글자 그대로 = 시험).
- K3 예시 = 고객과 같은 생성 함수(예시 전용 갈래 0).
- K4 새 id 가 다른 카테고리 세부 표 · 행사 표에 걸리지 않음.

## §7 배포

백엔드 + 프론트(고정 표시 문구 · 공개 목록 layout) · DDL 0 · ENV 0 · 배포 뒤 예시 24장(GPT · Harold 실행 · 서버 셸 한 줄).

## §8 범위 밖(기록)

- 할인·혜택 안 세부 칩(가격 할인 · 하나 더 · 세트).
- 다른 카테고리(제품 · 행사) 템플릿 배치 속성.

## §9 기록

- 1108 작성 → Harold 정정 둘(보편 · bhc 깔끔함 · 빈 제품 자리) 반영 3판 · 구조체크 K1 ~ K4.
- Codex 설계 3R(3판) = approve(지적 0) · 뒤이어 Harold 「베이직 4~5개 추가」 = D2-b 4개(24개) = 4R 범위.
- Codex 설계 2R(보편 1판) = 지적 1(예시 저장이 서버 기본 엔진을 따라 Gemini 결과가 저장될 수 있음) → D4 엔진 OpenAI 고정 · 저장 = 실제 openai 결과만 · T5.
- Codex 설계 1R(업종 판) = 지적 1(사진 없는 OpenAI 예시 = 빈 진열면 문장 충돌) → 3판 = 예시가 빈 제품 자리를 원함(J4) = 그 문장이 곧 원하는 동작 · 예시 전용 갈래 0(K3).
