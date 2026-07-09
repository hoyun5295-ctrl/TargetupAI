# CRM 캠페인 대행 접수 방식 재설계 — 웹 폼 + 이미지 (2026-07-09, Harold 승인)

> 원 구현(xlsx 양식 다운로드/업로드) = docs/superpowers/specs/2026-07-09-crm-campaign-agency-design.md.
> 본 설계 = 그 접수 입구를 웹 폼 + 행사 이미지(최대 5장)로 교체한다. 분석 파이프라인·PDF·자격 게이트는 유지.
> Harold 확정(2026-07-09): "엑셀 왕복은 잘못된 접수 방식 — 폼 모달을 풀화면급으로 제대로, 슈퍼관리자 메뉴도 완벽하게."

## 1. 불변 (유지)

- 업체 단일 스코프 · 무과금(runInCreditBundle) · 혜택 출구가드 · 타겟 DB 실측 · isCompanyEligible 자격 단일 기준
- AgencyRequestParsed 스키마 = 하류(제안서 엔진·PDF·관리자 보정 폼) 단일 입력 — 구조 불변
- 상태 흐름 received/designing/delivered/done/on_hold · 제안서 전달 = 시스템 밖(직원)

## 2. 변경

### 고객사 (CampaignAgencyPage — 다크)
- 양식 다운로드/xlsx 업로드 제거 → [대행 요청 작성] 버튼 → 풀화면급 폼 모달(bg-slate-900, max-w-4xl, h-[92vh])
- 폼: 행사명* · 기간 시작*/종료*(date) · 행사 내용*(큰 textarea) · 혜택*(문안은 이 값만 사용 안내) ·
  희망 채널(칩 다중선택: 문자/알림톡/모바일DM/이메일/인앱/여정) · 예산 · 대상 상품(행 추가: 상품명·정가·할인가) · 참고사항
- 행사 이미지 ≤5장, 장당 ≤5MB, jpg/png/webp (기존 이미지 판독 CT 체인과 동일 기준 — 설계안의 10MB에서 조정)
- 접수 1클릭 = multipart(payload JSON + images) → parsed_json 직접 저장(파싱 소멸) → 운영자 문자 통지
- 접수 이력: 상태·이미지 N장 뱃지, 클릭 → 읽기 전용 상세 모달(필드 + 이미지 갤러리)

### 슈퍼관리자 (AdminCampaignAgencyPage — 화이트 모던)
- 목록(상태 칩 필터·업체·행사명·기간·이미지·PDF 뱃지) → 행 클릭 → 상세 모달(max-w-5xl, h-[92vh]):
  이미지 갤러리(클릭 라이트박스) + 보정 폼 + 고객 메모 + 직원 메모 + 상태 변경 + legacy 요청서(xlsx) 다운로드(있을 때만)
  + [분석 실행 → 제안서 생성](ConfirmModal · 로딩 오버레이 · 닫기 차단) + 결과 요약 + PDF 다운로드
- 직접 설계(adhoc): xlsx 업로드 폐지 → 업체 선택 + 같은 폼 모달(이미지 포함) → 즉시 분석

### 분석·PDF
- generateAgencyProposal(companyId, parsed, images?) — 번들 안에서 extractEventTextFromImages(기존 CT) 호출 = 무과금 전사
- 전사 텍스트 = 프롬프트 새 축("행사 이미지 판독") + 혜택 출구가드 허용 텍스트에 포함(고객 제출물이므로)
- PDF 재디자인: 표지 밴드 + 섹션 헤더 + 플랜 카드 + 행사 이미지 섹션(jpeg/png 임베드, webp 제외) + 페이지 번호(bufferPages)

### DB (실행 완료 2026-07-09)
- image_paths jsonb 추가([{path,name,mime}]) · request_file_path NOT NULL 해제 — information_schema 실측 확인

### 제거
- GET /template · xlsx 업로드/매직바이트 · crm-agency-template.ts · parseRequestSheet · 왕복 테스트 · exceljs 의존성(소비처 1곳뿐 — grep 실증)
- crm-agency-request.ts는 "폼 정규화+필수 검증 CT"로 개편(buildParsedFromForm)

## 3. API 변경 요약

| Method/Path | 변경 |
|---|---|
| GET /template | 삭제 |
| POST /requests | multipart: payload(JSON)+images(≤5) — 필수 누락 400, 이미지 매직바이트 검증, INSERT 실패 시 전 이미지 unlink |
| GET /requests | parsed_json·images(name만 — 서버 경로 비노출) 추가 |
| GET /requests/:id/images/:idx | 신설 — 본 회사 스코프 인증 스트림 |
| GET /admin/requests | image 목록(name) 추가 |
| GET /admin/requests/:id/images/:idx | 신설 — requireSuperAdmin |
| POST /admin/design-adhoc | multipart: companyId+payload+images — 폼 방식으로 교체 |
| 그 외 | 불변 (file 다운로드는 legacy 행 전용 — null 가드 기존 존재) |
