# D62 — 13차 버그 수정 가이드 (2026-03-09)

> **목적:** 새 채팅에서 이 파일만 읽으면 바로 코드 수정 가능하도록 정리
> **원칙:** 파일 1개씩 순차 수정 (Read → Edit). **병렬 에이전트 절대 금지.**
> **기간계 무접촉:** 발송 INSERT, 차감, 환불, 인증 로직 일절 미수정
> **Harold님 컨펌 완료:** 2026-03-09

---

## 수정 순서

1. campaigns.ts (7건)
2. unsubscribes.ts (2건)
3. customers.ts (1건)
4. upload.ts (4건)
5. normalize.ts (3건)
6. ai.ts (2건)
7. Dashboard.tsx (2건)
8. AiCampaignResultPopup.tsx (3건)
9. TargetSendModal.tsx (2건)
10. CustomerDBModal.tsx (2건)
11. DirectTargetFilterModal.tsx (1건)

---

## 파일 1: campaigns.ts

**경로:** `packages/backend/src/routes/campaigns.ts`

### B13-07 🔴🔴 수신거부 제외 오류

**위치:** ~Line 2023-2029 (direct-send 수신거부 필터링)

**현재 코드:**
```typescript
const phones = recipients.map((r: any) => normalizePhone(r.phone));
const unsubResult = await query(
  `SELECT phone FROM unsubscribes WHERE user_id = $1 AND phone = ANY($2)`,
  [userId, phones]
);
```

**수정:**
```typescript
const phones = recipients.map((r: any) => normalizePhone(r.phone));
const unsubResult = await query(
  `SELECT phone FROM unsubscribes WHERE company_id = $1 AND phone = ANY($2)`,
  [companyId, phones]
);
```

**핵심:** `user_id` → `company_id` 변경. 수신거부는 회사 단위로 관리되어야 함.

---

### B8-08 🟠 수신거부 건수 미표시

**위치:** ~Line 2353-2359 (direct-send 응답)

**현재 코드:**
```typescript
res.json({
  success: true,
  campaignId,
  sentCount: directTotalSent,
  failCount: directFailTotal,
  message: `${directTotalSent}건 발송 ...`
});
```

**수정:**
```typescript
res.json({
  success: true,
  campaignId,
  sentCount: directTotalSent,
  failCount: directFailTotal,
  unsubscribeCount: excludedCount,
  message: `${directTotalSent}건 발송 ...`
});
```

**핵심:** `unsubscribeCount` 필드 추가. 프론트에서 모달에 표시용.

---

### B8-04 🔴 AI 회신번호 '1234' 차단

**위치:** ~Line 990 (AI send 회신번호 검증)

**현재 코드:**
```typescript
const senderCallback = normalizePhone(campaign.callback_number || defaultCallback);
const senderCheck = await query(...)
```

**수정 (senderCallback 바로 다음 줄에 삽입):**
```typescript
const senderCallback = normalizePhone(campaign.callback_number || defaultCallback);

// 회신번호 최소 길이 검증 (한국 전화번호 최소 8자리)
if (senderCallback.length < 8 || senderCallback.length > 11) {
  return res.status(400).json({
    error: '유효하지 않은 회신번호입니다. 올바른 전화번호 형식으로 입력해주세요.',
    code: 'INVALID_CALLBACK_FORMAT'
  });
}

const senderCheck = await query(...)
```

**동일 검증을 direct-send 라우트 (~Line 1981-1992)에도 적용.**

---

### B12-01 🔴 예약취소 미작동

**위치:** ~Line 2422-2433 (cancel route)

**현재 코드:**
```typescript
await smsExecAll(cancelTables,
  `DELETE FROM SMSQ_SEND WHERE app_etc1 = ? AND status_code = 100`,
  [campaignId]
);

if (alreadyPickedUp > 0) {
  await smsExecAll(cancelTables,
    `UPDATE SMSQ_SEND SET status_code = 9999 WHERE app_etc1 = ? AND status_code NOT IN (${SUCCESS_CODES.join(',')})`,
    [campaignId]
  );
}
```

**수정:** UPDATE 조건에서 이미 완료/대기 상태도 제외:
```typescript
await smsExecAll(cancelTables,
  `DELETE FROM SMSQ_SEND WHERE app_etc1 = ? AND status_code = 100`,
  [campaignId]
);

if (alreadyPickedUp > 0) {
  // 전송완료(SUCCESS_CODES)와 대기중(100) 제외, 진행중인 것만 취소처리
  await smsExecAll(cancelTables,
    `UPDATE SMSQ_SEND SET status_code = 9999 WHERE app_etc1 = ? AND status_code NOT IN (${SUCCESS_CODES.join(',')}) AND status_code != 100`,
    [campaignId]
  );
}
```

**추가:** PostgreSQL campaigns 테이블 상태도 업데이트:
```typescript
// 캠페인 상태를 'cancelled'로 변경
await query(
  `UPDATE campaigns SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND status IN ('scheduled', 'sending')`,
  [campaignId]
);
```

---

### B12-02 / B13-09 🔴 발송중 고착

**위치:** ~Line 2330-2335 (direct-send 상태 설정) + ~Line 1874-1889 (sync-results)

**현재 코드 (direct-send):**
```typescript
if (!scheduled) {
  await query(
    `UPDATE campaigns SET status = $1, sent_count = $2, sent_at = NOW() WHERE id = $3`,
    [directTotalSent === 0 ? 'failed' : 'sending', directTotalSent, campaignId]
  );
}
```

**수정:** 즉시발송 완료 시 바로 'completed' 전환 조건 추가:
```typescript
if (!scheduled) {
  // 즉시발송: MySQL INSERT 완료 후 상태 설정
  // QTmsg Agent가 처리할 시간을 고려하여 sending으로 설정하되,
  // sent_count와 fail_count를 함께 기록
  const immediateStatus = directTotalSent === 0 ? 'failed' : 'sending';
  await query(
    `UPDATE campaigns SET status = $1, sent_count = $2, fail_count = $3, sent_at = NOW(), updated_at = NOW() WHERE id = $4`,
    [immediateStatus, directTotalSent, directFailTotal, campaignId]
  );
}
```

**sync-results 수정 (~Line 1874-1889):**
```typescript
// 타임아웃 조건 완화: 60분 → 30분, 그리고 pending이 0이면 즉시 completed
const directTimedOut = directElapsedMinutes > 30;
const newStatus = dEffectivePendingCount === 0
  ? ((successCount + dEffectiveFailCount) > 0 ? 'completed' : 'failed')
  : (directTimedOut ? 'completed' : 'sending');
```

---

### B13-05 🔴 금액필터 미작동

**위치:** ~Line 1938-1960 (direct-send 파라미터)

**수정:** `targetFilter` 파라미터 추가 (req.body 디스트럭처링에):
```typescript
  targetFilter,  // 금액필터 등 타겟 조건
} = req.body;
```

**~Line 2022 (수신거부 필터링 전)에 금액필터 로직 추가:**
```typescript
// 금액필터 적용 (targetFilter가 있을 경우)
let filteredRecipients = recipients;
if (targetFilter && Object.keys(targetFilter).length > 0) {
  // 금액 조건이 있는 경우, DB에서 조건 매칭 고객만 필터
  const amountFields = Object.keys(targetFilter).filter(k =>
    k.includes('amount') || k.includes('purchase') || k.includes('금액')
  );
  if (amountFields.length > 0) {
    const recipientPhones = recipients.map((r: any) => normalizePhone(r.phone));
    let filterWhere = 'c.company_id = $1 AND c.phone = ANY($2::text[]) AND c.is_active = true';
    const filterParams: any[] = [companyId, recipientPhones];
    let pIdx = 3;

    for (const [key, condition] of Object.entries(targetFilter)) {
      if (typeof condition === 'object' && condition !== null) {
        const cond = condition as any;
        if (cond.operator === 'between' && Array.isArray(cond.value)) {
          filterWhere += ` AND c.${key} BETWEEN $${pIdx++} AND $${pIdx++}`;
          filterParams.push(cond.value[0], cond.value[1]);
        } else if (cond.operator === 'gte') {
          filterWhere += ` AND c.${key} >= $${pIdx++}`;
          filterParams.push(cond.value);
        } else if (cond.operator === 'lte') {
          filterWhere += ` AND c.${key} <= $${pIdx++}`;
          filterParams.push(cond.value);
        }
      }
    }

    const validResult = await query(
      `SELECT c.phone FROM customers c WHERE ${filterWhere}`,
      filterParams
    );
    const validPhones = new Set(validResult.rows.map((r: any) => normalizePhone(r.phone)));
    const beforeCount = filteredRecipients.length;
    filteredRecipients = filteredRecipients.filter((r: any) => validPhones.has(normalizePhone(r.phone)));
    if (filteredRecipients.length < beforeCount) {
      console.log(`[직접발송] 금액필터: ${beforeCount}명 → ${filteredRecipients.length}명`);
    }
  }
}
```

**이후 코드에서 `recipients` → `filteredRecipients` 사용하도록 변경.**

---

## 파일 2: unsubscribes.ts

**경로:** `packages/backend/src/routes/unsubscribes.ts`

### B10-01 🔴 store_code 격리 필터 누락

**위치:** ~Line 139-152

**현재 코드:**
```typescript
let whereClause = 'WHERE company_id = $1';
const params: any[] = [companyId];
```

**수정:**
```typescript
let whereClause = 'WHERE company_id = $1';
const params: any[] = [companyId];
let paramIndex = 2;

// company_user는 본인 매장 소속 고객의 수신거부만 조회
if (userType === 'company_user' && userId) {
  const userResult = await query('SELECT store_codes FROM users WHERE id = $1', [userId]);
  const storeCodes = userResult.rows[0]?.store_codes;
  if (storeCodes && storeCodes.length > 0) {
    whereClause += ` AND phone IN (
      SELECT c.phone FROM customers c
      JOIN customer_stores cs ON c.id = cs.customer_id
      WHERE cs.company_id = $1 AND cs.store_code = ANY($${paramIndex++}::text[])
    )`;
    params.push(storeCodes);
  }
}
```

### B13-07 🔴🔴 수신거부 카운트 오류

**위치:** ~Line 148-154

**현재 코드:**
```typescript
const countResult = await query(
  `SELECT COUNT(*) FROM (
    SELECT DISTINCT ON (phone) id FROM unsubscribes ${whereClause} ORDER BY phone, created_at DESC
  ) sub`,
  params
);
```

**수정:** COUNT(DISTINCT phone)으로 단순화:
```typescript
const countResult = await query(
  `SELECT COUNT(DISTINCT phone) as count FROM unsubscribes ${whereClause}`,
  params
);
```

---

## 파일 3: customers.ts

**경로:** `packages/backend/src/routes/customers.ts`

### B10-01 🔴 store_code 격리

**영향 엔드포인트 4개:**
1. GET `/stats` (~Line 619)
2. POST `/filter-count` (~Line 813)
3. GET `/filter-options` (~Line 1019)
4. GET `/enabled-fields` (~Line 1059)

**패턴 동일:** 각 엔드포인트에서 `company_user` 타입일 때 store_code JOIN 필터가 이미 존재하나, 조건이 정확히 적용되는지 확인 필요.

**확인 포인트:** `userType === 'company_user'` 조건과 `store_codes` 배열 체크 로직이 4곳 모두에 있는지 검증. 누락된 곳에 추가.

---

## 파일 4: upload.ts

**경로:** `packages/backend/src/routes/upload.ts`

### B8-10 / B10-04 / B13-02 🟠 엑셀 날짜/셀타입

**위치:** ~Line 103-109, ~Line 363, ~Line 444 (XLSX.readFile 호출 3곳)

**현재 코드:**
```typescript
const workbook = XLSX.readFile(filePath, {
  type: 'file',
  cellFormula: false,
  cellHTML: false,
  cellStyles: false,
  sheetStubs: false,
});
```

**수정 (3곳 모두 동일):**
```typescript
const workbook = XLSX.readFile(filePath, {
  type: 'file',
  cellFormula: false,
  cellHTML: false,
  cellStyles: false,
  cellDates: true,   // ★ 날짜 셀을 Date 객체로 변환
  raw: false,         // ★ 셀 포매팅 적용 (숫자 정밀도 유지)
  sheetStubs: false,
});
```

### B10-03 🟠 매장필드 NULL

**위치:** ~Line 467 (customer_stores INSERT)

**현재 코드:**
```typescript
if (customerId && storeCode) {
```

**수정:**
```typescript
const savedStoreCode = result.rows[0]?.store_code;
if (customerId && (storeCode || savedStoreCode)) {
  const codeToMap = storeCode || savedStoreCode;
```

---

## 파일 5: normalize.ts

**경로:** `packages/backend/src/utils/normalize.ts`

### B8-10 / B10-04 / B13-02 🟠 날짜 정규화

**위치:** ~Line 273 (normalizeDate 함수 시작부)

**현재 코드:**
```typescript
export function normalizeDate(value: any): string | null {
  if (value == null || value === '') return null;

  const numVal = typeof value === 'number' ? value : Number(value);
```

**수정 (Date 객체 처리 추가 — numVal 앞에 삽입):**
```typescript
export function normalizeDate(value: any): string | null {
  if (value == null || value === '') return null;

  // Date 객체 직접 처리 (XLSX cellDates: true)
  if (value instanceof Date && !isNaN(value.getTime())) {
    const yyyy = value.getFullYear();
    if (yyyy >= 1900 && yyyy <= 2099) {
      const mm = String(value.getMonth() + 1).padStart(2, '0');
      const dd = String(value.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }
    return null;
  }

  const numVal = typeof value === 'number' ? value : Number(value);
```

**upload.ts 내 normalizeDateValue 함수 (~Line 24-37)에도 동일한 Date 객체 처리 추가.**

---

## 파일 6: ai.ts

**경로:** `packages/backend/src/services/ai.ts`

### B8-09 🟠 SMS 바이트 경고

**위치:** ~Line 683-694

**현재 코드:**
```typescript
if (totalBytes > 90) {
  console.warn(`[AI 한줄로 SMS 바이트 초과] ...`);
}
```

**수정:**
```typescript
(variant as any).byte_count = msgBytes;
(variant as any).byte_warning = totalBytes > 90;
if (totalBytes > 90) {
  console.warn(`[AI SMS 바이트 초과] ${variant.variant_id}: 총 ${totalBytes}bytes (본문 ${msgBytes}bytes)`);
}
```

### B10-06 🟠 등급 프롬프트 하드코딩

**위치:** ~Line 342 (keywordMap) + ~Line 830 (프롬프트)

**수정:** keywordMap의 '등급' 배열에 스키마 기반 동적 값 concat:
```typescript
'등급': ['등급', '멤버십', '회원등급', '티어', 'tier', 'rank', 'level', '레벨', '랭크']
  .concat(schema?.grades || []),
```

---

## 파일 7: Dashboard.tsx

**경로:** `packages/frontend/src/pages/Dashboard.tsx`

### B8-08 🟠 수신거부 건수 모달 표시

**확인:** CampaignSuccessModal에서 `displayUnsub > 0` 조건으로 렌더링 중.
백엔드에서 `unsubscribeCount` 필드 추가 후, 프론트에서 해당 값을 state에 세팅하는 부분 확인 필요.

**위치:** ~Line 1405, 1509 (successUnsubscribeCount 세팅)
- 백엔드 응답의 `unsubscribeCount` → `setSuccessUnsubscribeCount(data.unsubscribeCount || 0)` 확인

### B13-06 🟠 이모지 경고

**위치:** ~Line 2908-2910 (정적 안내문)

**수정:** 이모지 감지 함수 추가 + 메시지 입력 시 실시간 검증:
```typescript
// 컴포넌트 내부에 추가
const hasEmoji = (text: string): boolean => {
  const emojiPattern = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF]|[\u2300-\u23FF]|[\u2B50-\u2BFF]|[\uFE00-\uFE0F]|[\u200D]|[\u20E3]|[\uE000-\uF8FF]/g;
  return emojiPattern.test(text);
};

// 메시지 onChange 핸들러에서:
if (directMsgType !== 'MMS' && hasEmoji(text)) {
  setToast({ show: true, type: 'warning', message: 'SMS/LMS는 이모지를 지원하지 않습니다. 발송 실패 원인이 됩니다.' });
}
```

**Toast 타입 확장 필요:** `'success' | 'error'` → `'success' | 'error' | 'warning'`

---

## 파일 8: AiCampaignResultPopup.tsx

**경로:** `packages/frontend/src/components/AiCampaignResultPopup.tsx`

### B8-09 🟠 SMS 바이트 초과 경고 표시

**위치:** ~Line 269-271

**현재 코드:**
```typescript
<span className={`text-[10px] ${editingAiMsg === idx ? 'text-purple-600 font-medium' : 'text-gray-400'}`}>
  {calculateBytes(wrapAdText(msg.message_text || ''))} / {selectedChannel === 'SMS' ? 90 : ...} bytes
</span>
```

**수정:**
```typescript
{(() => {
  const bytes = calculateBytes(wrapAdText(msg.message_text || ''));
  const limit = selectedChannel === 'SMS' ? 90 : selectedChannel === 'KAKAO' ? 4000 : 2000;
  const isOver = selectedChannel !== 'KAKAO' && bytes > limit;
  return (
    <>
      <span className={`text-[10px] ${isOver ? 'text-red-600 font-bold' : editingAiMsg === idx ? 'text-purple-600 font-medium' : 'text-gray-400'}`}>
        {bytes} / {limit} bytes
      </span>
      {isOver && <div className="text-[10px] text-red-600 mt-1">⚠️ {selectedChannel === 'SMS' ? 'SMS 90바이트 초과 — LMS 전환 필요' : 'LMS 2000바이트 초과'}</div>}
    </>
  );
})()}
```

### B13-03 🟠 미리보기 개인화 변수 치환

**위치:** ~Line 260-263 (메시지 프리뷰)

**현재 코드:**
```typescript
{wrapAdText(msg.message_text || '')}
```

**수정:** replaceVars 적용 (스팸필터 버튼과 동일 로직):
```typescript
{(() => {
  let text = msg.message_text || '';
  if (sampleCustomer) {
    Object.entries(sampleCustomer).forEach(([k, v]) => {
      text = text.replace(new RegExp(`%${k}%`, 'g'), String(v || ''));
    });
  }
  text = text.replace(/%[^%\s]{1,20}%/g, '');
  return wrapAdText(text);
})()}
```

### B13-04 🟡 스팸필터 결과 표시

**위치:** ~Line 330-360 (스팸필터 버튼)

**확인:** SpamFilterTestModal 컴포넌트가 결과를 제대로 표시하는지 확인 필요.
결과 표시가 안 되면 모달 내부에 pass/fail + 점수 + 사유 표시 UI 추가.

---

## 파일 9: TargetSendModal.tsx

**경로:** `packages/frontend/src/components/TargetSendModal.tsx`

### B13-08 🟠 MMS→SMS 이미지 잔존

**위치:** ~Line 536 (이미지 표시 조건)

**현재 코드:**
```typescript
(targetMsgType === 'MMS' || mmsUploadedImages.length > 0)
```

**수정:** OR → AND:
```typescript
(targetMsgType === 'MMS' && mmsUploadedImages.length > 0)
```

**추가:** SMS/LMS 버튼 클릭 시 이미지 정리 확인 (~Line 400, 404):
```typescript
onClick={() => { setTargetMsgType('SMS'); setMmsUploadedImages([]); }}
onClick={() => { setTargetMsgType('LMS'); setMmsUploadedImages([]); }}
```

### B13-06 🟠 이모지 경고

**위치:** ~Line 451-454

Dashboard.tsx와 동일한 `hasEmoji` 함수 + onChange 검증 로직 적용.
공통 유틸로 분리 권장: `utils/emoji.ts` → `export function hasEmoji(text: string): boolean`

---

## 파일 10: CustomerDBModal.tsx

**경로:** `packages/frontend/src/components/CustomerDBModal.tsx`

### B13-01 🟠 나이 라벨

**위치:** ~Line 146

**현재 코드:**
```typescript
{ key: 'age', label: '나이', format: (v) => v ? `${v}세` : '-' },
```

**수정:**
```typescript
{ key: 'age', label: '나이 (생년월일 기준 자동계산)', format: (v) => v ? `${v}세` : '-' },
```

### B10-02 🟡 커스텀 필드 라벨

**위치:** ~Line 337-340 (custom_fields 렌더링)

**수정:** fieldColumns 빈 배열 방어 코드:
```typescript
const fieldDef = fieldColumns && fieldColumns.length > 0
  ? fieldColumns.find((f: any) => f.field_key === key)
  : null;
const displayLabel = fieldDef?.field_label || fieldDef?.display_name || key;
```

---

## 파일 11: DirectTargetFilterModal.tsx

**경로:** `packages/frontend/src/components/DirectTargetFilterModal.tsx`

### B13-05 🔴 금액필터 미작동

**위치:** ~Line 268-278 (buildDynamicFiltersForAPI)

**수정:** 컬럼명 매핑 추가:
```typescript
// 필드명 → DB 컬럼명 매핑
const dbColMap: Record<string, string> = {
  'last_purchase_date': 'recent_purchase_date',
  'last_purchase_amount': 'recent_purchase_amount'
};
const dbCol = dbColMap[fieldKey] || fieldKey;

// 이후 filters[dbCol] = { operator: ... } 로 사용
```

**추가:** 백엔드 campaigns.ts의 direct-send에 `targetFilter` 전달하는 API 호출부 수정 필요.

---

## 수정 후 검증

1. **TypeScript 타입 체크:** `node -e "require('typescript').createProgram(...)"`
2. **Toast 타입 확장:** Dashboard.tsx의 toast type에 `'warning'` 추가
3. **공통 유틸:** `hasEmoji()` 함수를 `utils/emoji.ts`로 분리 검토
4. **프로젝트 폴더 복사:** 수정 완료 후 `C:\Users\ceo\OneDrive\바탕 화면\projects\targetup` 폴더로 복사
5. **배포:** `tp-push` & `tp-full`

---

## 주의사항

- **절대 병렬 에이전트 사용 금지** — 파일 1개씩 순차 수정
- **기간계 무접촉** — 발송 INSERT, 차감, 환불, 인증 로직 건드리지 않음
- **Read 먼저, Edit 다음** — 반드시 파일 읽고 정확한 위치 확인 후 수정
- **하드코딩 금지** — 환경변수/설정파일 통해 관리
