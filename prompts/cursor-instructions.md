# Cursor 개발 가이드

Target-UP 프로젝트 실제 코딩 작업 담당

---

## 프로젝트 초기 설정

### 1. 저장소 클론 및 설정
```bash
# 프로젝트 생성
mkdir targetup && cd targetup

# pnpm workspace 설정 (모노레포)
pnpm init

# 패키지 설치
pnpm add -D typescript @types/node
```

### 2. 패키지 구조 생성
```bash
mkdir -p packages/{shared,backend,admin-web,user-web}
mkdir -p database/{migrations,seeds}
mkdir -p docs/{api,architecture,business-logic}
```

### 3. 공통 패키지 (packages/shared)
```bash
cd packages/shared
pnpm init
pnpm add -D typescript
```

### 4. Backend 설정 (packages/backend)
```bash
cd packages/backend
pnpm init
pnpm add express cors helmet morgan dotenv
pnpm add prisma @prisma/client
pnpm add bullmq ioredis
pnpm add jsonwebtoken bcryptjs
pnpm add zod  # validation
pnpm add -D typescript @types/express @types/node @types/cors ts-node nodemon
```

### 5. Frontend 설정 (packages/admin-web, user-web)
```bash
cd packages/admin-web
pnpm create vite . --template react-ts
pnpm add @tanstack/react-query zustand axios
pnpm add antd @ant-design/icons  # UI 컴포넌트
pnpm add dayjs  # 날짜 처리
```

---

## 코딩 컨벤션

### TypeScript
```typescript
// 타입은 별도 파일로 분리
// packages/shared/src/types/message.ts
export interface Message {
  id: string;
  messageType: MessageType;
  recipientPhone: string;
  content: string;
  status: MessageStatus;
}

export type MessageType = 'SMS' | 'LMS' | 'MMS' | 'KMS' | 'FMS' | 'GMS';
export type MessageStatus = 'pending' | 'sending' | 'sent' | 'delivered' | 'failed' | 'cancelled';
```

### API 응답 형식
```typescript
// 성공
{
  "success": true,
  "data": { ... },
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 100
  }
}

// 에러
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "수신번호 형식이 올바르지 않습니다.",
    "details": [...]
  }
}
```

### 파일명 규칙
- 컴포넌트: `PascalCase.tsx` (예: `MessageForm.tsx`)
- 훅: `useCamelCase.ts` (예: `useTargetList.ts`)
- 유틸: `camelCase.ts` (예: `formatPhone.ts`)
- 상수: `SCREAMING_SNAKE_CASE` (예: `MESSAGE_TYPES`)

---

## 주요 구현 가이드

### 1. 타겟 추출 검색 조건 팝업

기획서에 5가지 타입이 있음:
1. 체크박스
2. 체크박스 + 범위검색 (월/금액/나이)
3. 리스트박스 + 검색
4. 검색박스
5. 상품정보 (대/중/소분류)

```tsx
// components/target/SearchConditionPopup.tsx
interface SearchConditionProps {
  type: 'checkbox' | 'checkbox_range' | 'listbox_search' | 'searchbox' | 'product_info';
  fieldKey: string;
  fieldLabel: string;
  options?: string[];
  onSelect: (value: any) => void;
}
```

### 2. 머지 기능 (변수 치환)

```typescript
// utils/merge.ts
export function mergeContent(
  template: string, 
  data: Record<string, string>
): string {
  // #{변수} 형식 처리
  return template.replace(/#{(\w+)}/g, (_, key) => data[key] || '');
}

// 바이트 수 계산 (한글 2바이트)
export function getByteLength(str: string): number {
  return str.split('').reduce((acc, char) => {
    return acc + (char.charCodeAt(0) > 127 ? 2 : 1);
  }, 0);
}
```

### 3. 발송 큐 처리

```typescript
// jobs/message-sender.ts
import { Queue, Worker } from 'bullmq';

const messageQueue = new Queue('message-send', { connection: redis });

// 분할 발송 처리
async function scheduleSplitSend(
  messages: Message[], 
  ratePerMinute: number
) {
  const batches = chunk(messages, ratePerMinute);
  
  for (let i = 0; i < batches.length; i++) {
    await messageQueue.addBulk(
      batches[i].map(msg => ({
        name: 'send',
        data: msg,
        opts: { delay: i * 60000 } // 1분씩 지연
      }))
    );
  }
}
```

### 4. 카카오 실패 → 대체 문자

```typescript
// jobs/fallback-handler.ts
async function handleKakaoFailure(message: Message) {
  if (!message.fallbackEnabled) return;
  
  const content = message.content;
  const byteLength = getByteLength(content);
  
  // 90바이트 이하면 SMS, 초과면 LMS
  const fallbackType = byteLength <= 90 ? 'SMS' : 'LMS';
  
  await messageQueue.add('send', {
    ...message,
    messageType: fallbackType,
    fallbackMessageId: message.id
  });
}
```

---

## 체크리스트

### Backend
- [ ] Prisma 스키마 작성
- [ ] 인증 미들웨어 (JWT)
- [ ] 에러 핸들링 미들웨어
- [ ] API 라우트 구현
- [ ] 발송 큐 워커 구현
- [ ] 외부 API 연동 (SMS, 카카오)

### Frontend (Admin)
- [ ] 로그인 페이지
- [ ] 사용자 관리 페이지
- [ ] 전송 관리 페이지
- [ ] 템플릿 관리 페이지
- [ ] 번호 관리 페이지
- [ ] 기본데이터 설정 페이지
- [ ] 통계분석 설정 페이지

### Frontend (User)
- [ ] 로그인 페이지
- [ ] 타겟 추출 페이지
- [ ] 문자 전송 (SMS/LMS/MMS)
- [ ] 카카오톡 전송 (KMS/FMS/GMS)
- [ ] Mobile DM 페이지
- [ ] 전송 결과 페이지
- [ ] 분석자료함 팝업

---

## Claude에게 코드 요청 시

Claude가 생성한 코드를 Cursor에서 사용할 때:

1. Claude에게 특정 파일 코드 요청
2. Claude가 코드 생성
3. Cursor에서 해당 파일 생성 및 붙여넣기
4. Cursor의 자동완성/수정 기능으로 보완
5. 필요시 GPT에게 리뷰 요청
