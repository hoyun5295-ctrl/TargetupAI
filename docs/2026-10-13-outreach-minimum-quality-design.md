# AI 영업 「최소 품질 장치」 설계서 (2026-10-13)

> 접수 = 서수란 1008 「(AI영업) 제작 관련 건」 ①누끼 부조화·화질 ②이미지 반복 ③빈 카탈로그 ④배너 누끼 ⑤다시 만들어도 안 변함·눈에 안 들어옴.
> Harold 지시(1013) = "재료가 아무리 없어도 어느 정도의 품질은 보장 · 기본 템플릿화 · 대표 이미지 하나를 세부 카테고리 템플릿에 텍스트를 입혀 보란듯이".
> 절차 = 브레인스토밍(COLLAB §1 · 기획·프론트·백엔드·디자이너·회의론자) 1차 → 교차 토론 1R → 회의론자 최종 검증(지적 a~i 전부 반영) → Harold 승인(1013).
> 전제 = 10-09 개편([설계서](2026-10-09-outreach-redesign-design.md) R1~R14)이 10-12 22:29 운영 반영됨. 접수 샘플 3건(톤28·헤라·스킨큐어)은 개편 전 산출물.
> 빈 자리 = 누끼가 안 나오면(배너·저해상·인물) 포스터는 제품 없는 행사 템플릿 + 타이포, 그마저 숫자 유출 2회면 버려져 히어로 = 홈 배너 사본(§6 추가 과제 ①로 미뤘던 것).

## 0. 넘을 수 없는 것([FEATURE-SALES-OUTREACH](FEATURE-SALES-OUTREACH.md) §2)
- 고객 제품 픽셀은 서버가 그대로 얹는다(생성 모델 i2i 0). 인물 사진 누끼 0. 이미지 안 글자는 코드가 찍는다. 혜택 수치는 면허 있을 때만. 숫자 유출 검사 유지.
- 합성 엔진 = `composeImage`(python · 저장소에 소스 없음 · 바꾸지 못한다) 또는 Node sharp(`framePhoneCapture` · 카탈로그 카드 선례).
- DDL 0(새 값은 studio_image payload 키 안). AI 호출은 `callOutreachAi` 경유. 품질 경고는 발송을 막지 않는다(불변 27).

## 1. 결정

### A. 사다리 = 주인공 축 × 배경 축
| 축 | 값 | 뜻 |
|---|---|---|
| 주인공 `subject` | `cutout` → `photo_card` → `none` | 누끼 → 사진 카드(누끼 실패 원본을 sharp 카드로) → 없음 |
| 배경 `bg` | `ai` → `code` | AI 배경 → 코드 배경(숫자 2회 · 생성 최종 실패 · AI 0) |
- 1321의 throw(숫자 2회면 포스터 폐기)를 지운다. 코드 배경 위에도 그 판의 주인공과 같은 타이포를 얹는다.
- url null = python 합성 장애·임시 저장 장애뿐. 그때의 홈 배너 폴백(jobs 1813 · `standardMaterialsOf` 2536)은 손대지 않는다(§7 ⑥).
- 화면 표시 = 「누끼 / 사진 카드 / 글자 포스터」 3값 + `bg=code`일 때만 「 · 코드 배경」 꼬리.

### B. 누끼 성공 판정(알파 불투명 비율)
- rembg 결과: 알파 ≥128 픽셀 비율이 0.08~0.85 밖이면 누끼 실패(배경째 돌아온 것 · 접수 ④) → 그 원본은 카드 후보.
- 몰 알파 PNG: 하한 0.08만(꽉 찬 상자형 패키지를 떨어뜨리지 않는다 · `pngHasAlpha`가 이미 투명 픽셀 존재를 요구한다).
- 순수 함수 `cutoutOpaqueRatio(buf)`(sharp raw · AI 0). 값은 시작값(600 하한과 같은 지위) · 모든 시도의 비율을 heroRung에 기록해 보정한다.

### C. 카드 원천·입장(추가 다운로드 0)
- 누끼 루프(`produceOutreachImageExclusive` 1215~1260)가 받은 원본 중 인물 판정 통과 · 누끼 실패(600 미만 · 알파 비율 밖 · photo 종류)인 것을 순서대로 입장 판정한다.
- 순서 = 대표 이미지(엑셀·등록 칸) → 사람 선택 → 상품 사본 3(현행). **종류 판정이 없는 후보(대표 이미지 · 홈 판정 대상 밖 선택)는 rembg 앞에서 기존 `classifyOutreachImages`를 1장만 돌린다**(같은 판정기 · 판정이 없을 때만 · 최대 2회). banner·document = 누끼·카드 모두 건너뜀 / photo·other = rembg 건너뛰고 카드 입장 / product·알파 PNG = 누끼 시도.
- 입장 함수 `photoCardAdmit(judge, person)`(순수): product → 통과 · photo·other ∧ text=false → 통과 · banner·document·판정 없음(판정 실패) → 금지 · 인물은 strictPerson 무관 none만.
- **사람이 정한 원천(대표 이미지 · 사람 선택)은 카드 입장을 통과하면 그 자리에서 멈춘다**(확정한 것이 산출물에서 사라지지 않게 · 불변 43의 원리). 상품 사본은 누끼를 끝까지 찾고 첫 카드 통과분은 기억만.
- jobs.ts 누끼 후보 제외 기준을 `banner·document`만으로 좁힌다(옛 = photo도 제외 → 카드가 될 수 없었다). 후보 URL → 판정 매핑(`cardKinds` · 상품 사본은 사본 키 · 사람 선택은 selectedCopy · 대표 이미지는 srcUrl이 같은 사본이 있으면 그것)과 `designatedUrls`(대표·선택)를 produce에 넘긴다.
- 카드 통과 판정은 **프리셋 명목 캔버스**(3:4 1792×2400 · 16:9 1920×1080)로 생성 전에 끝낸다. 템플릿 분기(`cutout || card` → product 순위)와 진열면 지시가 그 결과를 쓴다. 실측 캔버스에서는 크기만 다시 계산 · 탈락 없음.

### D. 카드 산식(캔버스 짧은 변 S 기준 비율 · 3:4·16:9 공용 · `photoCardRect` 순수)
- 자리: 3:4 → x 0.08~0.92 · y 0.30~0.92(위 = `POSTER_INK_ZONE.top.to`) / 16:9 → x 0.20~0.80 · y 0.06~0.52(글자 띠 0.55~1 위).
- 원본 trim(threshold 12 · 카탈로그 선례) → contain → 확대 상한 1.5 → **통과 = 카드 짧은 변 ≥ 0.40·S**(3:4 = 717px · 16:9 = 432px). 비율·면적 별도 규칙 없음(이 식에 흡수).
- 모양: 흰 매트 0.02·S · 바깥 모서리 0.035·S(svg rect dest-in) · 그림자 검정 30% · 아래 0.012·S · blur σ 0.02·S. 한 가지 모양(무드별 2종 · 어두운 배경 테두리 규칙 없음 · 흰 매트가 경계를 만든다).
- 합성 순서: AI 배경(원본 파일 유지) → sharp `framePhotoCard` → 중간본 PNG → `composeImage`(cutout null · 글자만) → JPEG. 유출 검사는 AI 원본 bgPath(현행 1310) · 밝기 측정은 AI 원본 top 띠(현행 · 카드는 0.30 아래). **sharp 중간본은 bgPath로 돌려주지 않는다**(테스트 고정).

### E. 2단 배경 = 제품 순위 템플릿 · 흐림 없음 · 프롬프트 문장 추가 0
- 1268 `templateFromRank(rank, cutout ? 'product' : 'event')` → `(cutout || card)`. 진열면 지시(`posterStyleHint` stage)는 현행 그대로 `!!(cutout || card)`(빈 진열면 = 카드 자리).
- 흐림은 디자이너가 접음(Harold 「액자 테두리처럼 뜬다」 반려 선례 · LESSONS_BACKEND 115).

### F. 3단(주인공 없음) = 행사 순위 템플릿 + 장면 필터 + 정규식 보강
- 아웃리치 후보 풀 함수 `outreachTemplatePool(code, kind, now)` 하나를 `templatePickCandidates` · `pickTemplate` · `hashTemplateRank` · `templateFromRank`가 함께 쓴다. 행사 풀에서 물건·숫자 장면(`OUTREACH_EVENT_SCENE_EXCLUDE_RE` = bottle·jar·box·gift·bag·perfume·tube·container·package·packaging·parcel·numbered·number·numeral·calendar · 복수형)을 뺀다. 비면 원래 풀(달 필터와 같은 형태). 스튜디오 목록 무변경. 주재자 실측 = 행사 173개 중 44개 제외.
- `templateFromRank`도 같은 필터를 거친다(저장된 template_pick에 걸러낸 장면이 있으면 건너뜀 · 비면 해시 폴백). 이미지 재생성이 template_pick을 지우지 않기 때문(jobs 1776).
- `stripScaffoldProps`: `\bproducts?\s+(stands?|standing|sits?|rests?|is placed|placed|centered)\b` + `\b(platform|stage|ledge|surface) for the products?\b`. products?가 같은 문장에 있을 때만(주문장 삭제 방지 · 회의론자 d).
- 타이포는 모든 단에서 현행 top 구역.

### G. 코드 배경(AI 0)
- sharp 세로 그라데이션(brandColor → 없으면 template.accent). 캔버스 = 실패한 AI 배경과 같은 크기(없으면 프리셋 명목 크기).
- 발동 = 숫자 2회 · `generatePosterWithRetry` 최종 실패(STUDIO_NOT_READY · 임시 저장 용량 초과는 현행대로 throw).
- 주인공 누끼면 현행 py 경로(cutoutPath + layout) · 카드면 D와 같은 sharp 선합성 · 없음이면 타이포만. ink = 측정값. 16:9도 같은 규칙.

### H. 기록 = studio_image payload 한 키 `heroRung`(DDL 0)
```
heroRung: {
  poster: { subject, bg, from, scale, shortPx, alpha, reason, bytes, inkStd, label, reasonText },
  banner: 같은 모양 | null,
  floor: { ok, miss: Array<'subject'|'title'|'digits'|'font'> }
}
```
- reason = 단이 내려간 사유 짧은 코드 · reasonText = 사람 문장(서버 완성 · 화면은 그대로 그린다). label = 「누끼 / 사진 카드 / 글자 포스터」(+ 「 · 코드 배경」).
- floor(경고만 · 잠금 0): subject none → 'subject' · `title === companyName` → 'title' · bg='ai' ∧ 최종 digits true → 'digits' · fontPath null → 'font'.
- inkStd = `measurePosterInkZone` 루프에 제곱합(측정만 · scrim은 실측 뒤 §7 ⑧).
- 옛 행(heroRung 없음): 서버 순수 함수 `heroRungOf(payload)`가 usedCutout으로 추정(cutout/none · ai · label만). 이미지 url 없는 행 = null.

### I. 화면(서버 문장만 그린다 · shared.ts:4)
- `cardHeroOf` 응답에 `heroTier` · `heroTierReason`(문자열 · 포스터 히어로일 때만). SQL은 `i.payload->'heroRung'` · `i.payload->>'usedCutout'`(기존 jsonb 컬럼 payload의 키 · 새 컬럼 0).
- 작업대 카드 재료 줄 첫 칸 = heroTier가 있으면 그것, 없으면 기존 히어로 종류(홈 배너·행사 배너 = 주의 색 유지). 사유는 보이는 한 줄.
- 상세 이미지 탭 설명 줄(Modal 1840)에 label · reasonText.
- 등록 칸: 열 이동 없음 · placeholder 「제품컷이면 누끼 · 글자 없는 사진이면 사진 카드」 · 엑셀 안내 문구 같은 뜻.

## 2. 영향표(수정 전 전수)
| 대상 | 소비처 | 영향 |
|---|---|---|
| `OutreachImageResult`(+heroRung) | jobs.ts 1787~1831(insertAssetOwned) | 키 추가 · 기존 키 불변 |
| `OutreachImageInput`(+cardKinds · designatedUrls) | jobs.ts 1787 1곳 | 선택 인자 · 미지정 = 옛 동작 |
| 1321 throw 제거 | jobs.ts 1806~1819(catch → studio_error · url null) | url null 경로가 python 장애로 좁아진다 · 분기 코드 불변 |
| 1268 템플릿 분기 | 없음(함수 안) | 카드일 때 product 순위 |
| `templatePickCandidates` · `pickTemplate` · `hashTemplateRank` · `templateFromRank` | jobs.ts(judgeOutreachTemplates) · produce 1268 · 테스트 redesign-1009 · template-month-1001 · produce-pure | 행사 풀만 줄어듦(제품 풀 불변) · 풀 비면 원래 풀 |
| `stripScaffoldProps` | produce 1270 · 배너 1333 · 테스트 redesign-1009 | product 문장만 추가 삭제 |
| jobs.ts `notCutout`(1767) | productCutouts · cutoutOrder | photo가 후보에 들어감 → produce가 카드 입장으로 처리(rembg 안 돌림) |
| studio_image payload | direct-jobs cardHeroOf(764) · Modal 909(latestAssetOf) · jobs 1842(latestAsset → posterUrl·bannerUrl) | 키 추가만 · posterUrl·bannerUrl 의미 불변 |
| `cardHeroOf` 응답 | shared.ts WorkbenchCard(선택 필드) · Workbench 266 | 필드 추가 |
| `measurePosterInkZone` 반환 | produce 1296 · 1343 · 테스트 poster-ink | 반환을 `{mean, std}`로 바꾸지 않고 두 번째 함수 `measurePosterInkStats`를 두어 기존 소비처 불변 |

## 3. 구현 순서(단독·순차)
1. produce.ts 순수 함수·상수(B·C·D·F·G·H) + 테스트 → 2. 누끼 루프·카드 결정·템플릿 분기·renderPoster(코드 배경 폴백)·배너 → 3. jobs.ts(cardKinds · designatedUrls · notCutout · heroRung 저장) → 4. direct-jobs.ts(cardHeroOf) → 5. 프론트(shared · Workbench · Modal) · bulk 안내 문구 → 6. tsc 0(backend·frontend) · 백엔드 전체 스위트 → 7. 자가 적대 검토 → Codex(Harold 지시) → 8. 문서(FEATURE §5 이력 · BUGS) → tp-push 인계.

## 4. 테스트(신규 `__tests__/sales-outreach-photo-card-1013.test.ts`)
- `photoCardRect`: 3:4 경계(0.30·0.92) · 3000×600 null · 300² null · 600² 통과(1.5배 → 900 ≥ 717) · 478² 경계 · 16:9 600² 통과(507 ≥ 432).
- `photoCardAdmit`: 5종 × text × person 표.
- `cutoutOpaqueRatio`: sharp 합성 PNG 0% · 50% · 100%.
- `framePhotoCard` 픽셀: 파랑 배경 + 초록 사진 → 카드 중앙 초록 · 매트 흰 · (0.5W, 0.15H) 파랑 · 모서리 밖 파랑.
- `codeBackdrop`: 크기 · 위아래 색 차.
- 장면 필터 계약: 전 업종 행사 풀 길이 ≥ 3 · `event-mem-pick-gift`·`event-day-adult`·`event-day-advent`(3741) 제외 · 제품 풀 불변 · `templateFromRank`가 걸러낸 id를 건너뜀.
- `stripScaffoldProps`: 366·375·546 세 문장 삭제 · "long-standing" 주문장 보존 · 옛 테스트 그대로.
- `heroRungOf` 옛 행 · `heroRungLabel` · `posterFloorOf`(title=업체명 · code면 digits 제외).
- 배선 계약(소스 문자열): throw 문장 0 · `cutout || card` 분기 · bgPath = AI 원본 · jobs notCutout에 photo 없음.
- 기존 스위트 전체 통과.

## 5. 배포 뒤 실측(Harold · 운영)
접수 샘플 3건 [이미지 다시 만들기] → `SELECT payload->'heroRung'->'poster'->>'subject', ...->>'bg', ...->>'reason', ...->>'alpha' FROM sales_outreach_assets WHERE kind='studio_image' ORDER BY created_at DESC LIMIT 5;` · 작업대 칩·사유 확인 · 알파 비율·0.40 게이트 시작값은 이 실측으로 조정.

## 6. 회의에서 갈렸던 곳과 택한 근거
- 확대 상한·게이트: 1.5 + 0.40S(기획·백엔드 2R·회의론자) vs 2 + 면적 0.20(디자이너 2R). 1.5 = DM 전폭에서 2배는 무름 · 0.20은 1.5배에서 600 정사각이 0.19로 탈락.
- 판정 없는 대표 이미지: 재료 단계 사본화(4) vs 제작 자리 1회 검사(회의론자). 제작 자리 **종류 판정기** 1회 = 크롤 무변경 + {kind,text} 의미 그대로(포스터 숫자 검사는 영어·작은 글자 배너를 통과시킬 수 있다).
- 다시 만들기 후보 회전 vs 「사진 카드로 다시」: 서로를 이유로 접힘 → 둘 다 §7.
- 흰 매트: 디자이너 2R 채택(테두리 규칙·무드별 2종 제거).

## 6-1. Codex 적대 검토(Harold 지시 · 이미지 제작 경로여도 실행)
- 1R(gpt-6-astra · working-tree · 초점 5문항): high 1 · medium 3 → 전부 수용.
  - [high] 숫자 2회 뒤 코드 배경 합성이 실패하면 바깥 catch 가 삼켜 **숫자가 검출된 첫 포스터가 발행**됐다 → 검사 장애만 삼키는 `scoreBg` 헬퍼로 분리 · 합성·저장 오류는 전파(url null · 옛 폴백).
  - [medium] 알파 PNG 가 기존 banner·document 판정을 우회해 카드로 들어갔다 → banner·document 제외를 알파 분기 앞으로 · 입장 판정은 기존 판정 우선(판정 없는 알파 PNG 만 제품으로).
  - [medium] EXIF 회전 사진이 회전 전 치수로 게이트를 통과한 뒤 합성에서 늘어났다 → `normalizePhotoForCard`(회전 + trim) 결과 버퍼·치수를 게이트·실측·합성이 같이 쓴다.
  - [medium] trim 이 빠져 여백이 최소 크기를 대신 채웠다 → 같은 함수에서 trim(threshold 12 · 카탈로그 선례).
  - [범위 밖] `watch-alert.ts:109` TS2345 1건(Codex 환경의 타입 검사 · 이 축의 tsc 는 0) → BUGS 미등재 · 재현되면 등재.
- 2R(1R 정정 줄 + 직접 호출부만 · 2026-10-14): **approve · material 0**. A 흐름 표 = (i) 첫 채점 null → 최초 AI 그대로(미검사 발행 · 기존 `digits !== true` 정책) (ii) retry StudioError → 코드 배경·bg_failed (iii) again null → 코드 배경·digits_twice (iv) 코드 배경 합성 throw → 발행 없음(url null). "숫자가 검출된 배경이 발행되는 조합 없음". B·C·D 의도와 같음(정규화 PNG 는 EXIF 가 제거돼 framePhotoCard 의 rotate 는 재회전하지 않는다). 기록 = 채점 장애(unavailable)가 재생성본을 채택하는 것은 옛 정책 그대로(이번 축 밖).

## 7. 추가 과제(이번 범위 밖 · 기록만)
① 「사진 카드로 다시」 버튼 ② 다시 만들기 후보 시작점 회전(사람 지정 대표 이미지 이탈 위험) ③ 상세 3칸 격자 ④ 16:9 좌우 분할 구역(bannerTier 탈락률 실측 뒤) ⑤ 메일 히어로 = 휴대폰 틀 속 DM 첫 화면 중복(R7 경로 · BUGS) ⑥ 홈 배너 폴백(url null · 상품 0·행사 0 AI 골격 produce 2530·1966)의 숫자 검사 ⑦ 메일 사본 1200폭·바이트 상한(bytes 실측 뒤 · `mmsMaxBytes`) ⑧ 글자 띠 scrim(inkStd 실측 뒤) ⑨ 자동 확정 + floor 미달 → review_flag(발송 경로 · 별 축) ⑩ 카드 모양 2종 · 머리 띠 분포 ⑪ 내려받기 실패 문구 "선택한 이미지" 고정(produce 1219).
