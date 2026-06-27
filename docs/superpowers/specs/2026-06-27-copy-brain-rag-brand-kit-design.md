# 한줄로 문안 두뇌 — RAG + 시의성 + 브랜드 키트 자동 학습 설계서 (2026-06-27, Harold 승인)

> 목표: 7천 건(`ai_training_logs`)을 실제 문안 생성에 먹여 "계절감만 반복"을 끝낸다. 같은 업종 비식별 노하우(패턴)는 빌려오되 타사 시그니처는 막고, 그 자리에 회사 자신의 시그니처를 명시 조합한다. 브랜드 보이스를 "수동 5건"에서 "자동 학습 + 브랜드 키트" 하이브리드로 격상하고, 산만한 AI 학습 메모리 화면을 정리한다.
>
> 이번 문서 = 설계. 구현은 writing-plans 계획서로 분해 후 진행.

---

## 0. 배경 — 무엇이 깨져 있나 (코드 실측 확정)

- **7천 건은 한 글자도 생성에 안 쓰인다.** `ai_training_logs`는 캠페인 발송마다 비식별 문안(브랜드명·전화·금액·URL → `{brand}`/`{phone}`/`{amount}`/`{url}` 마스킹) + 피처(`computeMessageFeatures`) + 성과(`sent_count`/`success_count`/`fail_count`/`spam_blocked`)를 누적한다([training-logger.ts](../../../packages/backend/src/utils/training-logger.ts)). 그러나 활용처는 오프라인 파인튜닝용 JSONL 변환 코어([export-training-core.ts](../../../packages/backend/src/utils/export-training-core.ts))뿐 — 런타임 생성 프롬프트에는 0건 주입.
- **"계절감"의 근본 원인**: 생성 프롬프트에 (1) 성과 검증된 과거 실문안 0건, (2) 시간·시즌·날씨·맥락 0건. AI가 매번 백지에서 무난하게 쓰다 "계절 인사"로 수렴한다.
- **공통 프롬프트 빌더는 이미 한 곳**: `buildSystemPromptWithBrandVoice(companyId, basePrompt)`([brand-voice-prompt.ts](../../../packages/backend/src/utils/brand-voice-prompt.ts), CT-99)가 6개 생성 경로(refineDirectMessage / generateMessages / refineStepMessage / generateJourneyPackage / recommend-target / recommend-next-campaign) + 이메일(email-ai.ts)에서 공통 호출됨. 여기에 두뇌를 얹으면 전 채널이 함께 똑똑해진다.
- **브랜드 보이스는 수동 5건 의존**: `ai_company_memory`의 `brand_guideline` 1건 + `representative_message` 최대 5건을 회사 admin이 직접 등록해야만 켜진다(`BrandVoiceCard.tsx`). 정작 그 회사 7천 건(자기 몫)은 안 본다. `signature` 필드는 추출 결과 표시일 뿐, "문안 끝에 항상 조합" 기능은 없다.
- **AI 학습 메모리 화면 산만**: 이 페이지만 보라색 배경(`from-violet-900`), 8개 섹션이 한 화면에 쌓이고, cleanup·add가 빠른시작 7카드와 1-click 3카드에 중복. 마케팅 담당자에게 덜 중요한 내부 메트릭(중요도 히스토그램·출처 도넛)이 메인에 노출.

---

## 1. 핵심 결정 (Harold 브레인스토밍 합의 2026-06-27)

| 갈림길 | 결정 |
|---|---|
| 무게중심 | AI 문안 엔진 먼저 (이메일 자체 완성도는 후속) |
| 학습 방식 | 실시간 참조(RAG) 먼저. 자체 모델 파인튜닝은 후순위(데이터 더 쌓인 뒤) |
| 검색 방식 | 꼬리표 필터 + 성과 정렬(SQL). 의미 검색(임베딩/pgvector)은 데이터가 수만 건일 때 |
| 데이터 폴백 | 회사 우선 + 업종 폴백(비식별 cross-company). 둘 다 부족하면 정직 폴백(임의 상수 0) |
| 시그니처 | 타사 비식별 = 패턴·골격만(고유 문구 제거). 자사 = 명시 등록 후 조합 |
| 시그니처 제어 | 입력(시그니처 후보 제외) + 프롬프트(복제 금지 지시) + 출력(유사도 가드 차단·재생성) 3단 |
| 적용 범위 | 공통 RAG 코어(CT) 신설 + 이메일·캠페인 SMS 먼저 배선. 검증 후 DM·인앱·여정 확산 |
| 브랜드 보이스 | 자동 학습(7천 건 시드) + 브랜드 키트(명시 자산) 하이브리드. admin 명시는 최우선 고정 |
| 녹일 맥락 | 시간·시즌 + 날씨(발송 직전) + 고객 행동(CDP) + 업종 시즌 이벤트 (전부) |

---

## 2. 아키텍처 — 두 기둥, 여덟 부품

### 기둥 A — 문안 두뇌 (RAG + 시의성 + 복제 가드)

**① 검색기 `utils/copy-rag-retriever.ts` (신규 CT)**
- 입력: `{ companyId, industryCode, channel('EMAIL'|'SMS'|'LMS'|'MMS'|'KAKAO'), isAd, intent }`.
- 1차(회사): `ai_training_logs`에서 `tenant_ref = hmacHash(companyId)` + `message_type` + `is_ad` 매칭, **성과 정렬**(우선 `success_count/sent_count` 비율, 동률 시 최신순) 상위 N건(기본 8, 최대 12).
- 2차(업종 폴백): 1차 표본이 `MIN_COMPANY_SAMPLE`(예 5) 미만이면 같은 `industry_code`의 **비식별** 행에서 보강. 단 시그니처 후보 제외(④-입력 규칙) + 회사 자기 행과 dedup.
- 정직 폴백: 1차+2차 합계가 `MIN_TOTAL_SAMPLE`(예 3) 미만이면 빈 결과 반환 → 조립기가 RAG 없이 기존 방식으로 생성. (가짜 예시 합성 금지.)
- 성과 라벨 적응: `success_count` 등이 전부 NULL/0인 회사·업종은 성과 정렬 대신 최신순으로 자동 degrade(에러 X).
- 출력 단위: `CopyExample { text, masked, source: 'company'|'industry', features, perf: { sentCount, successRate|null } }`.
- 비용: 꼬리표 SQL 1회(인덱스 전제). 임베딩 0.

**② 시의성 컨텍스트 `utils/copy-context.ts` (신규 CT, 순수 함수)**
- `buildTemporalContext(now: Date, tz='Asia/Seoul')` — 요일/시간대(아침·점심·저녁·밤)/계절/공휴일/기념일/절기. 외부 의존 0(공휴일·절기 = 코드 테이블).
- `buildIndustryEventContext(industryCode, now)` — 업종 시즌 이벤트 캘린더(명절·블프·개학·신학기·휴가철·연말정산 등). 코드 테이블.
- `buildCustomerContext(companyId)` — 그 회사 CDP 요약(평균 구매주기·최근 반응 톤·등급별 선호). 이미 쌓인 데이터만, 없으면 생략.
- `weather`(날씨): **발송 직전 주입** 설계. 생성 시점이 아니라 실제 발송 워커에서 지역·당일 날씨를 변수로. 1단계는 컨텍스트 슬롯만 정의(데이터 어댑터는 후속 — 외부 기상 API 연동은 별도 Phase). 예약 발송 도달시점 괴리 방지.
- 출력: `CopyContext { temporal, industryEvent, customer?, weather? }` — 조립기가 문장으로 압축해 프롬프트에 주입.

**③ 프롬프트 조립기 — `brand-voice-prompt.ts` 확장(또는 `utils/copy-prompt-composer.ts` 신규로 분리 후 CT-99가 위임)**
- 합성 순서: 기존 basePrompt → 브랜드 보이스(키트+가이드라인, 기둥 B) → ①성과 예시 → ②시의성 컨텍스트 → 시그니처 조합 지시 → 출력 형식 재확인.
- 회사 예시 = 원문 노출 가능("톤·구조 참고"). 업종 예시 = 패턴·골격 요약 + 짧은 발췌(고유 문구 제거), "표현 복제 금지, 이 회사 보이스로 새로" 강한 지시.
- 토큰 안전: 예시는 ①이 엄선한 N건만. 기존 5분 TTL 캐시 유지.

**④ 복제 가드 `utils/copy-similarity-guard.ts` (신규 CT, 순수 함수, TDD)**
- 입력단 규칙: `isLikelySignature(text, perTenantNgramFreq)` — 한 `tenant_ref`에서 반복되는 고빈도 고유 n-gram을 시그니처 후보로 판정 → 업종 예시에서 제외/마스킹.
- 출력단 규칙: `checkCopyLeak(generated, examples)` — 생성문 vs 참조 예시 연속 n어절(기본 6) 일치 또는 정규화 유사도 임계 초과 검출. 위반 시: 재생성 1회 → 그래도 위반이면 RAG 예시를 빼고 생성(브랜드 키트만으로).
- 금지어 가드: 브랜드 키트 `banned_words` 포함 시 제거·재생성(같은 출력단에서 함께).
- 전부 순수 함수 → `scripts/verify-copy-brain.ts`로 검증.

### 기둥 B — 브랜드 보이스 강화 (자동 학습 + 브랜드 키트 + 화면)

**⑤ 브랜드 키트(명시 자산) — `ai_company_memory` `brand_guideline` JSON 확장 + 신규 `brand_kit` 필드군**
- 추가 자산(회사 admin 명시 등록):
  - `signature_locked: string` — 문안 끝에 **항상 조합**할 고정 시그니처/맺음말 (주인님 핵심 요구).
  - `signature_mode: 'append' | 'ai_blend'` — 끝에 고정 부착 / AI가 자연스럽게 녹임. 기본 `append`.
  - `slogans: string[]` — 슬로건·태그라인(AI가 문맥에 맞게 활용).
  - `required_words: string[]` / `banned_words: string[]` — 필수어 / 금지어(④ 가드 연동).
  - 기존 9항목(tone_signature·avg_length·frequent_expressions·greeting_pattern·cta_patterns·signature(추출)·emoji_whitelist·ad/reject position)은 유지.
- 채널 적응: `signature_mode='append'`라도 SMS(33자 한도)는 자동 축약·생략(③에서 처리).
- **admin 명시 = 최우선 고정**: 자동 학습(⑥)은 이 필드를 절대 덮어쓰지 않는다(`admin_edited`/필드별 lock 플래그).

**⑥ 브랜드 보이스 자동 학습 `utils/brand-voice-learner.ts` (신규 CT)**
- 자동 시드: 회사가 대표 문안을 안 넣었어도(`representative_message` 0건), 그 회사 `ai_training_logs`(자기 발송분, 성과 상위)에서 대표 문안 풀을 자동 구성 → 가이드라인 추출. ①검색기와 같은 검색 메커니즘 재사용.
- admin 우선: admin이 등록·수정한 대표 문안/키트 필드는 그대로, 자동은 그 위 보강.
- 주기 갱신: 기존 `ai-memory-accumulator-worker.ts`에 통합 — 1일 1회 회사별 재추출, 톤 변화 시 `brand_tone_evolution` 메모리 추가(0613 ai-memory 설계분 정합). 멱등(회사+날짜).
- 정직성: 회사 표본 미달이면 자동 시드 생략(가짜 가이드라인 금지).

**⑦ 배선 — 이메일 + 캠페인 SMS 먼저**
- 이메일: `email-ai.ts` `generateEmailOneShot` / `generateEmailSections` / `refineEmail`에 ①②③④ 적용(이미 `buildSystemPromptWithBrandVoice` 사용 → 조립기 확장으로 자동 수혜 + 검색기/가드 호출 추가).
- 캠페인 SMS/문자: `generateMessages`(routes/ai.ts 또는 해당 생성 경로 — 구현 직전 정밀 grep) 경로에 동일 적용. 채널 = SMS/LMS/MMS.
- 나머지 4개 경로(여정 step·refine·recommend)는 조립기 확장으로 컨텍스트는 자동 수혜, RAG 검색·가드 배선은 후속 확산.

**⑧ 화면 정리 — `AiMemoryPage.tsx` + `BrandVoiceCard.tsx` 리디자인**
- 톤 통일: 보라 배경 → `bg-slate-950` + violet 액센트(0627 인앱 흐름과 일치, design_quality_minimum_journey_level 룰).
- 구조 재편: **브랜드 키트를 주인공**으로 최상단. 분석/조회(도넛·Top10·자세히분석·중요도 히스토그램)는 "자세히 보기" 모달/하위로 접기. cleanup·add 중복 제거(1-click 카드로 일원화).
- 브랜드 키트 등록 UX: 카드형으로 시그니처/슬로건/필수어/금지어/대표문안을 한 화면에서 등록·수정 + **"이 키트로 쓰면 이렇게 나옵니다" 실시간 미리보기**(샘플 문안 1건 생성 또는 조합 프리뷰).
- 5건 상한 완화: 대표 문안 저장은 넉넉히(예 10~15), 프롬프트 주입은 ①이 엄선.
- 영구 룰: native dialog 0(ConfirmModal+useToast), 모델명 UI 0, 모바일 반응형, Source caption, 마케팅 담당자 1클릭 흐름.

---

## 3. 데이터 소스 (구현 직전 검증 필요 — db_column_verify)

| 용도 | 소스 | 구현 직전 확인 |
|---|---|---|
| 성과 문안 풀 | `ai_training_logs` (training-logger INSERT 컬럼 = 코드 확정) | 총 건수, `industry_code` 채움률, `success_count`/`sent_count` 채움률, `tenant_ref` 분포 — SQL 1회 |
| 업종 폴백 | `ai_training_logs.industry_code` | 채움률 낮으면 업종 폴백 효과 제한 → 정직 폴백으로 자연 degrade(설계는 무방) |
| 브랜드 키트 | `ai_company_memory.memory_value` (jsonb, brand_guideline) | 컬럼 jsonb 확인(스키마 변경 없이 필드 확장) |
| RAG 인덱스 | `ai_training_logs` | `(message_type, is_ad, tenant_ref)` / `(industry_code, message_type, is_ad)` 인덱스 존재 여부 → 없으면 추가 |

> 첫 SQL은 순수 덤프(information_schema + count)부터. 추측 컬럼 0개(절대 0번 원칙).

---

## 4. 신규 / 수정 파일

**신규**
- `utils/copy-rag-retriever.ts` — 성과 문안 검색(①).
- `utils/copy-context.ts` — 시의성 컨텍스트(②, 순수).
- `utils/copy-similarity-guard.ts` — 복제·금지어 가드(④, 순수, TDD).
- `utils/brand-voice-learner.ts` — 자동 학습 시드(⑥).
- `utils/copy-prompt-composer.ts` — 조립기 분리(선택; CT-99가 위임).
- `scripts/verify-copy-brain.ts` — 순수 함수 검증(컨텍스트·가드·검색 정렬·시그니처 판정).

**수정**
- `utils/brand-voice-prompt.ts` — 조립기 확장(RAG 예시 + 컨텍스트 + 키트 + 시그니처 조합 주입).
- `utils/email-ai.ts` — ①④ 호출 배선(생성·다듬기).
- 캠페인 SMS 생성 경로(`routes/ai.ts` `generateMessages` 등 — 구현 직전 grep 확정) — 동일 배선.
- `utils/ai-memory-accumulator-worker.ts` — ⑥ 자동 학습·재추출 통합.
- `routes/ai-memory.ts` — 브랜드 키트 필드(signature_locked 등) 저장/조회 확장.
- `pages/AiMemoryPage.tsx` + `components/AiMemory/BrandVoiceCard.tsx`(+ 필요 시 신규 BrandKit 컴포넌트) — ⑧ 리디자인.
- `status/SCHEMA.md` — `ai_training_logs` 실측 기록 + 인덱스, `ai_company_memory` 키트 필드.

---

## 5. DB 변경

- **스키마 변경 최소**: 브랜드 키트는 `ai_company_memory.memory_value`(jsonb) 필드 확장 → 컬럼 추가 없음.
- **인덱스 추가(필요 시)**: `ai_training_logs`에 RAG 검색용 복합 인덱스. 구현 직전 `EXPLAIN`/`pg_indexes` 확인 후 `CREATE INDEX IF NOT EXISTS`.
- 그 외 신규 테이블 없음.

---

## 6. 시그니처 안전 설계 (정보 유출 차단)

- **타사 비식별 예시**: 마스킹(brand/phone/amount/url) 위에 + 시그니처 후보 제거(④ 입력 규칙) + 패턴·골격 위주 노출. 원문 통째 주입 안 함.
- **프롬프트 지시**: "업종 예시는 구조·톤 참고용. 고유 표현·슬로건을 그대로 베끼지 말 것. 이 회사 브랜드 보이스로 새로 작성."
- **출력 가드**: 연속 n어절 일치/유사도 임계 → 차단·재생성·예시 제거(④ 출력 규칙).
- **자사 시그니처는 적극 조합**: 타사 자리를 비운 만큼 회사 자기 시그니처(⑤ `signature_locked`)를 채워 브랜드별 완성도 확보.

---

## 7. 정직성 / 영구 룰 정합

- 회사·업종 표본 둘 다 부족 → RAG 없이 기존 방식 생성. 가짜 예시·임의 상수·가짜 0% 0건(feedback_no_arbitrary_constants).
- 구체 혜택(%/원/쿠폰/무료) 임의 생성 0 — 기존 placeholder 규칙 유지(feedback_ai_no_arbitrary_benefit).
- 모델명 UI 노출 0 / native dialog 0 / 박-단어 0 자가 grep.
- 회사 격리 — 회사 쿼리는 company_id/tenant_ref. 업종 폴링은 비식별 데이터만(역추적 불가).
- 모델 분리 — 메인 한줄로AI(model 파라미터)는 호출부 그대로 유지.

---

## 8. 검증 계획

- backend tsc 0 / frontend tsc 0.
- `scripts/verify-copy-brain.ts` GREEN: ① 검색 정렬(성과 우선·표본 미달 시 폴백·정직 빈결과) ② 시의성 컨텍스트(요일/계절/공휴일/절기 정확) ③ 복제 가드(n어절 일치 차단·통과·금지어 제거) ④ 시그니처 판정(고빈도 tenant n-gram만 후보).
- 자가 grep: 모델명·박-단어·native dialog·임의 혜택·가짜 0% 0건.
- 발송·돈 경로 무수정 확인(생성 프롬프트 강화만, 발송 로직 불변) — 실측 1건 시나리오(테스트 회사 1건 생성 → RAG 예시 주입 확인 → 시그니처 조합 확인 → 복제 가드 통과 확인).

---

## 9. Phase 골격 (writing-plans로 분해)

- **Phase 1 — 순수 코어(TDD)**: ② copy-context, ④ copy-similarity-guard + verify 스크립트. (DB·AI 무의존, 가장 먼저.)
- **Phase 2 — 검색기 + 데이터 검증**: ai_training_logs 실데이터 SQL → ① copy-rag-retriever + 인덱스.
- **Phase 3 — 조립기 통합**: ③ brand-voice-prompt 확장 → 이메일·캠페인 SMS 배선(⑦).
- **Phase 4 — 브랜드 키트 + 자동 학습**: ⑤ 키트 필드 저장/조회, ⑥ brand-voice-learner + 워커 통합.
- **Phase 5 — 화면 리디자인**: ⑧ AiMemoryPage + BrandVoiceCard slate 통일·브랜드 키트 주인공·실시간 미리보기.

---

## 10. 리스크 / 미해결

- `ai_training_logs.industry_code`·성과 라벨 채움률이 낮으면 업종 폴백·성과 정렬 효과 제한 → 정직 폴백으로 안전(설계 무방). Phase 2 SQL로 실태 확정 후 임계(MIN_*) 재조정.
- 날씨 외부 API 연동은 별도 Phase(비용·예약 도달시점 괴리)로 분리 — 1단계는 컨텍스트 슬롯만.
- 캠페인 SMS 생성 경로 정확 위치(generateMessages)는 구현 직전 grep 확정(routes/ai.ts 추정).
- 의미 검색(임베딩)은 데이터 수만 건 시점에 재검토(이번 범위 밖).
