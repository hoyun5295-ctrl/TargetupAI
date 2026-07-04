# 베스트 문안 진화 설계 — 성과 환류 + 공식 증류 + 사용자 제품화 (2026-07-04)

Harold 확정 방향: "성과 환류 → 공식 증류 → 제품화(원문 노출 0 정제안)"를 원스텝 구현.

## 0. 대원칙 — 원문의 벽

```
[내부 전용]                                   [사용자 노출]
직원 큐레이션 원문(탈색, best-copy 페이지)
   → 공식 증류(구조·톤·후킹만 추출)   →   AI 재창작 예시(style_example)   →   사용자 갤러리
        ↑ 원문 종착점. 벽 오른쪽으로 원문·원문 조각 이동 금지
```

- 사용자 화면에 **타사 실발송 원문은 탈색본이라도 절대 노출하지 않는다.**
- 사용자에게 보이는 것: ① 자기 자신의 과거 문안(내 승리 문안 — 자사 데이터 자사 노출 = 리스크 0)
  ② AI가 업종 공식으로 **새로 쓴** 예시(가상 상호, 혜택은 `[직접 작성해주세요]` placeholder).
- 사용자향 명칭은 "베스트 문안"이 아니라 **"스타일 참고"** — 문안 모음이 아니라 스타일 추천 프레임.
- 예시 캡션 고정: "AI가 업종 공통 패턴을 분석해 작성한 예시입니다. 실제 업체의 발송 문안이 아닙니다."
- 유사도 가드: 재창작 예시는 게시 전 시드 코퍼스와 word 3-gram Jaccard 검사(≥0.35 폐기).

## 1. 데이터 — 신규 테이블 2 (Harold 서버 psql 직접 실행)

코드는 테이블 부재(42P01) 시 조용히 degrade(로깅 skip·조회 빈 결과) — 배포 순서 자유.

```sql
-- 사전 확인 (둘 다 0 rows여야 신규)
SELECT table_name FROM information_schema.tables WHERE table_name IN ('best_copy_seed_usage','best_copy_assets');

CREATE TABLE best_copy_seed_usage (
  id bigserial PRIMARY KEY,
  seed_id uuid NOT NULL,
  tenant_ref varchar(64) NOT NULL,   -- getTenantRef(companyId) 해시 (ai_training_logs.tenant_ref와 동일 규격)
  channel varchar(10) NOT NULL,
  used_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bcsu_seed ON best_copy_seed_usage(seed_id);
CREATE INDEX idx_bcsu_tenant_time ON best_copy_seed_usage(tenant_ref, used_at);

CREATE TABLE best_copy_assets (
  id uuid PRIMARY KEY,               -- 앱 생성 UUID (확장 의존 없음)
  kind varchar(20) NOT NULL,         -- 'formula' | 'style_example'
  industry_code varchar(20) NOT NULL,
  channel varchar(10) NOT NULL DEFAULT 'LMS',
  is_ad boolean NOT NULL DEFAULT true,
  content text NOT NULL,             -- formula: 요약 렌더 / style_example: 예시 문안
  meta jsonb,                        -- formula 구조 JSON / example 태그(hook 유형 등)
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bca_kind_ind ON best_copy_assets(kind, industry_code);
```

## 2. 1단계 — 시드 성과 환류

- 서빙 기록: `composeCopyBrain`이 Track B(브랜드보이스 미등록)에서 업종 시드를 프롬프트에 넣는 순간
  `best_copy_seed_usage`에 (seed_id, tenant_ref, channel) INSERT — fire-and-forget, 실패해도 생성 무영향.
- 배관: retriever `SELECT`에 `id` 추가 → `CopyExample.seedId`(industry만) → 조립기에서 기록.
- 집계(시드 카드 뱃지): 참고 횟수 = usage rows(정확). 성과 = usage와 같은 회사(tenant_ref)의
  **참고 후 7일 내** ai_training_logs 발송 성과 합의 성공률 — **근사치**로 명시 라벨.
- 한계(정직): 캠페인 단위 정확 연결은 campaigns 스키마 + 발송 보호 영역 수술 필요 → **후속 과제**로 분리.
  (campaigns에 seed_refs 운반 컬럼 없음 — SCHEMA.md·실측 확인 2026-07-04)

## 3. 2단계 — 업종 승리 공식 증류

- `industry-formula.ts` 신규 CT: 업종 승인 시드(최소 3건)를 AI가 분석 →
  공식 JSON `{hooks[], structure, tone, cta, length_hint, donts[]}` → `best_copy_assets(kind='formula')` 업종당 1행 교체 저장.
- 주입: 조립기(Track B만)가 공식을 "## 업종 승리 공식(구조 지침 — 원문 아님)" 블록으로 프롬프트에 추가.
  기존 원문 시드 블록·구조 통계 블록과 공존(원문 참고 + 공식 지침 이중).
- 갱신 트리거: ① BestCopyPage 업종 선택 시 [공식·예시 갱신] 버튼(직원 1클릭)
  ② AI 채굴 승인 저장 직후 자동 갱신(fire-and-forget). 시드 3건 미만 업종 = insufficient 정직 안내.

## 4. 3단계 — 사용자 제품화 (스타일 참고)

- 공식 갱신 시 AI가 예시 문안 3건 재창작 → 유사도 가드 통과분만 `best_copy_assets(kind='style_example')` 교체 저장.
  예시 규칙: 가상 상호(예: "OO뷰티"), 구체 혜택 금지 — `[직접 작성해주세요]` placeholder(기존 룰 그대로), 모델명 0.
- 사용자 API: `GET /api/ai/style-gallery` (authenticate) →
  `{ myBest: 자사 학습로그 성과 상위 문안(원문 — 자사 것), styles: 자사 업종 style_example, industryLabel }`.
- 노출 지점: **AI 문구 추천 모달(AiMessageSuggestModal)** 안 "스타일 참고" 접이식 섹션(모달 자체 fetch — Dashboard 수정 0).
  - 내 승리 문안 카드 클릭 → 프롬프트에 "지난 성과 좋았던 우리 문안의 톤·구조 참고: (원문)" 삽입.
  - 업종 스타일 카드 클릭 → 프롬프트에 스타일 지시문(후킹 유형·톤·구성)만 삽입 — 예시 원문 복붙 아님.
  - 층 분리: 위=내 승리 문안(자사) / 아래=업종 스타일(AI 창작) + 고정 캡션.

## 5. 구현 파일

| 영역 | 파일 | 내용 |
|---|---|---|
| BE 신규 | utils/best-copy-assets.ts | 테이블 CRUD + 42P01 degrade + usage 기록/집계 + jaccard3 유사도 |
| BE 신규 | utils/industry-formula.ts | 공식 증류 + 예시 재창작(가드) LLM |
| BE 수정 | utils/copy-rag-retriever.ts | SELECT id + CopyExample.seedId |
| BE 수정 | utils/copy-prompt-composer.ts | usage 기록 + 공식 블록 주입 |
| BE 수정 | routes/admin.ts | list 확장(stats·formula·examples) + formula/refresh + 승인 후 자동 증류 |
| BE 수정 | routes/ai.ts | GET /style-gallery |
| FE 수정 | pages/BestCopyPage.tsx | 카드 성과 뱃지 + 공식 패널/갱신 버튼 |
| FE 수정 | components/AiMessageSuggestModal.tsx | 스타일 참고 섹션(내 승리 + 업종 스타일) |

## 6. 후속 과제 (이번 범위 밖 — 별도 승인)

1. 캠페인 단위 정확 성과 연결(campaigns seed_refs 운반 — 발송 보호 영역·스키마 변경 수반)
2. 0클릭 승인함(주간 자동 채굴 적재 + 미검수 뱃지)
3. 공식/예시 주간 자동 갱신 워커
4. 파인튜닝 골드 라벨 파이프(큐레이션 승인/반려 → 선호 데이터셋)
