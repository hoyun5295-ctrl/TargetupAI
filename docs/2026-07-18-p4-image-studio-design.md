# P4 — AI 이미지 스튜디오 상세 설계도 (2026-07-18 · v3 2026-07-19)

상태: **설계 확정 v3 — 적대적 리뷰([docs/2026-07-19-p4-design-review.md](2026-07-19-p4-design-review.md)) 치명 4건·높음 8건 해소 + 소스 실상태 대조 완료.** 상위 설계 = docs/2026-07-18-inapp-simplify-image-studio-design.md §4·§5. 구현 세션(Opus 4.8)은 이 문서 하나로 착수한다.

> ★ 호출어 = **"P4 이미지 스튜디오 시작"**. 구현 코드 0줄(이 문서는 설계뿐). 착수 순서 = §6.
> v3 변경 요지: ①API 표면 generateContent 확정(실측) ②4K = 멀티턴 보존 격상(업스케일 SKU 없음 — 공식 멀티턴 패턴, Harold 정정 반영) ③최종 굽기 서버 이관 ④크레딧 계약 실명(checkCredit/deductCreditSafe 멱등) ⑤DDL 1건 공식화(channel_spec 부재 실측) ⑥MMS = 기존 시스템 상수·검증 재사용 확정.

## 0. 착수 절차 (구현 세션 첫 스텝)

### 0-1. env 위치 정정 (★리뷰 M-9)
backend는 `dotenv.config()`(무경로 — app.ts:1-3 실측) = **CWD 기준 로드**. 운영 표준 경로 = **`packages/backend/.env`**(OPS.md 9-7 실례). 현재 키는 루트 `~/targetup-app/.env`에 등록돼 있음(2026-07-19 실측 세션) → **이관 필요(Harold 직접)**:
```bash
# 루트 .env의 GEMINI 2줄을 backend .env로 이동
grep '^GEMINI_' /home/administrator/targetup-app/.env >> /home/administrator/targetup-app/packages/backend/.env
sed -i '/^GEMINI_/d' /home/administrator/targetup-app/.env
grep -c '^GEMINI_' /home/administrator/targetup-app/packages/backend/.env   # 2면 정상
# 반영은 배포 시 pm2 restart all --update-env
```
- 키 미설정 = 스튜디오 카드 "준비 중" 정직 표기(500 금지 — §5-3).

### 0-2. 실측 현황
**완료(2026-07-19):**
1. 텍스트→이미지 2K: 응답 스키마 확정·1792×2400·19.5초·**실결제 230원/장**
2. 4K 생성: 3584×4800(진짜 4K)·이미지 2000토큰·28.2초·~411원 추정
3. 상품 직접 합성: 스테이징 미학 OK·**라벨 미세문구 왜곡**('Skin Activator'→'Seun Activator') → AI 재생성 폐기·레이어 합성 확정(§4-2)
4. 누끼: 로컬 rembg(isnet-general-use) — 가장자리 정연·원본 라벨 100% 보존·그림자 자동 제거
5. MMS 압축: 1080px 리사이즈+JPEG = 78KB(≤300KB 여유)

**잔여(코드 착수 전 — §6-1·6-2):**
1. **4K 보존 격상 왕복 1건**(§4-3 멀티턴 — 2K 결과+thoughtSignature 재전송+"구도 유지"+imageSize 4K → 구도 보존 판정)
2. **광원 제약 배경 1건**(§5-1-0 제약 프롬프트로 생성한 실배경 + 누끼 레이어 합성 시각 확인 — "붙인 티" 판정)
3. 서버 인프라 3종: `pm2 describe`(fork/cluster — §5-1-1 직렬화 방식 분기), nginx `proxy_read_timeout` 실값(4K 28초+여유), `python3 -V`·메모리·디스크 여유(rembg 상주)
4. information_schema로 cdp_assets 컬럼 재확인 → §5-4 ALTER 실행(Harold)

## 1. 정체성

"AI 이미지 생성 도구"가 아니라 **브랜드 에셋 라이브러리 + 전 채널 1클릭 소재 공급**. 만들고 끝(캔바·범용 챗봇)이 아니라 만들고 → 라이브러리 축적 → 인앱 포스터형·DM·이메일·MMS 규격으로 바로 꽂힌다. 마케팅 캘린더 메뉴 자리를 대체(3행 중앙 카드 교체), NEW 뱃지 4~6주.

★ 2026-07-19 Harold 확정 — **AI 오퍼레이터를 위한 스튜디오**:
- 바닥에서 그리는 범용 생성기가 아니다. 고객사는 고품질 제품 이미지를 이미 보유 — **1급 흐름 = 원본 제품 누끼(픽셀 보존) → AI 배경 생성 → 서버 합성 → 정제 타이포 오버레이**(벤치마크: 스타벅스 온라인스토어형 상품 스테이징 + 라벨/제목/부제 3단 문구, 수박 포스터형 템플릿). **AI는 배경만 만들고 제품은 원본 그대로** — 브랜드 왜곡 구조적 차단(근거 실측 §0-2-3). 빈 프롬프트 생성(제품 없이)은 '없는 제품'이라 보조 경로로만.
- **타이핑 0이 기본 경로**: 오퍼레이터가 이미 아는 것(연동 몰 상품·브랜드 키트·시즌)을 다시 묻지 않는다. 유저 필수 행동 = 상품 선택 + 용도 카드 클릭.
- 포지셔닝 = **AI 오퍼레이터 구독에 포함된 스튜디오**(별도 상품 아님·추가 구독료 없음) — UI 문구 톤도 이에 맞춘다. 단, 생성은 크레딧 차감(공짜 아님 — 무료 쿼터 없음, Harold 확정).
- 한줄전단(전 채널 이미지 커버) **개념만 계승 — 코드 이식 금지**(feedback_flyer_isolation).

## 2. 모델·원가 (공식 가격 문서 + 실측 확정)

| 모델 (API id) | 이미지 출력 단가 | 해상도 지원 | 비고 |
|---|---|---|---|
| **Nano Banana Pro = gemini-3-pro-image** | **1K~2K $0.134(1120tok) · 4K $0.24(2000tok)** | 1K/2K/4K | **채택** — 실결제 2K 230원/장 |
| Nano Banana 2 = gemini-3.1-flash-image | 0.5K $0.045 · 1K $0.067 · 2K $0.101 · 4K $0.151 | 0.5K~4K | 비품질 축 후속 검토용 |
| NB2 Lite = gemini-3.1-flash-lite-image | 1K $0.0336 | **1K만** | 참고 |

- 3:4 실해상도(공식 표 = 실측 일치): 1K=896×1200 · 2K=1792×2400 · 4K=3584×4800.
- 이미지 입력(편집·참조) = 장당 560토큰 $0.0011 — 원가 +α 수준. 환율 상수 1곳(원가 재계산 용이).
- **사고 토큰: Pro는 비활성 불가(공식 문서 명시)** — 실측 48~163토큰(원가 무시 수준). `thinking_level` 파라미터는 3.1 Flash 전용 — Pro 요청에 넣지 않는다.
- 생성 이미지 전부 **SynthID 워터마크**(비가시) 포함 — 공식. UI 고지는 선택(§5-3).
- 모델 id = env `GEMINI_IMAGE_MODEL`(기본 gemini-3-pro-image). 교체 시 해상도 지원표 확인 의무(Lite=1K만).

## 3. 크레딧 (★2026-07-19 Harold 확정 — 품질 우선 · 사용자 2선택 · 무료 쿼터 없음)

기준: **1크레딧(500원) = Pro 2K 1장**(실원가 230원 · 마진 54%). 품질 하향(flash) 선택지는 두지 않는다.

| 작업 | 크레딧 | 실원가(약) | source 키 |
|---|---|---|---|
| **생성 1회 = Pro 2K 후보 2장** | **2** | 460원 | image-studio-generate |
| [선택지 A] 2K 그대로 사용 | +0 | — | — |
| [선택지 B] 고른 1장 **같은 구도로 4K 격상**(§4-3) | **+2** | ~411원 | image-studio-4k |
| AI 편집(배경·무드 수정 — §5-1-4) | 1 | 230원 | image-studio-edit |
| 누끼·서버 합성·타이포 오버레이·MMS 변환 | 무료 | 수 원 | — |
| 시즌 선제 제안 카드(표시) | 무료 / 생성 클릭 = 생성 1회(2) | — | image-studio-generate |

- **차감 실행 계약(소스 실측 — utils/ai-credit.ts·utils/ai-credit-calc.ts)**:
  1. `CREDIT_COST_MAP`에 위 3키 등록 + frontend `constants/credit.ts` CREDIT_TASK_COSTS **1:1 동기**(맵 주석 룰: "한쪽만 바꾸지 말 것"). 전부 20 미만 = CreditConfirmModal 비대상(기준: 버튼 트리거 20+만 사전 모달).
  2. 흐름: `checkCredit`(사전 — 부족 시 402 정직 안내) → Gemini 생성 성공 → `deductCreditSafe`(**원자·멱등·3회 재시도 — 실측 검증된 CT**) `idempotencyKey='image-studio:{생성요청uuid}'` → 재시도·동시 요청 중복 차감 0.
  3. **부분 성공**: 2장 중 1장 성공 = cost 1로 차감(같은 멱등키) + "1장만 생성됨" 정직 표기 / 0장 = 미차감. API 실패·세이프티 거부 = 미차감.
  4. 표시=실차감·크레딧 잔액 화면 상시 표시.
- **무료 쿼터 없음(Harold 확정)** — 전부 크레딧. 사용량 카운터 테이블 불필요.
- 4K 격상 = 멀티턴 보존 재출력이라 **픽셀 동일이 아님** — UI 라벨 "같은 구도로 4K"(정직). 보존 품질은 §0-2 잔여 실측 1로 확정, 불충분 시 폴백 = 생성 시점 [2K 2크레딧 / 4K 4크레딧] 선택(§7-1).
- 저장 소재 "다른 채널 규격으로 재생성" = 생성 1회(2크레딧). 단순 크롭/리사이즈 = 무료(서버 PIL).

## 4. API 연동 (★v3 — generateContent 확정)

### 4-1. 확정 표면 (2026-07-19 실측)
- **v1 = `generateContent`**(왕복 실측 완료·모델 목록 supportedGenerationMethods 확인). Interactions API는 GA 권장 신표면이나 응답 스키마 실측이 끝난 generateContent로 v1을 만들고, 전환은 후속(공식 문서에 동형 전환 버튼 존재).
- 요청: `POST /v1beta/models/{GEMINI_IMAGE_MODEL}:generateContent` + 헤더 `x-goog-api-key`.
  body = `contents[].parts[]`(text | `inlineData{mimeType,data(base64)}`) + `generationConfig{responseModalities:["TEXT","IMAGE"], imageConfig{aspectRatio,imageSize}}`. imageSize는 **대문자 K 의무**(소문자 거부 — 공식).
- 응답(실측): `candidates[0].content.parts[]` — 이미지 파트 = `{inlineData:{mimeType:'image/jpeg', data}, thoughtSignature}` + `usageMetadata`(candidatesTokensDetails IMAGE 토큰). 텍스트 파트는 없을 수 있음.
- 세이프티 거부·오류 = §5-1-11 에러 매핑(원문 UI 노출 금지).

### 4-2. 상품 포스터 = 레이어 합성 (실측 확정)
① 원본 제품 누끼(픽셀 그대로) → ② AI는 **배경 장면만** 생성(제품 없음·제품 자리·상단 텍스트 존 — §5-1-0 제약) → ③ **서버 합성**(알파 bbox 트림+접지 그림자 — §5-1-5) → ④ 정제 타이포 오버레이(라벨/제목/부제). 원본 100% 보존 = 브랜드 왜곡 구조적 0.

### 4-3. 멀티턴 보존 편집 (4K 격상·AI 편집의 공통 기반 — ★Harold 정정 반영)
업스케일 전용 SKU는 없다(가격 문서 실측). 대신 **공식 멀티턴 패턴**: 이전 모델 응답(이미지 파트+**thoughtSignature**)을 contents 대화 이력으로 재전송 + 새 유저 턴("Do not change any other elements of the image. Output the same image at 4K." 류) + `imageConfig.imageSize` 목표 해상도. Interactions API `previous_interaction_id`와 동형(공식 문서의 "스페인어 인포그래픽" 예시 구조). 같은 구도 보존 재출력 — §0-2 잔여 실측 1로 품질 확정.

### 4-4. 채널 2트랙 (Harold 확정)

**트랙 A — 고품질 (DM·인앱·이메일·자유)**: 용량 제한 없음.

| 프리셋 | aspect_ratio | image_size | 소비처 |
|---|---|---|---|
| 인앱 포스터형 | 3:4 | 2K | full_image 카드 |
| DM 카드 | 1:1 | 1K~2K | 모바일 DM 미디어 |
| 이메일 히어로 | 16:9 | 2K | 이메일 상단 |
| 자유 | 사용자 선택 | 1K~2K | 라이브러리 범용 |

**트랙 B — MMS 전용 (★기존 시스템 규격 재사용 — 소스 실측)**:
- 생성 = 3:4 · **1K**(896×1200) → 서버에서 1080px 리사이즈 + JPEG 품질 이진탐색.
- 규격 = **기존 상수 재사용**: `LIMITS.mmsImageSize = 300*1024` · `LIMITS.mmsImageCount = 3`(config/defaults.ts 실측 — Harold 300KB 기준과 정확히 일치). **JPG만**(routes/mms-images.ts 파일필터 실측 — "PNG·GIF는 통신사 거절" 사유 명시).
- 분리 목적 = 소형 화면 가독성(굵고 단순한 구성) + **규격을 시스템이 강제**(사용자가 오버사이즈를 만들 수 없음 — 서버 합성이 보장 §5-1-5). 원트랙이면 발송 하드 실패(게이트웨이 1MB·on_error:fail)→클레임.
- **인접 사각 해소(실측)**: 스튜디오 밖 MMS 업로드 경로(routes/mms-images.ts)는 이미 300KB+JPG+3장 하드 검증 존재 — 추가 조치 불요. 스튜디오 MMS 산출물이 MMS 발송에 연결될 때는 이 기존 업로드 계약(mms_image_paths)과 접속(구현 시 발송 경로 확인).
- Batch API(24h·원가 절감)는 시즌 선제 생성(P5+) 예약. v1 = 동기 호출만.

## 5. 아키텍처

### 5-1. Backend (신규 라우트 /api/image-studio + CT utils/image-studio.ts)

0. **buildMarketingPrompt CT — 마케팅 증강 계층**: 유저 입력을 그대로 모델에 넘기지 않는다.
   - 구성: 용도 카드 프리셋 + 채널 구도 규칙 + **오버레이 여백 지시**(프리셋별 텍스트 존 — 포스터형=상단) + **브랜드 키트 색·톤**(brand_kit/brandAccent 자산 실존 — utils/dm/dm-tokens.ts·utils/inapp-ai-generator.ts 등에서 소비 중. 함수 실명은 구현 시 해당 파일에서 확정) + **시즌 컨텍스트**(utils/season-context.ts CT 실존 — 재사용) + (합성 시) 제품 톤 힌트.
   - **광원·구도 제약 고정(리뷰 H-1 — "붙인 티" 방지)**: "soft diffuse frontal lighting, eye-level, flat horizontal surface, no strong directional shadows" + 제품 놓일 하단 중앙 여백.
   - **지시 순서(리뷰 H-6 — 인젝션 방어)**: 유저 한 줄은 "장면 묘사 힌트"로 중간 삽입, **금지 지시(픽셀 텍스트·숫자·혜택 금지)가 마지막**. 유저 텍스트에 혜택 패턴(%·원·할인·쿠폰) 감지 시 사전 안내("문구는 텍스트 편집에서 얹으세요").
1. `POST /generate` — {product_asset_id?, purpose_card, prompt?, preset, track} → checkCredit → buildMarketingPrompt → Gemini 배경 2장 병렬 → temp 기록(`uploads/studio-temp/{companyId}/`, crypto UUID) → 성공 후 deductCreditSafe(§3 계약) → {tempId,url}×2.
   - **회사당 동시 생성 1건**: pm2 모드 실측(§0-2) 후 fork 단일 = in-flight 맵 / cluster = Redis 락(Redis 상주 — OPS). 둘째 요청 = 409 + 프론트 ConfirmModal "다른 생성이 진행 중입니다"(리뷰 M-4).
2. `POST /ingest-product` (★신설 — 리뷰 H-2): 연동 몰 상품 이미지는 **외부 CDN URL**(MallProductPickerModal 실측 계약 `PickedMallProduct.imageUrl`) → 서버 fetch: **https만·사설 IP 차단(SSRF)·타임아웃 10s·상한 10MB·이미지 MIME 검증** → 최장변 2000px 다운스케일(rembg 추론 시간 확보) → temp 산출.
3. `POST /remove-bg` — **rembg 상주 서비스 확정(리뷰 H-3)**: isnet-general-use(로컬 실측 통과), **127.0.0.1 전용 바인딩**(0.0.0.0 절대 금지 룰)·systemd·모델(179MB) 프리로드·단일 워커 큐. 서비스 다운 = 503 정직 안내("이미지 준비 기능 점검 중"). 설치 = python3 venv + rembg + onnxruntime(Harold 서버 실행 — python3 버전은 §0-2 인프라 실측 후 확정).
4. `POST /edit` — §4-3 멀티턴 보존 편집 기반, 1크레딧. **대상 = 배경·전체 무드 수정 한정 라벨**(제품 픽셀 재생성 왜곡의 뒷문 차단 — 리뷰 M-8. v1 포함 여부 = §7-4). ref company_id 소유 검증 필수.
5. `POST /compose` (★신설 — 리뷰 C-4 해소): **최종 굽기 = 서버 PIL**(rembg와 동반 설치). 프론트는 미리보기 캔버스만, 확정 시 레이어 데이터(배경 tempId·누끼 tempId·위치/스케일·그림자 파라미터·타이포[텍스트/서체/크기/색/위치])를 전송 → 서버가 합성(알파 bbox 트림 + 접지 그림자 — 실측: 미적용 시 떠 보임) + 인코딩(고품질=JPEG q~90 / **MMS 트랙 = 1080px + ≤LIMITS.mmsImageSize 이진탐색 보장**) → **bytes 서버 실측**(클라 신고 불신). 서체 = 자가 호스팅 12종 폰트 파일을 서버가 로드(PIL truetype). 기기 편차·iOS 캔버스 한계·클라 조작 원천 차단.
6. `POST /save` — **tempId 1회성 소비**(중복 409 — 리뷰 M-2) → 실 저장소 이동 + cdp_assets 등재(kind='generated'·origin='studio'·prompt·**channel_spec**) + 플랜 용량 한도 검사(P3 용량 CT 재사용) + 회사당 temp 총량 상한(§7-3).
7. `GET /temp/:tempId` — 인증 endpoint(세션 회사=소유 회사)·tempId=crypto UUID. 프론트 표시 = **fetch+blob**(토큰 헤더라 `<img src>` 직결 불가 — 선례 OPS 7-7 agent-builds 다운로드. 리뷰 M-1).
8. temp 7일 스윕 — 기존 PM2 워커 패턴·mtime 기준 1일 1회. 저장 전 산출물 화면에 "7일 후 자동 삭제" 명시(스윕-편집 경합은 이 문구로 수용 — 리뷰 M-6).
9. **DDL 1건 공식화(★리뷰 C-1 — "DDL 0" 정정)**: SCHEMA.md 실측 13컬럼에 channel_spec **없음**(설계 초안과 실 DDL 상이) →
   `ALTER TABLE cdp_assets ADD COLUMN channel_spec varchar(20);` (+ §7-2 승인 시 `width int, height int` 동반 — DDL 1회 묶음).
   information_schema 선검증 → Harold 직접 실행 → 관련 endpoint catch에 `column does not exist` → **503 DB_MIGRATION_PENDING** 분기(db_alter_safety_net).
10. env: `GEMINI_API_KEY`·`GEMINI_IMAGE_MODEL` — **packages/backend/.env**(§0-1). 미설정 = "준비 중".
11. **에러 매핑(★리뷰 H-5 — 모델명 노출 차단)**: Gemini 오류 원문을 응답에 싣지 않는다 — 코드 매핑(SAFETY_BLOCKED="안전 기준으로 생성이 거부됐어요 — 문구를 바꿔보세요"(미차감) / RATE_LIMITED / GEN_FAILED). 원문은 PM2 로그만.

### 5-2. Frontend (신규 페이지 /image-studio — Journey 동급 디자인 · 타이핑 0 기본)
- 상단 sticky 헤더 + 그라데이션 아이콘 + NEW 뱃지. UI 문구 톤 = "AI 오퍼레이터에 포함된 스튜디오".
- **1급 진입 = 상품 포스터 합성**: 상품 픽커(MallProductPickerModal — onPick 계약 실측·AssetLibraryPickerModal·업로드 재사용) + **용도 카드 5종**(신상품 포스터·시즌 프로모션·이벤트 공지·브랜드 무드컷·자유 생성 — 카드=증강 프리셋 결정 주입, 카드 문구=실제 주입 내용 1:1) + 트랙 선택(고품질 4프리셋 / MMS 전용). **상품 선택+용도 카드 클릭=생성 시작(타이핑 0)**. 자연어는 접힌 보조 창.
- **누끼 확인 단계(리뷰 M-3)**: 합성 전 누끼 결과를 사용자에게 보여주고 승인 후 진행. UI 안내 "단일 제품 사진에서 가장 잘 작동합니다"(isnet은 최돌출 객체를 딴다 — 인물 포함 광고컷이면 인물이 따질 수 있음).
- 결과: 후보 2장 그리드(fetch+blob 표시) → [텍스트 얹기] [라이브러리에 저장] [**같은 구도로 4K(+2크레딧)**] [AI 편집(1크레딧)] — "7일 후 자동 삭제" 명시·진행 UI(2K 20초·4K 28초 실측 기반)·재클릭 차단.
- **텍스트 오버레이(정제 타이포)**: 라벨/제목/부제 3단 프리셋(스타벅스형) + 자가 호스팅 서체 12종 + 위치 프리셋(상단/하단) + 색. **초안 자동 제안 = 몰 실데이터**(상품명→제목·판매가→부제 — PickedMallProduct 실측 필드. DM 상품 슬라이드 자동 채움 선례와 동일 = 임의 혜택 아님·사용자 수정 가능). AI 임의 혜택 수치 = `[직접 작성해주세요]` 룰 유지.
- **미리보기=프론트 캔버스 / 확정 굽기=서버 /compose**(§5-1-5). 인앱 포스터형만 데이터 레이어로 전달(기존 오버레이 시스템 접속 — 굽지 않음).
- **저장 직후 발송 연결**: "이 소재로 인앱 만들기" → 인앱 편집기 이미지 주입 진입(v1 최소 = 포스터형. DM·이메일 확장 = P3-b와 함께). "다른 채널 규격으로 재생성" 버튼(§3 과금).
- **채널 역진입**: AssetLibraryPickerModal "AI로 만들기" 탭 — 편집기에서 채널 프리셋 선택된 채 생성→그 자리 삽입. **소비처 실측 = InAppMessagesPage 1곳뿐** → channel prop 신설 파급 최소(미전달 폴백=고품질 — 무파손).
- **라이브러리 픽커 2트랙 게이팅(Harold 확정)**: 탭 [인앱·DM·이메일(고품질)] / [MMS]. MMS 컨텍스트 = 고품질 탭 비활성 → 클릭 시 ConfirmModal "이 이미지는 용량이 커서 MMS로 보낼 수 없어요 — MMS 이미지 탭에서 선택해 주세요". **MMS 탭 판별 = `channel_spec='mms'` 1차(태그·§5-1-9 ALTER) + format='jpg'·bytes≤300KB 2차 안전망**(리뷰 H-8 — bytes 단독 판별의 소형 PNG 오분류 차단). 방향 비대칭: MMS→고품질 차단(하드 실패 축) / 고품질→MMS 허용(저해상 소프트).
- 우측: 라이브러리 최근 소재 + 크레딧 잔액·용량 게이지 상시.
- 시즌 선제 제안 카드(utils/season-context.ts 재사용): 표시 무료·생성 클릭 = **2크레딧**(생성 1회와 동일 — 리뷰 M-7 정정).
- 메뉴: SUB_MODULE_CARDS 3행 중앙 교체(constants/ai-operator-modules.ts — 소비 4파일 실측: DashboardHeader·AiOperatorPage·QuickCampaignPage·워크스루 → 교체 시 4곳 교차 확인). MarketingCalendarPage 라우트 유지(진입 링크만 제거 — 비파괴). **신규 lazy 라우트 = 0718 스플리팅 게이트(safe-build 3-1/3-2 + verify-live-chunks) 통과 의무.**

### 5-3. 가드레일 (영구 룰 상속)
- **혜택 문구 픽셀 금지**: 증강 프롬프트 마지막 고정 지시(§5-1-0) + UI 안내. AI 임의 혜택 룰의 이미지판. 산출물에 텍스트가 새겨진 경우 재생성 유도(확률적 방어임을 인지 — 완전 차단은 불가).
- 모델명 UI 노출 금지 — "AI 이미지 생성"만 + **에러 원문 미노출**(§5-1-11).
- native dialog 금지(ConfirmModal·useToast) / 지표·미리보기 목업 금지 / 생성 실패 PM2 로그.
- (선택) 정보 표기: 생성 이미지에 SynthID 비가시 워터마크 포함(공식) — 고지 여부 Harold 판단.

## 6. 구현 순서 (구현 세션)
1. env 이관 확인(§0-1 — Harold) + 서버 인프라 실측 3종(§0-2-3: pm2 모드/nginx 타임아웃/python3·메모리·디스크)
2. 잔여 API 실측 2건(§0-2): 4K 보존 격상 왕복 → §3 확정 / 광원 제약 배경+레이어 합성 시각 판정
3. DDL: information_schema 확인 → ALTER channel_spec(+승인 시 width·height) — Harold 서버 psql 직접
4. rembg 상주 서비스 설치(Harold 서버 실행 — 127.0.0.1·systemd) + 헬스체크
5. Backend: CREDIT_COST_MAP 3키 등록 → utils/image-studio.ts CT(buildMarketingPrompt·Gemini 클라·에러 매핑) → routes/image-studio.ts(§5-1 endpoint 7종) → temp 스윕 워커 → tsc·계약 테스트
6. Frontend: constants/credit.ts 1:1 → 스튜디오 페이지 → AssetLibraryPickerModal 확장(channel prop·AI로 만들기 탭·2트랙 게이팅) → 메뉴 카드 교체(4소비처 교차 확인) → 스플리팅 게이트
7. Codex 라운드 → 배포 → Harold 실측 왕복 2건: ①상품 선택→생성→누끼 확인→텍스트 얹기→서버 합성 저장→인앱 포스터형에 꽂기 ②MMS 트랙 생성→저장→MMS 캠페인 첨부(≤300KB 검증 통과)

## 7. Harold 결정 대기
1. **4K 보존 격상 확정** — §0-2 잔여 실측 1 결과 보고 후: 보존 품질 OK = 현안(+2크레딧) / 불충분 = 생성 시점 [2K 2크레딧·4K 4크레딧] 선택으로 전환
2. **width·height 컬럼 동반 ALTER** — 권장(픽커 표시·저해상 경고에 필요·DDL 1회 묶음). 미승인 시 channel_spec만
3. temp 회사당 상한 — 제안 기본 200MB
4. **/edit(AI 편집) v1 포함 여부** — 멀티턴 편집은 제품 왜곡 뒷문 관리 필요(§5-1-4 한정 라벨로 완화). 미포함 시 P4-b로 이연

## 부록 A — 착수 전 확정 현황 (리뷰 §4 대비, 2026-07-19 실측)
**해소(소스 실측 완료):** 크레딧 함수 실명(checkCredit·deductCreditSafe 멱등·CREDIT_COST_MAP·frontend constants/credit.ts) / 픽커 소비처(InAppMessagesPage 1곳) / MallProductPickerModal 반환 계약(PickedMallProduct — imageUrl 외부 CDN) / MMS 규격·검증 실존(LIMITS 300KB·3장·JPG only·routes/mms-images.ts) / env 로드 방식(dotenv CWD → packages/backend/.env 표준) / 브랜드 키트 자산 실존(dm-tokens 등) / 시즌 CT 실존(utils/season-context.ts) / cdp_assets 13컬럼(channel_spec·width·height 부재 — SCHEMA.md)
**잔여(구현 세션):** information_schema 재확인(ALTER 직전) / pm2 모드 / nginx proxy_read_timeout / python3 -V·메모리·디스크 / 브랜드 키트 주입 함수 실명 / MMS 발송 경로(mms_image_paths)와 스튜디오 산출물 접속 지점
