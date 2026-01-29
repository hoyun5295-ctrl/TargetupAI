# Target-UP 프로젝트 구조

## 기술 스택

| 영역 | 기술 | 이유 |
|------|------|------|
| **Backend** | Node.js 20 + Express | 비동기 발송 처리, 빠른 개발 |
| **Frontend** | React 18 + TypeScript | 컴포넌트 재사용, 타입 안전성 |
| **Database** | PostgreSQL 15 | 동적 스키마, 파티셔닝, JSONB |
| **ORM** | Prisma | TypeScript 타입 자동 생성 |
| **Queue** | BullMQ (Redis) | 대용량 발송, 예약/분할 처리 |
| **Cache** | Redis | 세션, 발송 상태 캐시 |
| **API Doc** | Swagger/OpenAPI | 자동 문서화 |

---

## 디렉토리 구조

```
targetup/
├── README.md
├── docker-compose.yml          # 로컬 개발 환경
├── .env.example
│
├── database/
│   ├── schema.sql              # PostgreSQL 스키마
│   ├── seeds/                  # 초기 데이터
│   └── migrations/             # 마이그레이션
│
├── docs/
│   ├── api/                    # API 명세
│   ├── architecture/           # 아키텍처 문서
│   └── business-logic/         # 비즈니스 로직 설명
│
├── packages/
│   ├── shared/                 # 공통 타입, 유틸
│   │   ├── src/
│   │   │   ├── types/          # TypeScript 타입 정의
│   │   │   ├── constants/      # 상수값
│   │   │   └── utils/          # 공통 유틸
│   │   └── package.json
│   │
│   ├── backend/                # Express API 서버
│   │   ├── src/
│   │   │   ├── app.ts
│   │   │   ├── config/         # 환경설정
│   │   │   ├── routes/         # API 라우트
│   │   │   │   ├── admin/      # 관리자 API
│   │   │   │   └── user/       # 사용자 API
│   │   │   ├── controllers/    # 컨트롤러
│   │   │   ├── services/       # 비즈니스 로직
│   │   │   │   ├── auth/
│   │   │   │   ├── customer/
│   │   │   │   ├── message/
│   │   │   │   ├── template/
│   │   │   │   └── analytics/
│   │   │   ├── repositories/   # DB 접근
│   │   │   ├── middlewares/    # 인증, 로깅 등
│   │   │   ├── jobs/           # 백그라운드 작업
│   │   │   │   ├── message-sender.ts
│   │   │   │   ├── scheduled-sender.ts
│   │   │   │   └── result-collector.ts
│   │   │   └── integrations/   # 외부 API 연동
│   │   │       ├── sms/        # SMS/MMS API
│   │   │       ├── kakao/      # 카카오 비즈메시지
│   │   │       └── opt-out/    # 080 수신거부
│   │   ├── prisma/
│   │   │   └── schema.prisma
│   │   └── package.json
│   │
│   ├── admin-web/              # 관리자 React 앱
│   │   ├── src/
│   │   │   ├── App.tsx
│   │   │   ├── pages/
│   │   │   │   ├── UserManagement/
│   │   │   │   ├── TransmissionManagement/
│   │   │   │   ├── TemplateManagement/
│   │   │   │   ├── NumberManagement/
│   │   │   │   ├── DataSettings/
│   │   │   │   └── AnalyticsSettings/
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   ├── services/       # API 호출
│   │   │   └── stores/         # 상태 관리 (Zustand)
│   │   └── package.json
│   │
│   └── user-web/               # 사용자 React 앱
│       ├── src/
│       │   ├── App.tsx
│       │   ├── pages/
│       │   │   ├── TargetExtraction/   # 타겟 추출
│       │   │   ├── MessageSend/        # 문자 전송
│       │   │   │   ├── SMS/
│       │   │   │   ├── LMS/
│       │   │   │   └── MMS/
│       │   │   ├── KakaoSend/          # 카카오톡 전송
│       │   │   │   ├── KMS/            # 알림톡
│       │   │   │   ├── FMS/            # 친구톡
│       │   │   │   └── GMS/            # 친구톡 이미지
│       │   │   ├── MobileDM/           # Mobile DM
│       │   │   ├── TransmissionResult/ # 전송 결과
│       │   │   └── Analytics/          # 분석자료함
│       │   ├── components/
│       │   │   ├── common/
│       │   │   ├── target/             # 타겟 관련
│       │   │   ├── message/            # 메시지 관련
│       │   │   └── template/           # 템플릿 관련
│       │   ├── hooks/
│       │   ├── services/
│       │   └── stores/
│       └── package.json
│
├── prompts/                    # AI 도구용 프롬프트
│   ├── gemini-analysis-prompt.md
│   ├── gpt-review-prompt.md
│   └── cursor-instructions.md
│
└── scripts/                    # 유틸리티 스크립트
    ├── setup.sh
    └── deploy.sh
```

---

## 핵심 모듈 설명

### 1. Message Sender (발송 엔진)
```
jobs/message-sender.ts
├── 즉시 발송 처리
├── 분할 발송 (분당 N건)
├── 카톡 실패 → 대체 문자 발송
└── 결과 수집 및 상태 업데이트
```

### 2. Target Extraction (타겟 추출)
```
services/customer/target-extraction.ts
├── 동적 검색 조건 처리 (5가지 팝업 타입)
├── 머지 데이터 맵핑 (#{변수})
├── 수신거부/오류번호 필터링
└── 타겟 리스트 생성
```

### 3. Template Manager (템플릿 관리)
```
services/template/
├── kakao-template.ts    # 알림톡 템플릿 검수 프로세스
├── friendtalk-image.ts  # 친구톡 이미지 관리
└── sms-template.ts      # 문자 보관함
```

---

## 다음 단계

1. [x] DB 스키마 설계
2. [x] 프로젝트 구조 정의
3. [ ] Prisma 스키마 생성
4. [ ] API 명세서 작성
5. [ ] Backend 보일러플레이트
6. [ ] Frontend 보일러플레이트
