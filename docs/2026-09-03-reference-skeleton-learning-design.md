# 참조 골격 학습층 설계서 (2026-09-03)

> **호출어: "참조 골격"**. 상태 = **★2026-09-03 Harold 승인 → §11 실측 3건 통과 → 묶음 ②③④ 코드 완료 · 배포 대기**(구현 결과 = §16).
> 회의 절차 = `status/COLLAB.md` §1. 안건서·1차·2R·수렴 초안은 세션 스크래치에 있었고, 결론만 이 문서가 소유한다.
> 이 문서는 **참조 골격 학습층의 유일 SoT**다. 구현 후 상설 SoT(`docs/FEATURE-*.md`) 승격 여부는 §15에서 정한다.

---

## 0. 한 줄 요약

직원이 손으로 완성한 모바일 DM·이메일에서 **섹션 골격(타입 순서·통계)만** 뽑아 `best_copy_assets`(kind=`structure`)에 저장하고, 생성 CT 두 곳(`oneShotGenerate`·`generateEmailSections`)이 AI 재설계 대신 **결정적으로 그 골격을 고른다.** 소비처(플래너·AI 영업·원스텝·DM 편집기·이메일 화면)는 같은 CT를 타므로 한 번에 바뀐다. 서빙은 슈퍼관리자 토글(기본 off)이고, 끄면 현재 결과와 문자 단위로 같다.

---

## 1. 배경과 회의 결론

### 1-1. 배경 (Harold 지시 · 2026-09-03)
- 직원(임은지·남지현, 주식회사 인비토 계정)이 08-25~09-02에 만든 DM 11건·이메일 9건을 정답지로 삼아, AI 영업이 업체명·홈페이지만 받으면 그 수준 이상을 자동 생성하고, **마케팅 플래너 산출물도 같은 학습으로 풍부해져야 한다**(플래너 산출물은 현재 "0점"이라 배제).
- 실측(§3)으로 드러난 것: 문안(텍스트) 학습 배관은 있지만 **구조(섹션 골격) 학습은 없다.** AI 기본형은 5~8섹션, 직원 실물은 9~12섹션이며 여기서 갈린다.

### 1-2. 회의 결론 (5역할 전원 납득 · 갈린 지점 1개)
| 항목 | 결론 |
|---|---|
| 용어 | 직원 실물은 "정답"이 아니라 **참조 골격**(0813 설계 §0-8에서 "직원 실물 = 정답" 전제는 이미 기각). 화면·문서·코드 전부 이 용어 |
| 저장 | `best_copy_assets` kind=`structure`. 신규 DDL 0. 채널별 별도 골격(DM = 이미지 리듬 / EMAIL = text_card 리듬) |
| 비식별 | 승격 시 props를 **읽지 않는다.** `s.type`만 취한다 = 규칙이 아니라 형태로 달성 |
| 주입 | 사다리 = **사람이 고른 구성 > 빠른 시작 시나리오 > 참조 골격 > 기존 AI 설계.** 골격은 유형·해시로 결정적 선택. 난수·temperature 0 |
| 감산 | 더하기 없음. 재료 부재(상품 0·혜택 면허 없음)일 때만 뺀다. 재료를 모르는 경로는 감산 0(3값) |
| 서빙 | `meta.serving.enabled` 기본 false. 슈퍼관리자가 표본 수를 보고 켠다. 임계 상수 없음 |
| 아웃리치 | 호출부가 골격을 읽어 면허 없는 혜택 섹션 + 타사 임베드·sns 4종을 상시 감산한 뒤 `structure` 인자로 명시 전달(불변 20) |
| 플래너 | 0점의 1차 원인 = 재료(`buildPlannerEventText` 4줄 → 한 줄 요약). 공용 함수 무변경, 호출부에서 재료 확장. 이메일은 1차부터 골격 적용, DM은 재료 확장 뒤 |
| 승격 UI | 슈퍼관리자 전용. `/admin/best-copy` 패널 안 선택 모달 1개(회사·채널·후보 체크·업종 1필드). 고객 화면(DM 빌더·이메일 카드)에는 붙이지 않는다 |
| 자동 영업 발송 | 조건부 자동 없음. 최대치 = 발송 직전까지 전량 자동 + 큐 일괄 승인 1클릭(N건). 학습 점수를 발송 게이트에 넣지 않는다 |
| 성과 환류 | 1차 범위 밖. `meta.perf` 자리만 |
| **갈린 지점** | 기획·백엔드는 참조 골격을 시나리오 위에 두었다. **주재자 택 = 시나리오 위.** 근거: 시나리오는 사용자가 클릭한 고정 구성이고 코드도 정규화 없이 그대로 쓴다(`dm-ai.ts:874~875`). 0813 원칙의 연장으로 보며 빠른 시작 회귀 0. 회의론자 동의. Harold 결재 ⑨ |

### 1-3. 회의론자 최종 검증 조건 5 (전부 §5·§9에 반영)
①`avail` 3값 · unknown이면 감산 0 ②승격 게이트에서 파이프라인 산출물 제외 + 실측 선행 ③아웃리치 임베드·sns 상시 감산 ④저장은 chains **append**(치환이면 두 번째 승격이 첫 번째를 지운다) ⑤`getStructureSkeleton` 실패 = null(현행 동작).
정정 1건: 회의론자는 "AI 산출물 재학습 방지"로 `ai_prompt IS NULL` 게이트를 요구했으나, 첫 목록 실측에서 참조 DM 10건 전부 `ai_prompt`가 채워져 있었다(AI 초안 + 사람 편집). 그 게이트면 10건이 전부 탈락한다. 게이트는 **파이프라인 귀속 제외**(§7-2)로 바꾸고 `meta.chains[].src`에 `human_edited`를 기록한다.

---

## 2. 불변 원칙 (⛔ = 어길 수 없다)

1. ⛔ **props를 읽지 않는다.** 승격·저장·주입 어디에서도 섹션 props(문구·이미지 URL·링크·상품명·수치·브랜드명)를 읽지 않는다. 입력은 `s.type`의 배열뿐이다. 계약 테스트로 고정.
2. ⛔ **시퀀스 원문은 프롬프트에 나가지 않는다.** 이메일 프롬프트에는 통계·리듬 문장만(`renderStructureBlock`). DM은 프롬프트 자체가 없다(결정적 선택).
3. ⛔ **더하기 없음.** `reduceStructure`는 입력의 부분집합만 반환한다. 최소 골격(header·콘텐츠 1·cta·footer)은 기존 `normalizeSectionChain`이 보장하며 이 축은 그 함수를 고치지 않는다.
4. ⛔ **사다리는 순수 함수 하나가 소유한다.** `resolveStructure`. 호출부가 순위를 다시 판단하지 않는다.
5. ⛔ **서빙 off 또는 골격 null = 현재와 문자 단위 동일.** 조회 예외도 null로 접는다(throw 0). 계약 테스트 §9-3.
6. ⛔ **상한값은 registry가 유일 소유.** `SECTION_META.maxCount`(`dm-section-registry.ts`). 학습층은 p50·range만 저장하고 어떤 상한도 들지 않는다(이중 진실 금지).
7. ⛔ **공용 CT는 아웃리치 사정을 모른다.** 면허·임베드 감산은 `sales-outreach-produce.ts`가 조립해 `structure` 인자로 넘긴다(FEATURE-SALES-OUTREACH 불변 20).
8. ⛔ **저장은 append.** 같은 `ref.id`는 무시. `serving`은 보존. DELETE 후 INSERT 형태(`saveIndustryFormula` 패턴)를 쓰지 않는다.
9. ⛔ **`content`는 AI로 만들지 않는다.** stats에서 순수 함수로 조립(비결정성·원가·누출 0).
10. ⛔ **유형 라벨은 chain 선택 키로만.** 프롬프트 문구·사용자 화면 문안에 "media/catalog"를 쓰지 않는다.
11. ⛔ **임계 상수 없음.** 업종 골격을 켜는 것은 사람(토글) + 표본 수 노출. MIN_SEEDS류 자동 판정 0.
12. ⛔ **자동 승격 없음.** 파이프라인(플래너·아웃리치) 산출물은 후보에서 제외한다(자기 강화 루프 차단. LESSONS_META 23·24, LESSONS_BACKEND 0705 "예시가 재학습시킨다").
13. ⛔ **모델명·개발 용어 노출 0.** 화면 문구는 "참조 골격 n건을 참고했습니다 / 아직 표본이 없어 기본형으로 만들었습니다" 형태.
14. ⛔ **학습 점수·골격은 발송 게이트와 배선하지 않는다.** 예측으로 타겟을 고르지 않는 원칙과 §10 법률 미확정.

---

## 3. 실측 전제 (이 절 위에서만 설계한다)

### 3-1. 생성 CT와 소비처 (grep · 2026-09-03)
| CT | 정의 | 소비처 |
|---|---|---|
| `oneShotGenerate` | `packages/backend/src/utils/dm/dm-ai.ts:797~985` | `routes/dm.ts:944`(편집기 자유 프롬프트·시나리오) · `routes/content-interview.ts:294`(원스텝 · `structure` 전달) · `utils/planner-production.ts:145` · `utils/sales-outreach-produce.ts:281~287` |
| `generateEmailSections` | `packages/backend/src/utils/email-ai.ts:367~` | `routes/email.ts` · `utils/email-channel.ts` · `utils/planner-production.ts:104` |

체인 결정 4분기(`dm-ai.ts:871~884`): `structure` → `scenarioMeta.sections`(정규화 없이 그대로) → `prompt`이면 `designSectionLayout`(spec 요약 한 줄 입력 · temperature 0.8 · "5~8개" 지시 `:1136`) → 기본 `recommended_sections`. 정규화 = `dm-section-layout.ts:17~35`(header 맨 앞·footer 맨 끝 강제·maxCount·cta≥1·콘텐츠≥1).

이메일: `EMAIL_BLOCKS_SYSTEM`(`email-ai.ts:341~365`) 블록 9종 + "권장 순서 header→hero→본문→cta→footer" 한 줄. 주입 지점 = `baseSystem + brain.promptSuffix`(`:394`). 정규화 = `email-blocks.ts:89~107 normalizeAiBlocksToSections`(화이트리스트 밖 drop, footer·cta 강제 없음). 화이트리스트 12종 `email-blocks.ts:12~15` = `header hero text_card cta coupon promo_code product_carousel gallery store_info sns reviews footer`.

### 3-2. 기존 학습 자산 (재사용 대상)
- `copy-prompt-composer.ts:132 composeCopyBrain`(문안 RAG + 승리 공식 + 브랜드킷). **여기에는 넣지 않는다**: 그 suffix는 SMS(`services/ai.ts:1282`)까지 먹는다.
- `best-copy-assets.ts:107 getIndustryFormula`(42P01 → null) · `:125 saveIndustryFormula`(DELETE+INSERT · **미러하지 않는다**, 불변 8) · `isMissingTable`.
- A6 구조 통계 블록 패턴 `copy-prompt-composer.ts:92~101`(sampleCount>0 게이트 · 통계만) = `renderStructureBlock`의 기성 형태.
- 라우트 패턴 `routes/admin.ts:4948~5000`(`authenticate, requireSuperAdmin` · `isIndustryCode` · 503 `DB_MIGRATION_PENDING`).
- 화면 `pages/BestCopyPage.tsx:315~335`(업종 칩) · `:359~387`(승리 공식 패널 · `:381` 표본 0 문구 형식) · 라우트 `App.tsx:314~320`(`/admin/best-copy`, `super_admin`만).

### 3-3. 테이블 실측 (information_schema · 2026-09-03 Harold 실행)
- `best_copy_assets` 8컬럼: `id uuid, kind varchar, industry_code varchar, channel varchar, is_ad boolean, content text, meta jsonb, created_at timestamptz`.
- `dm_pages` 27컬럼 · `email_campaigns` 26컬럼(SCHEMA.md 0903 갱신본).
- ⚠ **미실측 = §11에서 먼저 확인**: `best_copy_assets.kind`에 CHECK 제약이 있는가(있으면 `'structure'` INSERT가 막힌다) · `planner_touchpoints.exec_meta` 실재 · `sales_outreach_assets.payload` 키(`dmId`).

### 3-4. 참조 실물 (인비토 · 임은지 5 · 남지현 6 · 08-25~09-02)
DM 11건 중 탑텐(header>hero 2섹션·미완성) 제외 = **10건**. 이메일 9건. 시퀀스 전문·유형 판정은 §5-2 표. 관찰: DM 평균 10.1섹션(7~12), product_carousel 9/10(무신사 없음), cta 0건 1(조선미녀), countdown·coupon류 8/10, footer 마감 6/10 · 이메일 평균 8.6(6~12), text_card 9/9(건당 2.0), countdown 0, footer 마감 4/9. 이메일 9건이 쓴 타입은 화이트리스트 12종과 정확히 일치. 이메일 발신명은 9건 전부 `모바일`(계정명 기본값 · Harold 결재 ⑧).
샘플 회사가 인비토라 `companies.industry_code`로 업종 매칭이 되지 않는다 → 업종은 승격 시 사람이 지정한다.

### 3-5. 아웃리치·플래너 현황
- AI 영업 v2 = 코드 완료·Codex 종결·DDL 2테이블 0828 실행완료(FEATURE §5)·**ENV 대기.** `status/STATUS.md:81`은 "ENV+DDL만 남음"으로 적혀 있어 문서 불일치 1건(§13).
- `sales-outreach-style.ts` v0(`sampleTrained=false`). 이 축이 끝나면 실물 참조는 참조 골격 CT로 위임하고 스타일 파일은 규칙 층만 남는다.
- 스마트스토어 입력은 차단(0731 설계서 §16-9-1 API 404 · §17-1 크롤 429 출구 IP). 입력 축 = 공식몰 URL. 이 문서 범위 밖.
- 플래너: `planner-execution.ts:388~394 buildPlannerEventText` = `[행사명][기간][혜택][상품]` 4줄. `planner-production.ts:145` prompt = `${tp.title} 행사 안내 모바일 페이지`. DM은 초안 저장까지(발행은 담당자, §3-20 발행 게이트 = 빈 자리 0).

---

## 4. 데이터 모델 (신규 DDL 0)

`best_copy_assets` 1행 = (`kind='structure'`, `industry_code`, `channel`). `channel` ∈ `DM` | `EMAIL`. `is_ad`는 NULL. `content` = 사람 가독 요약(순수 조립). `meta`:

```json
{
  "v": 1,
  "chains": [
    { "seq": ["header","hero","cta","gallery","product_carousel","cta","footer"],
      "author_type": "catalog", "author_type_source": "auto",
      "src": "human_edited",
      "ref": { "kind": "dm", "id": "<dm_pages.id>", "promoted_at": "2026-09-03T00:00:00Z", "promoted_by": "<super_admins.id>" } }
  ],
  "stats": {
    "n": 10,
    "len": { "p50": 10, "min": 7, "max": 12 },
    "opening": [ ["header","hero",0.6], ["header","slideshow",0.2] ],
    "closing": [ ["footer",0.6], ["sns",0.2] ],
    "repeat": { "product_carousel": { "p50": 2, "max": 3 }, "gallery": { "p50": 1, "max": 2 } },
    "freq": { "countdown": 0.6, "coupon": 0.1, "slideshow": 0.5, "text_card": 0.2 },
    "cta": { "p50": 1, "max": 4 },
    "text_card": { "p50": 0, "max": 1 },
    "by_type": { "media": 5, "catalog": 5 }
  },
  "perf": { "basis": null, "n": 0, "confident": false, "updated_at": null },
  "serving": { "enabled": false, "enabled_by": null, "enabled_at": null }
}
```

규칙
- `chains[].seq`는 승격 원본의 타입 순서 **그대로**(정규화 전). 정규화는 사용 시점에 `normalizeSectionChain`이 한다(DM). 이메일 chains는 화이트리스트 밖 타입이 있으면 승격 자체를 거부한다(사유 표시).
- `stats`는 저장 때마다 chains 전체에서 순수 함수로 재계산한다(`deriveSkeletonStats`). 저장된 stats를 손으로 고치지 않는다.
- `src` ∈ `human`(ai_prompt NULL) | `human_edited`(ai_prompt 존재). 파이프라인 산출물은 후보에서 제외되므로 값이 없다.
- `perf`는 1차에서 쓰지 않는다. 자리만 둔다(합의 · 성과 환류는 별건).
- `serving`은 행 단위. 초판 서빙 행 = (`general`, `DM`) · (`general`, `EMAIL`) 2행. 업종별 행은 저장은 허용, 서빙은 각 행의 토글.
- 저장 함수는 read-modify-write: 기존 행 있으면 chains append(같은 `ref.id` 무시) + stats 재계산 + serving 보존 + content 재조립 → UPDATE. 없으면 INSERT(serving.enabled=false).

---

## 5. 백엔드 계약

### 5-1. 파일별 소유
| 파일 | 소유 | 성격 |
|---|---|---|
| `packages/backend/src/utils/dm/dm-structure-resolve.ts` (신설) | `inferAuthorType` · `deriveSkeletonStats` · `buildSkeletonContent` · `reduceStructure` · `resolveStructure` · `stableHash` | **순수** (DB·AI·ENV import 0) |
| `packages/backend/src/utils/email/email-structure-prompt.ts` (신설) | `renderStructureBlock(stats)` | 순수. 시퀀스 원문 0 |
| `packages/backend/src/utils/best-copy-assets.ts` (확장) | `getStructureSkeleton` · `saveStructureSkeleton`(append) · `setStructureServing` · `listStructureSkeletons` | DB. 42P01·예외 = null/false |
| `packages/backend/src/utils/reference-skeleton-promote.ts` (신설) | `listPromotionCandidates` · `promoteReferenceSkeleton` | DB. 후보 조회 게이트·타입 추출·저장 호출 |
| `packages/backend/src/utils/dm/dm-ai.ts` (변경 1곳) | 체인 결정 분기에 `learned` 단 1개 + `OneShotResult.structureSource` | 공용 CT. 계약 테스트 캡처 선행 |
| `packages/backend/src/utils/email-ai.ts` (변경 1곳) | `generateEmailSections` system 뒤 블록 1 | 공용 CT. 캡처 선행 |
| `packages/backend/src/utils/sales-outreach-produce.ts` (변경 1곳) | 골격 읽기 → 감산 → `structure` 전달 · asset payload `structureRef` | 아웃리치 파일(불변 20) |
| `packages/backend/src/utils/planner-production.ts` (변경 2곳) | `produceDm`에 `disableLearnedStructure: true`(1차) · `produceEmail` 무변경(자동 수혜) · 묶음 ④에서 eventText 확장 | 호출부 |
| `packages/backend/src/routes/admin.ts` (라우트 4) | `/best-copy/skeleton` GET · `/candidates` GET · `/promote` POST · `/serving` POST | `authenticate, requireSuperAdmin` |
| `packages/backend/src/utils/__tests__/reference-skeleton-invariants.test.ts` (신설) · `dm-structure-resolve.test.ts` (신설) | §9 계약 | vitest |

### 5-2. 유형 추정 `inferAuthorType(seq, channel)`
- `DM`: `count(video, youtube_embed, instagram_embed, slideshow) >= 2` → `media`, 아니면 `catalog`.
- `EMAIL`: 마지막 타입이 `footer` → `catalog`, 아니면 `media`.
- `text_card` 축은 쓰지 않는다(DM 2/10 · 이메일 9/9라 판별력 0).

골든 검증표(계약 §9-8이 이 표를 고정한다):

| 브랜드 | DM seq | DM 유형 | EMAIL seq | EMAIL 유형 |
|---|---|---|---|---|
| 조선미녀 | header>video>countdown>product_carousel>reviews>gallery>tab_cards>product_carousel>text_card>slideshow>instant_coupon>footer | media(2) | header>gallery>hero>text_card>text_card>product_carousel>cta | media |
| 무신사 | header>hero>slideshow>cta>gallery>countdown>youtube_embed>gallery>promo_code>instagram_embed | media(3) | header>gallery>hero>text_card>product_carousel>text_card>product_carousel>coupon>cta | media |
| 3CE | header>hero>product_carousel>youtube_embed>cta>slideshow>text_card>gallery>slideshow>sns | media(3) | header>hero>product_carousel>product_carousel>text_card>cta | media |
| 지그재그 | header>slideshow>product_carousel>tab_cards>youtube_embed>countdown>product_carousel>cta>sns | media(2) | header>gallery>text_card>product_carousel>text_card>product_carousel>text_card>cta | media |
| 유니클로 | header>youtube_embed>hero>product_carousel>product_carousel>coupon>countdown>slideshow>cta>gallery>gallery>store_info | media(2) | header>hero>text_card>product_carousel>coupon>cta>text_card>gallery>cta>gallery>gallery>store_info | media |
| 이폴리움 | header>hero>cta>gallery>product_carousel>cta>footer | catalog(0) | (없음) | |
| 올리브영 | header>hero>cta>product_carousel>product_carousel>gallery>gallery>cta>countdown>footer | catalog(0) | header>hero>text_card>product_carousel>text_card>cta>footer | catalog |
| 쿠팡 | header>hero>cta>product_carousel>hero>product_carousel>cta>cta>cta>footer | catalog(0) | header>hero>cta>text_card>product_carousel>text_card>product_carousel>cta>cta>cta>footer | catalog |
| 에이블리 | header>coupon>product_carousel>cta>product_carousel>gallery>cta>gallery>cta>countdown>footer | catalog(0) | header>hero>text_card>coupon>product_carousel>text_card>cta>footer | catalog |
| 스파오 | header>hero>slideshow>product_carousel>product_carousel>product_carousel>gallery>cta>gallery>footer | catalog(1) | header>hero>text_card>product_carousel>cta>text_card>cta>gallery>footer | catalog |

DM 5:5, 이메일 4:5. 브랜드 단위로 DM·이메일 유형이 일치한다. 이메일 유니클로는 `store_info` 마감이라 media(비footer)로 분류되며 이는 실물 작성자 축(임은지)과 일치한다.

### 5-3. 통계 `deriveSkeletonStats(chains)`
- `len` p50·min·max / `opening` = (seq[0], seq[1]) 쌍 빈도 상위 3 / `closing` = 마지막 타입 빈도 상위 2 / `repeat` = 타입별 건당 등장 수 p50·max(등장한 건만) / `freq` = 타입별 등장 비율 / `cta`·`text_card` p50·max / `by_type` 유형 수.
- 상한을 만들지 않는다(불변 6).

### 5-4. 감산 `reduceStructure(types, avail)`
`avail` 3값(`present` | `absent` | `unknown`) · 불변 10과 같은 형태. **unknown = 감산 0.**

| 축 | present | absent | 제거 대상 |
|---|---|---|---|
| `products` | count ≥ 1 | 0 | `product_carousel` 전부 |
| `benefit` | 면허 인용 또는 원문 혜택 존재 | 없음 | `countdown` `coupon` `instant_coupon` `promo_code` `limited_quantity` |
| `embeds` | 허용 | 불허 | `youtube_embed` `instagram_embed` `video` |
| `social` | 허용 | 불허 | `sns` `reviews` |
| `media` | 1차 미사용(unknown 고정) | | `gallery` `slideshow` 초과분(2차) |

호출부별 `avail`(1차):
| 호출부 | products | benefit | embeds | social |
|---|---|---|---|---|
| 편집기 자유 프롬프트(`routes/dm.ts`) · eventText 없음 | unknown | unknown | unknown | unknown |
| 편집기 · eventText 있음 | brief.products.length로 present/absent | brief.benefit 유무 | unknown | unknown |
| 원스텝(`content-interview`) | `structure` 전달 = human 축이라 학습 골격 미사용 | | | |
| 플래너 DM | 1차 `disableLearnedStructure: true` | | | |
| 아웃리치(`sales-outreach-produce`) | `input.eventText`의 추출 상품 수 | `selectedEvent.benefitLicensed` | **absent(상시)** | **absent(상시)** |

아웃리치 embeds·social 상시 absent 근거 = 타사 채널 콘텐츠를 영업 산출물에 싣는 것은 불변 11(사람이 고른 이미지 1장·로고 금지)의 취지와 충돌(회의론자 최종 검증).

### 5-5. 선택 `resolveStructure(input)`
```ts
export type StructureSource = 'human' | 'scenario' | 'learned' | 'ai';
export interface ResolveInput {
  human?: SectionType[];              // opts.structure.sectionTypes
  scenario?: SectionType[];           // scenarioMeta.sections
  learned?: SkeletonMeta | null;      // getStructureSkeleton(...)?.meta (serving.enabled 확인은 조회 함수가 한다)
  variant: 'media' | 'catalog';
  seed: string;                       // §5-6
  avail: Avail;                       // §5-4
}
export function resolveStructure(i: ResolveInput): { types: SectionType[] | null; source: StructureSource; chainIdx: number | null }
```
- 사다리: `human` → `scenario` → `learned` → `null`(호출부가 기존 `designSectionLayout` 경로를 그대로 탄다).
- `learned` 선택: `variant`와 같은 `author_type` chains 중 `stableHash(seed) % n` 번째. 같은 유형이 0건이면 전체 chains에서 고른다. chains가 0건이면 null.
- 선택된 seq에 `reduceStructure` 적용 후 반환. 정규화(`normalizeSectionChain`)는 호출부가 기존 자리에서 한다(scenario 경로처럼 정규화를 건너뛰지 않는다: learned는 자유 프롬프트 계열이다).
- `variant` 결정(호출부 공통 규칙, `dm-structure-resolve.ts`의 `pickVariant(avail, productCount, seed)`): `products=present && count >= 3` → `catalog` / `products=present && count < 3` → `media` / `unknown|absent` → `stableHash(seed) % 2`. 근거: catalog 실물의 정의가 "product_carousel 반복"이라 상품 수와 정합. 편집기 unknown 경로는 해시 교대로 단조를 막는다.

### 5-6. seed와 해시
- `seed = ${companyId}:${eventTitle || prompt.slice(0,40)}:${YYYY-MM-DD(KST)}`. 회사 단독이면 한 회사가 늘 같은 골격(단조)이라 행사·일자를 섞는다(회의론자).
- `stableHash` = djb2(32bit). `Math.random`·`Date.now` 불사용. 테스트는 seed 주입으로 결정성 고정.
- 일자는 호출부가 넘긴다(`nowKst` 인자). 순수 함수 안에서 `new Date()`를 부르지 않는다.

### 5-7. 조회·저장 `best-copy-assets.ts`
```ts
export async function getStructureSkeleton(industryCode: string, channel: 'DM'|'EMAIL', opts?: { requireServing?: boolean }): Promise<{ id: string; content: string; meta: SkeletonMeta } | null>
// requireServing 기본 true: serving.enabled=false면 null. 예외·42P01 = null(throw 0).
export async function saveStructureSkeleton(industryCode: string, channel: 'DM'|'EMAIL', newChains: SkeletonChain[]): Promise<{ ok: true; added: number; total: number } | { ok: false; reason: 'table_missing'|'db_error' }>
// read-modify-write append. 같은 ref.id 무시. stats 재계산. serving 보존. content 재조립.
export async function setStructureServing(industryCode: string, channel: 'DM'|'EMAIL', enabled: boolean, by: string): Promise<boolean>
export async function listStructureSkeletons(): Promise<Array<{ industryCode; channel; n; serving; updatedAt }>>
```
- 생성 경로에서는 `getStructureSkeleton('general', channel)`만 부른다(초판). 업종별 서빙은 §13 후속.
- 동시 승격 경합: 슈퍼관리자 1인 화면이라 트랜잭션 잠금은 두지 않되, UPDATE는 `WHERE id=$1 AND meta->'chains' = $prevChains` 형태의 낙관 검사로 덮어쓰기를 막고 실패 시 1회 재시도.

### 5-8. 이메일 블록 `renderStructureBlock(stats)`
```
## 같은 채널 참조 골격 통계 (구성 지침 · 실물 아님 · 위 블록 type만 사용)
- 블록 수: 보통 8개(6~12)
- 시작: header 다음에 hero(67%) 또는 gallery(33%)
- 본문: text_card 보통 2개, product_carousel 보통 1~2개
- 행동 유도(cta): 보통 1개, 최대 2개 권장
- 마감: cta로 끝나는 경우 56%, footer 44%
- 위는 구성 통계일 뿐이다. 블록 type만 고르고 문구·혜택·상품·수치는 [행사 내용]에 있는 것만 쓴다.
```
- 출력에 URL·숫자+`%`(통계 비율 제외)·상품명·브랜드명이 들어갈 입력 자체가 없다(stats만 받는다). 계약 §9-6.
- `EMAIL_BLOCKS_SYSTEM:361` "권장 순서" 한 줄은 **무변경**. 블록이 시퀀스가 아니라 통계라 모순되지 않는다.

---

## 6. 주입 배선

### 6-1. DM (`dm-ai.ts` 체인 결정 분기)
```ts
} else if (prompt) {
  const learned = opts.disableLearnedStructure ? null : await getStructureSkeleton('general', 'DM');
  const picked = learned ? resolveStructure({ learned: learned.meta, variant, seed, avail }) : { types: null, source: 'ai', chainIdx: null };
  if (picked.types) {
    sectionTypes = normalizeSectionChain(picked.types, spec.objective);
    structureSource = { source: 'learned', skeletonId: learned.id, chainIdx: picked.chainIdx, variant };
  } else {
    const aiChain = await designSectionLayout(spec, opts.companyId);   // 기존 그대로
    sectionTypes = normalizeSectionChain(aiChain, spec.objective);
  }
}
```
- `structure`·`scenario` 분기는 손대지 않는다(사다리 상위 2단이 코드 순서로 성립).
- `OneShotResult`에 `structureSource?: { source: StructureSource; skeletonId?: string; chainIdx?: number; variant?: string }` 추가(가산 필드 · 기존 소비처 무영향).
- `opts.disableLearnedStructure?: boolean`(기본 false) = 탈출구 1개. opt-in 파라미터는 만들지 않는다(소비처 4곳 배선 누락 = 조용한 옛 동작).
- `avail`·`variant`·`seed`는 `oneShotGenerate` 안에서 `brief`·`opts.prompt`·`opts.companyId`·KST 일자로 만든다. 편집기 eventText 없음 = brief null = unknown.

### 6-2. 이메일 (`email-ai.ts generateEmailSections`)
```ts
const skeleton = await getStructureSkeleton('general', 'EMAIL');      // serving off·예외 = null
const structureBlock = skeleton ? renderStructureBlock(skeleton.meta.stats) : '';
system: baseSystem + brain.promptSuffix + structureBlock,
```
- `EmailSectionsGenResult`에 `structureSource?: { skeletonId: string }` 가산.

### 6-3. 아웃리치 (`sales-outreach-produce.ts produceOutreachDm`)
```ts
const skeleton = await getStructureSkeleton('general', 'DM');
const structure = skeleton
  ? (() => { const r = resolveStructure({ learned: skeleton.meta, variant, seed, avail: { products, benefit: input.benefitLicensed ? 'present' : 'absent', embeds: 'absent', social: 'absent' } });
             return r.types ? { sectionTypes: r.types } : undefined; })()
  : undefined;
const gen = await oneShotGenerate({ prompt, companyId, eventText, ...(structure ? { structure } : {}) });
```
- `structure`로 넘기므로 CT 안에서는 human 축(최상위)이 된다. `designSectionLayout` 미호출 = 결정성.
- `produceOutreachDm` 입력에 `benefitLicensed: boolean` 추가(호출부 `sales-outreach-jobs.ts:464` 부근이 `selectedEvent.benefitLicensed`를 넘긴다).
- asset payload(`kind='dm'`)에 `structureRef: { skeletonId, chainIdx, variant, removed: string[] } | null` 저장(근거 패널이 지어내지 않게). `insertAssetOwned` 형태 그대로(payload jsonb).
- `sales-outreach-style.ts`는 이번 축에서 무변경. 스타일 규칙 층은 그대로, 실물 참조는 이 CT가 맡는다(문서 헤더 주석만 후속 갱신).

### 6-4. 플래너 (`planner-production.ts`)
- `produceEmail`: 무변경(`generateEmailSections` 내부 주입으로 자동 수혜).
- `produceDm`: 1차 `oneShotGenerate({ ..., disableLearnedStructure: true })`. 근거 = 섹션 9~12는 빈 이미지 자리를 비례 증가시키고 §3-20 발행 게이트(빈 자리 0)가 완주율을 깎는다(기획 남는 반대 · 회의론자 동의).
- 묶음 ④(재료 확장): `buildPlannerEventText`(공용 · 문자·DM·이메일 4곳 공유)는 **무변경.** `produceDm`·`produceEmail` 호출부에서 `eventText`에 줄을 덧붙인다: `[브랜드] ${brandBasicInfo 요약}` · `[행사 목적] ${tp.objective 또는 timing 설명}` · `[유의사항] ${ev.notes}`(존재 시). 혜택은 원문 그대로(생성 0). 이 확장이 끝난 뒤 `disableLearnedStructure`를 제거한다. 확장 필드의 실재(`brand_basic_info` 컬럼·`planner_events` 필드)는 그 묶음 착수 시 information_schema로 확인한다.

---

## 7. 승격 (슈퍼관리자)

### 7-1. API (`routes/admin.ts` · `authenticate, requireSuperAdmin`)
| 메서드 | 경로 | 입력 | 출력 |
|---|---|---|---|
| GET | `/best-copy/skeleton` | `channel?` | `listStructureSkeletons()` + 각 행 `stats`·`chains`(seq·author_type·ref.kind·promoted_at) |
| GET | `/best-copy/skeleton/candidates` | `companyId`(기본 `OUTREACH_COMPANY_ID`) · `channel` · `limit≤50` | 후보 목록(§7-2) |
| POST | `/best-copy/skeleton/promote` | `channel` · `industryCode`(`isIndustryCode` 또는 `general`) · `items:[{id, authorTypeOverride?}]` | `{ added, skipped:[{id, reason}] }` |
| POST | `/best-copy/skeleton/serving` | `industryCode` · `channel` · `enabled` | `{ ok }` |
- 테이블 부재 = 503 `DB_MIGRATION_PENDING`(기존 패턴 `admin.ts:4982`).

### 7-2. 후보 게이트 `listPromotionCandidates`
- DM: `dm_pages.company_id = $company AND status = 'published'` · 제목이 `[플래너]`·`[영업]`으로 시작하지 않음 · `id NOT IN (플래너 exec_meta dm_id)` · `id NOT IN (sales_outreach_assets kind='dm' payload dmId)`. 섹션 수는 `extractFlatSectionsFromDm`으로 세되 **type만** 사용. 섹션 3개 미만은 후보 표시하되 승격 거부 사유 "미완성".
- EMAIL: `email_campaigns.company_id = $company AND sections IS NOT NULL` · 이름 `[플래너]` 제외 · `id NOT IN (플래너 exec_meta email_campaign_id)`. 화이트리스트 밖 타입 포함 시 거부 사유 표시.
- 응답 필드: `id · title/name · createdBy(이름) · createdAt · sectionCount · types[] · inferredAuthorType · alreadyPromoted(ref.id 존재)`. props는 응답에 싣지 않는다.
- 파이프라인 제외 join의 컬럼·키는 §11에서 실측한 뒤 SQL을 확정한다.

### 7-3. 승격 `promoteReferenceSkeleton`
1. 후보 게이트 재검사(화면을 믿지 않는다).
2. `seq = types`, `author_type = override ?? inferAuthorType(seq, channel)`, `author_type_source`, `src = ai_prompt ? 'human_edited' : 'human'`, `ref`.
3. `saveStructureSkeleton(industryCode, channel, [chain])` append.
4. 응답에 정규화 예고를 싣는다: DM은 `normalizeSectionChain(seq)`와 원본 차이(footer 부착·maxCount 초과 제거) 목록. 화면이 한 줄로 알린다(자동 보정을 조용히 하지 않는다).

---

## 8. 화면 (`/admin/best-copy` · `BestCopyPage.tsx`)

하한 = LESSONS_FRONTEND "디자인 최소 기준"(`bg-slate-950` + `border-white/10` + violet 액센트 · 모바일 반응형 · ConfirmModal/커스텀 모달 · Source caption · 모델명 0).

### 8-1. "참조 골격" 패널 (승리 공식 패널 `:359~387` 바로 아래 · 같은 규격)
- 헤더: "참조 골격" + 채널 칩(DM · 이메일) + [참조 골격 올리기] 버튼(violet).
- 본문(채널·현재 업종 칩 기준 행): 표본 n · 길이 p50(범위) · 시작 상위 2 · 마감 상위 2 · 반복(product_carousel p50) · 유형 수(media/catalog는 화면에 "이벤트형/상품형"으로 표기). 서빙 토글(스위치 + "켜면 자동 생성이 이 골격을 참고합니다"). 표본 0 = `:381` 형식 문구 "아직 참조 골격이 없습니다. [참조 골격 올리기]로 직원 실물을 올려주세요."
- chains 목록: 행마다 유형 칩 + 타입 칩 나열(flex-wrap · 12개 초과는 접기) + ref 종류·승격일. 문구·이미지·브랜드명 표시 없음.
- Source caption: `Data source: best_copy_assets(kind=structure)`.

### 8-2. 승격 모달 (전용 커스텀 모달 · `bg-slate-900 border-white/10 rounded-2xl shadow-2xl`)
- 상단: 회사 select(기본 인비토 = `OUTREACH_COMPANY_ID` 회사 · 목록은 기존 `/admin/companies` 계열 API 재사용) · 채널 탭.
- 본문: 후보 목록(제목 · 작성자 · 생성일 · 섹션 n · 유형 추정 칩(클릭 시 토글 = 필드 수 증가 0) · 이미 올림 배지 · 거부 사유). 체크박스 다중 선택.
- 하단: 업종 select 1개(기본 `general`) + [올리기]. 응답의 정규화 예고를 토스트/인라인 한 줄로("무신사: 끝에 footer가 붙습니다").
- 추가 입력은 업종 하나뿐(1클릭 원칙). 발신명은 계정 설정 축이라 여기 없음.

### 8-3. 아웃리치 검토 화면 근거 패널 (`SalesOutreachModal.tsx:766~789`)
- `:778` 문구 자리를 2단으로: `dmAsset.structureRef` 있으면 "참조 골격 n건 중 1건을 구성으로 참고했습니다(상품형)" + 빠진 섹션 있으면 "행사 근거가 없어 혜택 관련 구성 2개를 제외했습니다" / 없으면 기존 "양식 샘플 학습 전(기본형)" 문구 유지.
- 칩 대조·DM iframe 미리보기는 별건(§13).

### 8-4. 플래너 화면
- 1차 변경 없음(플래너 DM은 탈출구, 이메일은 통계 주입뿐이라 "참조" 표시가 과장이 된다).

---

## 9. 무후퇴 계약 테스트 (착수 전 먼저 작성 · vitest)

| # | 단언 | 파일 |
|---|---|---|
| 1 | `structure` 인자 있으면 `designSectionLayout`·`getStructureSkeleton` 호출 0 | invariants |
| 2 | `scenario` 있으면 `getStructureSkeleton` 호출 0(사다리: 시나리오 > 참조) | invariants |
| 3 | serving off · 골격 null · 조회 예외(모킹 throw) 세 경우 모두 `designSectionLayout`에 가는 system === 현행 `SECTION_LAYOUT_SYSTEM` 스냅샷 · 결과 sectionTypes 동일 | invariants |
| 4 | 이메일: 골격 null이면 system === `baseSystem + brain.promptSuffix`(문자 단위) | invariants |
| 5 | 골든 DM 10건 seq를 `normalizeSectionChain`에 넣어 순서 보존 + footer 부착 4건(무신사·3CE·지그재그·유니클로) + **cta 최소 보장 추가 1건(조선미녀 · 실물 cta 0)** + **hero 최소 보장 앞 추가 2건(지그재그·에이블리 · hero·text_card 없이 slideshow/coupon으로 시작)** + maxCount 초과 제거 0건을 **명시 승인** | resolve.test |
| 6 | `renderStructureBlock` 출력에 `http`·`www`·`원`·브랜드명 토큰 0(stats만 입력) · 시퀀스 배열 문자열 0 | resolve.test |
| 7 | `reduceStructure` 반환 ⊆ 입력 · avail 전부 unknown이면 항등 | resolve.test |
| 8 | `inferAuthorType` 골든 19건 = §5-2 표 | resolve.test |
| 9 | `resolveStructure` 같은 seed 반복 100회 동일 · seed 다르면 chainIdx 분포가 1개 값에 고정되지 않음 | resolve.test |
| 10 | `saveStructureSkeleton` 2회(같은 ref.id 포함) 후 chains.length 증가 = 신규 id 수 · `serving.enabled` 보존 · stats 재계산 | invariants(모킹 pool) |
| 11 | 플래너 `produceDm` 호출이 `disableLearnedStructure: true`를 넘긴다 | invariants(readCode) |
| 12 | 아웃리치 `produceOutreachDm`이 넘기는 avail에 `embeds:'absent'`·`social:'absent'` 고정 | invariants(readCode) |
| 13 | 승격 경로 어디에서도 `props`를 읽지 않는다(readCode: `reference-skeleton-promote.ts`·`dm-structure-resolve.ts`에 `.props` 문자열 0) | invariants |
| 14 | 회귀 주입 검증: `reduceStructure`를 "더하기"로 망가뜨려 7이 실제로 깨지는지 확인 후 원복(LESSONS_BACKEND 0801: 소스 스캔은 조건 반전을 못 잡는다) | 착수 절차 |

기존 `sales-outreach-invariants.test.ts`·`content-interview.test.ts`는 전체 스위트로 함께 돌린다(패키지 전체 실행 원칙).

---

## 10. 착수 순서·묶음 (파일 교집합 0 = 병행 가능 · **활성화만 순서**)

| 묶음 | 내용 | 코드 | 선행 |
|---|---|---|---|
| ① | 아웃리치 본체 ENV 등록(FEATURE §4) + 운영 1건 완주 + DM 새 탭 육안 확인. 완주 산출물에 `structureRef: null`·배포 리비전 기록 | 0 | 없음 |
| ② | 저장·승격: `best-copy-assets` CT 4 · `dm-structure-resolve.ts` · `reference-skeleton-promote.ts` · 라우트 4 · BestCopyPage 패널+모달 · 계약 5~10·13 | 있음 | §11 실측 |
| ③ | 주입: `dm-ai` 분기 1 + `OneShotResult` 가산 · `email-ai` 블록 1 · `email-structure-prompt.ts` · 아웃리치 감산·전달·structureRef · 근거 패널 문구 · 플래너 DM 탈출구 · 계약 1~4·11·12 | 있음 | ② |
| ④ | 플래너 재료: `produceDm`·`produceEmail` 호출부 eventText 확장 · DM 탈출구 해제 · 실측 5건 | 있음 | ③ + 필드 실측 |
| 활성화 | ①·② 배포 → 직원 실물 10+9건 승격 → ③ 배포(토글 off) → 운영 1건 완주 재확인 → 토글 on → 아웃리치·편집기 실측 각 1건 | | |

②③ 병행이 ① 판정을 흐리지 않는 이유: 골격 행이 없거나 토글 off면 `learned=null`이라 ③이 먼저 배포돼도 결과가 같다(회의론자 최종 검증 (마)).

Codex: ②·③은 DB 쓰기 경로(승격 저장)와 공용 CT 변경을 포함하므로 `/codex:review` 대상. ④는 호출부 확장이라 계약 테스트 통과 시 면제 후보(Harold 판단).

---

## 11. 착수 전 실측 SQL (코드 0 · 하나씩 · 결과를 받은 뒤 코드)

1. `best_copy_assets.kind` CHECK 제약 유무:
```sql
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'best_copy_assets'::regclass;
```
2. 파이프라인 제외 join 컬럼 실재:
```sql
SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND ((table_name='planner_touchpoints' AND column_name='exec_meta') OR (table_name='sales_outreach_assets' AND column_name IN ('kind','payload'))) ORDER BY 1,2;
```
3. 참조 실물의 파이프라인 귀속 0건 확인(11 DM id는 short_code로, 이메일 9건은 name으로):
```sql
SELECT d.title, d.id, (d.ai_prompt IS NOT NULL) AS ai_edit, EXISTS(SELECT 1 FROM planner_touchpoints t WHERE t.exec_meta->>'dm_id' = d.id::text) AS planner, EXISTS(SELECT 1 FROM sales_outreach_assets a WHERE a.kind='dm' AND a.payload->>'dmId' = d.id::text) AS outreach FROM dm_pages d WHERE d.short_code IN ('SLk8T3v','SCYg0SA','JqkQnXs','hZ9Bg12','CKSUeUJ','SMMww74','Q59eDMq','lb0NuGC','guUAc2J','PXSYpl6') ORDER BY d.created_at;
```
(2번 결과에 따라 3번의 컬럼명을 확정한다. 2번 전에 3번을 실행하지 않는다.)

---

## 12. Harold 결재 항목

| # | 항목 | 이 문서의 기본값 |
|---|---|---|
| ① | §10 광고성 판단 주체·시점(아웃리치 발송 축) | 미확정 유지 · 발송 잠금 유지 |
| ② | 수신거부 문구 원문 | 미확정 유지 |
| ③ | 일일 상한 | 설계서 제안 30 |
| ④ | 발신 도메인 | hanjul@invitocorp.com |
| ⑤ | 일괄 승인 1클릭 최대 건수 | 미정(이 축 범위 밖) |
| ⑥ | 학습 점수 자동 통과 채택 | **부결 권고**(불변 14) |
| ⑦ | 네이버 앱 "사용 API"에 쇼핑 검색 추가 가능 여부 확인 | Harold 확인 · 이 축 범위 밖 |
| ⑧ | 직원 이메일 9건 발신명 `모바일` 정리 지시 | 승격 대상은 골격뿐이라 학습에는 무관 · 실발송 품질 축 |
| ⑨ | 사다리에서 빠른 시작 시나리오 > 참조 골격 | 주재자 택 = 시나리오 위 |
| ⑩ | 원가: 섹션 수 증가 = 섹션별 카피 호출 증가(aiAware 18종 · 5~8 → 9~12) · 과금은 완성 시점 고정이라 매출 불변 | 측정 후 처방(활성화 뒤 실측 1주 AI 비용 대비) |

---

## 13. 범위 밖 · 별건 기록 (이번 축에 넣지 않는다)

| 항목 | 처리 |
|---|---|
| 성과 환류(`dm_views`·`email_events` → `meta.perf`) | 별건. 정답지 10건은 발송 대상이 없어 성과 0 · DM은 분모 없음 · email open은 프록시 오염 → 클릭만 |
| 업종별 서빙 | 저장은 가능. 서빙 토글 UI는 있으나 생성 경로는 초판 `general`만 조회. 업종 조회 확장 = 2차 |
| 회사 스코프 참조(고객사 관리자가 자기 실물을 올림) | 제외(저장 축 2개 = 이중 진실) |
| DM 목록 카드 액션 행의 클릭 전파(`DmBuilderPage.tsx:1840~1880` · 프론트 역할 지적 · **미검증**) | 실측 후 BUGS 등재 판단. 이 축은 고객 카드에 버튼을 안 붙이므로 무관 |
| 아웃리치 DM 탭 실물 미리보기 | 별건. 관리자 열람이 `trackDmView`로 `view_count`·`dm_views`를 오염시킨다(`dm-builder.ts:842·868`) → 추적 없는 SSR html asset + `srcDoc` sandbox 액자가 선결 |
| 칩 2단 대조(참조 골격 vs 이번 산출물) | 별건. asset `structureRef`가 쌓인 뒤 |
| 소재 밀도(실사진·상품 수) · `attachMallImagesToProductCarousels` DM 경로 | 2차 검토 |
| 이메일 정규화 신설(CTA≥1·footer) | 하지 않는다. 공용 CT 변경 = 전 캠페인 생성 변경. CTA 0은 검토 화면 경고 칩(별건) |
| `sales-outreach-style.ts` 헤더 주석·`sampleTrained` 의미 갱신 | ③ 배포 시 주석만 |
| `status/STATUS.md:81` "ENV+DDL만 남음" → "ENV만 남음" | 문서 정정 1줄(①에서) |
| 스마트스토어 입력 축 | 0731 설계서 §16-9-1 재개 조건 그대로 |
| `email_events` 컬럼 실측 | 환류 착수 시 |

---

## 14. 회의 이력 · 뒤집힌 판단 (같은 자리에서 다시 틀리지 않으려고)

1. 백엔드 "`designSectionLayout` 안에 힌트 + 하한 미달 시 `chains[0]` 폴백" → **접음.** 확률적이고 새 임계 상수를 낳는다. 결정적 선택으로.
2. 회의론자 "`resolveStructure` 신설 불필요(주입이 함수 안이면 우선순위가 성립)" → 백엔드가 결정적 선택으로 옮기며 **순수 함수 하나가 사다리를 소유**하는 형태로 수렴. 회의론자 동의.
3. 디자이너 "리듬 규격을 별도 저장 단위로" → `stats`에 흡수(신규 키 `opening` 1개).
4. 디자이너 "AI에게 변주 시키기" → 복수 chains + 해시 선택 + 감산으로 대체.
5. 디자이너 "승격 모달 3필드(업종·유형·발신명)" → 업종 1필드 + 유형 칩 토글. 발신명은 계정 설정 축.
6. 디자이너 "상한값(carousel ≤3 등)을 학습층이 든다" → registry가 유일 소유(이중 진실).
7. 기획 "학습층은 본체 배포 다음" → 파일 교집합 0이라 병행. 활성화만 순서.
8. 기획 "승격 UI 신설 안 함" ↔ 프론트 "카드 1클릭 2곳" → 슈퍼관리자는 고객 화면에 들어가지 않는다는 라우트 실측(`App.tsx:296~320`)으로 **`/admin/best-copy` 모달 1개**로 수렴.
9. 회의론자 "`ai_prompt IS NULL` 게이트" → 참조 10건 전부 ai_prompt 존재 실측으로 **파이프라인 귀속 제외**로 정정.
10. 기획·백엔드 "참조 골격 > 시나리오" → 주재자 택 "시나리오 > 참조 골격"(갈린 지점 · 결재 ⑨).
11. 백엔드 "`normalizeAiBlocksToSections`에 CTA≥1 보강" → 접음(공용 CT 변경 · 링크 면허 없을 때 빈 CTA).
12. 프론트 "학습 반영 배지를 목록 카드에" → 접음. 신뢰가 필요한 자리는 검토 화면(근거 패널 문구).
13. 백엔드 "MIN_SEEDS=3 미러" → 접음(임계 상수 금지). 서빙 토글 + 표본 수 노출.
14. 회의론자 "성과 열람 수로 골격 순위" → 1차 제외. 표시 전용 통계로 시작.

---

## 15. 검증 상태 선언

- (가) 내가 실행해 본 것: grep·파일 읽기로 §3-1·§3-2·§3-5의 파일:행, 라우트·화면 구조, 화이트리스트, 정규화 규칙.
- (나) Harold가 실행해 준 것: §3-3 컬럼 실측 3테이블, §3-4 실물 목록·시퀀스, `best_copy_assets` 실재.
- (다) 추론(미검증): §3-3 ⚠ 3건(CHECK 제약·exec_meta·payload 키) → §11에서 실측 후 코드. §6-4 확장 필드 실재. 원가 증가폭(§12-⑩).
- 이 문서는 회의 결론을 옮긴 것이며, 구현 착수는 Harold 승인 뒤 `workflow_4_1` 순서(§11 실측 → 계약 테스트 작성 → 묶음 ② → ③ → ④)로 한다. 상설 SoT 승격(`docs/FEATURE-REFERENCE-SKELETON.md`)은 ③ 배포·실측 뒤 판단하고, 그 전까지는 이 문서가 `status/SOT-INDEX.md` §2(설계·정의 문서 · 착수 대기)에 등재된다. STATUS §2 카드는 착수 승인 시점에 만든다.

---

## 16. 구현 결과 (2026-09-03 · 코드 완료 · 배포 대기)

### 16-1. §11 실측 결과 (Harold 실행)
| # | 결과 |
|---|---|
| 1 | `best_copy_assets` 제약 = PK뿐(CHECK 없음) → `kind='structure'` INSERT 가능 |
| 2 | `planner_touchpoints.exec_meta jsonb` · `sales_outreach_assets.kind text` · `payload jsonb` 실재 |
| 3 | 참조 DM 10건 전부 플래너 f · 아웃리치 f · `ai_prompt` 존재(→ `src='human_edited'`) |

### 16-2. 파일
| 파일 | 변경 |
|---|---|
| `packages/backend/src/utils/dm/dm-structure-resolve.ts` | 신설 · 순수(extractTypeSequence · inferAuthorType · deriveSkeletonStats · buildSkeletonContent · seedDateKey · stableHash · pickVariant · reduceStructure · resolveStructure · emptySkeletonMeta · appendChains · normalizationNotes) |
| `packages/backend/src/utils/email/email-structure-prompt.ts` | 신설 · `renderStructureBlock(stats)` |
| `packages/backend/src/utils/best-copy-assets.ts` | `getStructureSkeleton` · `listStructureSkeletons` · `saveStructureSkeleton`(append · jsonb 동등 비교 낙관 잠금 · 1회 재시도) · `setStructureServing` |
| `packages/backend/src/utils/reference-skeleton-promote.ts` | 신설 · `listPromotionCandidates` · `promoteReferenceSkeleton`(파이프라인 귀속 제외 · 화이트리스트 검사 · 정규화 예고) |
| `packages/backend/src/utils/dm/dm-ai.ts` | 체인 결정 분기에 참조 골격 1단(사다리: structure > scenario > learned > AI) · `disableLearnedStructure` 탈출구 · `OneShotResult.structureSource` |
| `packages/backend/src/utils/email-ai.ts` | `generateEmailSections` system 뒤 통계 블록(없으면 '') |
| `packages/backend/src/utils/sales-outreach-produce.ts` | `pickOutreachStructure`(면허 없으면 혜택 섹션 제외 · 임베드·sns 상시 제외) → `structure` 명시 전달 · `structureRef` 반환 |
| `packages/backend/src/utils/sales-outreach-jobs.ts` | `benefitLicensed` 전달 · asset payload `structureRef` |
| `packages/backend/src/utils/planner-execution.ts` | `buildPlannerExtraMaterial`(순수 · 브랜드 기본정보·발송 시점) |
| `packages/backend/src/utils/planner-production.ts` | `buildPlannerProductionEventText`(공용 4줄 + 확장 재료) · DM·이메일 제작 호출부 2곳. **DM 탈출구는 두지 않았다**(재료 확장을 같은 배포에 넣었고 서빙 토글이 기본 off라 활성화 전 동작 변화 0) |
| `packages/backend/src/routes/admin.ts` | `/best-copy/skeleton` GET · `/candidates` GET · `/promote` POST · `/serving` POST (`requireSuperAdmin` · 안전 문구 · 503 `DB_MIGRATION_PENDING`) |
| `packages/frontend/src/pages/BestCopyPage.tsx` | 참조 골격 패널(채널 칩 · 통계 타일 · 골격 목록 · 서빙 토글) + 올리기 모달(후보 체크 · 유형 칩 토글 · 업종 1필드 · 정규화 예고 토스트) |
| `packages/frontend/src/components/admin/SalesOutreachModal.tsx` | 근거 패널 2단 문구(`structureRef` 있으면 "참조 골격 n건 중 1건 참고 · 제외 n개") |
| `packages/backend/src/utils/sales-outreach-style.ts` | 헤더 주석 1줄(실물 참조는 참조 골격 CT로 위임) |
| 테스트 | `__tests__/dm-structure-resolve.test.ts`(19) · `__tests__/reference-skeleton-invariants.test.ts`(8) |

### 16-3. 설계 대비 정정 2건
1. §8-2 회사 select: 슈퍼관리자 회사 목록 API가 없어 **후보 회사 = `OUTREACH_COMPANY_ID` 고정**(응답에 회사명 표시). 다른 회사 승격은 후속.
2. §9-5 명시 승인 목록에 **조선미녀 cta 최소 보장 1건 + 지그재그·에이블리 hero 최소 보장 2건** 추가(`normalizeSectionChain`의 전환·콘텐츠 최소 보장 = 발송 가능성 조건이라 이 축은 손대지 않는다 · 승격 화면이 예고 문구로 알린다). 실물 관찰 정정 = product_carousel 9/10(무신사 없음).

### 16-4. 검증
- 백엔드 `tsc --noEmit` 0 · 프론트 `tsc --noEmit` 0 · vitest 신규 27건 통과 · 전체 스위트 결과 = STATUS 카드 갱신 시점 기록.
- 모델명 grep 0(사용자 노출 파일) · `.props` 접근 0(순수·승격 모듈, 계약 13).

### 16-5. 배포 뒤 순서 (Harold)
①`git pull` → 백엔드 빌드·재기동 + 프론트 `build:safe` ②`/admin/best-copy` → 참조 골격 패널 → [참조 골격 올리기] DM 10건(탑텐 제외)·이메일 9건 승격(업종 = 업종 공통) ③서빙 토글은 off 상태로 두고 아웃리치 본체 운영 1회 완주 ④토글 on → 편집기 자유 프롬프트·아웃리치·플래너 이메일 각 1건 실측 → 결과와 원가(§12-⑩)를 이 문서 §16에 기록.
