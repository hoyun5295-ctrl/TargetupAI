# CRM 캠페인 제안 (캠페인 대행) — 설계 (2026-07-09, Harold 확정)

> 비즈니스 요금제(300만원, 7,800크레딧) 전용 특별 서비스. 고객사가 행사/신제품 요청서를 접수하면 인비토가 그 업체의 학습 메모리·실시간 고객DB·과거 캠페인 성과·구매이력을 분석해 "한줄로 마케팅 제안서" PDF를 만들어 전달하고, 오프라인 컨펌 후 인비토 직원이 캠페인 예약을 대행한다. 요금제 영업 무기 + 직원 활용 컨설팅 상품.

## 0) 확정 결정 (Harold, 2026-07-09 대화)

| 항목 | 결정 |
|------|------|
| 대상 | 비즈니스 요금제(300만원) 이상 업체만 — 메뉴 자체가 미만 요금제엔 비노출 |
| 접수 방식 | 고객사가 양식 문서(캠페인대행요청서.xlsx)를 다운로드→작성→파일 업로드 |
| 제안서 생성 | 슈퍼관리자(sys.hanjullo.com) 신규 메뉴에서 인비토 직원이 실행 (내부 도구) |
| 컨펌 | 시스템 밖(오프라인 — 전화·이메일·카톡). 앱 내 컨펌 화면 없음 |
| 예약 대행 | 시스템 밖 — 직원이 기존 화면(여정·DM·이메일·인앱·발송)으로 설정 |
| 과금 | **제안서 생성 = 무과금(크레딧 차감 0)**. 대행 실행 단계에서 기존 크레딧 소모처(여정·DM·이메일·발송·인앱)가 어차피 차감 — 거기서 회수 |
| 산출물 | "한줄로 마케팅 제안서" PDF |

## 1) 스코프

**만드는 것 (시스템)**
1. 캠페인대행요청서.xlsx 양식 1개 (정적 파일)
2. 고객사 접수 메뉴 (app.hanjul.ai) — 접수만
3. 슈퍼관리자 "캠페인 대행 설계" 메뉴 (sys.hanjullo.com) — 접수함 + 분석 실행 + PDF
4. 분석 파이프라인 CT + 제안서 PDF 생성
5. 신규 테이블 `campaign_agency_requests` (DDL 1건)

**만들지 않는 것 (운영 영역)**
- 앱 내 컨펌 워크플로우 (오프라인)
- 캠페인 자동 설정/실행 (직원이 기존 화면으로 수동 대행)
- 별도 크레딧 배선 (무과금)

## 2) 양식 — 캠페인대행요청서.xlsx

셀 구조 고정 xlsx (파싱 확실 — upload.ts 엑셀 파서 선례). 필드:

| 필드 | 필수 | 비고 |
|------|------|------|
| 행사명 | Y | |
| 행사 기간 (시작~종료) | Y | |
| 행사 내용 (자유서술) | Y | |
| 신제품/대상 상품 (이름·정가·할인가, 복수) | N | |
| 혜택 내용 | Y | **고객사 직접 기입 — AI 임의 혜택 생성 금지 룰 정합. 제안서의 모든 혜택 문구는 이 값만 사용** |
| 희망 채널 (문자/알림톡/DM/이메일/인앱/여정, 복수 선택) | N | 미기입 = AI가 데이터 기반 추천 |
| 예산 (원) | N | 기입 시 플랜 비용 상한으로 사용 |
| 참고사항 | N | |

파싱 실패·비정형 제출(pdf/docx 등) 대비: 슈퍼관리자 실행 화면에서 파싱 결과를 직원이 확인·수정한 뒤 분석을 돌린다 (파싱은 보조, 직원 확인이 최종).

## 3) 고객사 접수 메뉴 (app.hanjul.ai)

- **게이팅**: 비즈니스 요금제 이상만 메뉴 노출 + backend 이중 게이트 (요금제 게이트 기존 패턴 — planCtx. 미만 요금제 = 메뉴 비노출, API 403)
- **구성**: 안내 카드(서비스 설명) + 양식 다운로드 버튼 + 접수 폼(행사명·메모·파일 업로드) + 내 접수 이력 목록
- **이력 상태**: `접수됨 → 설계 중 → 제안서 전달 → 완료` (+ `보류`). 상태 변경은 슈퍼관리자에서 직원이 수행, 고객사는 읽기 전용
- **접수 통지**: 접수 시 인비토 운영자에게 알림 (system-alert 재사용)
- 디자인: Journey Builder 동급 (다크 slate + 그라데이션 아이콘 + 모바일 반응형 + ConfirmModal/useToast)

## 4) 슈퍼관리자 "캠페인 대행 설계" 메뉴 (sys.hanjullo.com)

**접수함**
- 전체 접수 목록 (업체명·행사명·접수일·상태·담당 메모) + 요청서 파일 다운로드 + 상태 변경

**★ 최상위 불변식 — 업체 단일 스코프 (Harold 명시 2026-07-09)**
1. **업체 선택 리스트 = 비즈니스 요금제 이상만** (companies 요금제 필터 — 미만 업체는 리스트에 아예 안 뜸)
2. **분석 전 축 = 선택된 업체의 company_id 단일 스코프.** DB 현황·메모리·캠페인 이력·구매이력·타겟 실측 전부 `WHERE company_id = 선택 업체` — 다른 업체 데이터가 제안서에 한 줄이라도 섞이면 안 됨 (교차 오염 = 상품 신뢰 파괴 + 정보 유출 사고)
3. 구현 검증 의무: 파이프라인의 모든 쿼리·CT 호출이 companyId 인자를 관통하는지 전수 grep + 제안서 PDF에 "분석 대상: {업체명}" 명기

**설계 실행**
1. 업체 선택 (비즈니스+ 요금제 업체만 필터) — 접수 건에서 진입하면 자동 선택
2. 요청서 선택(접수 파일) 또는 직접 업로드
3. 파싱 결과 확인·보정 (행사명·기간·상품·혜택·채널·예산)
4. **분석 실행** → 제안서 PDF 생성 → 접수 건에 첨부 저장 (다운로드 → 고객사 전달은 오프라인)

**분석 파이프라인** (전부 실데이터 소스 — 목업/임의 상수 금지)
| 축 | 소스 |
|----|------|
| 실시간 DB 현황 | company-data-profile (CT-58: 고객수·등급/포인트 분포·필드 채워짐) |
| 학습 메모리 | operator_memories (성공 패턴·고객 인사이트·브랜드 톤·채널 성과) |
| 과거 캠페인 성과 | campaigns + 발송 결과 (뭐가 통했나 — 채널·시점·타겟별) |
| 구매 이력 | 구매/주문 데이터 (최근성·구매액·재구매 주기) |
| 캠페인 설계 코어 | orchestrate 재사용 (타겟·문안·채널·비용·기대 성과) |

축별 best-effort: 소스 조회 실패·데이터 부족 축은 생략하고 PDF에 "insufficient_data(데이터 부족)" 정직 표기 (marketing-calendar buildCompanyCalendarContext 선례).

**제안서 PDF — "한줄로 마케팅 제안서"** (report-pdf 인프라 재사용)
1. 표지 (업체명·행사명·작성일)
2. 기업 현황 분석 (고객DB·등급 분포·최근 캠페인 성과 요약)
3. 행사 분석 (요청 내용 정리 + 시장/시즌 맥락)
4. 캠페인 플랜 N개 — 플랜별: 타겟 세그먼트(명확한 규칙 + 실측 인원수)·채널·발송 시점·문안 초안·예상 비용·기대 성과(실데이터 기반)
5. 실행 일정 제안 (타임라인)
6. 비용 총괄 (플랜별 발송비 합산 — 회사 실단가)

## 5) 데이터 모델 (DDL 1건 — 실행 전 information_schema 검증 절차 준수)

```sql
CREATE TABLE IF NOT EXISTS campaign_agency_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,   -- 접수 계정
  title varchar(200) NOT NULL,                               -- 행사명
  memo text,                                                 -- 고객사 메모
  request_file_path text NOT NULL,                           -- 업로드 요청서
  parsed_json jsonb,                                         -- 파싱+직원 보정 결과
  status varchar(20) NOT NULL DEFAULT 'received',            -- received/designing/delivered/done/on_hold
  proposal_pdf_path text,                                    -- 생성된 제안서
  staff_note text,                                           -- 직원 메모
  designed_at timestamptz,                                   -- 제안서 생성 시각
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agency_requests_company ON campaign_agency_requests(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agency_requests_status ON campaign_agency_requests(status, created_at DESC);
```

## 6) 과금·AI 호출

- 크레딧 차감 0. **주의**: `callAIWithFallback`은 creditCost 미지정 시 source 맵으로 자동 차감 — 이 파이프라인의 모든 AI 호출은 **무과금 명시(creditCost 0)** 로 호출해 고객사 차감이 절대 발생하지 않게 한다 (marketing-calendar 무과금 호출 선례).
- AI 비용은 인비토 부담 (300만+ 요금제 부가 서비스).

## 7) 안전 룰 정합 (영구 룰 매핑)

| 룰 | 적용 |
|----|------|
| AI 임의 혜택 생성 금지 | 제안서 혜택 = 요청서 기입값만. 미기입 시 `[혜택 직접 확정 필요]` 표기 (placeholder 그대로 발송될 일 없음 — 발송은 직원 수동) |
| 예측으로 타겟 선정 금지 | 플랜 타겟 = 명확한 규칙(등급·구매이력·최근성)만. 예측 지표는 "참고 인사이트" 섹션에 분리 표기 |
| 모델명 UI 노출 금지 | 화면·PDF 전체 grep 0 ("AI 분석") |
| 목업/임의 상수 금지 | 전 지표 실데이터 + Data source 표기, 부족 축 insufficient_data |
| 0건 타겟 자동완화 금지 | 플랜 타겟 0건이면 그 플랜은 "대상 없음"으로 정직 표기 (조건 완화 제안 X) |

## 8) 에러 처리

- xlsx 파싱 실패 → 직원 보정 화면에서 수동 입력 후 진행 (분석 차단 아님)
- 분석 축 실패 → 그 축 생략 + PDF에 부족 표기 (전체 실패 아님)
- PDF 생성 실패 → status 유지(designing) + 에러 표시 + 재실행 가능 (멱등 — 재실행 시 덮어씀)
- 업로드 파일 검증: 확장자·크기 제한, 저장 경로는 기존 업로드 컨벤션 준수

## 9) 테스트·검증

- 순수 로직(양식 파싱·플랜 조립·PDF 섹션 데이터 빌더) = DB-free CT 분리 + vitest
- backend/frontend tsc 0 · 금지 패턴(모델명·native dialog·박-단어) grep 0
- 실측 1건: 실제 요청서 1건 접수→슈퍼관리자 분석 실행→PDF 산출→내용 검수 (Harold/직원)

## 10) 구현 순서 (플랜 단계에서 상세화)

1. DDL + 양식 xlsx 제작
2. backend: 접수 API(업로드·목록) + 슈퍼관리자 API(접수함·파싱·분석 실행·PDF)
3. 분석 파이프라인 CT (`utils/crm-agency-proposal.ts` 신규 — 인라인 금지)
4. frontend: 고객사 접수 메뉴 (요금제 게이팅)
5. frontend: 슈퍼관리자 설계 메뉴
6. 검증(tsc·vitest·grep) + 실측 1건
