# 브랜드메시지 구현 설계서

> 작성: 2026-03-25
> 상태: 설계 완료 (구현 전)
> 참조: `[휴머스온]브랜드메시지 Agent 사용 메뉴얼_20260209.pdf` (40p)

---

## 1. 현황

### 현재 구현 상태
- **자유형 TEXT만 구현** — Dashboard.tsx에서 `IMC_BM_FREE_BIZ_MSG` 테이블에 INSERT
- `sms-queue.ts`의 `insertKakaoQueue()` 함수가 자유형 TEXT INSERT 담당
- 타겟팅은 `I`(채널 친구) 고정
- 메시지 유형은 TEXT 고정

### 구현해야 할 것
- **자유형 8종 메시지 유형** UI + 발송
- **기본형(템플릿)** 발송 — 템플릿 코드 참조 + 변수 치환
- **타겟팅 선택** (M/N/I)
- 카카오&RCS 페이지 브랜드메시지 탭에 통합

---

## 2. 발송 방식 2가지

### 2-1. 자유형 (IMC_BM_FREE_BIZ_MSG)
- 템플릿 없이 직접 작성
- 8종 메시지 유형 지원
- ATTACHMENT_JSON / CAROUSEL_JSON으로 리치 구성
- **현재 TEXT만 구현됨 → 8종 전체로 확장 필요**

### 2-2. 기본형 (IMC_BM_BASIC_BIZ_MSG)
- 사전 등록된 템플릿 코드 참조
- 변수 치환 가능 (MESSAGE_VARIABLE_JSON, BUTTON_VARIABLE_JSON 등)
- 개인화 발송에 적합
- **미구현 → 신규 개발 필요**

---

## 3. 메시지 유형 8종 상세

| 유형 | 코드 | 본문 | 이미지 | 버튼 | 특이사항 |
|------|------|------|--------|------|----------|
| 텍스트 | TEXT | 필수 (1,300자) | 없음 | 최대 5개 | 가장 기본 |
| 이미지 | IMAGE | 필수 (1,300자) | **필수** | 최대 5개 | jpg/png, 5MB, 800x400px |
| 와이드 이미지 | WIDE | 필수 (76자) | **필수** | 최대 2개 | 가로형 배너 |
| 와이드 리스트 | WIDE_ITEM_LIST | 미사용 | 아이템별 | 아이템별 | HEADER 필수(20자), 아이템 3~4개 |
| 캐러셀 피드 | CAROUSEL_FEED | 미사용 | 아이템별 | 아이템별 | CAROUSEL_JSON, 아이템 2~6개 |
| 프리미엄 동영상 | PREMIUM_VIDEO | 선택 (76자) | 없음 | 최대 1개 | 카카오TV URL 필수 |
| 커머스 | COMMERCE | 미사용 | **필수** | 1~2개 | ADDITIONAL_CONTENT(34자), 가격 정보 |
| 캐러셀 커머스 | CAROUSEL_COMMERCE | 미사용 | 아이템별 | 아이템별 | CAROUSEL_JSON, 아이템 2~6개, 가격 |

---

## 4. 타겟팅 옵션

| 코드 | 이름 | 대상 | 수신거부 표시 |
|------|------|------|-------------|
| M | 마수동 전체 | 마케팅 수신동의 전체 | 비친구만 |
| N | 비친구만 | 마수동 중 채널 친구 제외 | 전원 |
| I | 채널 친구 | 광고주 지정 대상 중 채널 친구만 | 없음 |

---

## 5. MySQL 테이블 구조

### 5-1. 자유형 (IMC_BM_FREE_BIZ_MSG) — 40개 컬럼
**발송 필수:**
- `CHAT_BUBBLE_TYPE` — 메시지 유형 (TEXT/IMAGE/WIDE 등)
- `STATUS` — '1' (발송대기)
- `PRIORITY` — 'N' (Normal)
- `AD_FLAG` — 'Y' (광고)
- `RESERVED_DATE` — 예약시간 (yyyyMMddHHmmss)
- `SENDER_KEY` — 발신 프로필 키
- `PHONE_NUMBER` — 수신자 번호
- `TARGETING` — 타겟팅 (M/N/I)

**메시지 구성:**
- `HEADER` — 상단 제목 (WIDE_ITEM_LIST 필수, PREMIUM_VIDEO 선택)
- `MESSAGE` — 본문 (TEXT/IMAGE/WIDE/PREMIUM_VIDEO)
- `ADDITIONAL_CONTENT` — 부가정보 (COMMERCE)
- `ATTACHMENT_JSON` — 버튼/이미지/쿠폰/리스트 JSON
- `CAROUSEL_JSON` — 캐러셀 구성 JSON

**대체 발송:**
- `RESEND_MT_TYPE` — NO/SM/LM/MM
- `RESEND_MT_FROM` — 대체발송 발신번호
- `RESEND_MT_TO` — 대체발송 수신번호
- `RESEND_MT_MESSAGE` — 대체발송 메시지

**수신거부:**
- `UNSUBSCRIBE_PHONE_NUMBER` — 080 번호
- `UNSUBSCRIBE_AUTH_NUMBER` — 인증번호

### 5-2. 기본형 (IMC_BM_BASIC_BIZ_MSG) — 46개 컬럼
자유형 + 추가 필드:
- `TEMPLATE_CODE` — 템플릿 코드 (필수)
- `MESSAGE_VARIABLE_JSON` — 메시지 변수
- `BUTTON_VARIABLE_JSON` — 버튼 변수
- `COUPON_VARIABLE_JSON` — 쿠폰 변수
- `IMAGE_VARIABLE_JSON` — 이미지 변수
- `VIDEO_VARIABLE_JSON` — 동영상 변수
- `COMMERCE_VARIABLE_JSON` — 커머스 변수
- `CAROUSEL_VARIABLE_JSON` — 캐러셀 변수

---

## 6. ATTACHMENT_JSON 구조 (Appendix A)

```json
{
  "button": [
    { "name": "버튼명", "type": "WL", "url_mobile": "https://...", "url_pc": "https://..." }
  ],
  "image": {
    "img_url": "https://...",
    "img_link": "https://..."
  },
  "coupon": {
    "title": "n원 할인 쿠폰",
    "description": "설명",
    "link": { "url_mobile": "...", "url_pc": "..." }
  },
  "item": {
    "list": [
      { "title": "아이템1", "description": "설명", "img_url": "...", "img_link": "...", "link": {...} }
    ]
  },
  "commerce": {
    "title": "상품명",
    "regular_price": 50000,
    "discount_price": 39000,
    "discount_rate": 22,
    "currency_unit": "원"
  },
  "video": {
    "video_url": "https://tv.kakao.com/v/123456",
    "thumbnail_url": "https://..."
  }
}
```

### 버튼 타입 (Appendix B)

| 코드 | 이름 | 필수 필드 |
|------|------|-----------|
| WL | 웹링크 | url_mobile (필수), url_pc (선택) |
| AL | 앱링크 | scheme_android, scheme_ios 중 1개 이상 + url_mobile |
| BK | 봇키워드 | name만 |
| MD | 메시지전달 | name만 |
| BF | 비즈니스폼 | biz_form_key |
| BC | 상담톡전환 | name만 |
| BT | 봇전환 | name만 |
| AC | 채널추가 | name만 |
| P1~P3 | 플러그인 | plugin_id, relay_id |

---

## 7. CAROUSEL_JSON 구조 (Appendix C)

```json
{
  "head": {
    "header": "인트로 제목",
    "description": "인트로 설명",
    "img_url": "...",
    "img_link": "..."
  },
  "list": [
    {
      "header": "아이템 제목",
      "message": "아이템 본문",
      "additional_content": "부가정보",
      "attachment": { /* ATTACHMENT_JSON과 동일 구조 */ },
      "commerce": { /* 커머스 정보 */ }
    }
  ],
  "tail": {
    "link": { "url_mobile": "...", "url_pc": "..." }
  }
}
```

---

## 8. 구현 계획 (Phase별)

### Phase 2-1: 자유형 확장 (우선)
기존 TEXT만 되는 자유형 발송을 8종 전체로 확장

**백엔드:**
- `sms-queue.ts`의 `insertKakaoQueue()` 확장 — CHAT_BUBBLE_TYPE, ATTACHMENT_JSON, CAROUSEL_JSON 파라미터 추가
- 메시지 유형별 validation 함수 (본문 길이, 이미지 필수 여부, 버튼 개수 등)

**프론트엔드 — KakaoRcsPage 브랜드메시지 탭:**
- 메시지 유형 선택 (8종 카드형 selector)
- 유형별 입력 폼:
  - TEXT: 본문 + 버튼(5개)
  - IMAGE: 이미지 업로드 + 본문 + 버튼(5개)
  - WIDE: 이미지 업로드 + 본문(76자) + 버튼(2개)
  - WIDE_ITEM_LIST: HEADER + 아이템(3~4개, 각각 타이틀+설명+이미지+링크) + 버튼
  - CAROUSEL_FEED: 캐러셀 아이템(2~6개, 각각 이미지+설명+버튼)
  - PREMIUM_VIDEO: 카카오TV URL + HEADER + 본문 + 버튼(1개)
  - COMMERCE: 이미지 + 상품명+가격+할인 + 버튼(1~2개)
  - CAROUSEL_COMMERCE: 캐러셀 아이템(2~6개, 각각 상품정보)
- 타겟팅 선택 (M/N/I)
- 발신 프로필 선택
- 수신자 입력 (기존 직접발송 패턴)
- 미리보기 (카카오 말풍선 목업)
- 대체 발송 설정 (SMS/LMS/MMS 폴백)

### Phase 2-2: 기본형(템플릿) 발송
- 템플릿 선택 → 변수 입력 → 개인화 발송
- `IMC_BM_BASIC_BIZ_MSG` INSERT 로직
- 변수 치환 미리보기

### Phase 2-3: 결과 동기화
- 브랜드메시지 발송 결과 → PostgreSQL 동기화
- `RESPONSE_CODE`, `REPORT_CODE` 매핑

---

## 9. 파일 영향 범위

| 파일 | 변경 내용 |
|------|-----------|
| `utils/sms-queue.ts` | `insertKakaoQueue()` 확장 (ATTACHMENT_JSON, CAROUSEL_JSON 등) |
| `routes/campaigns.ts` | 브랜드메시지 발송 API 확장 (유형별 validation) |
| `pages/KakaoRcsPage.tsx` | 브랜드메시지 탭 — 8종 메시지 작성 UI |
| `components/BrandMessageEditor.tsx` (신규) | 메시지 유형별 에디터 컴포넌트 |
| `components/BrandMessagePreview.tsx` (신규) | 카카오 말풍선 미리보기 |
| `components/CarouselEditor.tsx` (신규) | 캐러셀 아이템 편집기 |
| `components/CommerceEditor.tsx` (신규) | 커머스 상품정보 편집기 |

---

---

## 10. QTmsg SMSQ_SEND 발송 테이블 (SMS/알림톡/RCS 통합)

> 참조: `QTmsg-사용자메뉴얼ver4.0.pdf`
> **핵심**: SMSQ_SEND 테이블에 INSERT하면 QTmsg Agent가 자동으로 가져가서 발송. 결과는 SMSQ_SEND_YYYYMM에 저장.

### 10-1. msg_type별 발송 채널

| msg_type | 채널 | 필수 필드 | 비고 |
|----------|------|-----------|------|
| `S` (또는 NULL) | SMS | dest_no, call_back, msg_contents | 90바이트 이내 |
| `L` | LMS | dest_no, call_back, msg_contents, title_str | 2,000바이트 |
| `M` | MMS | dest_no, call_back, msg_contents, file_name1~5 | jpg 300KB 권장 |
| `K` | **알림톡** | dest_no, call_back, msg_contents, k_template_code, k_next_type | 템플릿 코드 필수 |
| `F` | 친구톡 | dest_no, call_back, msg_contents, k_etc_json(senderkey) | |
| `G` | 친구톡 파일첨부 | dest_no, call_back, msg_contents, file_name1, k_etc_json | jpg/png 500KB |

### 10-2. 알림톡 발송 필드 (msg_type = 'K')

| 필드 | 필수 | 설명 |
|------|------|------|
| `dest_no` | Y | 수신번호 |
| `call_back` | Y | 발신번호 |
| `msg_contents` | Y | 알림톡 본문 (변수 치환된 완성형) |
| `msg_type` | Y | `'K'` |
| `k_template_code` | Y | 카카오 등록 템플릿 코드 |
| `k_next_type` | Y | 실패 시 폴백: N(없음), S(SMS), L(LMS), A(대체문구SMS), B(대체문구LMS) |
| `k_next_contents` | 조건 | k_next_type이 A/B일 때 대체 문구 |
| `k_button_json` | 선택 | 버튼 JSON (최대 5개) |
| `k_etc_json` | 선택 | 강조표기 title, senderkey 등 |
| `title_str` | 선택 | 제목 |
| `sendreq_time` | Y | 발송 시간 (NOW() 또는 예약시간) |
| `msg_instm` | Y | INSERT 시간 |

### 10-3. 알림톡 버튼 JSON (k_button_json)

```json
{
  "name1": "버튼1명", "type1": "2", "url1_1": "https://모바일URL", "url1_2": "https://PC URL",
  "name2": "버튼2명", "type2": "1", "url2_1": "", "url2_2": ""
}
```

**버튼 타입 코드:**
| 코드 | 이름 | URL |
|------|------|-----|
| 1 | 배송조회 | 없음 (카카오 제공) |
| 2 | 웹링크 | url_1(모바일 필수), url_2(PC 선택) |
| 3 | 앱링크 | url_1(Android), url_2(iOS) 둘 다 필수 |
| 4 | 봇키워드 | 미적용 |
| 5 | 메시지전달 | 미적용 |
| 6 | 채널추가 | 없음 |

### 10-4. 알림톡 강조표기 (k_etc_json)

```json
{"title": "강조표기 제목"}
```

### 10-5. 알림톡 발송 INSERT 예시 (MySQL)

```sql
INSERT INTO SMSQ_SEND (
  dest_no, call_back, msg_contents, msg_instm, sendreq_time,
  msg_type, title_str, k_template_code, k_next_type, k_button_json
) VALUES (
  '01012345678', '01000000000',
  '주문 확인\n주문번호: 12345\n결제금액: 50,000원',
  NOW(), NOW(),
  'K', '주문확인', 'template_code_001', 'L',
  '{"name1":"주문확인","type1":"2","url1_1":"https://example.com/order/12345","url1_2":""}'
);
```

### 10-6. 발송 결과 코드 (status_code)

| 코드 | 의미 |
|------|------|
| 100 | 대기 |
| 6 | SMS 성공 |
| 1000 | LMS 성공 |
| 1800 | MMS 성공 |
| 7830 | 카톡 실패 → SMS 전환 성공 |
| 7831 | 카톡 실패 → LMS 전환 성공 |
| 1 | 시스템 장애 |
| 2 | 인증 실패 |

### 10-7. RCS 발송

> RCS는 젬텍 NGS 규격서 기반. QTmsg 4.0 매뉴얼에는 RCS 규격이 없음.
> 별도 `젬텍_NGS_RCS_연동규격서_V2.0.2.pdf` 참조 필요.
> RCS도 동일한 MySQL INSERT 방식이지만, 테이블/필드 구조가 다를 수 있음.
> Harold님에게 RCS 발송 테이블 구조 확인 필요.

---

## 11. 알림톡 발송 구현 계획 (즉시 구현 가능)

### 현재 상태
- `sms-queue.ts`의 `insertKakaoQueue()`는 **브랜드메시지**(IMC_BM_FREE_BIZ_MSG)용
- **알림톡**은 SMSQ_SEND에 `msg_type='K'`로 INSERT — 별도 함수 필요

### 구현할 것
1. **sms-queue.ts에 `insertAlimtalkQueue()` 함수 추가** (컨트롤타워)
   - SMSQ_SEND에 msg_type='K' + k_template_code + k_button_json INSERT
   - 기존 `bulkInsertSmsQueue()` 패턴 활용
2. **campaigns.ts 알림톡 발송 경로 추가**
   - 승인된 템플릿 선택 → 변수 치환 → SMSQ_SEND INSERT
3. **프론트 알림톡 탭 개선**
   - 승인 템플릿 드롭다운 → 변수 입력 → 미리보기 → 발송
   - "발송 준비중" 제거 → 실제 발송 버튼

---

## 12. 주의사항

- **발송 가능 시간 (브랜드메시지)**: 08:00 ~ 20:50 (KST)
- **이미지 규격 (브랜드메시지)**: jpg/png, 5MB 이하, 권장 800x400px
- **알림톡 폴백**: k_next_type으로 SMS/LMS 자동 전환 — 반드시 설정
- **대체 발송 발신번호**: 카톡 실패 → SMS 전환 시 call_back 필드 사용
- **수신거부 (브랜드메시지 M/N 타겟팅)**: 080 번호 필수
- **카카오TV URL (프리미엄 동영상)**: `https://tv.kakao.com/v/{숫자}` 형식만
- **QTmsg 중복 방지**: 1초 이내 동일번호+동일내용 자동 거절
