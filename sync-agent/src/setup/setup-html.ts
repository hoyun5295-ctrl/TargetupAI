/**
 * 설치 마법사 HTML (인라인 임베드)
 * esbuild→pkg 번들링 시 파일시스템의 HTML이 포함되지 않으므로
 * HTML을 JS 문자열로 직접 포함
 *
 * 원본: src/setup/setup-ui/index.html
 */

// eslint-disable-next-line
export const SETUP_HTML = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sync Agent 설치 마법사</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', -apple-system, sans-serif;
      background: #f0f4f8;
      color: #1a202c;
      min-height: 100vh;
    }

    .container {
      max-width: 640px;
      margin: 40px auto;
      padding: 0 20px;
    }

    .header {
      text-align: center;
      margin-bottom: 32px;
    }
    .header h1 {
      font-size: 24px;
      font-weight: 700;
      color: #2d3748;
    }
    .header p {
      color: #718096;
      margin-top: 8px;
      font-size: 14px;
    }

    /* Steps indicator */
    .steps {
      display: flex;
      justify-content: center;
      gap: 8px;
      margin-bottom: 32px;
    }
    .step-dot {
      width: 12px; height: 12px;
      border-radius: 50%;
      background: #cbd5e0;
      transition: all 0.3s;
    }
    .step-dot.active { background: #3182ce; transform: scale(1.3); }
    .step-dot.done { background: #48bb78; }

    /* Card */
    .card {
      background: white;
      border-radius: 12px;
      padding: 32px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .card h2 {
      font-size: 18px;
      margin-bottom: 4px;
      color: #2d3748;
    }
    .card .subtitle {
      color: #718096;
      font-size: 13px;
      margin-bottom: 24px;
    }

    /* Form */
    .form-group {
      margin-bottom: 16px;
    }
    .form-group label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: #4a5568;
      margin-bottom: 4px;
    }
    .form-group input, .form-group select {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      font-size: 14px;
      transition: border-color 0.2s;
      outline: none;
    }
    .form-group input:focus, .form-group select:focus {
      border-color: #3182ce;
      box-shadow: 0 0 0 3px rgba(49,130,206,0.1);
    }
    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    /* Buttons */
    .btn {
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: all 0.2s;
    }
    .btn-primary {
      background: #3182ce;
      color: white;
    }
    .btn-primary:hover { background: #2c5282; }
    .btn-primary:disabled { background: #a0aec0; cursor: not-allowed; }
    .btn-secondary {
      background: #edf2f7;
      color: #4a5568;
    }
    .btn-secondary:hover { background: #e2e8f0; }
    .btn-success {
      background: #48bb78;
      color: white;
    }
    .btn-success:hover { background: #38a169; }

    .btn-row {
      display: flex;
      justify-content: space-between;
      margin-top: 24px;
    }

    /* Status messages */
    .status {
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 13px;
      margin-top: 12px;
      display: none;
    }
    .status.show { display: block; }
    .status.success { background: #f0fff4; color: #276749; border: 1px solid #c6f6d5; }
    .status.error { background: #fed7d7; color: #9b2c2c; border: 1px solid #feb2b2; }
    .status.info { background: #ebf8ff; color: #2a4365; border: 1px solid #bee3f8; }

    /* Table/Column selection */
    .select-list {
      max-height: 200px;
      overflow-y: auto;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      margin-top: 8px;
    }
    .select-item {
      padding: 8px 12px;
      cursor: pointer;
      font-size: 13px;
      border-bottom: 1px solid #f7fafc;
      transition: background 0.1s;
    }
    .select-item:hover { background: #ebf8ff; }
    .select-item.selected { background: #bee3f8; font-weight: 600; }

    /* Mapping table */
    .mapping-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      margin-top: 12px;
    }
    .mapping-table th {
      background: #f7fafc;
      padding: 8px 10px;
      text-align: left;
      font-weight: 600;
      border-bottom: 2px solid #e2e8f0;
    }
    .mapping-table td {
      padding: 6px 10px;
      border-bottom: 1px solid #f0f0f0;
    }
    .mapping-table select {
      width: 100%;
      padding: 4px 8px;
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      font-size: 13px;
    }
    .mapping-table .arrow {
      text-align: center;
      color: #a0aec0;
    }

    /* Hidden step */
    .step-panel { display: none; }
    .step-panel.active { display: block; }

    /* Complete screen */
    .complete-icon {
      text-align: center;
      font-size: 64px;
      margin-bottom: 16px;
    }
    .complete-text {
      text-align: center;
      color: #4a5568;
    }

    /* Spinner */
    .spinner {
      display: inline-block;
      width: 16px; height: 16px;
      border: 2px solid #e2e8f0;
      border-top: 2px solid #3182ce;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
      vertical-align: middle;
      margin-right: 6px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>

<div class="container">
  <div class="header">
    <h1>🔄 Sync Agent 설치 마법사</h1>
    <p>고객사 DB와 한줄로를 연결합니다</p>
  </div>

  <div class="steps">
    <div class="step-dot active" data-step="0"></div>
    <div class="step-dot" data-step="1"></div>
    <div class="step-dot" data-step="2"></div>
    <div class="step-dot" data-step="3"></div>
    <div class="step-dot" data-step="4"></div>
  </div>

  <!-- ═══ Step 0: API 키 입력 ═══ -->
  <div class="card step-panel active" data-step="0">
    <h2>1. 한줄로 API 연결</h2>
    <p class="subtitle">한줄로에서 발급받은 API 키를 입력하세요</p>

    <div class="form-group">
      <label>서버 URL</label>
      <input type="text" id="serverUrl" value="https://hanjul.ai" />
    </div>
    <div class="form-group">
      <label>API Key</label>
      <input type="text" id="apiKey" placeholder="발급받은 API Key 입력" />
    </div>
    <div class="form-group">
      <label>API Secret</label>
      <input type="password" id="apiSecret" placeholder="발급받은 API Secret 입력" />
    </div>

    <div class="btn-row">
      <div></div>
      <button class="btn btn-primary" onclick="goStep(1)">다음 →</button>
    </div>
  </div>

  <!-- ═══ Step 1: DB 접속정보 ═══ -->
  <div class="card step-panel" data-step="1">
    <h2>2. DB 접속 설정</h2>
    <p class="subtitle">고객사 POS/ERP 데이터베이스 정보를 입력하세요</p>

    <div class="form-group">
      <label>DB 종류</label>
      <select id="dbType">
        <option value="mssql">MSSQL (SQL Server)</option>
        <option value="mysql">MySQL / MariaDB</option>
        <option value="oracle">Oracle</option>
        <option value="postgres">PostgreSQL</option>
      </select>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>호스트</label>
        <input type="text" id="dbHost" value="localhost" />
      </div>
      <div class="form-group">
        <label>포트</label>
        <input type="number" id="dbPort" value="1433" />
      </div>
    </div>
    <div class="form-group">
      <label>DB 이름</label>
      <input type="text" id="dbName" placeholder="데이터베이스명" />
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>사용자</label>
        <input type="text" id="dbUser" placeholder="DB 계정" />
      </div>
      <div class="form-group">
        <label>비밀번호</label>
        <input type="password" id="dbPassword" placeholder="DB 비밀번호" />
      </div>
    </div>

    <button class="btn btn-success" onclick="testDbConnection()" id="btnTestDb">
      🔌 접속 테스트
    </button>
    <div id="dbStatus" class="status"></div>

    <div class="btn-row">
      <button class="btn btn-secondary" onclick="goStep(0)">← 이전</button>
      <button class="btn btn-primary" onclick="loadTables()" id="btnNext1" disabled>다음 →</button>
    </div>
  </div>

  <!-- ═══ Step 2: 테이블 선택 ═══ -->
  <div class="card step-panel" data-step="2">
    <h2>3. 테이블 선택</h2>
    <p class="subtitle">사용할 테이블만 선택하세요. 구매 테이블은 선택사항입니다.</p>

    <div class="form-group">
      <label>고객 테이블 <span style="color:#e53e3e;">★필수</span></label>
      <select id="customerTable"></select>
    </div>
    <div class="form-group">
      <label>구매 테이블 <span style="color:#718096; font-weight:normal; font-size:12px;">(선택사항 — 구매 이력이 없으면 "사용 안 함" 선택)</span></label>
      <select id="purchaseTable"></select>
    </div>

    <div id="tableStatus" class="status"></div>

    <div class="btn-row">
      <button class="btn btn-secondary" onclick="goStep(1)">← 이전</button>
      <button class="btn btn-primary" onclick="loadColumns()" id="btnNext2">다음 →</button>
    </div>
  </div>

  <!-- ═══ Step 3: 컬럼 매핑 ═══ -->
  <div class="card step-panel" data-step="3">
    <h2>4. 컬럼 매핑</h2>
    <p class="subtitle">DB 컬럼을 한줄로 필드에 매핑하세요</p>

    <!-- v1.5.0: AI 자동 매핑 (Claude Opus 4.7) — 설계서 §11-1 Step 4 -->
    <div style="background:#f7fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px 16px; margin-bottom:16px; display:flex; align-items:center; gap:12px;">
      <span style="font-size:20px;">🤖</span>
      <div style="flex:1;">
        <strong style="color:#2d3748;">AI 자동 매핑 (Claude Opus 4.7)</strong>
        <div style="color:#718096; font-size:12px; margin-top:2px;">
          고객사 DB 컬럼을 표준 필드에 자동 매핑합니다. 회사당 월 10회 호출 가능.
        </div>
      </div>
      <button class="btn btn-primary" onclick="runAiMapping()" id="btnAiMapping" style="white-space:nowrap;">
        AI 매핑 실행
      </button>
    </div>
    <div id="aiMappingStatus" class="status" style="display:none; margin-bottom:12px;"></div>

    <h3 style="font-size:14px; margin-bottom:8px;">고객 테이블 매핑</h3>
    <div style="overflow-x:auto;">
      <table class="mapping-table" id="customerMappingTable">
        <thead>
          <tr><th>DB 컬럼</th><th class="arrow">→</th><th>한줄로 필드</th></tr>
        </thead>
        <tbody></tbody>
      </table>
    </div>

    <div id="purchaseMappingSection">
      <h3 style="font-size:14px; margin:16px 0 8px;">구매 테이블 매핑</h3>
      <div style="overflow-x:auto;">
        <table class="mapping-table" id="purchaseMappingTable">
          <thead>
            <tr><th>DB 컬럼</th><th class="arrow">→</th><th>한줄로 필드</th></tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>

    <div class="btn-row">
      <button class="btn btn-secondary" onclick="goStep(2)">← 이전</button>
      <button class="btn btn-primary" onclick="goStep(4)">다음 →</button>
    </div>
  </div>

  <!-- ═══ Step 4: 동기화 설정 + 저장 ═══ -->
  <div class="card step-panel" data-step="4">
    <h2>5. 동기화 설정</h2>
    <p class="subtitle">동기화 주기와 기타 옵션을 설정합니다</p>

    <div class="form-row">
      <div class="form-group">
        <label>고객 동기화 주기 (분)</label>
        <select id="customerInterval">
          <option value="30">30분</option>
          <option value="60" selected>1시간</option>
          <option value="120">2시간</option>
          <option value="360">6시간 (하루 4회)</option>
          <option value="720">12시간 (하루 2회)</option>
          <option value="1440">24시간 (하루 1회)</option>
        </select>
      </div>
      <div class="form-group">
        <label>구매 동기화 주기 (분)</label>
        <select id="purchaseInterval">
          <option value="30" selected>30분</option>
          <option value="60">1시간</option>
          <option value="120">2시간</option>
          <option value="360">6시간</option>
          <option value="720">12시간</option>
          <option value="1440">24시간</option>
        </select>
      </div>
    </div>

    <div class="form-group">
      <label>Agent 이름 (식별용)</label>
      <input type="text" id="agentName" value="sync-agent-001" />
    </div>

    <div id="saveStatus" class="status"></div>

    <div class="btn-row">
      <button class="btn btn-secondary" onclick="goStep(3)">← 이전</button>
      <button class="btn btn-primary" onclick="saveConfig()" id="btnSave">
        💾 설치 완료
      </button>
    </div>
  </div>

  <!-- ═══ Complete ═══ -->
  <div class="card step-panel" data-step="5">
    <div class="complete-icon">✅</div>
    <h2 style="text-align:center;">설치 완료!</h2>
    <p class="complete-text" style="margin-top:12px;">
      Sync Agent가 설정되었습니다.<br>
      잠시 후 자동으로 동기화가 시작됩니다.
    </p>
    <p class="complete-text" style="margin-top:16px; font-size:13px; color:#a0aec0;">
      이 창은 닫으셔도 됩니다.
    </p>
  </div>
</div>

<script>
  // ═══ State ═══
  let currentStep = 0;
  let dbConnected = false;

  // ═══ Common Helpers (v1.4.1 — API 호출 안정화) ═══
  // 모든 /api/setup/* 호출은 이 헬퍼로 통일한다.
  //   - AbortController 타임아웃 (기본 30초)
  //   - 요청/응답/소요시간 콘솔 로깅 (F12 Network 탭 없이도 진단 가능)
  //   - HTTP 에러 / 네트워크 에러 / 타임아웃 구분
  async function apiCall(path, body, opts) {
    const timeoutMs = (opts && opts.timeout) || 30000;
    const label = (opts && opts.label) || path;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    console.log('[setup] →', label, body);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const ms = Math.round(t1 - t0);
      if (!res.ok) {
        console.error('[setup] ×', label, res.status, res.statusText, 'in', ms + 'ms');
        return { ok: false, error: 'HTTP ' + res.status + ' (' + res.statusText + ')' };
      }
      const data = await res.json();
      console.log('[setup] ←', label, '(' + ms + 'ms)', data);
      return { ok: true, data };
    } catch (err) {
      clearTimeout(timer);
      const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const ms = Math.round(t1 - t0);
      if (err && err.name === 'AbortError') {
        console.error('[setup] ⏱', label, 'timeout after', ms + 'ms');
        return { ok: false, error: '응답 시간 초과 (' + Math.round(timeoutMs/1000) + '초). DB 서버가 느리거나 네트워크가 끊겼을 수 있어요.' };
      }
      console.error('[setup] ✗', label, 'error in', ms + 'ms', err);
      return { ok: false, error: (err && err.message) || '알 수 없는 에러' };
    }
  }

  // 버튼에 로딩 UX를 걸고 작업 수행. finally로 원래 상태 복원.
  async function withButtonLoading(btnId, loadingHtml, fn) {
    const btn = $(btnId);
    if (!btn) return fn();
    const prevHtml = btn.innerHTML;
    const prevDisabled = btn.disabled;
    btn.disabled = true;
    btn.innerHTML = loadingHtml;
    try {
      return await fn();
    } finally {
      btn.innerHTML = prevHtml;
      btn.disabled = prevDisabled;
    }
  }

  // ═══ 한줄로 표준 필드 (v1.4.1 — standard-field-map.ts 완전 동기화) ═══
  // 고정 21개 (storageType='column') + 커스텀 15개 슬롯 (storageType='custom_fields') = 36개
  // SoT: packages/backend/src/utils/standard-field-map.ts FIELD_MAP
  const CUSTOMER_FIELDS = [
    { value: '', label: '— 매핑 안 함 —' },

    // ── basic (기본정보) — 8개 ──
    { value: 'name',       label: 'name (고객명)' },
    { value: 'phone',      label: 'phone (고객전화번호) ★필수' },
    { value: 'gender',     label: 'gender (성별)' },
    { value: 'age',        label: 'age (나이)' },
    { value: 'birth_date', label: 'birth_date (생일)' },
    { value: 'email',      label: 'email (이메일주소)' },
    { value: 'address',    label: 'address (주소)' },
    { value: 'region',     label: 'region (지역)' },

    // ── purchase (구매정보) — 5개 ──
    { value: 'recent_purchase_store',  label: 'recent_purchase_store (최근구매매장)' },
    { value: 'recent_purchase_amount', label: 'recent_purchase_amount (최근구매금액)' },
    { value: 'total_purchase_amount',  label: 'total_purchase_amount (누적구매금액)' },
    { value: 'purchase_count',         label: 'purchase_count (구매횟수)' },
    { value: 'recent_purchase_date',   label: 'recent_purchase_date (최근구매일)' },

    // ── store (매장/등록정보) — 5개 ──
    { value: 'store_code',        label: 'store_code (브랜드)' },
    { value: 'registration_type', label: 'registration_type (등록구분)' },
    { value: 'registered_store',  label: 'registered_store (등록매장정보)' },
    { value: 'store_phone',       label: 'store_phone (매장전화번호)' },
    { value: 'store_name',        label: 'store_name (매장명)' },

    // ── membership (등급/포인트) — 2개 ──
    { value: 'grade',  label: 'grade (고객등급)' },
    { value: 'points', label: 'points (보유포인트)' },

    // ── marketing (수신동의) — 1개 ──
    { value: 'sms_opt_in', label: 'sms_opt_in (수신동의여부)' },

    // ── custom (커스텀 슬롯) — 15개 ──
    { value: 'custom_1',  label: 'custom_1 (커스텀 슬롯 1)' },
    { value: 'custom_2',  label: 'custom_2 (커스텀 슬롯 2)' },
    { value: 'custom_3',  label: 'custom_3 (커스텀 슬롯 3)' },
    { value: 'custom_4',  label: 'custom_4 (커스텀 슬롯 4)' },
    { value: 'custom_5',  label: 'custom_5 (커스텀 슬롯 5)' },
    { value: 'custom_6',  label: 'custom_6 (커스텀 슬롯 6)' },
    { value: 'custom_7',  label: 'custom_7 (커스텀 슬롯 7)' },
    { value: 'custom_8',  label: 'custom_8 (커스텀 슬롯 8)' },
    { value: 'custom_9',  label: 'custom_9 (커스텀 슬롯 9)' },
    { value: 'custom_10', label: 'custom_10 (커스텀 슬롯 10)' },
    { value: 'custom_11', label: 'custom_11 (커스텀 슬롯 11)' },
    { value: 'custom_12', label: 'custom_12 (커스텀 슬롯 12)' },
    { value: 'custom_13', label: 'custom_13 (커스텀 슬롯 13)' },
    { value: 'custom_14', label: 'custom_14 (커스텀 슬롯 14)' },
    { value: 'custom_15', label: 'custom_15 (커스텀 슬롯 15)' },
  ];

  // 구매 테이블 필드 — customers와 달리 일부 기본 필드 + 커스텀은 미지원(장기적으로 정리 필요)
  // ★필수 표식은 해당 매핑 경로를 선택할 때만 의미. 고객사가 구매 테이블 자체를 안 쓰면 전체 스킵.
  const PURCHASE_FIELDS = [
    { value: '', label: '— 매핑 안 함 —' },
    { value: 'customer_phone', label: 'customer_phone (고객전화) ★필수' },
    { value: 'purchase_date',  label: 'purchase_date (구매일시) ★필수' },
    { value: 'store_code',     label: 'store_code (매장코드)' },
    { value: 'store_name',     label: 'store_name (매장명)' },
    { value: 'product_code',   label: 'product_code (상품코드)' },
    { value: 'product_name',   label: 'product_name (상품명)' },
    { value: 'quantity',       label: 'quantity (수량)' },
    { value: 'unit_price',     label: 'unit_price (단가)' },
    { value: 'total_amount',   label: 'total_amount (총금액) ★필수' },
  ];

  // 자동 매핑은 서버 API (/api/setup/auto-mapping)로 처리
  // 복합 패턴 우선순위 적용 (STORE_NM → store_name, PROD_NM → product_name)

  // DB 타입별 기본 포트
  const DEFAULT_PORTS = { mssql: 1433, mysql: 3306, oracle: 1521, postgres: 5432 };

  // ═══ Step Navigation ═══
  function goStep(step) {
    // 유효성 검사
    if (step === 1 && currentStep === 0) {
      if (!$('apiKey').value.trim() || !$('apiSecret').value.trim()) {
        alert('API Key와 Secret을 입력하세요.');
        return;
      }
    }

    document.querySelectorAll('.step-panel').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.step-dot').forEach((el, i) => {
      el.classList.remove('active', 'done');
      if (i < step) el.classList.add('done');
      if (i === step) el.classList.add('active');
    });
    document.querySelector(\`.step-panel[data-step="\${step}"]\`).classList.add('active');
    currentStep = step;
  }

  // ═══ DB Connection Test (v1.4.1 — apiCall 통합) ═══
  async function testDbConnection() {
    const status = $('dbStatus');
    showStatus(status, 'info', '<span class="spinner"></span>접속 테스트 중...');

    const result = await withButtonLoading('btnTestDb', '<span class="spinner"></span>접속 테스트 중...', function() {
      return apiCall('/api/setup/test-db', getDbConfig(), { label: 'test-db', timeout: 15000 });
    });

    if (result.ok && result.data.success) {
      showStatus(status, 'success', '✅ ' + result.data.message);
      $('btnNext1').disabled = false;
      dbConnected = true;
    } else {
      const msg = result.ok ? result.data.message : result.error;
      showStatus(status, 'error', '❌ ' + msg);
      $('btnNext1').disabled = true;
      dbConnected = false;
    }
  }

  // ═══ Load Tables (v1.4.1 — apiCall + 즉시 로딩 UX + 권한부족 안내) ═══
  // Step 1 → Step 2 전환의 핵심. "다음" 버튼(btnNext1)이 이 함수를 호출한다.
  async function loadTables() {
    const status = $('tableStatus');
    showStatus(status, 'info', '<span class="spinner"></span>테이블 목록 조회 중...');

    const result = await withButtonLoading('btnNext1', '<span class="spinner"></span>테이블 불러오는 중...', function() {
      return apiCall('/api/setup/tables', getDbConfig(), { label: 'tables', timeout: 30000 });
    });

    // ── 네트워크/HTTP 레벨 실패 ──
    if (!result.ok) {
      showStatus(status, 'error', '❌ ' + result.error);
      return;
    }

    const data = result.data;

    // ── 정상: 테이블 1개 이상 ──
    if (data.success && Array.isArray(data.tables) && data.tables.length > 0) {
      const custSelect = $('customerTable');
      const purchSelect = $('purchaseTable');
      custSelect.innerHTML = '';
      purchSelect.innerHTML = '';

      // "— 사용 안 함 —" 옵션을 구매 테이블에만 추가 (구매 테이블은 옵션)
      purchSelect.add(new Option('— 사용 안 함 (고객 데이터만 동기화) —', ''));

      for (const table of data.tables) {
        custSelect.add(new Option(table, table));
        purchSelect.add(new Option(table, table));
      }

      // 자동 선택 추측
      autoSelectTable(custSelect, ['customer', 'cust', 'member', 'client']);
      autoSelectTable(purchSelect, ['purchase', 'order', 'sale', 'buy', 'transaction']);

      showStatus(status, 'success', '✅ ' + data.tables.length + '개 테이블 발견');
      goStep(2);
      return;
    }

    // ── success:true인데 테이블 0개 = 계정 권한 부족 ──
    if (data.success && (!data.tables || data.tables.length === 0)) {
      const cfg = getDbConfig();
      const sql = 'USE ' + (cfg.database || '[DB이름]') + '; ALTER ROLE db_datareader ADD MEMBER ' + (cfg.username || '[계정]') + ';';
      showStatus(status, 'error',
        '⚠️ 테이블이 0개 조회됐어요. 계정에 읽기 권한이 없을 수 있어요.<br>' +
        'SSMS에서 아래 SQL을 실행한 뒤 다시 시도해주세요:<br>' +
        '<code style="display:inline-block;margin-top:6px;font-size:12px;background:#f3f4f6;padding:4px 8px;border-radius:4px;color:#1f2937;">' + sql + '</code>'
      );
      return;
    }

    // ── success:false (서버 에러 메시지) ──
    showStatus(status, 'error', '❌ ' + (data.message || '테이블 조회 실패'));
  }

  // ═══ Load Columns & Build Mapping (v1.4.1 — apiCall + 구매 옵션화) ═══
  // 구매 테이블이 "— 사용 안 함 —"(value='')이면 구매 관련 처리 전부 스킵.
  async function loadColumns() {
    const custTable = $('customerTable').value;
    const purchTable = $('purchaseTable').value;

    if (!custTable) {
      alert('고객 테이블을 선택하세요.');
      return;
    }

    // 구매 테이블 사용 여부 (value 빈 문자열이면 "사용 안 함")
    const usePurchase = !!purchTable;

    const doLoad = async function() {
      // ── 1. 고객 테이블 컬럼 조회 ──
      const custRes = await apiCall('/api/setup/columns',
        Object.assign({}, getDbConfig(), { tableName: custTable }),
        { label: 'columns(customers)', timeout: 30000 }
      );
      if (!custRes.ok || !custRes.data.success) {
        const msg = custRes.ok ? custRes.data.message : custRes.error;
        alert('고객 테이블 컬럼 조회 실패: ' + msg);
        return;
      }
      const custData = custRes.data;
      const custColNames = custData.columns.map(function(c) { return c.name; });

      // ── 2. 구매 테이블 컬럼 조회 (옵션) ──
      let purchData = null;
      let purchColNames = [];
      if (usePurchase) {
        const purchRes = await apiCall('/api/setup/columns',
          Object.assign({}, getDbConfig(), { tableName: purchTable }),
          { label: 'columns(purchases)', timeout: 30000 }
        );
        if (!purchRes.ok || !purchRes.data.success) {
          const msg = purchRes.ok ? purchRes.data.message : purchRes.error;
          alert('구매 테이블 컬럼 조회 실패: ' + msg);
          return;
        }
        purchData = purchRes.data;
        purchColNames = purchData.columns.map(function(c) { return c.name; });
      }

      // ── 3. 자동 매핑 추천 (병렬) ──
      const autoPromises = [
        apiCall('/api/setup/auto-mapping', { columns: custColNames, target: 'customers' }, { label: 'auto-mapping(customers)', timeout: 15000 })
      ];
      if (usePurchase) {
        autoPromises.push(
          apiCall('/api/setup/auto-mapping', { columns: purchColNames, target: 'purchases' }, { label: 'auto-mapping(purchases)', timeout: 15000 })
        );
      }
      const autoResults = await Promise.all(autoPromises);
      const custAutoRes = autoResults[0];
      const purchAutoRes = autoResults[1] || null;

      const custAutoMapping = (custAutoRes.ok && custAutoRes.data.success) ? custAutoRes.data.mapping : {};
      const purchAutoMapping = (purchAutoRes && purchAutoRes.ok && purchAutoRes.data.success) ? purchAutoRes.data.mapping : {};

      // ── 4. 매핑 테이블 구성 (고객 필수, 구매 옵션) ──
      buildMappingTable('customerMappingTable', custData.columns, CUSTOMER_FIELDS, custAutoMapping);

      const purchSection = document.getElementById('purchaseMappingSection');
      if (usePurchase && purchData) {
        if (purchSection) purchSection.style.display = '';
        buildMappingTable('purchaseMappingTable', purchData.columns, PURCHASE_FIELDS, purchAutoMapping);
      } else {
        // 구매 테이블 미사용 시 매핑 섹션 숨김 + 테이블 비우기
        if (purchSection) purchSection.style.display = 'none';
        const purchTbody = $('purchaseMappingTable').querySelector('tbody');
        if (purchTbody) purchTbody.innerHTML = '';
      }

      console.log('[setup] 자동 매핑 결과',
        { customer: Object.keys(custAutoMapping).length + '/' + custColNames.length,
          purchase: usePurchase ? (Object.keys(purchAutoMapping).length + '/' + purchColNames.length) : 'skipped' });

      goStep(3);
    };

    const result = await withButtonLoading('btnNext2', '<span class="spinner"></span>컬럼 분석 중...', doLoad);
    return result;
  }

  // v1.5.0: AI 매핑 — 기존 매핑 테이블의 select 옵션을 AI 결과로 갱신
  async function runAiMapping() {
    const serverUrl = $('serverUrl').value.trim();
    const apiKey = $('apiKey').value.trim();
    const apiSecret = $('apiSecret').value.trim();
    const dbType = $('dbType').value;
    const custTableName = $('customerTable').value;
    const purchSelect = $('purchaseTable');
    const purchTableName = purchSelect ? purchSelect.value : '';
    const usePurchase = !!(purchTableName && purchTableName.trim().length > 0);

    if (!serverUrl || !apiKey || !apiSecret) {
      alert('Step 1의 서버 URL / API Key / API Secret을 먼저 입력하세요.');
      return;
    }
    if (!custTableName) {
      alert('고객 테이블을 먼저 선택하세요 (Step 3).');
      return;
    }

    const status = $('aiMappingStatus');
    status.style.display = '';
    status.className = 'status info show';
    status.textContent = '🤖 AI 매핑 호출 중... (Claude Opus 4.7 → Sonnet 폴백 체인)';

    const btn = $('btnAiMapping');
    const prevLabel = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>호출 중...';

    try {
      // 기존 매핑 테이블의 data-source 속성에서 컬럼명 수집
      const custRows = $('customerMappingTable').querySelectorAll('tbody tr');
      const custColNames = Array.from(custRows).map(function(tr) {
        return tr.querySelector('select').getAttribute('data-source');
      });

      const purchRows = usePurchase ? $('purchaseMappingTable').querySelectorAll('tbody tr') : [];
      const purchColNames = Array.from(purchRows).map(function(tr) {
        return tr.querySelector('select').getAttribute('data-source');
      });

      // 고객 AI 매핑
      const custRes = await apiCall('/api/setup/ai-mapping', {
        serverUrl: serverUrl, apiKey: apiKey, apiSecret: apiSecret,
        columns: custColNames, target: 'customers',
        tableName: custTableName, dbType: dbType,
      }, { label: 'ai-mapping(customers)', timeout: 90000 });

      if (!custRes.ok || !custRes.data || !custRes.data.success) {
        status.className = 'status error show';
        const errMsg = (custRes.data && custRes.data.message) ? custRes.data.message : (custRes.error || '서버 오류');
        status.textContent = '❌ AI 매핑 실패: ' + errMsg;
        return;
      }

      applyMappingToTable('customerMappingTable', custRes.data.mapping || {});

      let purchMessage = '';
      if (usePurchase && purchColNames.length > 0) {
        const purchRes = await apiCall('/api/setup/ai-mapping', {
          serverUrl: serverUrl, apiKey: apiKey, apiSecret: apiSecret,
          columns: purchColNames, target: 'purchases',
          tableName: purchTableName, dbType: dbType,
        }, { label: 'ai-mapping(purchases)', timeout: 90000 });

        if (purchRes.ok && purchRes.data && purchRes.data.success) {
          applyMappingToTable('purchaseMappingTable', purchRes.data.mapping || {});
          purchMessage = ' / 구매: ' + Object.keys(purchRes.data.mapping || {}).length + '개';
        } else {
          purchMessage = ' / 구매 AI 매핑 실패 (기존 매핑 유지)';
        }
      }

      const d = custRes.data;
      const modelLabel = d.fallbackUsed
        ? '로컬 폴백 (' + (d.fallbackReason || 'AI 호출 실패') + ')'
        : (d.modelUsed || 'claude-opus-4-7');
      const cacheBadge = d.cacheHit ? ' · 캐시적중' : '';
      status.className = 'status success show';
      status.textContent = '✅ AI 매핑 완료 — 고객: ' + Object.keys(d.mapping || {}).length + '개'
        + purchMessage + ' / 모델: ' + modelLabel + cacheBadge;
    } catch (err) {
      status.className = 'status error show';
      status.textContent = '❌ AI 매핑 오류: ' + (err && err.message ? err.message : String(err));
    } finally {
      btn.disabled = false;
      btn.innerHTML = prevLabel;
    }
  }

  function applyMappingToTable(tableId, mapping) {
    const rows = $(tableId).querySelectorAll('tbody tr');
    for (const tr of rows) {
      const select = tr.querySelector('select');
      const source = select.getAttribute('data-source');
      const suggested = mapping[source];
      if (suggested) {
        const hasOpt = Array.from(select.options).some(function(o) { return o.value === suggested; });
        if (hasOpt) select.value = suggested;
      }
    }
  }

  function buildMappingTable(tableId, columns, targetFields, autoMapping) {
    const tbody = $(tableId).querySelector('tbody');
    tbody.innerHTML = '';

    for (const col of columns) {
      const tr = document.createElement('tr');
      // 서버 API 추천 결과 사용
      const suggested = autoMapping[col.name] || '';

      tr.innerHTML = \`
        <td><strong>\${col.name}</strong><br><span style="color:#a0aec0;font-size:11px;">\${col.dataType}\${col.nullable ? ', null가능' : ''}</span></td>
        <td class="arrow">→</td>
        <td>
          <select data-source="\${col.name}">
            \${targetFields.map(f =>
              \`<option value="\${f.value}" \${f.value === suggested ? 'selected' : ''}>\${f.label}</option>\`
            ).join('')}
          </select>
        </td>
      \`;
      tbody.appendChild(tr);
    }
  }

  function autoSelectTable(selectEl, keywords) {
    for (const option of selectEl.options) {
      const lower = option.value.toLowerCase();
      if (keywords.some(k => lower.includes(k))) {
        selectEl.value = option.value;
        return;
      }
    }
  }

  // ═══ Save Config (v1.4.1 — apiCall + 구매 옵션화) ═══
  async function saveConfig() {
    const status = $('saveStatus');

    // 매핑 수집
    const customerMapping = collectMapping('customerMappingTable');
    const purchTable = $('purchaseTable').value;
    const usePurchase = !!purchTable;
    const purchaseMapping = usePurchase ? collectMapping('purchaseMappingTable') : {};

    // phone 필수 확인 (발송 서비스 기간계 — 전화번호 없으면 의미 없음)
    if (!Object.values(customerMapping).includes('phone')) {
      showStatus(status, 'error', '❌ 고객 테이블에서 phone(전화번호) 매핑은 필수입니다. 전화번호 컬럼을 phone으로 매핑해주세요.');
      return;
    }

    const config = {
      server: {
        baseUrl: $('serverUrl').value.trim(),
        apiKey: $('apiKey').value.trim(),
        apiSecret: $('apiSecret').value.trim(),
      },
      database: {
        type: $('dbType').value,
        host: $('dbHost').value.trim(),
        port: parseInt($('dbPort').value, 10),
        database: $('dbName').value.trim(),
        username: $('dbUser').value.trim(),
        password: $('dbPassword').value.trim(),
        queryTimeout: 30000,
      },
      sync: {
        customerInterval: parseInt($('customerInterval').value, 10),
        purchaseInterval: parseInt($('purchaseInterval').value, 10),
        batchSize: 4000,
        customerTable: $('customerTable').value,
        // ★ 구매 테이블 옵션화: 미사용 시 빈 문자열 전송 (schema에서 optional 처리)
        purchaseTable: usePurchase ? purchTable : '',
        timestampColumn: 'updated_at',
        fallbackToFullSync: true,
      },
      mapping: {
        customers: customerMapping,
        purchases: purchaseMapping,
      },
      agent: {
        name: $('agentName').value.trim(),
        version: '1.5.1',
      },
      log: { level: 'info' },
    };

    const result = await withButtonLoading('btnSave', '<span class="spinner"></span>저장 중...', function() {
      return apiCall('/api/setup/save', { config: config }, { label: 'save', timeout: 30000 });
    });

    if (result.ok && result.data.success) {
      goStep(5);
      return;
    }

    const msg = result.ok ? result.data.message : result.error;
    showStatus(status, 'error', '❌ ' + msg);
  }

  function collectMapping(tableId) {
    const mapping = {};
    const selects = $(tableId).querySelectorAll('select[data-source]');
    selects.forEach(sel => {
      if (sel.value) {
        mapping[sel.dataset.source] = sel.value;
      }
    });
    return mapping;
  }

  // ═══ Helpers ═══
  function $(id) { return document.getElementById(id); }

  function getDbConfig() {
    return {
      type: $('dbType').value,
      host: $('dbHost').value.trim(),
      port: $('dbPort').value,
      database: $('dbName').value.trim(),
      username: $('dbUser').value.trim(),
      password: $('dbPassword').value.trim(),
    };
  }

  function showStatus(el, type, msg) {
    el.className = \`status show \${type}\`;
    el.innerHTML = msg;
  }

  // DB 타입 변경 시 포트 자동 변경
  $('dbType').addEventListener('change', function() {
    $('dbPort').value = DEFAULT_PORTS[this.value] || 1433;
  });
</script>

</body>
</html>
`;
