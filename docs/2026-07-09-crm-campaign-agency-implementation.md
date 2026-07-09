# CRM 캠페인 대행 (캠페인 설계 대행) — 구현 기록

> 작성일 2026-07-09 · 상태 **웹 폼 전환 코드완료(2차) — 배포 대기** · 설계 SoT = [superpowers/specs/2026-07-09-crm-agency-webform-redesign-design.md](superpowers/specs/2026-07-09-crm-agency-webform-redesign-design.md) (1차 원설계 = [superpowers/specs/2026-07-09-crm-campaign-agency-design.md](superpowers/specs/2026-07-09-crm-campaign-agency-design.md))
> 이 문서 = "실제로 무엇을 어떻게 구현했는가"의 단일 참조. 코드와 불일치 시 코드가 진실.
> ★ 2026-07-09 2차(Harold 지시): 1차의 xlsx 양식 다운로드/업로드 접수를 **웹 폼 + 행사 이미지(≤5장)** 접수로 전면 교체.

## 1. 개요

비즈니스 요금제(월 300만원, 7,800크레딧) 이상 고객사 전용 **컨설팅 대행 상품**. 고객사가 신제품·행사 내용을 웹 폼(+행사 이미지 최대 5장)으로 접수하면, 인비토 직원이 슈퍼관리자에서 **그 업체 하나의 데이터만** 분석해 "한줄로 마케팅 제안서"(PDF)를 생성·전달한다. 컨펌·캠페인 예약은 오프라인 + 직원이 기존 화면으로 대행(운영).

- 목적: 300만 요금제 영업 무기 + 인비토 직원 활용 컨설팅
- 과금: **무과금**(제안서 생성·이미지 판독 크레딧 0 — runInCreditBundle). 대행 실행 단계에서 기존 크레딧으로 회수
- ★ 최상위 불변식: **업체 단일 스코프** — 분석 전 축(DB현황·AI메모리·캠페인이력·행사이미지·타겟실측)이 선택 업체 `company_id` 하나만 본다

## 2. 확정 정책 (Harold, 2026-07-09)

| 항목 | 결정 |
|------|------|
| 대상 | 비즈니스·엔터프라이즈 **활성 구독** 업체만 (미가입/만료/정지 = 메뉴 비노출·API 차단) |
| 접수 | **웹 폼(풀화면급 모달) + 행사 이미지 최대 5장** (★2차 — 옛 xlsx 왕복 폐지) |
| 설계 실행 | 슈퍼관리자(sys.hanjullo.com) — 요청 목록 → 상세 모달 → [분석 실행] |
| 컨펌·대행 | 시스템 밖(오프라인 + 직원 수동) |
| 과금 | 제안서 생성 = 크레딧 0 |
| 산출물 | "한줄로 마케팅 제안서" PDF (표지 밴드·플랜 카드·행사 이미지·페이지 번호) |

## 3. 시스템 구성

### 고객사 (app.hanjul.ai) — 접수만
- 헤더 메뉴 "캠페인 대행" (planCode BUSINESS/ENTERPRISE에서만 노출)
- `/campaign-agency` 페이지(다크): 3단 안내 → [대행 요청 작성] CTA → **풀화면급 폼 모달**(행사명·기간·내용·혜택·채널 칩·예산·상품 행·이미지 드래그&드롭·참고) → 접수 이력(상태 읽기 전용 + 상세 모달: 필드+이미지 갤러리+라이트박스)
- 접수 시 운영자에게 문자 통지(system-alert)

### 슈퍼관리자 (sys.hanjullo.com) — 캠페인 대행 설계 (화이트 모던)
- AdminDashboard 발송 관리 그룹 "캠페인 대행 설계" → `/admin/campaign-agency`
- 상태 칩 필터 + 요청 목록(업체·행사명·기간·이미지 수·PDF 뱃지) → 행 클릭 → **상세 모달**: 이미지 갤러리(라이트박스) + 고객 메모 + 보정 폼(공용 AgencyRequestForm) + 직원 메모 + 상태 변경 + legacy 요청서(xlsx) 다운로드(있을 때만) + **[분석 실행 → 제안서 생성]**(ConfirmModal + 로딩 오버레이·닫기 차단) + 결과 요약(플랜·전사·dataNotes) + PDF 다운로드
- [직접 설계] 모달: 업체 선택 + 같은 폼(+이미지) → 접수행 생성('designing') + 즉시 분석(1단계)

## 4. 데이터 모델

campaign_agency_requests (1차 CREATE 2026-07-09) + **2차 ALTER 2건 (Harold 서버 psql 실행·information_schema 실측 확인 2026-07-09)**:

```sql
ALTER TABLE campaign_agency_requests ADD COLUMN IF NOT EXISTS image_paths jsonb;      -- [{path,name,mime}]
ALTER TABLE campaign_agency_requests ALTER COLUMN request_file_path DROP NOT NULL;    -- 웹 폼 접수 = 파일 없음
```

- 웹 폼 접수 행: `parsed_json`=폼 값 그대로(파싱 단계 소멸), `image_paths`=이미지 메타, `request_file_path`=null
- legacy xlsx 접수 행: 보존 — `request_file_path` 있는 행만 관리자에서 원본 다운로드 노출
- 파일 저장: `uploads/agency-requests/<companyId>/<uuid>.<jpg|png|webp>` (이미지) · `uploads/agency-proposals/<companyId>/<requestId>.pdf` (제안서). 정적 서빙 밖 — 인증 endpoint 전용

## 5. 파일 목록

**backend**
| 파일 | 역할 |
|------|------|
| utils/crm-agency-request.ts | ★2차 개편: 웹 폼 정규화+필수 검증 CT(buildParsedFromForm·AGENCY_REQUIRED_FIELDS). xlsx 파싱 삭제 |
| utils/event-image-extract.ts | (기존 CT 재사용) vision 전사 + ★2차 `sniffImageMediaType`(jpg/png/webp 매직바이트) 추가 |
| utils/crm-agency-proposal-core.ts | 순수 코어: 프롬프트 빌더(+이미지 전사 축) + normalizeProposal(+extraAllowedText 혜택 허용) |
| utils/crm-agency-proposal.ts | 오케스트레이션: 회사 스코프 수집 + **축4 이미지 전사(무과금 번들 안)** + AI 호출 + 타겟 실측 |
| utils/crm-agency-pdf-render.ts | ★2차 재디자인: 표지 밴드·섹션 헤더·플랜 스트립·행사 이미지 임베드(jpeg/png)·전사 박스·페이지 번호(bufferPages) |
| routes/campaign-agency.ts | ★2차 재작성: 폼 접수(multipart payload+images)·이미지 인증 스트림·adhoc 폼화·/template 삭제 |
| **삭제** utils/crm-agency-template.ts | xlsx 양식 빌더 — 폐지 (exceljs 의존성도 package.json에서 제거) |

**frontend**
| 파일 | 역할 |
|------|------|
| components/agency/AgencyRequestForm.tsx | ★2차 신규: 고객사(다크)·관리자(화이트) 공용 폼(채널 칩·상품 행·이미지 드래그&드롭·payload 빌더) |
| pages/CampaignAgencyPage.tsx | ★2차 재작성: CTA + 풀화면급 접수 모달 + 이력 상세 모달(이미지 갤러리·라이트박스) |
| pages/AdminCampaignAgencyPage.tsx | ★2차 재작성: 상태 칩 필터 + 목록 + 상세 모달 + 직접 설계 모달 |

**테스트**: crm-agency-request.test.ts(폼 정규화 6) · crm-agency-proposal-core.test.ts(+전사 허용 1) · crm-agency-template.test.ts 삭제

## 6. API 엔드포인트

전부 `/api/campaign-agency` prefix, `authenticate` 공통. 컬럼/테이블 미반영 대비 catch에서 `relation/column does not exist` → 503 `DB_MIGRATION_PENDING`.

**고객사 (isCompanyEligible 게이트 = plan_code + 구독활성)**
| Method | Path | 동작 |
|---|---|---|
| GET | /eligibility | `{eligible}` — 프론트 메뉴 노출 판단 |
| POST | /requests | multipart: payload(JSON)+images(≤5장·장당 5MB·jpg/png/webp 매직바이트 검증) → 필수 누락 400 → 저장 → INSERT(실패 시 이미지 전체 unlink) → 운영자 통지 |
| GET | /requests | 본 회사 이력(parsed_json + images name만 — 서버 경로 비노출) |
| GET | /requests/:id/images/:idx | 본 회사 행 이미지 인증 스트림 |

**슈퍼관리자 (requireSuperAdmin)**
| Method | Path | 동작 |
|---|---|---|
| GET | /admin/companies | 비즈니스+ **활성** 업체 목록 |
| GET | /admin/requests?status= | 전 접수 목록(업체명 JOIN + images name) |
| GET | /admin/requests/:id/images/:idx | 이미지 인증 스트림(갤러리·라이트박스) |
| GET | /admin/requests/:id/file | legacy 요청서 원본 다운로드(null 가드) |
| PATCH | /admin/requests/:id | status(화이트리스트)·staff_note·parsed(서버 buildParsedFromForm 재정규화) |
| POST | /admin/requests/:id/design | 분석 실행 → PDF(효과 검증 후 기록). executeDesignForRequest 공유 |
| POST | /admin/design-adhoc | 업체 선택 + 폼(+이미지) → 접수행 생성 + 즉시 분석(1단계) |
| GET | /admin/requests/:id/proposal | 제안서 PDF 다운로드 |

(삭제) GET /template — xlsx 양식 다운로드 폐지.

## 7. 분석 파이프라인 (crm-agency-proposal.ts)

`generateAgencyProposal(companyId, request, images?)` — **runInCreditBundle로 전체 감싸 무과금**:

1. **collectContext(companyId)** — 축별 best-effort(실패 축은 dataNotes 정직 기록): 회사 기본+단가 / 고객 통계 / 축1 DB현황(getCompanyDataProfile percent) / 축2 AI메모리(listMemories 20) / 축3 캠페인이력 15건
2. **축4 행사 이미지 전사(★2차)** — `extractEventTextFromImages`(기존 CT 재사용, 번들 안 = 차감 0). 실패 = "행사 이미지 판독 실패 — 해당 축 생략" 정직 기록 후 계속
3. **callAIWithFallback** model:'opus' creditCost:0 → JSON → `extractJsonFromAiText`
4. **normalizeProposal(…, imageTranscript)** — plans 1~5 / channel 화이트리스트 / **혜택 출구가드: 요청 benefit+description+상품가격+이미지 전사만 허용**(이미지도 고객 제출물) / Liquid 평문화 / plans 0건=throw
5. **measurePlanTargets** — recommendTarget→빈 필터=실패 취급→countFilteredCustomers **DB 실측**→문자 채널만 count×단가

## 8. 제안서 PDF (crm-agency-pdf-render.ts — ★2차 재디자인)

표지 바이올렛 밴드(제목·작성일) + 정보 카드(분석 대상 업체 명기·행사·기간·예산) → 1.기업 현황 → 2.행사 분석(+이미지 판독 전사 박스) → 행사 이미지 섹션(jpeg/png 임베드 최대 6장 2열, **webp = pdfkit 미지원이라 제외 안내**) → 3.캠페인 플랜(플랜 헤더 스트립+채널 칩+문안 박스) → 4.참고 인사이트("발송 대상 선정 미사용" 캡션) → 5.리스크 → 데이터 참고 → 전 페이지 번호 푸터(**호출측 `new PDFDocument({bufferPages:true})` 필수** — routes에서 적용됨). malgun.ttf 한글 폰트. 모델명 노출 0.

## 9. 자격 게이팅

`isCompanyEligible(companyId)` = `isBetaAccessAllowed`(plan_code BUSINESS/ENTERPRISE) **AND** `isSubscriptionBlocked` 통과. 고객사 접수·이력·이미지 · `/admin/companies` · `executeDesignForRequest` 실행 시점 · design-adhoc 서버 재검증 = **전부 단일 기준 공유**.

## 10. 안전 장치

1차 Codex 적대 리뷰 5건 유지·계승: ① 고아 파일 — INSERT 실패 시 **이미지 전체 unlink** ② 자격=isSubscriptionBlocked 동반 ③ design 실행 시점 재검증 ④ 업로드 검증 — **이미지 매직바이트(sniffImageMediaType: FFD8FF/89504E47/RIFF-WEBP)**, mimetype 위장 차단, 검증 전 저장 없음 ⑤ 빈 필터=변환 실패 취급.
2차 추가: 서버 FS 경로 클라이언트 비노출(name만·이미지는 idx 기반 인증 스트림) / 필수 누락 서버 400(missingRequired 단일 진실=AGENCY_REQUIRED_FIELDS) / PATCH parsed 서버측 재정규화 / PDF 이미지 임베드 실패 개별 무시(분석·문안 영향 0).
영구 룰: AI 임의 혜택 금지(혜택=요청 기입값+고객 이미지 전사만) / 예측 타겟 금지 / 모델명 UI 0 / 목업 금지 / 0건 정직.

## 11. 검증 (2026-07-09 2차)

backend tsc 0 · frontend tsc 0 · vitest 396/396(template 3 삭제 + request 폼 6 + core 전사 1) · 금지 패턴(모델명·native dialog·박-단어) 0 · /template·crm-agency-template·exceljs 참조 잔존 0 grep.

## 12. 배포 주의

- **exceljs 의존성 제거**(package.json·lock) — 서버 `git pull` 후 `cd packages/backend && npm install` 권장(정리용 — 미실행해도 잔존 모듈이 있어 부팅 영향 없음)
- DDL 2건 실행 완료(2026-07-09 Harold — image_paths 추가·request_file_path NULL 허용 실측 확인)
- frontend + backend build:safe + pm2 reload

## 13. 잔여·후속 (설계 밖)

- 컨펌·캠페인 예약 대행 = 오프라인 + 직원 수동(의도)
- 후속 여지: 고객 화면 제안서 PDF 제공(전달 자동화), 앱 내 컨펌 워크플로우 — 필요 시 별도 과제
