# 동적 필터 + 아코디언 UI 변경사항

> ⚠️ 작업 전 반드시: `git add -A && git commit -m "동적필터 작업 전 백업"`

---

## 1. Backend: customers.ts 수정 (4곳)

### 1-1. buildDynamicFilter 확장 - region 추가

**검색** (28번 줄):
```typescript
    const basicFields = ['gender', 'grade', 'sms_opt_in', 'store_code'];
```

**교체:**
```typescript
    const basicFields = ['gender', 'grade', 'sms_opt_in', 'store_code', 'region'];
```

---

### 1-2. buildDynamicFilter 확장 - 숫자 필드 추가

**검색** (29번 줄):
```typescript
    const numericFields = ['points', 'total_purchase_amount'];
```

**교체:**
```typescript
    const numericFields = ['points', 'total_purchase_amount', 'purchase_count', 'avg_order_value', 'ltv_score', 'visit_count', 'coupon_usage_count', 'return_count'];
```

---

### 1-3. buildDynamicFilter - region 처리 + days_within 추가

**검색** (43~47번 줄):
```typescript
        } else {
          whereClause += ` AND ${field} = $${paramIndex++}`;
          params.push(value);
        }
```

**교체:**
```typescript
        } else if (field === 'region') {
          const rf = buildRegionFilter(String(value), paramIndex);
          whereClause += rf.sql;
          params.push(...rf.params);
          paramIndex = rf.nextIndex;
        } else {
          whereClause += ` AND ${field} = $${paramIndex++}`;
          params.push(value);
        }
```

---

### 1-4. buildDynamicFilter - days_within 연산자 추가 (날짜 필드용)

**검색** (dateFields 처리 안, 74~77번 줄):
```typescript
      } else if (operator === 'between' && Array.isArray(value)) {
        whereClause += ` AND ${field} BETWEEN $${paramIndex++} AND $${paramIndex++}`;
        params.push(value[0], value[1]);
      }
    } else if (field === 'age') {
```

**교체:**
```typescript
      } else if (operator === 'between' && Array.isArray(value)) {
        whereClause += ` AND ${field} BETWEEN $${paramIndex++} AND $${paramIndex++}`;
        params.push(value[0], value[1]);
      } else if (operator === 'days_within') {
        const daysAgo = new Date();
        daysAgo.setDate(daysAgo.getDate() - parseInt(value));
        whereClause += ` AND ${field} >= $${paramIndex++}`;
        params.push(daysAgo.toISOString().split('T')[0]);
      }
    } else if (field === 'age') {
```

---

### 1-5. 새 엔드포인트: GET /enabled-fields

**위치:** `export default router;` 바로 위에 추가

```typescript
// GET /api/customers/enabled-fields - 회사별 활성 필터 필드 + 드롭다운 옵션
router.get('/enabled-fields', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다' });

    const companyResult = await query('SELECT enabled_fields FROM companies WHERE id = $1', [companyId]);
    
    const DEFAULT_FIELDS = ['gender', 'age_group', 'grade', 'region', 'total_purchase_amount', 'last_purchase_date'];
    const enabledKeys = companyResult.rows[0]?.enabled_fields?.length > 0 
      ? companyResult.rows[0].enabled_fields 
      : DEFAULT_FIELDS;

    if (enabledKeys.length === 0) {
      return res.json({ fields: [], options: {} });
    }

    const fieldsResult = await query(
      `SELECT field_key, display_name, category, data_type, description, sort_order 
       FROM standard_fields 
       WHERE is_active = true AND field_key = ANY($1) 
       ORDER BY sort_order`,
      [enabledKeys]
    );

    // 문자열 필드 중 DB 직접 컬럼이 있는 것만 드롭다운 옵션 조회
    const OPTION_COLUMNS: Record<string, string> = {
      'gender': 'gender', 'grade': 'grade', 'region': 'region', 'store_code': 'store_code',
    };

    const options: Record<string, string[]> = {};
    for (const field of fieldsResult.rows) {
      if (field.data_type === 'string' && OPTION_COLUMNS[field.field_key]) {
        const col = OPTION_COLUMNS[field.field_key];
        try {
          const optResult = await query(
            `SELECT DISTINCT ${col} FROM customers_unified WHERE company_id = $1 AND is_active = true AND ${col} IS NOT NULL AND ${col} != '' ORDER BY ${col} LIMIT 100`,
            [companyId]
          );
          if (optResult.rows.length > 0) {
            options[field.field_key] = optResult.rows.map((r: any) => r[col]);
          }
        } catch (e) { /* 컬럼 없으면 무시 */ }
      }
    }

    res.json({ fields: fieldsResult.rows, options });
  } catch (error) {
    console.error('활성 필드 조회 실패:', error);
    res.status(500).json({ error: '조회 실패' });
  }
});
```

---

### 1-6. filter-count 수정 - dynamicFilters 지원

**검색** (660번 줄):
```typescript
    const { gender, ageRange, grade, region, minPurchase, recentDays, smsOptIn } = req.body;
```

**교체:**
```typescript
    const { gender, ageRange, grade, region, minPurchase, recentDays, smsOptIn, dynamicFilters } = req.body;
```

**검색** (676~725번 줄 - 수신동의 필터부터 최근 구매일 필터까지 전체):
```typescript
    // 수신동의 필터
    if (smsOptIn) {
      whereClause += ' AND sms_opt_in = true';
    }

    // 성별 필터
    if (gender) {
      const gf = buildGenderFilter(String(gender), paramIndex);
      whereClause += gf.sql;
      params.push(...gf.params);
      paramIndex = gf.nextIndex;
    }

    // 나이대 필터
    if (ageRange) {
      const ageVal = parseInt(ageRange);
      if (ageVal === 60) {
        whereClause += ` AND age >= 60`;
      } else {
        whereClause += ` AND age >= $${paramIndex++} AND age < $${paramIndex++}`;
        params.push(ageVal, ageVal + 10);
      }
    }

    // 등급 필터
    if (grade) {
      const grf = buildGradeFilter(String(grade), paramIndex);
      whereClause += grf.sql;
      params.push(...grf.params);
      paramIndex = grf.nextIndex;
    }

    // 지역 필터 (normalize.ts 변형값 매칭)
    if (region) {
      const regionResult = buildRegionFilter(String(region), paramIndex);
      whereClause += regionResult.sql;
      params.push(...regionResult.params);
      paramIndex = regionResult.nextIndex;
    }

    // 구매금액 필터
    if (minPurchase) {
      whereClause += ` AND total_purchase_amount >= $${paramIndex++}`;
      params.push(parseInt(minPurchase));
    }

    // 최근 구매일 필터
    if (recentDays) {
      whereClause += ` AND recent_purchase_date >= NOW() - INTERVAL '${parseInt(recentDays)} days'`;
    }
```

**교체:**
```typescript
    if (dynamicFilters && typeof dynamicFilters === 'object' && Object.keys(dynamicFilters).length > 0) {
      // === 동적 필터 (새 UI) ===
      if (smsOptIn) whereClause += ' AND sms_opt_in = true';
      const df = buildDynamicFilter(dynamicFilters, paramIndex);
      whereClause += df.where;
      params.push(...df.params);
      paramIndex = df.nextIndex;
    } else {
      // === 레거시 필터 (기존 UI - 하위호환) ===
      if (smsOptIn) {
        whereClause += ' AND sms_opt_in = true';
      }
      if (gender) {
        const gf = buildGenderFilter(String(gender), paramIndex);
        whereClause += gf.sql;
        params.push(...gf.params);
        paramIndex = gf.nextIndex;
      }
      if (ageRange) {
        const ageVal = parseInt(ageRange);
        if (ageVal === 60) {
          whereClause += ` AND age >= 60`;
        } else {
          whereClause += ` AND age >= $${paramIndex++} AND age < $${paramIndex++}`;
          params.push(ageVal, ageVal + 10);
        }
      }
      if (grade) {
        const grf = buildGradeFilter(String(grade), paramIndex);
        whereClause += grf.sql;
        params.push(...grf.params);
        paramIndex = grf.nextIndex;
      }
      if (region) {
        const regionResult = buildRegionFilter(String(region), paramIndex);
        whereClause += regionResult.sql;
        params.push(...regionResult.params);
        paramIndex = regionResult.nextIndex;
      }
      if (minPurchase) {
        whereClause += ` AND total_purchase_amount >= $${paramIndex++}`;
        params.push(parseInt(minPurchase));
      }
      if (recentDays) {
        whereClause += ` AND recent_purchase_date >= NOW() - INTERVAL '${parseInt(recentDays)} days'`;
      }
    }
```

---

### 1-7. extract 수정 - dynamicFilters 지원

**검색** (750번 줄):
```typescript
    const { gender, ageRange, grade, region, minPurchase, recentDays, smsOptIn, phoneField, limit = 10000 } = req.body;
```

**교체:**
```typescript
    const { gender, ageRange, grade, region, minPurchase, recentDays, smsOptIn, phoneField, limit = 10000, dynamicFilters } = req.body;
```

**검색** (766~815번 줄 - 수신동의 필터부터 최근 구매일 필터까지):
```typescript
    // 수신동의 필터
    if (smsOptIn) {
      whereClause += ' AND sms_opt_in = true';
    }

    // 성별 필터
    if (gender) {
      const gf = buildGenderFilter(String(gender), paramIndex);
      whereClause += gf.sql;
      params.push(...gf.params);
      paramIndex = gf.nextIndex;
    }

    // 나이대 필터
    if (ageRange) {
      const ageVal = parseInt(ageRange);
      if (ageVal === 60) {
        whereClause += ` AND age >= 60`;
      } else {
        whereClause += ` AND age >= $${paramIndex++} AND age < $${paramIndex++}`;
        params.push(ageVal, ageVal + 10);
      }
    }

    // 등급 필터
    if (grade) {
      const grf = buildGradeFilter(String(grade), paramIndex);
      whereClause += grf.sql;
      params.push(...grf.params);
      paramIndex = grf.nextIndex;
    }

    // 지역 필터 (normalize.ts 변형값 매칭)
    if (region) {
      const regionResult = buildRegionFilter(String(region), paramIndex);
      whereClause += regionResult.sql;
      params.push(...regionResult.params);
      paramIndex = regionResult.nextIndex;
    }

    // 구매금액 필터
    if (minPurchase) {
      whereClause += ` AND total_purchase_amount >= $${paramIndex++}`;
      params.push(parseInt(minPurchase));
    }

    // 최근 구매일 필터
    if (recentDays) {
      whereClause += ` AND recent_purchase_date >= NOW() - INTERVAL '${parseInt(recentDays)} days'`;
    }
```

**교체:** (filter-count와 완전 동일)
```typescript
    if (dynamicFilters && typeof dynamicFilters === 'object' && Object.keys(dynamicFilters).length > 0) {
      if (smsOptIn) whereClause += ' AND sms_opt_in = true';
      const df = buildDynamicFilter(dynamicFilters, paramIndex);
      whereClause += df.where;
      params.push(...df.params);
      paramIndex = df.nextIndex;
    } else {
      if (smsOptIn) {
        whereClause += ' AND sms_opt_in = true';
      }
      if (gender) {
        const gf = buildGenderFilter(String(gender), paramIndex);
        whereClause += gf.sql;
        params.push(...gf.params);
        paramIndex = gf.nextIndex;
      }
      if (ageRange) {
        const ageVal = parseInt(ageRange);
        if (ageVal === 60) {
          whereClause += ` AND age >= 60`;
        } else {
          whereClause += ` AND age >= $${paramIndex++} AND age < $${paramIndex++}`;
          params.push(ageVal, ageVal + 10);
        }
      }
      if (grade) {
        const grf = buildGradeFilter(String(grade), paramIndex);
        whereClause += grf.sql;
        params.push(...grf.params);
        paramIndex = grf.nextIndex;
      }
      if (region) {
        const regionResult = buildRegionFilter(String(region), paramIndex);
        whereClause += regionResult.sql;
        params.push(...regionResult.params);
        paramIndex = regionResult.nextIndex;
      }
      if (minPurchase) {
        whereClause += ` AND total_purchase_amount >= $${paramIndex++}`;
        params.push(parseInt(minPurchase));
      }
      if (recentDays) {
        whereClause += ` AND recent_purchase_date >= NOW() - INTERVAL '${parseInt(recentDays)} days'`;
      }
    }
```

---

## 2. Frontend: Dashboard.tsx 수정 (6곳)

### 2-1. State 변경

**검색** (451~462번 줄):
```typescript
  // 직접 타겟 설정 관련 state
  const [targetPhoneField, setTargetPhoneField] = useState('phone');
  const [targetGender, setTargetGender] = useState('');
  const [targetAgeRange, setTargetAgeRange] = useState('');
  const [targetGrade, setTargetGrade] = useState('');
  const [targetRegion, setTargetRegion] = useState('');
  const [targetMinPurchase, setTargetMinPurchase] = useState('');
  const [targetRecentDays, setTargetRecentDays] = useState('');
  const [targetSmsOptIn, setTargetSmsOptIn] = useState(true);
  const [targetCount, setTargetCount] = useState(0);
  const [targetCountLoading, setTargetCountLoading] = useState(false);
  const [targetSchemaFields, setTargetSchemaFields] = useState<{name: string, label: string, type: string}[]>([]);
```

**교체:**
```typescript
  // 직접 타겟 설정 관련 state
  const [targetPhoneField, setTargetPhoneField] = useState('phone');
  const [targetSmsOptIn, setTargetSmsOptIn] = useState(true);
  const [targetCount, setTargetCount] = useState(0);
  const [targetCountLoading, setTargetCountLoading] = useState(false);
  const [targetSchemaFields, setTargetSchemaFields] = useState<{name: string, label: string, type: string}[]>([]);
  // 동적 필터 state
  const [enabledFields, setEnabledFields] = useState<any[]>([]);
  const [targetFilters, setTargetFilters] = useState<Record<string, string>>({});
  const [filterOptions, setFilterOptions] = useState<Record<string, string[]>>({});
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({ basic: true });
```

---

### 2-2. 함수 변경 - loadTargetSchema → loadEnabledFields 추가, loadTargetCount/handleTargetExtract/resetTargetFilters 교체

**검색** (834~962번 줄 전체 - loadTargetSchema부터 resetTargetFilters까지):
```typescript
  // 직접 타겟 설정 - 스키마 로드
  const loadTargetSchema = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/customers/schema', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.fields) {
        setTargetSchemaFields(data.fields);
      }
    } catch (error) {
      console.error('스키마 로드 실패:', error);
    }
  };

  // 직접 타겟 설정 - 필터 카운트
  const loadTargetCount = async () => {
    setTargetCountLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/customers/filter-count', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({
          gender: targetGender || undefined,
          ageRange: targetAgeRange || undefined,
          grade: targetGrade || undefined,
          region: targetRegion || undefined,
          minPurchase: targetMinPurchase || undefined,
          recentDays: targetRecentDays || undefined,
          smsOptIn: targetSmsOptIn
        })
      });
      const data = await res.json();
      setTargetCount(data.count || 0);
    } catch (error) {
      console.error('카운트 조회 실패:', error);
    } finally {
      setTargetCountLoading(false);
    }
  };

  // 직접 타겟 설정 - 타겟 추출 후 발송화면 이동
  const handleTargetExtract = async () => {
    if (targetCount === 0) {
      setToast({show: true, type: 'error', message: '추출할 대상이 없습니다'});
      setTimeout(() => setToast({show: false, type: 'error', message: ''}), 3000);
      return;
    }
    try {
      const token = localStorage.getItem('token');
      
      // 080 수신거부번호 로드
      const settingsRes = await fetch('/api/companies/settings', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (settingsRes.ok) {
        const settingsData = await settingsRes.json();
        if (settingsData.reject_number) {
          setOptOutNumber(settingsData.reject_number);
        }
      }
      
      // 회신번호 로드
      const cbRes = await fetch('/api/companies/callback-numbers', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const cbData = await cbRes.json();
      if (cbData.success) {
        setCallbackNumbers(cbData.numbers || []);
        const defaultCb = cbData.numbers?.find((n: any) => n.is_default);
        if (defaultCb) setSelectedCallback(defaultCb.phone);
      }
      
      const res = await fetch('/api/customers/extract', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({
          gender: targetGender || undefined,
          ageRange: targetAgeRange || undefined,
          grade: targetGrade || undefined,
          region: targetRegion || undefined,
          minPurchase: targetMinPurchase || undefined,
          recentDays: targetRecentDays || undefined,
          smsOptIn: targetSmsOptIn,
          phoneField: targetPhoneField
        })
      });
      const data = await res.json();
      if (data.success && data.recipients) {
        // 직접타겟발송 화면으로 데이터 전달
        const recipients = data.recipients.map((r: any) => ({
          phone: r.phone,
          name: r.name || '',
          grade: r.grade || '',
          region: r.region || '',
          amount: r.total_purchase_amount ? Math.floor(r.total_purchase_amount).toLocaleString() + '원' : '',
          callback: r.callback || ''
        }));
        setTargetRecipients(recipients);
        setShowDirectTargeting(false);
        setShowTargetSend(true);
        setToast({show: true, type: 'success', message: `${data.count}명 추출 완료`});
        setTimeout(() => setToast({show: false, type: 'success', message: ''}), 3000);
      }
    } catch (error) {
      console.error('타겟 추출 실패:', error);
      setToast({show: true, type: 'error', message: '타겟 추출 실패'});
      setTimeout(() => setToast({show: false, type: 'error', message: ''}), 3000);
    }
  };

  // 직접 타겟 설정 - 필터 초기화
  const resetTargetFilters = () => {
    setTargetGender('');
    setTargetAgeRange('');
    setTargetGrade('');
    setTargetRegion('');
    setTargetMinPurchase('');
    setTargetRecentDays('');
    setTargetSmsOptIn(true);
  };
```

**교체:**
```typescript
  // 직접 타겟 설정 - 스키마 로드 (기존 유지)
  const loadTargetSchema = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/customers/schema', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.fields) {
        setTargetSchemaFields(data.fields);
      }
    } catch (error) {
      console.error('스키마 로드 실패:', error);
    }
  };

  // 동적 필터 - 활성 필드 로드
  const loadEnabledFields = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/customers/enabled-fields', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setEnabledFields(data.fields || []);
        setFilterOptions(data.options || {});
      }
    } catch (error) {
      console.error('필드 로드 실패:', error);
    }
  };

  // 동적 필터 → API 포맷 변환
  const buildDynamicFiltersForAPI = () => {
    const filters: Record<string, any> = {};
    for (const [fieldKey, value] of Object.entries(targetFilters)) {
      if (!value) continue;
      const field = enabledFields.find((f: any) => f.field_key === fieldKey);
      if (!field) continue;

      // 특수 필드 변환
      if (fieldKey === 'age_group') {
        const ageVal = parseInt(value);
        if (ageVal >= 60) { filters['age'] = { operator: 'gte', value: 60 }; }
        else { filters['age'] = { operator: 'between', value: [ageVal, ageVal + 9] }; }
        continue;
      }
      if (fieldKey === 'last_purchase_date' || fieldKey === 'first_purchase_date' || fieldKey === 'last_visit_date') {
        const dbCol = fieldKey === 'last_purchase_date' ? 'recent_purchase_date' : fieldKey;
        filters[dbCol] = { operator: 'days_within', value: parseInt(value) };
        continue;
      }

      const dbFieldMap: Record<string, string> = { 'opt_in_sms': 'sms_opt_in' };
      const dbField = dbFieldMap[fieldKey] || fieldKey;

      if (field.data_type === 'string') {
        filters[dbField] = { operator: 'eq', value };
      } else if (field.data_type === 'number') {
        filters[dbField] = { operator: 'gte', value: Number(value) };
      } else if (field.data_type === 'date') {
        filters[dbField] = { operator: 'days_within', value: parseInt(value) };
      } else if (field.data_type === 'boolean') {
        filters[dbField] = { operator: 'eq', value: value === 'true' };
      }
    }
    return filters;
  };

  // 직접 타겟 설정 - 필터 카운트
  const loadTargetCount = async () => {
    setTargetCountLoading(true);
    try {
      const token = localStorage.getItem('token');
      const dynamicFilters = buildDynamicFiltersForAPI();
      const res = await fetch('/api/customers/filter-count', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ dynamicFilters, smsOptIn: targetSmsOptIn })
      });
      const data = await res.json();
      setTargetCount(data.count || 0);
    } catch (error) {
      console.error('카운트 조회 실패:', error);
    } finally {
      setTargetCountLoading(false);
    }
  };

  // 직접 타겟 설정 - 타겟 추출 후 발송화면 이동
  const handleTargetExtract = async () => {
    if (targetCount === 0) {
      setToast({show: true, type: 'error', message: '추출할 대상이 없습니다'});
      setTimeout(() => setToast({show: false, type: 'error', message: ''}), 3000);
      return;
    }
    try {
      const token = localStorage.getItem('token');
      
      // 080 수신거부번호 로드
      const settingsRes = await fetch('/api/companies/settings', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (settingsRes.ok) {
        const settingsData = await settingsRes.json();
        if (settingsData.reject_number) {
          setOptOutNumber(settingsData.reject_number);
        }
      }
      
      // 회신번호 로드
      const cbRes = await fetch('/api/companies/callback-numbers', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const cbData = await cbRes.json();
      if (cbData.success) {
        setCallbackNumbers(cbData.numbers || []);
        const defaultCb = cbData.numbers?.find((n: any) => n.is_default);
        if (defaultCb) setSelectedCallback(defaultCb.phone);
      }
      
      const dynamicFilters = buildDynamicFiltersForAPI();
      const res = await fetch('/api/customers/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          dynamicFilters,
          smsOptIn: targetSmsOptIn,
          phoneField: targetPhoneField
        })
      });
      const data = await res.json();
      if (data.success && data.recipients) {
        const recipients = data.recipients.map((r: any) => ({
          phone: r.phone,
          name: r.name || '',
          grade: r.grade || '',
          region: r.region || '',
          amount: r.total_purchase_amount ? Math.floor(r.total_purchase_amount).toLocaleString() + '원' : '',
          callback: r.callback || ''
        }));
        setTargetRecipients(recipients);
        setShowDirectTargeting(false);
        setShowTargetSend(true);
        setToast({show: true, type: 'success', message: `${data.count}명 추출 완료`});
        setTimeout(() => setToast({show: false, type: 'success', message: ''}), 3000);
      }
    } catch (error) {
      console.error('타겟 추출 실패:', error);
      setToast({show: true, type: 'error', message: '타겟 추출 실패'});
      setTimeout(() => setToast({show: false, type: 'error', message: ''}), 3000);
    }
  };

  // 직접 타겟 설정 - 필터 초기화
  const resetTargetFilters = () => {
    setTargetFilters({});
    setTargetSmsOptIn(true);
    setTargetCount(0);
  };
```

---

### 2-3. 모달 열기 버튼 - enabledFields 로드 추가

**검색** (1604번 줄):
```typescript
                onClick={() => setShowDirectTargeting(true)}
```

**교체:**
```typescript
                onClick={() => { setShowDirectTargeting(true); loadEnabledFields(); }}
```

---

### 2-4. 직접 타겟 설정 모달 UI 전체 교체

**검색** (2487~2694번 줄 - 모달 전체):
```typescript
        {/* 직접 타겟 설정 모달 */}
        {showDirectTargeting && (
```
부터
```typescript
        )}

        {showFileUpload && (
```
직전까지 전체.

**교체:**
```typescript
        {/* 직접 타겟 설정 모달 */}
        {showDirectTargeting && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl shadow-2xl w-[700px] max-h-[95vh] overflow-hidden">
              {/* 헤더 */}
              <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
                <div>
                  <h3 className="text-lg font-bold text-gray-800">직접 타겟 설정</h3>
                  <p className="text-sm text-gray-500 mt-0.5">필터 조건으로 대상 고객을 선택하세요</p>
                </div>
                <button 
                  onClick={() => { setShowDirectTargeting(false); resetTargetFilters(); }}
                  className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* 필터 영역 */}
              <div className="p-6 space-y-4 overflow-y-auto max-h-[65vh]">
                {/* 수신번호 필드 선택 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">수신번호 필드</label>
                  <select 
                    value={targetPhoneField}
                    onChange={(e) => setTargetPhoneField(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white text-gray-700"
                  >
                    <option value="phone">phone (전화번호)</option>
                    <option value="mobile">mobile</option>
                    <option value="phone_number">phone_number</option>
                  </select>
                </div>

                <div className="border-t border-gray-100"></div>

                {/* 필터 조건 헤더 */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-700">필터 조건</span>
                    {Object.keys(targetFilters).length > 0 && (
                      <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full font-medium">
                        {Object.values(targetFilters).filter(v => v).length}개 적용
                      </span>
                    )}
                  </div>
                  <button onClick={resetTargetFilters} className="text-xs text-green-600 hover:text-green-700 font-medium">초기화</button>
                </div>

                {/* 아코디언 필터 */}
                {enabledFields.length === 0 ? (
                  <div className="text-center py-8 text-gray-400 text-sm">
                    필터 항목을 로딩 중...
                  </div>
                ) : (
                  (() => {
                    const CAT_LABELS: Record<string, string> = {
                      basic: '📋 기본정보', segment: '🏷️ 등급/세그먼트', purchase: '💰 구매/거래',
                      loyalty: '⭐ 충성도/활동', store: '🏪 소속/채널', preference: '❤️ 선호/관심',
                      marketing: '📱 마케팅수신', custom: '🔧 커스텀'
                    };
                    // 필터 대상에서 제외할 필드 (식별용/수신동의는 별도 처리)
                    const SKIP_FIELDS = ['name', 'phone', 'email', 'address', 'opt_in_sms', 'opt_in_date', 'opt_out_date'];
                    const filterableFields = enabledFields.filter((f: any) => !SKIP_FIELDS.includes(f.field_key));
                    
                    // 연령대 프리셋
                    const AGE_OPTIONS = [
                      { label: '20대', value: '20' }, { label: '30대', value: '30' },
                      { label: '40대', value: '40' }, { label: '50대', value: '50' },
                      { label: '60대 이상', value: '60' },
                    ];
                    // 금액 프리셋
                    const AMOUNT_OPTIONS = [
                      { label: '5만원 이상', value: '50000' }, { label: '10만원 이상', value: '100000' },
                      { label: '50만원 이상', value: '500000' }, { label: '100만원 이상', value: '1000000' },
                      { label: '500만원 이상', value: '5000000' },
                    ];
                    // 일수 프리셋
                    const DAYS_OPTIONS = [
                      { label: '7일 이내', value: '7' }, { label: '30일 이내', value: '30' },
                      { label: '90일 이내', value: '90' }, { label: '180일 이내', value: '180' },
                      { label: '1년 이내', value: '365' },
                    ];

                    const renderInput = (field: any) => {
                      const val = targetFilters[field.field_key] || '';
                      const set = (v: string) => setTargetFilters(prev => {
                        if (!v) { const next = {...prev}; delete next[field.field_key]; return next; }
                        return {...prev, [field.field_key]: v};
                      });
                      const selectClass = "w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-sm bg-white";

                      // 연령대 특수 처리
                      if (field.field_key === 'age_group') {
                        return (
                          <select value={val} onChange={e => set(e.target.value)} className={selectClass}>
                            <option value="">전체</option>
                            {AGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        );
                      }

                      // 문자열 + DB 옵션 → 드롭다운
                      if (field.data_type === 'string' && filterOptions[field.field_key]?.length) {
                        return (
                          <select value={val} onChange={e => set(e.target.value)} className={selectClass}>
                            <option value="">전체</option>
                            {filterOptions[field.field_key].map((opt: string) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        );
                      }

                      // 금액 필드 → 프리셋 드롭다운
                      if (field.data_type === 'number' && ['total_purchase_amount', 'avg_order_value'].includes(field.field_key)) {
                        return (
                          <select value={val} onChange={e => set(e.target.value)} className={selectClass}>
                            <option value="">전체</option>
                            {AMOUNT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        );
                      }

                      // 숫자 필드 → 직접 입력
                      if (field.data_type === 'number') {
                        return (
                          <input type="number" value={val} onChange={e => set(e.target.value)}
                            placeholder="이상" className={selectClass} />
                        );
                      }

                      // 날짜 필드 → 일수 드롭다운
                      if (field.data_type === 'date') {
                        return (
                          <select value={val} onChange={e => set(e.target.value)} className={selectClass}>
                            <option value="">전체</option>
                            {DAYS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        );
                      }

                      // 불리언
                      if (field.data_type === 'boolean') {
                        return (
                          <select value={val} onChange={e => set(e.target.value)} className={selectClass}>
                            <option value="">전체</option>
                            <option value="true">예</option>
                            <option value="false">아니오</option>
                          </select>
                        );
                      }

                      // 기본: 텍스트 입력
                      return (
                        <input type="text" value={val} onChange={e => set(e.target.value)}
                          placeholder="입력" className={selectClass} />
                      );
                    };

                    return (
                      <div className="space-y-2">
                        {Object.entries(CAT_LABELS).map(([cat, label]) => {
                          const catFields = filterableFields.filter((f: any) => f.category === cat);
                          if (catFields.length === 0) return null;
                          const activeCount = catFields.filter((f: any) => targetFilters[f.field_key]).length;
                          const isExpanded = expandedCats[cat] ?? false;

                          return (
                            <div key={cat} className="border border-gray-200 rounded-lg overflow-hidden">
                              <button
                                type="button"
                                onClick={() => setExpandedCats(prev => ({ ...prev, [cat]: !prev[cat] }))}
                                className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
                              >
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-gray-700">{label}</span>
                                  <span className="text-xs text-gray-400">({catFields.length})</span>
                                  {activeCount > 0 && (
                                    <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full font-semibold">{activeCount}</span>
                                  )}
                                </div>
                                <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                              </button>
                              {isExpanded && (
                                <div className="p-4 bg-white grid grid-cols-2 gap-3 border-t border-gray-100">
                                  {catFields.map((field: any) => (
                                    <div key={field.field_key}>
                                      <label className="block text-xs text-gray-500 mb-1.5">{field.display_name}</label>
                                      {renderInput(field)}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()
                )}

                {/* 수신동의 */}
                <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                  <input 
                    type="checkbox" 
                    id="targetSmsOptIn" 
                    checked={targetSmsOptIn}
                    onChange={(e) => setTargetSmsOptIn(e.target.checked)}
                    className="w-4 h-4 text-green-600 rounded focus:ring-green-500" 
                  />
                  <label htmlFor="targetSmsOptIn" className="text-sm text-gray-700">수신동의 고객만 포함</label>
                </div>

                {/* 조회 버튼 */}
                <button
                  onClick={loadTargetCount}
                  disabled={targetCountLoading}
                  className="w-full py-2.5 border border-green-600 text-green-700 rounded-lg hover:bg-green-50 transition-colors font-medium disabled:opacity-50"
                >
                  {targetCountLoading ? '조회 중...' : '대상 인원 조회'}
                </button>
              </div>

              {/* 푸터 - 대상 인원 + 버튼 */}
              <div className="px-6 py-4 border-t border-gray-100 bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                      <Users className="w-5 h-5 text-green-600" />
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">대상 인원</div>
                      <div className="text-2xl font-bold text-green-700">
                        {targetCountLoading ? '...' : targetCount.toLocaleString()}
                        <span className="text-base font-normal text-gray-500 ml-1">명</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => { setShowDirectTargeting(false); resetTargetFilters(); }}
                      className="px-5 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors font-medium"
                    >
                      취소
                    </button>
                    <button
                      onClick={handleTargetExtract}
                      disabled={targetCount === 0}
                      className="px-6 py-2.5 bg-green-700 text-white rounded-lg hover:bg-green-800 transition-colors font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Users className="w-4 h-4" />
                      타겟 추출
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
```

---

## 3. 작업 순서 요약

1. `git commit` (안전 백업)
2. **customers.ts**: 1-1 ~ 1-7 순서대로 수정
3. **Dashboard.tsx**: 2-1 ~ 2-4 순서대로 수정
4. 백엔드 재시작 → 테스트

## 4. 테스트 방법

1. 유저 로그인 (luna1234)
2. 직접 타겟 설정 클릭
3. 아코디언 카테고리가 열리는지 확인
4. 기본정보 펼치기 → 성별/등급/지역 드롭다운에 실제 데이터 나오는지 확인
5. 몇 개 필터 선택 → "대상 인원 조회" → 숫자 나오는지 확인
6. "타겟 추출" → 발송 화면으로 넘어가는지 확인
