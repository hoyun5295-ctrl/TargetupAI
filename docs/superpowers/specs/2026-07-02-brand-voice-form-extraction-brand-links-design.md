# 브랜드보이스 형태 추출 강화 + 브랜드 링크 — 설계서

> 2026-07-02 작성 · 같은 날 구현 완료(backend tsc 0 / vitest 183 / frontend tsc 0). 선행 설계서 = `2026-06-30-copy-quality-brand-voice-design.md`(B2-4 "깊이 강화"가 이번 작업의 뿌리).
>
> 구현 결과 메모 (설계 대비 변경점):
> 1. length_range는 AI 추출이 아니라 코드 계산(대표 문안 min/max — 결정적)으로 확정. link_habit도 코드 스캔.
> 2. CT-100 재생성 루프는 기존에 호출부 0건(휴면)이었음 — generateMessages에 신규 배선(미달 시 1회 재생성, creditCost 0 = 추가 차감 없음, nginx 60초 한도 고려 1회 한정). generateCustomMessages는 링크 토큰 치환만(재생성 루프 없음 — 프롬프트 규칙은 동일 적용).
> 3. 자동발송(AutoSendFormModal)은 D188에 영구 폐기 확인 → 칩 부착 = AI 오퍼레이터 메인·직접발송·타겟발송 3곳 + AI 학습 메모리(관리 모드).
> 4. 검증기에서 카카오 채널은 이모지 화이트리스트 검사 제외(카카오는 이모지 허용 채널 — 화이트리스트는 LMS 학습값).
> 5. campaigns/dm 라우트 catch에 DirectSendError 일반 매핑 추가(가드 400이 500으로 새지 않게).
> 제약 0번: AI는 구체 혜택을 지어내지 않는다. 이번 추가 — **AI는 URL도 지어내지 않는다. URL은 고객사가 등록한 값만 쓴다.**

## 0. Harold 요구 (2026-07-02 대화)

1. **형태 추출** — 대표 문안 6건이면 "이 회사가 선호하는 문안 방식"을 결론 내리기에 충분하다. 6건의 형태만 제대로 추출해도 비슷한 유형의 문안 제작은 무리가 없어야 한다.
2. **브랜드 링크** — 여정을 제외한 모든 문안 생성 경로(AI 오퍼레이터 메인부터)에 URL 입력칸을 만들고, 추가를 누르면 컬럼값 치환 칩처럼 문안 편집 중 커서 위치에 URL이 삽입되게 한다. 브랜드보이스를 추출해 보면 늘 URL을 붙이는 회사들이 있는데, AI는 CTA 문구까지만 만들고 실제 URL은 고객사가 쥐고 있기 때문.

## 1. 현황 (2026-07-02 grep 사실 — 전부 기존 자산 확장)

| 역할 | 위치 | 상태 |
|------|------|------|
| 가이드라인 추출기 | `routes/ai-memory.ts` 563~654 (추출 프롬프트 + 파싱) | 9항목 고정. 형태(후크 유형·구조 순서·종결어미·호칭·기호·길이 범위) 없음 |
| 주입 | CT-99 `utils/brand-voice-prompt.ts` `buildSystemPromptWithBrandVoice` | 가이드라인 9항목 + 브랜드 키트 5항목 + few-shot 최대 10건. 5분 TTL 캐시 |
| 생성 후 검증 | CT-100 `utils/brand-voice-validator.ts` `validateBrandVoiceCompliance` | 필수 3(빈출 표현·(광고) 위치·이모지) + 경고 1(길이 ±30%). 미달 시 호출부 재생성 max 3회 |
| 커서 삽입 | frontend CT `utils/textInsert.ts` `insertAtCursor` | 소비처 4곳(Dashboard·DirectSendPanel·AutoSendFormModal·TargetSendModal). EmailVisualEditor는 selectionStart 직접 사용(인라인) |
| placeholder 발송 가드 | `email-ai.ts findUneditedPlaceholder`(이메일 `routes/email.ts:537`) · `inapp-message.ts BENEFIT_PLACEHOLDER_ERROR`(`routes/cdp.ts:1112·1143`) | 혜택 placeholder 잔존 시 발송 차단 패턴 기존재 |
| 저장소 | `ai_company_memory` (SCHEMA.md 2297~2313 확인) | memory_type varchar(50) / memory_key varchar(200) / memory_value text / UNIQUE(company_id, memory_type, memory_key). **ALTER 0** |
| AI 응답 JSON 파싱 | CT `utils/ai-json.ts escapeControlCharsInJsonStrings` | raw 제어문자 대비 robust 파싱 기존재(LESSONS_BACKEND 429 교훈) — 추출기 확장 시 재사용 |

## 2. 설계 1 — 형태 추출 강화 (추출 → 주입 → 검증)

### 2-1. 추출기 확장 (`routes/ai-memory.ts`)
기존 9항목 유지 + 형태 6항목 추가(AI 추출, JSON 스키마 확장):

| 신규 필드 | 내용 | 예시(폴라초이스 6건 기준) |
|------|------|------|
| `hook_type` | 첫 후크 유형: question / declaration / slogan_en / benefit_direct 중 빈도순 최대 2 | question("딱 하나만 고른다면?") + slogan_en("KNOW BETTER, GLOW BETTER") |
| `body_structure` | 본문 구조 순서 배열 | ["(광고)+브랜드", "후크", "본문", "혜택/조건", "기간", "CTA", "수신거부"] |
| `sentence_endings` | 종결어미 스타일: 해요체/합쇼체/혼합 + 대표 어미 2~3 | 합쇼체("~습니다", "~해보세요") |
| `customer_address` | 고객 호칭 | "고객님" / 등급 결합("실버 등급 고객님") |
| `symbol_style` | 기호·구분선 사용 패턴(이모지 화이트리스트와 별개, 【】·▶·> 등 위치 포함) | CTA 끝 ">" 부착 |
| `length_range` | 본문 길이 min~max (평균만으론 폭을 모름) | 220~320자 |

- 링크 습관 `link_habit`은 AI가 아니라 **코드 정규식 스캔**으로 추출(결정적·오탐 0): 대표 문안에서 URL 패턴(`https?://`, 도메인형) 감지 → `{ uses_url, url_position('after_cta'|'body_end'), urls_per_message }`. 추출 endpoint 안에서 AI 호출과 별개로 계산해 guideline에 병합.
- 파싱: 신규 필드 전부 안전 기본값(없으면 빈 값) — 기존 저장 가이드라인과 하위 호환. 브랜드 키트 보존 로직(659~667)과 동일하게 재추출이 admin 정정 값을 덮지 않는 규칙 유지.

### 2-2. 타입·주입 확장 (CT-99 `brand-voice-prompt.ts`)
- `BrandGuideline`에 신규 필드 전부 **optional** 추가(기존 데이터 파싱 영향 0).
- 주입 프롬프트에 **"형태 준수 규칙" 섹션 신설** — few-shot(참고)과 분리된 명시 규칙: 후크 유형, 구조 순서 그대로, 종결어미 스타일, 호칭, 기호 위치, 길이 범위 내 작성. 필드가 없으면(기존 저장 가이드라인) 섹션 생략 = 기존 회사 영향 0.
- 링크: 회사 브랜드 링크 존재 + `link_habit.uses_url`이면 "CTA 문구 뒤에 `{{LINK:라벨}}` 토큰만 배치하라(URL 직접 작성 절대 금지)" 지시 추가.

### 2-3. 검증 확장 (CT-100 `brand-voice-validator.ts`)
기계 검증 항목 추가(전부 코드 검사, AI 호출 0, 기존 재생성 루프 max 3회 그대로):
- 필수 추가: 종결어미 스타일 일치(합쇼체 회사에 해요체 출력 차단), 길이 범위 이탈(기존 ±30% 경고를 length_range 있으면 필수로 격상).
- 경고 추가: 후크 유형 불일치, 구조 순서 상이, 기호 스타일 미사용.
- 신규 필드 없는 기존 저장 가이드라인 = 기존 검증 그대로(하위 호환).

### 2-4. 가이드라인 모달 (frontend `AiMemoryPage`)
신규 필드 표시 + "직접 정정" 편집 지원. 기존 모달 필드 패턴 그대로 확장(디자인 톤 동일).

## 3. 설계 2 — 브랜드 링크 (등록 → 삽입 → 자동 배치 → 가드)

### 3-1. 저장 — `ai_company_memory` 재사용 (ALTER 0)
- `memory_type = 'brand_link'`, `memory_key = 라벨`(예: 공식몰), `memory_value = { label, url }`, `source = 'admin_input'`.
- 회사 격리 = 기존 UNIQUE(company_id, memory_type, memory_key) 구조 그대로.
- API: `routes/ai-memory.ts`에 GET/POST/DELETE `/brand-links` 추가(기존 대표문안 CRUD 패턴 복제). URL 검증 = `http(s)://` 형식만 허용. 저장·삭제 시 `invalidateBrandVoiceCache` 호출(기존 의무 규칙).

### 3-2. 삽입 — 공용 링크 칩 컴포넌트 (frontend 신규 1개)
- `components/common/BrandLinkChips.tsx` 1개 신설: URL 입력칸 + "추가"(즉시 저장 + 칩 생성) + 저장된 링크 칩 목록 + 칩 클릭 시 `insertAtCursor`(textInsert CT 재사용)로 커서 위치에 실제 URL 삽입 + 삭제.
- 부착 지점(1차 — 문자 계열 텍스트 편집기): AI 오퍼레이터 메인 결과 편집, DirectSendPanel, TargetSendModal, AutoSendFormModal. **여정(JourneysPage) 제외 — Harold 명시.**
- 이메일·DM·인앱은 에디터가 블록/버튼 구조라 같은 brand_link 데이터를 읽되 각 에디터에 맞는 UI(버튼 href 선택 등)로 2차 확장. 이번 범위는 문자 계열 4곳.
- 바이트 카운터는 textarea 값 기반이라 삽입 즉시 자동 반영. LMS 한도 초과 시 기존 경고 그대로 작동.

### 3-3. AI 자동 배치 — 토큰 치환 (URL 오타 원천 차단)
- AI 출력에는 실제 URL 대신 `{{LINK:라벨}}` 토큰만 허용(AI가 URL을 한 글자라도 변형하면 사고 — 컬럼 치환과 같은 결정적 치환 철학).
- 백엔드 생성 후처리에서 등록 URL로 치환 → 편집기에는 완성된 실제 URL이 보임.
- 링크 미등록 회사 + link_habit 있음 = `[링크를 입력해주세요]` placeholder + 칩 등록 유도(혜택 placeholder와 동일 철학).

### 3-4. 발송 전 가드
- `[링크를 입력해주세요]` 또는 치환 안 된 `{{LINK:` 잔존 시 발송 차단.
- 적용: 문자 발송 경로(직접/타겟/자동) + 이메일 `findUneditedPlaceholder` 패턴 확장. 차단 코드 = 기존 `BENEFIT_PLACEHOLDER_UNEDITED` 패턴을 따른 `LINK_PLACEHOLDER_UNEDITED`.

## 4. 불변(절대 유지)
- 혜택 날조 금지·URL 날조 금지(등록 값만) · 회사 격리(company_id) · 모델명 UI 노출 0 · native dialog 0(ConfirmModal/useToast) · 크레딧 변동 0 · EUC-KR sanitize · 여정 제외.
- 재추출이 admin 직접 정정 값을 덮지 않음(브랜드 키트 보존 규칙 확장 적용).

## 5. 구현 순서
1. Backend — 추출기 확장(ai-memory.ts) + link_habit 코드 스캔
2. Backend — CT-99 타입·주입 확장 / CT-100 검증 확장
3. Backend — brand-links CRUD + 생성 후처리 토큰 치환 + 발송 가드
4. Frontend — BrandLinkChips 공용 컴포넌트 + 4곳 부착
5. Frontend — AiMemoryPage 가이드라인 모달 신규 필드
6. tsc 0 + vitest + 자가 grep(모델명·native dialog·박-단어 0건) + Codex 리뷰

## 6. 구현 중 확인 항목
- CT-100 호출부(재생성 루프)가 어느 함수에 있는지 확정 후 신규 필수 항목 연결.
- AI 오퍼레이터 메인 결과 편집 textarea의 ref 구조(insertAtCursor 연결 방식).
- EmailVisualEditor의 selectionStart 인라인 사용은 이번 범위 밖(2차 이메일 적용 때 textInsert CT로 정리).
- 추출 AI 응답 파싱에 ai-json.ts robust 파싱 적용 여부(현재 match+parse 단순형).
