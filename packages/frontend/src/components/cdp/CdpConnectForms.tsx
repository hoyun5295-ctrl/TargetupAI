/**
 * components/cdp/CdpConnectForms.tsx — 몰별 연결 폼 (★2026-08-10 Phase 5-3)
 *
 * `CdpSettingsPage`에 있던 네이버·메이크샵·아임웹·고도몰 연결 폼의 **마크업**을 그대로 옮긴 것이다.
 *
 * ⛔ 분해 규약
 *   - **동작을 바꾸지 않는다.** 입력 상태와 연결·해제 핸들러는 페이지에 그대로 두고 props로 받는다.
 *     상태를 여기로 내리면 모달을 닫았다 열 때 입력값이 사라져 **리팩터가 동작을 바꾸는 일**이 된다.
 *   - **헬퍼를 새로 쓰지 않는다.** 옮길 때는 원본을 복사한다. 기억으로 다시 쓰면 테두리·글자 크기가
 *     조용히 달라지고 tsc도 테스트도 못 잡는다(1차에서 실제로 겪었다).
 *   - 설치 스크립트는 `cdp-sdk-script` CT가 만든다 — 버전 문자열을 여기 적지 않는다.
 */

import {
  Check, Loader2, Link2, Unlink, Eye, EyeOff, Code2, Copy,
  ShoppingCart, Palette, LayoutTemplate, Server, Boxes, Store, ChevronUp, ChevronDown, ExternalLink,
} from 'lucide-react';
import { GuideStep } from './CdpFormPrimitives';
import { buildSdkScriptTag } from '../../utils/cdp-sdk-script';

// ════════════════════════════════════════════════════════════════════
// 상태 타입 — 각 provider `/status` 응답
// ════════════════════════════════════════════════════════════════════

export interface NaverCommerceStatus {
  connected: boolean;
  store_id?: string;
  status?: string;
  token_expires_at?: string;
  scope?: string;
}

export interface MakeshopStatus {
  connected: boolean;
  shop_uid?: string;
  status?: string;
}

export interface ImwebStatus {
  connected: boolean;
  site_code?: string;
  status?: string;
  token_expires_at?: string;
  scope?: string;
}

export interface GodoStatus {
  connected: boolean;
  status?: string;
  connectedAt?: string | null;
  /** ★2026-08-10 주기 수집 관측값 — 마지막 성공 시각 / 마지막 실패 사유(있으면 조치 필요). */
  lastSyncedAt?: string | null;
  syncError?: { message: string; code: string; at: string | null } | null;
}

// ★ 2026-07-06 네이버 커머스 = client_credentials — scope/Redirect URI 개념 없음. 앱에 서버 IP 등록 + "주문 판매자" API 그룹 필요.
//   ★ 보안: 서버 egress IP는 코드/화면 비노출 — 실제 연동 업체만 담당자에게 개별 안내(공개 시 전 고객사가 우리 IP 인지 = 공격 표면).
const NAVER_REQUIRED_API_GROUPS = ['주문 판매자'];
// ★ 2026-07-06 메이크샵 = client_credentials(자격 입력) — 파트너센터 App에 회원·주문 Read 권한 필요. IP 등록 불요(실측).
const MAKESHOP_REQUIRED_PERMISSIONS = ['회원 (Read)', '주문 (Read)'];

const NOT_ADMIN_NOTE = <div className="text-[11px] text-white/50 text-center">연동은 회사 관리자만 가능합니다.</div>;

// ════════════════════════════════════════════════════════════════════
// 카페24 — OAuth (한줄로 공식 앱 기본 + 자체앱 BYO 고급)
// ════════════════════════════════════════════════════════════════════

export interface Cafe24Status {
  connected: boolean;
  mall_id?: string;
  status?: string;
  token_expires_at?: string;
  scope?: string;
}

// 고객 self-app에 등록하는 한줄로 고정 콜백 (백엔드 CAFE24_CALLBACK_REDIRECT 기본값과 동일)
const CAFE24_CALLBACK_URL = 'https://app.hanjul.ai/api/cafe24/oauth/callback';
// 고객 self-app에 필요한 권한 (백엔드 DEFAULT_SCOPE와 동일)
const CAFE24_REQUIRED_SCOPES = ['mall.read_customer', 'mall.read_order', 'mall.read_product', 'mall.read_application'];

export interface CdpCafe24ConnectFormProps {
  status: Cafe24Status | null;
  isAdmin: boolean;
  connecting: boolean;
  mallId: string;
  onMallIdChange: (v: string) => void;
  showByo: boolean;
  onToggleByo: () => void;
  clientId: string;
  onClientIdChange: (v: string) => void;
  clientSecret: string;
  onClientSecretChange: (v: string) => void;
  showSecret: boolean;
  onToggleSecret: () => void;
  /** 기본 흐름 — 한줄로 공식 앱(mall_id만) */
  onConnectOfficial: () => void;
  /** 고급 — 자체앱 자격 저장 후 연결 */
  onConnectByo: () => void;
  onDisconnect: () => void;
  onCopy: (text: string, label: string) => void;
}

export function CdpCafe24ConnectForm(p: CdpCafe24ConnectFormProps) {
  return (
    <div id="section-cafe24" className="bg-white/5 border border-white/10 rounded-xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <Store className="w-5 h-5 text-amber-300" />
        <h2 className="text-base font-bold text-white">카페24 연동</h2>
        <span className="text-xs bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full font-medium">OAuth · 코딩 0건</span>
      </div>

      {p.status?.connected ? (
        <div className="space-y-3">
          <div className="bg-emerald-500/10 border border-emerald-400/30 rounded-lg p-4 flex items-start gap-3">
            <Check className="w-5 h-5 text-emerald-300 mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-medium text-emerald-100">{p.status.mall_id} 카페24 연동됨</div>
              <div className="text-xs text-emerald-300 mt-1">
                status: {p.status.status} · 토큰 만료: {p.status.token_expires_at ? new Date(p.status.token_expires_at).toLocaleString('ko-KR') : '-'}
              </div>
            </div>
          </div>
          {p.isAdmin && (
            <button onClick={p.onDisconnect} className="px-4 py-2 bg-rose-500/15 border border-rose-400/40 hover:bg-rose-500/25 text-rose-200 text-sm font-medium rounded-lg flex items-center gap-2">
              <Unlink className="w-4 h-4" /> 연동 해제
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {/* 기본 흐름 — 한줄로 공식 앱 (mall_id만 입력, 2026-07-03) */}
          <div className="bg-violet-500/10 border border-violet-400/30 rounded-xl p-4">
            <div className="text-xs font-semibold text-violet-100 mb-1">쇼핑몰 ID만 입력하면 연결됩니다</div>
            <div className="text-[11px] text-white/50">한줄로 공식 카페24 앱으로 연결되어 회원·주문·장바구니가 자동 동기화됩니다. 새 창에서 카페24 로그인 + 권한 동의만 하면 끝.</div>
          </div>

          <div>
            <label className="block text-[11px] text-white/50 mb-1">쇼핑몰 ID (mall_id)</label>
            <input
              type="text"
              value={p.mallId}
              onChange={(e) => p.onMallIdChange(e.target.value)}
              placeholder="예: hanjullo-test"
              className="w-full px-3 py-2 bg-violet-900/40 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-amber-400/50"
            />
            <div className="text-[11px] text-white/40 mt-1">쇼핑몰 주소가 <span className="font-mono">hanjullo-test.cafe24.com</span>이면 → <span className="font-mono">hanjullo-test</span></div>
          </div>

          <button onClick={p.onConnectOfficial} disabled={p.connecting || !p.isAdmin || !p.mallId.trim()} className="w-full px-4 py-2.5 bg-amber-500/30 hover:bg-amber-500/50 text-amber-100 text-sm font-medium rounded-lg disabled:opacity-40 flex items-center justify-center gap-2">
            {p.connecting ? <><Loader2 className="w-4 h-4 animate-spin" /> 연결 준비 중...</> : <><Link2 className="w-4 h-4" /> 카페24 연결</>}
          </button>
          {!p.isAdmin && NOT_ADMIN_NOTE}

          {/* 고급 — 자체앱(직접 발급 키)으로 연결 (접이식) */}
          <div className="border border-white/10 rounded-xl overflow-hidden">
            <button onClick={p.onToggleByo} className="w-full px-4 py-2.5 flex items-center justify-between text-[11px] text-white/50 hover:bg-white/5">
              <span>자체앱(직접 발급한 키)으로 연결 (고급)</span>
              {p.showByo ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            {p.showByo && (
              <div className="p-4 pt-2 space-y-4 border-t border-white/10">
                <div className="bg-violet-500/10 border border-violet-400/30 rounded-xl p-4 space-y-3">
                  <div className="text-xs font-semibold text-violet-100">자체앱 연결 · 4단계</div>
                  <GuideStep n={1}>
                    <a href="https://developers.cafe24.com" target="_blank" rel="noreferrer" className="text-violet-200 underline inline-flex items-center gap-1">카페24 개발자센터<ExternalLink className="w-3 h-3" /></a>에서 "앱 만들기"(자체앱)를 생성합니다.
                  </GuideStep>
                  <GuideStep n={2}>
                    앱의 <strong className="text-white/90">Redirect URI</strong>에 아래 주소를 그대로 등록합니다.
                    <div className="flex items-center gap-2 bg-slate-950 border border-white/10 rounded-lg px-3 py-2 mt-1.5">
                      <code className="flex-1 text-[11px] text-emerald-200 font-mono break-all">{CAFE24_CALLBACK_URL}</code>
                      <button onClick={() => p.onCopy(CAFE24_CALLBACK_URL, 'Redirect URI')} className="shrink-0 p-1.5 rounded-md bg-white/5 hover:bg-white/10 text-white/60" title="복사"><Copy className="w-3.5 h-3.5" /></button>
                    </div>
                  </GuideStep>
                  <GuideStep n={3}>
                    다음 권한(scope)을 모두 선택합니다.
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {CAFE24_REQUIRED_SCOPES.map((s) => <span key={s} className="text-[10px] font-mono bg-white/5 border border-white/10 text-white/60 px-2 py-0.5 rounded-full">{s}</span>)}
                    </div>
                  </GuideStep>
                  <GuideStep n={4}>
                    발급된 <strong className="text-white/90">Client ID·Secret</strong>을 아래에 입력합니다.
                  </GuideStep>
                </div>

                <div className="space-y-2.5">
                  <div>
                    <label className="block text-[11px] text-white/50 mb-1">Client ID</label>
                    <input
                      type="text"
                      value={p.clientId}
                      onChange={(e) => p.onClientIdChange(e.target.value)}
                      placeholder="자체앱 Client ID"
                      className="w-full px-3 py-2 bg-violet-900/40 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-amber-400/50 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-white/50 mb-1">Client Secret</label>
                    <div className="relative">
                      <input
                        type={p.showSecret ? 'text' : 'password'}
                        value={p.clientSecret}
                        onChange={(e) => p.onClientSecretChange(e.target.value)}
                        placeholder="자체앱 Client Secret"
                        className="w-full px-3 py-2 pr-10 bg-violet-900/40 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-amber-400/50 font-mono"
                      />
                      <button type="button" onClick={p.onToggleSecret} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-white/40 hover:text-white/70" title={p.showSecret ? '숨기기' : '보기'}>
                        {p.showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>

                <button onClick={p.onConnectByo} disabled={p.connecting || !p.isAdmin || !p.mallId.trim() || !p.clientId.trim() || !p.clientSecret.trim()} className="w-full px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 text-sm font-medium rounded-lg disabled:opacity-40 flex items-center justify-center gap-2">
                  {p.connecting ? <><Loader2 className="w-4 h-4 animate-spin" /> 연결 준비 중...</> : <><Link2 className="w-4 h-4" /> 자체앱 키 저장하고 연결</>}
                </button>
                <div className="text-[10px] text-white/30 italic">Client Secret은 한줄로 서버에 안전 보관되며 화면에 다시 표시되지 않습니다. 쇼핑몰 ID는 위 입력칸을 함께 사용합니다.</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// 네이버 스마트스토어 — 커머스 API 자격 입력형
// ════════════════════════════════════════════════════════════════════

export interface CdpNaverConnectFormProps {
  status: NaverCommerceStatus | null;
  isAdmin: boolean;
  connecting: boolean;
  previewing: boolean;
  storeId: string;
  onStoreIdChange: (v: string) => void;
  clientId: string;
  onClientIdChange: (v: string) => void;
  clientSecret: string;
  onClientSecretChange: (v: string) => void;
  showSecret: boolean;
  onToggleSecret: () => void;
  onConnect: () => void;
  onPreview: () => void;
  onDisconnect: () => void;
}

export function CdpNaverConnectForm(p: CdpNaverConnectFormProps) {
  return (
    <div id="section-naver" className="bg-white/5 border border-white/10 rounded-xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <ShoppingCart className="w-5 h-5 text-emerald-300" />
        <h2 className="text-base font-bold text-white">네이버 스마트스토어 연동</h2>
        <span className="text-xs bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full font-medium">커머스 API</span>
      </div>

      {/* ★ 2026-07-06 인앱 미지원 명확 안내 — 스마트스토어는 스토어 페이지에 스크립트 설치 불가(폐쇄형) */}
      <div className="mb-4 bg-amber-500/10 border border-amber-400/25 rounded-lg p-3 text-[11px] text-amber-200/90 leading-relaxed">
        네이버 스마트스토어는 <strong className="text-white/90">주문·구매고객 데이터 동기화만</strong> 지원됩니다. 스마트스토어 페이지에는 스크립트를 설치할 수 없어 <strong className="text-white/90">인앱 메시지(웹 팝업) 표시는 지원되지 않습니다.</strong> 인앱 메시지는 카페24·고도몰·메이크샵·아임웹·자체 쇼핑몰에서 이용할 수 있습니다.
      </div>

      {p.status?.connected ? (
        <div className="space-y-3">
          <div className="bg-emerald-500/10 border border-emerald-400/30 rounded-lg p-4 flex items-start gap-3">
            <Check className="w-5 h-5 text-emerald-300 mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-medium text-emerald-100">{p.status.store_id} 네이버 스마트스토어 연동됨</div>
              {/* ★ 2026-07-06 토큰 만료 시각 노출 제거 — client_credentials는 자동 재발급이라 만료 시각이 불안만 유발(Harold 지적) */}
              <div className="text-xs text-emerald-300 mt-1">연동 유지 중 · 토큰 자동 갱신</div>
            </div>
          </div>
          {p.isAdmin && (
            <div className="flex gap-2">
              <button onClick={p.onPreview} disabled={p.previewing} className="px-4 py-2 bg-emerald-500/15 border border-emerald-400/40 hover:bg-emerald-500/25 text-emerald-200 text-sm font-medium rounded-lg flex items-center gap-2 disabled:opacity-40">
                {p.previewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />} 주문 데이터 확인 (24h)
              </button>
              <button onClick={p.onDisconnect} className="px-4 py-2 bg-rose-500/15 border border-rose-400/40 hover:bg-rose-500/25 text-rose-200 text-sm font-medium rounded-lg flex items-center gap-2">
                <Unlink className="w-4 h-4" /> 연동 해제
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="text-xs text-amber-200/80 bg-amber-500/10 border border-amber-400/30 rounded p-2">
            ★ 네이버 정책상 휴대폰·이메일 등 개인정보 제공이 제한될 수 있어, 기존 고객과의 매칭률이 낮을 수 있습니다.
          </div>
          {/* 안내 — 애플리케이션 등록 4단계 (client_credentials — Redirect URI/scope 없음) */}
          <div className="bg-violet-500/10 border border-violet-400/30 rounded-xl p-4 space-y-3">
            <div className="text-xs font-semibold text-violet-100">애플리케이션 연결 · 4단계</div>
            <GuideStep n={1}>네이버 커머스 API센터에서 애플리케이션을 등록합니다.</GuideStep>
            <GuideStep n={2}>
              애플리케이션의 <strong className="text-white/90">API 호출 IP</strong>에 한줄로 서버 IP를 등록합니다. (미등록 시 연동이 거부됩니다)
              <div className="bg-slate-950 border border-white/10 rounded-lg px-3 py-2 mt-1.5 text-[11px] text-white/70 leading-relaxed">
                보안을 위해 등록할 IP는 <strong className="text-emerald-200">한줄로 AI · SDK 연동 담당자</strong>에게 문의해 개별 안내받으세요.
              </div>
            </GuideStep>
            <GuideStep n={3}>
              API 그룹에서 다음 그룹을 추가합니다.
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {NAVER_REQUIRED_API_GROUPS.map((s) => <span key={s} className="text-[10px] bg-white/5 border border-white/10 text-white/60 px-2 py-0.5 rounded-full">{s}</span>)}
              </div>
            </GuideStep>
            <GuideStep n={4}>
              발급된 <strong className="text-white/90">애플리케이션 ID·시크릿</strong>을 아래에 입력하고 연동하기를 누릅니다.
            </GuideStep>
          </div>

          {/* 입력 — store_id + Client ID + Secret */}
          <div className="space-y-2.5">
            <div>
              <label className="block text-[11px] text-white/50 mb-1">store_id</label>
              <input
                type="text"
                value={p.storeId}
                onChange={(e) => p.onStoreIdChange(e.target.value)}
                placeholder="네이버 스마트스토어 store_id"
                className="w-full px-3 py-2 bg-violet-900/40 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-emerald-400/50"
              />
            </div>
            <div>
              <label className="block text-[11px] text-white/50 mb-1">Client ID</label>
              <input
                type="text"
                value={p.clientId}
                onChange={(e) => p.onClientIdChange(e.target.value)}
                placeholder="애플리케이션 Client ID"
                className="w-full px-3 py-2 bg-violet-900/40 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-emerald-400/50 font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] text-white/50 mb-1">Client Secret</label>
              <div className="relative">
                <input
                  type={p.showSecret ? 'text' : 'password'}
                  value={p.clientSecret}
                  onChange={(e) => p.onClientSecretChange(e.target.value)}
                  placeholder="애플리케이션 Client Secret"
                  className="w-full px-3 py-2 pr-10 bg-violet-900/40 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-emerald-400/50 font-mono"
                />
                <button type="button" onClick={p.onToggleSecret} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-white/40 hover:text-white/70" title={p.showSecret ? '숨기기' : '보기'}>
                  {p.showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>

          <button onClick={p.onConnect} disabled={p.connecting || !p.isAdmin || !p.storeId.trim() || !p.clientId.trim() || !p.clientSecret.trim()} className="w-full px-4 py-2.5 bg-emerald-500/30 hover:bg-emerald-500/50 text-emerald-100 text-sm font-medium rounded-lg disabled:opacity-40 flex items-center justify-center gap-2">
            {p.connecting ? <><Loader2 className="w-4 h-4 animate-spin" /> 연동 확인 중...</> : <><Link2 className="w-4 h-4" /> 연동하기</>}
          </button>
          {!p.isAdmin && NOT_ADMIN_NOTE}
          <div className="text-[10px] text-white/30 italic">Client Secret은 한줄로 서버에 안전 보관되며 화면에 다시 표시되지 않습니다.</div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// 메이크샵 — 커머스 API 자격 입력형
// ════════════════════════════════════════════════════════════════════

export interface CdpMakeshopConnectFormProps {
  status: MakeshopStatus | null;
  isAdmin: boolean;
  connecting: boolean;
  previewing: boolean;
  shopUid: string;
  onShopUidChange: (v: string) => void;
  clientId: string;
  onClientIdChange: (v: string) => void;
  clientSecret: string;
  onClientSecretChange: (v: string) => void;
  showSecret: boolean;
  onToggleSecret: () => void;
  onConnect: () => void;
  onPreview: () => void;
  onDisconnect: () => void;
  publicKey: string | null | undefined;
  onCopy: (text: string, label: string) => void;
}

export function CdpMakeshopConnectForm(p: CdpMakeshopConnectFormProps) {
  const makeshopHead = buildSdkScriptTag(p.publicKey);
  return (
    <div id="section-makeshop" className="bg-white/5 border border-white/10 rounded-xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <Palette className="w-5 h-5 text-rose-300" />
        <h2 className="text-base font-bold text-white">메이크샵 연동</h2>
        <span className="text-xs bg-rose-500/20 text-rose-300 px-2 py-0.5 rounded-full font-medium">커머스 API</span>
      </div>

      {p.status?.connected ? (
        <div className="space-y-3">
          <div className="bg-emerald-500/10 border border-emerald-400/30 rounded-lg p-4 flex items-start gap-3">
            <Check className="w-5 h-5 text-emerald-300 mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-medium text-emerald-100">{p.status.shop_uid} 메이크샵 연동됨</div>
              <div className="text-xs text-emerald-300 mt-1">연동 유지 중 · 토큰 자동 갱신</div>
            </div>
          </div>
          {p.isAdmin && (
            <div className="flex gap-2">
              <button onClick={p.onPreview} disabled={p.previewing} className="px-4 py-2 bg-emerald-500/15 border border-emerald-400/40 hover:bg-emerald-500/25 text-emerald-200 text-sm font-medium rounded-lg flex items-center gap-2 disabled:opacity-40">
                {p.previewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Boxes className="w-4 h-4" />} 회원·주문 데이터 확인
              </button>
              <button onClick={p.onDisconnect} className="px-4 py-2 bg-rose-500/15 border border-rose-400/40 hover:bg-rose-500/25 text-rose-200 text-sm font-medium rounded-lg flex items-center gap-2">
                <Unlink className="w-4 h-4" /> 연동 해제
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {/* 안내 — App 등록 3단계 */}
          <div className="bg-violet-500/10 border border-violet-400/30 rounded-xl p-4 space-y-3">
            <div className="text-xs font-semibold text-violet-100">App 연결 · 3단계</div>
            <GuideStep n={1}>메이크샵 파트너센터(partner.makeshop.co.kr)에서 App을 등록합니다.</GuideStep>
            <GuideStep n={2}>
              App에 다음 권한(Read)을 추가합니다.
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {MAKESHOP_REQUIRED_PERMISSIONS.map((s) => <span key={s} className="text-[10px] bg-white/5 border border-white/10 text-white/60 px-2 py-0.5 rounded-full">{s}</span>)}
              </div>
            </GuideStep>
            <GuideStep n={3}>
              App의 <strong className="text-white/90">Client ID·Secret</strong>과 <strong className="text-white/90">상점 ID(shop_uid)</strong>를 아래에 입력하고 연동하기를 누릅니다.
            </GuideStep>
          </div>

          {/* 입력 — shop_uid + Client ID + Secret */}
          <div className="space-y-2.5">
            <div>
              <label className="block text-[11px] text-white/50 mb-1">상점 ID (shop_uid)</label>
              <input
                type="text"
                value={p.shopUid}
                onChange={(e) => p.onShopUidChange(e.target.value)}
                placeholder="메이크샵 상점 ID"
                className="w-full px-3 py-2 bg-violet-900/40 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-emerald-400/50"
              />
            </div>
            <div>
              <label className="block text-[11px] text-white/50 mb-1">Client ID</label>
              <input
                type="text"
                value={p.clientId}
                onChange={(e) => p.onClientIdChange(e.target.value)}
                placeholder="App Client ID"
                className="w-full px-3 py-2 bg-violet-900/40 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-emerald-400/50 font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] text-white/50 mb-1">Client Secret</label>
              <div className="relative">
                <input
                  type={p.showSecret ? 'text' : 'password'}
                  value={p.clientSecret}
                  onChange={(e) => p.onClientSecretChange(e.target.value)}
                  placeholder="App Client Secret"
                  className="w-full px-3 py-2 pr-10 bg-violet-900/40 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-emerald-400/50 font-mono"
                />
                <button type="button" onClick={p.onToggleSecret} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-white/40 hover:text-white/70" title={p.showSecret ? '숨기기' : '보기'}>
                  {p.showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>

          <button onClick={p.onConnect} disabled={p.connecting || !p.isAdmin || !p.shopUid.trim() || !p.clientId.trim() || !p.clientSecret.trim()} className="w-full px-4 py-2.5 bg-emerald-500/30 hover:bg-emerald-500/50 text-emerald-100 text-sm font-medium rounded-lg disabled:opacity-40 flex items-center justify-center gap-2">
            {p.connecting ? <><Loader2 className="w-4 h-4 animate-spin" /> 연동 확인 중...</> : <><Link2 className="w-4 h-4" /> 연동하기</>}
          </button>
          {!p.isAdmin && NOT_ADMIN_NOTE}
          <div className="text-[10px] text-white/30 italic">Client Secret은 한줄로 서버에 안전 보관되며 화면에 다시 표시되지 않습니다.</div>
        </div>
      )}

      {/* ★ 2026-07-06 메이크샵 SDK 설치 (방문·장바구니 수집 + 인앱 메시지 표시) — 주문 API와 별개. 메이크샵은 자동삽입 불가라 디자인 편집 복붙. */}
      <div className="mt-5 pt-5 border-t border-white/10 space-y-4">
        <div className="flex items-center gap-2">
          <Code2 className="w-4 h-4 text-violet-300" />
          <h3 className="text-sm font-bold text-white">SDK 설치: 방문·장바구니 수집 + 인앱 메시지 표시</h3>
        </div>
        <div className="text-[11px] text-white/50 -mt-2">회원·주문 동기화(위)와 별개입니다. 방문·장바구니 수집과 <strong className="text-white/80">인앱 메시지 표시</strong>는 쇼핑몰 페이지에 아래 스크립트가 설치돼야 작동합니다. 메이크샵 관리자 &gt; 개별디자인(디자인 편집)에서 모든 페이지에 공통 적용되는 상단 HTML(&lt;head&gt;)에 붙여넣으세요. PC·모바일 디자인 양쪽 모두 필요합니다.</div>
        <div className="space-y-3">
          <pre className="bg-slate-950 border border-white/10 rounded-xl p-3 text-[11px] text-emerald-200 overflow-x-auto whitespace-pre-wrap break-all">{makeshopHead}</pre>
          <button type="button" onClick={() => p.onCopy(makeshopHead, '메이크샵 설치 스크립트')} className="px-3 py-2 bg-indigo-500/40 hover:bg-indigo-500/60 text-white rounded-lg text-xs font-medium inline-flex items-center gap-1.5">
            <Copy className="w-3.5 h-3.5" />복사
          </button>
          <div className="text-[10px] text-amber-300/70 italic">설치 후 "수집 허용 도메인"에 쇼핑몰 도메인을 등록해야 수집·인앱 표시가 시작됩니다.</div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// 아임웹 — OAuth (siteCode)
// ════════════════════════════════════════════════════════════════════

export interface CdpImwebConnectFormProps {
  status: ImwebStatus | null;
  isAdmin: boolean;
  connecting: boolean;
  siteCode: string;
  onSiteCodeChange: (v: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  publicKey: string | null | undefined;
  onCopy: (text: string, label: string) => void;
}

export function CdpImwebConnectForm(p: CdpImwebConnectFormProps) {
  const imwebHead = buildSdkScriptTag(p.publicKey);
  return (
    <div id="section-imweb" className="bg-white/5 border border-white/10 rounded-xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <LayoutTemplate className="w-5 h-5 text-indigo-300" />
        <h2 className="text-base font-bold text-white">아임웹 연동</h2>
        <span className="text-xs bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full font-medium">imweb OAuth</span>
      </div>

      {p.status?.connected ? (
        <div className="space-y-3">
          <div className="bg-emerald-500/10 border border-emerald-400/30 rounded-lg p-4 flex items-start gap-3">
            <Check className="w-5 h-5 text-emerald-300 mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-medium text-emerald-100">{p.status.site_code} 아임웹 연동됨</div>
              <div className="text-xs text-emerald-300 mt-1">status: {p.status.status} · 토큰 만료: {p.status.token_expires_at ? new Date(p.status.token_expires_at).toLocaleString('ko-KR') : '-'}</div>
            </div>
          </div>
          {p.isAdmin && (
            <button onClick={p.onDisconnect} className="px-4 py-2 bg-rose-500/15 border border-rose-400/40 hover:bg-rose-500/25 text-rose-200 text-sm font-medium rounded-lg flex items-center gap-2">
              <Unlink className="w-4 h-4" /> 연동 해제
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-violet-500/10 border border-violet-400/30 rounded-xl p-4 space-y-3">
            <div className="text-xs font-semibold text-violet-100">아임웹 연결 · 2단계</div>
            <GuideStep n={1}>
              아임웹 앱스토어에서 <strong className="text-white/90">한줄로</strong> 앱을 추가하면 전달되는 <strong className="text-white/90">사이트 코드(siteCode)</strong>를 확인합니다.
            </GuideStep>
            <GuideStep n={2}>
              사이트 코드를 아래에 입력하고 연결하면, 새 창에서 아임웹 동의 후 회원·주문·수신동의·장바구니가 자동 동기화됩니다.
            </GuideStep>
          </div>

          <div>
            <label className="block text-[11px] text-white/50 mb-1">사이트 코드(siteCode)</label>
            <input
              type="text"
              value={p.siteCode}
              onChange={(e) => p.onSiteCodeChange(e.target.value)}
              placeholder="예: S2025012450f7813d2ddau"
              className="w-full px-3 py-2 bg-violet-900/40 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-indigo-400/50 font-mono"
            />
          </div>

          <button onClick={p.onConnect} disabled={p.connecting || !p.isAdmin || !p.siteCode.trim()} className="w-full px-4 py-2.5 bg-indigo-500/30 hover:bg-indigo-500/50 text-indigo-100 text-sm font-medium rounded-lg disabled:opacity-40 flex items-center justify-center gap-2">
            {p.connecting ? <><Loader2 className="w-4 h-4 animate-spin" /> 연결 준비 중...</> : <><Link2 className="w-4 h-4" /> 아임웹 연결</>}
          </button>
          {!p.isAdmin && NOT_ADMIN_NOTE}
          <div className="text-[10px] text-white/30 italic">Data source: 아임웹 Open API (openapi.imweb.me). 회원·주문·수신동의 읽기 전용.</div>
        </div>
      )}

      {/* ★ 2026-07-06 아임웹 SDK 설치 (방문·장바구니 수집 + 인앱 메시지 표시) — 주문 API와 별개. 아임웹은 자동삽입 불가라 코드 삽입 복붙. */}
      <div className="mt-5 pt-5 border-t border-white/10 space-y-4">
        <div className="flex items-center gap-2">
          <Code2 className="w-4 h-4 text-violet-300" />
          <h3 className="text-sm font-bold text-white">SDK 설치: 방문·장바구니 수집 + 인앱 메시지 표시</h3>
        </div>
        <div className="text-[11px] text-white/50 -mt-2">회원·주문 동기화(위)와 별개입니다. 방문·장바구니 수집과 <strong className="text-white/80">인앱 메시지 표시</strong>는 사이트에 아래 스크립트가 설치돼야 작동합니다. 아임웹 관리자 화면의 코드 삽입(HEAD 영역)에 붙여넣으세요.</div>
        <div className="space-y-3">
          <pre className="bg-slate-950 border border-white/10 rounded-xl p-3 text-[11px] text-emerald-200 overflow-x-auto whitespace-pre-wrap break-all">{imwebHead}</pre>
          <button type="button" onClick={() => p.onCopy(imwebHead, '아임웹 설치 스크립트')} className="px-3 py-2 bg-indigo-500/40 hover:bg-indigo-500/60 text-white rounded-lg text-xs font-medium inline-flex items-center gap-1.5">
            <Copy className="w-3.5 h-3.5" />복사
          </button>
          <div className="text-[10px] text-amber-300/70 italic">설치 후 "수집 허용 도메인"에 사이트 도메인을 등록해야 수집·인앱 표시가 시작됩니다.</div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// 고도몰 — BYO 쇼핑몰 인증키(key)
// ════════════════════════════════════════════════════════════════════

export interface CdpGodoConnectFormProps {
  status: GodoStatus | null;
  isAdmin: boolean;
  connecting: boolean;
  apiKey: string;
  onApiKeyChange: (v: string) => void;
  showKey: boolean;
  onToggleKey: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  publicKey: string | null | undefined;
  onCopy: (text: string, label: string) => void;
}

export function CdpGodoConnectForm(p: CdpGodoConnectFormProps) {
  const godoHead = buildSdkScriptTag(p.publicKey);
  const godoBody = `<body data-hjl-user-id="{=gSess.memNo}" data-hjl-phone="{=gSess.cellPhone}" data-hjl-name="{=gSess.memNm}">`;
  const godoCart = `<script>\n  // 장바구니 담기 성공 시점(담기 버튼/AJAX 성공)에 호출\n  window.hjl && window.hjl.track('cart_add', {\n    product_name: "{=goodsView['goodsNm']}",\n    price: Number("{=gd_isset(goodsView['goodsPrice'],0)}"),\n    product_url: location.href,\n    quantity: 1\n  });\n</script>`;
  const godoPurchase = `<script>\n  window.hjl && window.hjl.track('purchase', { order_id: '{=orderInfo.orderNo}' });\n</script>`;
  const blk = (label: string, code: string, copyLabel: string) => (
    <div key={copyLabel}>
      <div className="text-xs font-medium text-white/70 mb-1.5">{label}</div>
      <pre className="bg-slate-950 border border-white/10 rounded-xl p-3 text-[11px] text-emerald-200 overflow-x-auto whitespace-pre-wrap break-all">{code}</pre>
      <button type="button" onClick={() => p.onCopy(code, copyLabel)} className="mt-2 px-3 py-2 bg-indigo-500/40 hover:bg-indigo-500/60 text-white rounded-lg text-xs font-medium inline-flex items-center gap-1.5">
        <Copy className="w-3.5 h-3.5" />복사
      </button>
    </div>
  );

  return (
    <div id="section-godo" className="bg-white/5 border border-white/10 rounded-xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <Server className="w-5 h-5 text-indigo-300" />
        <h2 className="text-base font-bold text-white">고도몰 연동</h2>
        <span className="text-xs bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full font-medium">쇼핑몰 인증키</span>
      </div>

      {p.status?.connected ? (
        <div className="space-y-3">
          <div className="bg-emerald-500/10 border border-emerald-400/30 rounded-lg p-4 flex items-start gap-3">
            <Check className="w-5 h-5 text-emerald-300 mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-medium text-emerald-100">고도몰 연동됨</div>
              <div className="text-xs text-emerald-300 mt-1">
                status: {p.status.status} · 연결: {p.status.connectedAt ? new Date(p.status.connectedAt).toLocaleString('ko-KR') : '-'}
              </div>
            </div>
          </div>
          {p.isAdmin && (
            <button onClick={p.onDisconnect} className="px-4 py-2 bg-rose-500/15 border border-rose-400/40 hover:bg-rose-500/25 text-rose-200 text-sm font-medium rounded-lg flex items-center gap-2">
              <Unlink className="w-4 h-4" /> 연동 해제
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-violet-500/10 border border-violet-400/30 rounded-xl p-4 space-y-3">
            <div className="text-xs font-semibold text-violet-100">쇼핑몰 인증키 연결 · 2단계</div>
            <GuideStep n={1}>고도몰 쇼핑몰 관리자에서 한줄로 API 사용을 신청하고 <strong className="text-white/90">쇼핑몰 인증키(key)</strong>를 발급받습니다.</GuideStep>
            <GuideStep n={2}>발급된 인증키를 아래에 입력하면, 최근 주문이 자동으로 들어옵니다.</GuideStep>
          </div>

          <div>
            <label className="block text-[11px] text-white/50 mb-1">쇼핑몰 인증키(key)</label>
            <div className="relative">
              <input
                type={p.showKey ? 'text' : 'password'}
                value={p.apiKey}
                onChange={(e) => p.onApiKeyChange(e.target.value)}
                placeholder="고도몰에서 발급받은 인증키"
                className="w-full px-3 py-2 pr-10 bg-violet-900/40 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-indigo-400/50 font-mono"
              />
              <button type="button" onClick={p.onToggleKey} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-white/40 hover:text-white/70" title={p.showKey ? '숨기기' : '보기'}>
                {p.showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button onClick={p.onConnect} disabled={p.connecting || !p.isAdmin || !p.apiKey.trim()} className="w-full px-4 py-2.5 bg-indigo-500/30 hover:bg-indigo-500/50 text-indigo-100 text-sm font-medium rounded-lg disabled:opacity-40 flex items-center justify-center gap-2">
            {p.connecting ? <><Loader2 className="w-4 h-4 animate-spin" /> 연결 확인 중...</> : <><Link2 className="w-4 h-4" /> 저장하고 고도몰 연동</>}
          </button>
          {!p.isAdmin && NOT_ADMIN_NOTE}
          <div className="text-[10px] text-white/30 italic">인증키는 한줄로 서버에 안전 보관되며 화면에 다시 표시되지 않습니다.</div>
        </div>
      )}

      {/* ★ 2026-07-03 고도몰 SDK 설치 (행동·회원 수집) — 주문 API 키와 별개. 고도몰은 자동삽입 불가라 스킨 복붙. */}
      <div className="mt-5 pt-5 border-t border-white/10 space-y-4">
        <div className="flex items-center gap-2">
          <Code2 className="w-4 h-4 text-violet-300" />
          <h3 className="text-sm font-bold text-white">SDK 설치: 방문·회원·장바구니 수집</h3>
        </div>
        <div className="text-[11px] text-white/50 -mt-2">주문(위)과 별개입니다. 방문·회원·장바구니까지 수집하려면 고도몰 스킨(PC·모바일 각각)에 아래를 붙여넣으세요. 고도몰5 표준 치환코드라 수정 없이 동작합니다.</div>
        <div className="space-y-4">
          {blk('① 설치 스크립트: 모든 페이지 스킨 <head>', godoHead, '고도몰 설치 스크립트')}
          {blk('② 회원 식별: 로그인 스킨 <body> 태그', godoBody, '고도몰 회원 식별 코드')}
          {blk('③ 장바구니 담기: 상품상세(goods_view) 스킨', godoCart, '고도몰 장바구니 코드')}
          {blk('④ 구매 완료: 주문완료(order_end) 스킨', godoPurchase, '고도몰 구매 완료 코드')}
          <div className="text-[10px] text-amber-300/70 italic">PC·모바일 스킨 양쪽에 넣어야 합니다. 그리고 "수집 허용 도메인"에 몰 도메인을 등록해야 수집이 시작됩니다.</div>
        </div>
      </div>
    </div>
  );
}
