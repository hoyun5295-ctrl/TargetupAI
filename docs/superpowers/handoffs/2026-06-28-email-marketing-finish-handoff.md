# 이메일 마케팅 마무리 — 다음 세션 핸드오프 (2026-06-28)

> 이번 세션(2026-06-28 이어서)에 이메일 브레이즈급 **Phase 1 전부 구현·배포 완료**. 다음 세션 = 이메일 마케팅 **마무리**(폴리시 + 실측 + Phase 2 우선순위 확정).

## 0. 진입 방법

1. CLAUDE.md + `status/STATUS.md` CURRENT_TASK + `status/lessons/LESSONS_BACKEND.md`·`LESSONS_FRONTEND.md` 정독.
2. 본 핸드오프 + 설계서 `docs/superpowers/specs/2026-06-28-email-braze-phase1-design.md` + 계획 `docs/superpowers/plans/2026-06-28-email-braze-phase1.md` 정독.
3. 승리 공식([[feedback_braze_win_formula]]) 기준 — 매 항목 "편리함 + AI 풍부" 자가 질의.
4. 발송·돈 경로 수정은 0611 6원칙(수정 전 승인 + 실측 1건).

## 1. 이미 완료(배포됨) — 재작업 금지

- 비주얼 에디터(`components/email/EmailVisualEditor.tsx`): @dnd-kit 드래그 순서변경 + 블록 복제.
- 템플릿 갤러리: `utils/email-templates.ts`(프리셋 6) + `components/email/EmailTemplateGalleryModal.tsx` + EmailCampaignsPage "템플릿에서 시작" 버튼.
- 개인화: `Section.display_condition`(jsonb) + `utils/email/email-personalization.ts`(CT, verify 9/9) + `render-preview` sampleCustomer + `GET /api/email/preview-customers` + 에디터 변수 칩·조건부·VIP/일반/신규 미리보기.
- 발송 경로: `email-channel.ts` `resolveCustomerRecipients`(customer 필드) + `sendEmailCampaign`(섹션 캠페인 수신자별 렌더, 수동 HTML 무회귀).

## 2. 다음 세션 작업 — 정확한 잔여 목록

### A. 발송·돈 실측 1건 (★최우선, 주인님 직접)
- 본인 이메일을 직접 입력 수신자로 두고, `{{ customer.name }}`가 든 텍스트 블록 + "등급=VIP일 때만 표시" 조건부 블록을 가진 섹션 캠페인을 테스트 발송 → ① 이름 치환 ② 조건부 표시/숨김 확인. 통과 후에만 실고객 대량 발송.

### B. Phase 1 폴리시 (편리함 + AI 풍부 마감)
- **1클릭 "AI 개선"** — `EmailVisualEditor` 상단에 버튼 추가. 기존 `POST /api/email/ai/refine`(routes/email.ts:840 존재) 재사용해 제목·본문 다듬기(혜택 placeholder 유지·임의 혜택 0). 구현 직전 ai/refine 입력·출력 계약 read.
- **템플릿 AI 추천 배선** — `email-templates.ts`에 `recommendTemplateKeys(industry)` 이미 있음(미배선). 회사 업종 신호(brand kit/회사 데이터)를 가져와 갤러리 상단에 "회사에 어울리는 추천" 1~2개 우선 노출. 업종 신호 없으면 전체 노출(추측 추천 금지).
- **변수 커서 삽입 개선** — 현재 변수 칩은 클립보드 복사 방식. 가능하면 마지막 포커스된 텍스트 필드의 커서 위치에 직접 삽입으로 격상(SectionPropsEditor 입력 ref 추적 필요 — 공용 컴포넌트라 영향 점검).

### C. Phase 2 — 다음 우선순위 확정 후 구현 (brainstorming 시 이연됨)
- 분석 대시보드(캠페인별 오픈·클릭·전환 추이 + 비교) — `email_events` 데이터 이미 적재됨.
- A/B 테스트(제목·본문 변형 + 성과 비교, 기존 bandit-arm 연계).
- 세그먼트 타겟(고객 등급·행동 조건 발송, CDP 연계).
- → 셋 중 임팩트순 1~2개를 다음 세션 brainstorming으로 확정 후 진행.

## 3. 영구 원칙

- AI 임의 혜택 0(placeholder) · 모델명 UI 0 · native dialog 0 · 모바일 반응형 · Source caption.
- 발송·돈 = 6원칙(전수 grep·실측 1건·무회귀). 인라인 치환 신설 0(liquid-templating·inapp CT 재사용).
- 디자인 = [[feedback_design_modal_first_simplicity]] + [[feedback_braze_win_formula]](편리함 + AI 풍부).
