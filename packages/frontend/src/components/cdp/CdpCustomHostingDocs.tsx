/**
 * components/cdp/CdpCustomHostingDocs.tsx — 자체 호스팅 개발자 안내·수신 검증 (★2026-08-10 Phase 5-5)
 *
 * `CdpSettingsPage`의 자체 호스팅(webhook) 영역 중 **표시 전용 조각**을 옮긴 것이다.
 *   - webhook 개발 안내(계약 문서)  : 입력은 webhook URL 하나
 *   - 네이티브 앱 REST 안내         : 입력 없음(완전 정적)
 *   - 연결 검증(최근 수신)          : 목록 + 로딩 + 새로고침 콜백
 *
 * ⛔ 시크릿 발급 패널은 여기 없다. 발급·재발급·해제는 상태가 얽혀 있고 `SecretRow`를 CDP 키 절과
 *   공유하므로 페이지에 남긴다 — 겉보기 정리를 위해 그 얽힘을 억지로 끊지 않는다.
 * ⛔ 탭 표시 조건(`customTab === …`)도 페이지가 통제한다. 여기는 무엇을 그릴지만 안다.
 */

import { Code2, Activity, Loader2, RefreshCw } from 'lucide-react';

export interface CdpWebhookDelivery {
  event: string;
  status: string;
  errorMessage: string | null;
  receivedAt: string | null;
}

// ════════════════════════════════════════════════════════════════════
// webhook 개발 안내 (자사몰 개발자 전달용)
// ════════════════════════════════════════════════════════════════════

export function CdpCustomWebhookGuide({ webhookUrl }: { webhookUrl: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6">
      <div className="flex items-center gap-2 mb-3">
        <Code2 className="w-5 h-5 text-indigo-700" />
        <h2 className="text-base font-bold text-slate-900">Webhook 개발 안내 (자사몰 개발자 전달용)</h2>
      </div>
      <div className="space-y-4 text-xs text-slate-600 leading-relaxed">
        <div>
          <div className="font-semibold text-slate-800 mb-1">1. 요청 형식</div>
          <pre className="bg-slate-100 border border-slate-200 rounded-xl p-3 text-[11px] text-emerald-800 overflow-x-auto whitespace-pre">{`POST ${webhookUrl}
Content-Type: application/json
X-Hanjullo-Company-Id: (이 화면의 Company ID)
X-Hanjullo-Event: order.created          ← 아래 이벤트명 중 하나
X-Hanjullo-Signature: (HMAC-SHA256 서명, hex 또는 base64)

{"event":"order.created","resource":{ ...아래 필드 }}`}</pre>
        </div>
        <div>
          <div className="font-semibold text-slate-800 mb-1">2. 이벤트와 resource 필드</div>
          <table className="w-full text-[11px]">
            <thead><tr className="text-left text-slate-500 border-b border-slate-200"><th className="py-1 pr-2">이벤트</th><th className="py-1 pr-2">시점</th><th className="py-1">resource 필드</th></tr></thead>
            <tbody className="text-slate-600">
              <tr className="border-b border-slate-100"><td className="py-1 pr-2 font-mono">customer.created / customer.updated</td><td className="py-1 pr-2">회원 가입·정보 변경</td><td className="py-1">external_id(필수), phone(신규 필수), name, email, birth_date, gender, grade, address, sms_opt_in(수신동의 true/false)</td></tr>
              <tr className="border-b border-slate-100"><td className="py-1 pr-2 font-mono">order.created / order.updated</td><td className="py-1 pr-2">주문 생성·상태 변경</td><td className="py-1">order_id(필수), external_id(필수), status(pending/paid/completed/shipping), total_amount, ordered_at, items, phone, name</td></tr>
              <tr><td className="py-1 pr-2 font-mono">order.cancelled / order.refunded</td><td className="py-1 pr-2">취소·환불</td><td className="py-1">order_id(필수), external_id(필수), total_amount, cancelled_at</td></tr>
            </tbody>
          </table>
          <div className="text-[11px] text-amber-800 mt-1.5">★ 수신동의(sms_opt_in)를 보내지 않으면 신규 고객은 발송 제외로 저장됩니다. 동의받은 회원은 반드시 true로 보내주세요.</div>
        </div>
        <div>
          <div className="font-semibold text-slate-800 mb-1">3. 서명 생성: 전송하는 JSON 문자열 그대로(바이트 동일) 계산</div>
          <pre className="bg-slate-100 border border-slate-200 rounded-xl p-3 text-[11px] text-emerald-800 overflow-x-auto whitespace-pre">{`// Node.js
const body = JSON.stringify({ event, resource });
const signature = require('crypto')
  .createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
// body 변수를 그대로 전송하세요 (다시 직렬화하면 서명이 어긋납니다)

// PHP
$body = json_encode(['event' => $event, 'resource' => $resource]);
$signature = hash_hmac('sha256', $body, $webhook_secret);
// $body를 그대로 전송하세요

# Python
import json, hmac, hashlib
body = json.dumps({"event": event, "resource": resource})
signature = hmac.new(WEBHOOK_SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()
# body 변수를 그대로 전송하세요`}</pre>
        </div>
        <div>
          <div className="font-semibold text-slate-800 mb-1">4. 응답 규칙</div>
          <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
            <li>200 + success true (duplicate true 포함) = 정상. 재전송 불필요</li>
            <li>401 = 서명 또는 secret 불일치. secret·서명 문자열 점검</li>
            <li>429 = 이번 달 호출 한도 초과</li>
            <li>5xx 또는 네트워크 오류 = 잠시 후 재전송 권장 (중복 전송은 자동 차단됩니다)</li>
          </ul>
        </div>
      </div>
      <div className="text-[10px] text-slate-400 italic mt-3">Data source: POST /api/cdp/webhook/custom 계약</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// 연결 검증 — 최근 webhook 수신
// ════════════════════════════════════════════════════════════════════

export interface CdpCustomDeliveriesProps {
  deliveries: CdpWebhookDelivery[] | null;
  loading: boolean;
  onLoad: () => void;
}

export function CdpCustomDeliveries({ deliveries, loading, onLoad }: CdpCustomDeliveriesProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-emerald-700" />
          <h2 className="text-base font-bold text-slate-900">연결 검증: 최근 수신</h2>
        </div>
        <button onClick={onLoad} disabled={loading} className="px-3.5 py-2 rounded-lg bg-emerald-100 border border-emerald-200 hover:bg-emerald-100 text-emerald-900 text-[12px] font-medium disabled:opacity-40 flex items-center gap-1.5">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} 최근 수신 확인
        </button>
      </div>
      <div className="text-xs text-slate-500 mb-3">자사몰에서 webhook을 보낸 뒤 눌러 도착·처리 결과를 확인하세요.</div>
      {deliveries === null ? (
        <div className="text-xs text-slate-400">"최근 수신 확인"을 눌러 도착한 이벤트를 조회합니다.</div>
      ) : deliveries.length === 0 ? (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-3">아직 수신된 webhook이 없습니다. 자사몰 서버에서 테스트 이벤트를 보내보세요 (401이면 secret·서명 문자열 점검).</div>
      ) : (
        <div className="space-y-1.5">
          {deliveries.map((d, i) => (
            <div key={i} className="flex items-center gap-2 text-xs bg-slate-100 border border-slate-200 rounded-lg px-3 py-2">
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${d.status === 'processed' ? 'bg-emerald-100 text-emerald-700' : d.status === 'duplicate' ? 'bg-slate-100 text-slate-500' : d.status === 'failed' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>{d.status}</span>
              <span className="font-mono text-slate-700">{d.event}</span>
              <span className="ml-auto text-slate-400">{d.receivedAt ? new Date(d.receivedAt).toLocaleString('ko-KR') : '-'}</span>
            </div>
          ))}
          {deliveries.some((d) => d.errorMessage) && (
            <div className="text-[10px] text-rose-700 mt-1">failed 항목은 처리 오류. 이벤트·resource 필드 점검</div>
          )}
        </div>
      )}
      <div className="text-[10px] text-slate-400 italic mt-3">Data source: GET /api/cdp/custom/deliveries</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// 네이티브 앱 (REST 직접 호출) — 완전 정적
// ════════════════════════════════════════════════════════════════════

export function CdpCustomAppGuide() {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6">
      <div className="flex items-center gap-2 mb-3">
        <Code2 className="w-5 h-5 text-cyan-700" />
        <h2 className="text-base font-bold text-slate-900">네이티브 앱 (REST 직접 호출)</h2>
      </div>
      <div className="text-xs text-slate-500 leading-relaxed mb-3">
        웹뷰가 아닌 순수 네이티브 앱(iOS/Android)은 공개키(<span className="font-mono">hjl_</span>)로 이벤트·인앱을 직접 호출합니다. <strong className="text-slate-800">secret(<span className="font-mono">sk_</span>)은 앱에 넣지 마세요</strong>. 회원/주문 적재는 고객사 서버에서 호출합니다(브라우저와 동일 원칙).
      </div>
      <div className="space-y-3 text-xs text-slate-600">
        <div>
          <div className="font-semibold text-slate-800 mb-1">이벤트 수집 (공개키)</div>
          <pre className="bg-slate-100 border border-slate-200 rounded-xl p-3 text-[11px] text-cyan-800 overflow-x-auto whitespace-pre">{`curl -X POST https://app.hanjul.ai/api/cdp/ingest \\
  -H "Content-Type: application/json" -H "X-Hanjullo-Key: hjl_..." \\
  -d '{"schema_version":"v1","anonymous_id":"DEVICE_UUID","events":[
        {"type":"track","event":"cart_add","properties":{"product_id":"P1","price":19000}}]}'`}</pre>
        </div>
        <div>
          <div className="font-semibold text-slate-800 mb-1">인앱 메시지 조회 (공개키, 앱 채널)</div>
          <pre className="bg-slate-100 border border-slate-200 rounded-xl p-3 text-[11px] text-cyan-800 overflow-x-auto whitespace-pre">{`GET https://app.hanjul.ai/api/cdp/inapp/active?channel=app&anonymous_id=DEVICE_UUID
Header: X-Hanjullo-Key: hjl_...`}</pre>
        </div>
        <div>
          <div className="font-semibold text-slate-800 mb-1">Swift / Kotlin</div>
          <pre className="bg-slate-100 border border-slate-200 rounded-xl p-3 text-[11px] text-cyan-800 overflow-x-auto whitespace-pre">{`// Swift (URLSession)
var req = URLRequest(url: URL(string: "https://app.hanjul.ai/api/cdp/ingest")!)
req.httpMethod = "POST"
req.setValue("hjl_...", forHTTPHeaderField: "X-Hanjullo-Key")
req.setValue("application/json", forHTTPHeaderField: "Content-Type")
req.httpBody = bodyData   // {"schema_version":"v1","anonymous_id":..,"events":[..]}
URLSession.shared.dataTask(with: req).resume()

// Kotlin (OkHttp)
val req = Request.Builder().url("https://app.hanjul.ai/api/cdp/ingest")
  .addHeader("X-Hanjullo-Key", "hjl_...")
  .post(bodyJson.toRequestBody("application/json".toMediaType())).build()
client.newCall(req).execute()`}</pre>
        </div>
      </div>
      <div className="text-[10px] text-slate-400 italic mt-3">Data source: /api/cdp/ingest · /api/cdp/inapp/active (공개키)</div>
    </div>
  );
}
