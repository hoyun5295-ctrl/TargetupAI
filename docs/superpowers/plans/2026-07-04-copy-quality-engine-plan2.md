# 문안 퀄리티 엔진 계획 2 — 업종 베스트 주입(탈색·큐레이션) + 베스트 랭커

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, 순차 — no_parallel_tasks). 스텝 `- [ ]`.

**Goal:** Track B(브랜드보이스 미등록)가 "얇은 통계" 대신 탈색·검수된 업종 베스트 문안 원문을 생성 프롬프트로 받게 한다. 베스트 선별은 성과 없을 때도 작동(final_source·spam_blocked·루브릭).

**Architecture:** 큐레이션 시드는 스키마 ALTER 없이 `ai_training_logs`에 sentinel tenant_ref(`hmac('__CURATED_SEED__')`)로 저장. 검색기는 Track B에서 이 sentinel 행만 업종별로 조회 → 원본 타사 행 미서빙(누출 0). 탈색(pure)·베스트 랭커(pure)는 신규 CT. 큐레이션 시드 생성기(9천 채굴→탈색→검수 후보)는 오프라인 스크립트.

**참조 스펙:** docs/superpowers/specs/2026-07-04-copy-quality-engine-design.md §4.1·4.2·4.3·4.6

**검증된 컬럼(2026-07-04 덤프)**: tenant_ref·industry_code·message_type·is_ad·final_message·final_source·sent_count·success_count·spam_blocked·created_at. 신규 컬럼 없음.

---

### Task 1: 탈색 CT (copy-deidentify) — 시그니처 누출 0 1차 방어
- Files: Create `packages/backend/src/utils/copy-deidentify.ts` + `.test.ts`
- 자동 탈색 = 명확 식별자(대괄호 브랜드·전화·대표번호·URL·이메일) 제거, 구조·표현 보존. 본문 평문 회사명은 하이브리드 사람 검수가 최종 안전망.
- 함수: `deBrand(text): string`, `hasIdentifierLeak(text): boolean`(서빙 전 게이트).
- 정규식 /g는 replace에만, 탐지(.test)는 비-global 별도(lastIndex 버그 회피).
- 수용: 브랜드/전화/URL 제거 + 본문 보존 + 잔존 탐지 + 반복 호출 일관.

### Task 2: 베스트 랭커 CT (copy-best-ranker)
- Files: Create `packages/backend/src/utils/copy-best-ranker.ts` + `.test.ts`
- 입력: 후보 행(final_message·final_source·spam_blocked·success_count·sent_count). 출력: 점수순 상위 N.
- Tier 0 신호(지금): final_source(selected/edited 가중) + spam_blocked=0 가중 + 성과(있으면 successRate) + 구조 루브릭(copy-domain-rules hasCta 등). 성과 없으면 하위 신호로 폴백(임의 상수 0).
- Tier 1/2(클릭·전환)는 후속에서 가중치 상향 슬롯(설계 §6). 수용: 사람선택·저스팸·고성과가 상위, 신호 없을 때 폴백 정상.

### Task 3: 검색 업그레이드 (copy-rag-retriever 확장)
- Files: Modify `copy-rag-retriever.ts` + `copy-prompt-composer.ts`
- Track B(미등록 + 회사 표본 부족): 원본 타사 조회(`tenant_ref <> own`) 대신 **큐레이션 시드 조회**(`tenant_ref = CURATED_SEED AND industry_code = $1 AND message_type = ANY AND is_ad = $x`). 이미 탈색·검수된 행이므로 CopyExample(source='industry') 원문 서빙. 서빙 전 `hasIdentifierLeak` 가드(누출 0 이중 방어).
- 베스트 랭커로 상위 N 선별(최근순 대체). industryFeatures도 시드 행에서 산출.
- 조립기 `buildCopyBrainPrompt`: 시드가 있으면 "같은 업종에서 검증된 문안(탈색·구조 참고)" 블록으로 원문 렌더(현행 통계 블록 대체/병기). 정직 폴백(시드 0이면 빈 결과) 유지.
- 수용: Track B가 시드 원문을 받음, 원본 타사 행 미서빙, 누출 0, 회귀(등록 회사=자기것만) 불변.

### Task 4: 큐레이션 시드 생성기 (오프라인 스크립트/워커)
- Files: Create `packages/backend/src/utils/copy-seed-curator.ts` (+ 실행 진입점)
- 9천 코퍼스에서 업종별 후보 채굴: final_source in (selected,edited) 우선 + spam_blocked=0 + 베스트 랭커 상위 → `deBrand` → `hasIdentifierLeak` 통과분만 후보. 사람 검수(하이브리드) 후 sentinel tenant_ref 행으로 INSERT.
- 검수 전 후보는 별도 상태로 보관(자동 발송·서빙 금지). 검수·승인 흐름은 최소 형태부터(승인 리스트/플래그), 필요 시 프론트 후속.
- 수용: 후보 채굴·탈색·누출0 통과분만 시드 INSERT, 검수 전 미서빙.

---

## Self-Review
- 스펙 커버리지: §4.2(Task1)·§4.1(Task2)·§4.3(Task3)·§4.6(Task4). §4.4/4.5/4.8 런타임=계획1 완료. §4.7 라벨배관·스팸 오프라인 마이너=계획3.
- 스키마: sentinel tenant로 ALTER 0, 컬럼 전부 덤프 확인.
- 안전: 탈색 누출0 테스트 강제 + 서빙 전 hasIdentifierLeak 가드 이중. 검수 전 시드 미서빙.
