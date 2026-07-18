/**
 * ★ 2026-07-17 인앱 메시지 앱(네이티브) 통합 계약 — 단일 소스.
 * 소비처: CdpSettingsPage(자사몰 연동 앱 탭 — 개발자 관점) + InAppMessagesPage(편집기 앱 채널 — 마케터 관점).
 * 배경(Harold 지시): 고객사는 자기 네이티브 앱을 우리가 못 고친다. 인앱을 제대로 쓰려면
 * "앱이 무엇을 구현해야 하는지"를 계약으로 명확히 제시해야 한다. 항목·필드명은 전부 실제
 * 서빙 응답(inapp-message.ts mapRowToMessageDetail)과 SDK 트래킹 페이로드에서 가져온 실측값 —
 * 여기 항목을 바꾸면 서버 계약과 함께 바꿔야 한다(드리프트 금지).
 * 함정 목록은 팝폰 앱에서 실제 발생한 사고 기반(세션 영속·그라데이션 크래시·정렬 미소비).
 */
import { X, Smartphone, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useEffect } from 'react';

export interface ContractItem {
  title: string;
  desc: string;
  code?: string;
}

export interface ContractSection {
  key: string;
  heading: string;
  items: ContractItem[];
}

export const APP_INAPP_CONTRACT_SECTIONS: ContractSection[] = [
  {
    key: 'fetch',
    heading: '1. 메시지 조회',
    items: [
      {
        title: '활성 메시지 조회 (공개키 + 앱 번들ID 등록 선행)',
        desc: '앱 실행(홈 진입) 시 조회해 응답의 messages 배열을 그립니다. 번들ID는 자사몰 연동 → 앱 탭에서 등록합니다.',
        code: `GET https://app.hanjul.ai/api/cdp/inapp/active?channel=app&anonymous_id=DEVICE_UUID
Header: X-Hanjullo-Key: hjl_...
(로그인 회원은 &external_id=회원ID 동봉 — 개인화 변수 치환용 customer 동봉됨)`,
      },
    ],
  },
  {
    key: 'render',
    heading: '2. 그려야 하는 필드 (앱 채널 보장 계약)',
    items: [
      {
        title: '텍스트·이미지·버튼',
        desc: 'title(제목) · body(본문) · imageUrl(이미지, 없으면 생략) · badgeText(배지) · buttons({id, label, action_url} 배열 — 3개까지만 그리세요. 웹 SDK도 3개까지만 렌더합니다) — 앱 채널은 서버가 블록 콘텐츠를 이 평면 필드로 합성해 보장합니다.',
      },
      {
        title: '색상 — 단색 hex만 옵니다',
        desc: 'backgroundColor · textColor는 앱 채널 응답에서 단색 hex(#RGB~#RRGGBBAA, 3~8자리)로 보정돼 옵니다(그라데이션 문자열 없음). 그래도 색 파싱 실패 시 앱이 죽지 않게 기본색 폴백을 두세요.',
      },
      {
        title: '텍스트 정렬',
        desc: "design.text_align('left' | 'center' | 'right')을 제목·본문 정렬에 적용하세요. 미지정 = 왼쪽. 이 필드를 소비하지 않으면 편집기의 정렬 설정이 앱에서 무시됩니다.",
      },
      {
        title: '표시 형태',
        desc: "template: 편집기는 앱 채널에 'center_modal'(중앙 모달)과 'bottom_banner'(하단 시트) 2형만 제공합니다. 그 밖의 값이 와도 두 형태 중 하나로 폴백하세요.",
      },
    ],
  },
  {
    key: 'behavior',
    heading: '3. 동작 계약 (닫기·빈도·다시 보지 않기)',
    items: [
      {
        title: '닫기(X) = 이번 세션만',
        desc: '닫기는 이번 앱 실행 동안만 억제하고, 다음 실행에는 displayFrequency 규칙대로 다시 표시합니다. 닫기 상태를 영구 저장소에 쓰면 안 됩니다.',
      },
      {
        title: '"다시 보지 않기" = 영구 (opt_out)',
        desc: "명시 거부 버튼을 제공하는 경우에만 영구 억제합니다. event_type 'opt_out'으로 트래킹을 보내면 서버가 기록하고 이후 조회 응답에서 제외됩니다.",
      },
      {
        title: 'displayFrequency 의미',
        desc: "once_per_session = 세션당 1회(앱은 앱 실행 1회, 웹은 브라우저 방문 1회) · once_per_day = 하루 1회 · always = 매번 표시(닫기 전 중복 표시는 금지).",
      },
      {
        title: '버튼 이동',
        // ★ 2026-07-18 정정(Codex D2) — 서버 sanitize 실동작 기준: http/https만 통과, 그 외 스킴은 저장 시 제거
        desc: 'buttons[].action_url(또는 actionUrl)을 엽니다. 서버가 https:// 프로토콜을 보정해 내려주며, http/https URL만 전달됩니다(그 외 스킴은 저장 시 제거).',
      },
      {
        // ★ 2026-07-18 P2 — CTA 자동 연결 규칙: 몰마다 제각각인 앱 내 경로 문제 종결 (0718 팝폰 m/xxx 무반응 실사고 근거)
        title: 'CTA URL 처리 규칙 (웹 URL 기준)',
        desc: 'CTA에는 연동 몰의 웹 URL(https://…)이 옵니다. 앱은 자체 라우팅 규칙으로 앱 내 화면에 매핑하고, 매핑할 수 없으면 반드시 인앱 브라우저(또는 외부 브라우저)로 여세요. 스킴 없는 상대경로를 openURL에 그대로 넘기면 조용히 무반응이 됩니다 — 무반응 CTA는 계약 위반입니다.',
      },
    ],
  },
  {
    key: 'track',
    heading: '4. 트래킹 (성과 집계·빈도 판정의 근거)',
    items: [
      {
        title: '표시·클릭·닫기·거부 이벤트 전송',
        desc: 'impression(표시 직후) · click(버튼, button_id 동봉) · dismiss(닫기) · opt_out(다시 보지 않기)을 보냅니다. 이걸 안 보내면 통계가 0으로 잡히고 빈도·거부 판정도 서버에서 못 합니다.',
        code: `POST https://app.hanjul.ai/api/cdp/inapp/track
Header: X-Hanjullo-Key: hjl_...
Body: { "message_id": "...", "event_type": "impression|click|dismiss|opt_out",
        "anonymous_id": "DEVICE_UUID", "external_id": "회원ID(선택)",
        "button_id": "클릭 시", "dwell_seconds": 12 }`,
      },
    ],
  },
  {
    key: 'pitfalls',
    heading: '5. 흔한 함정 (실사고 기반 체크리스트)',
    items: [
      {
        title: '세션 억제를 영구 저장하지 마세요',
        desc: '닫기·세션 표시 이력을 디스크(영구 저장소)에 쓰면 "다시 접속해도 안 뜨는" 결함이 됩니다. 세션 상태는 메모리(앱 실행 단위)에만 두세요.',
      },
      {
        title: '모르는 필드에 죽지 마세요',
        desc: '응답에 새 필드가 추가될 수 있습니다. 모르는 필드는 무시하고, 필수 필드 부재·파싱 실패 시 해당 메시지만 건너뛰세요(앱 크래시 금지).',
      },
      {
        title: '표시 직전 재검증',
        desc: '스플래시/로딩 직후 바로 띄우면 사용자가 못 봅니다. 홈 화면이 상호작용 가능해진 뒤 표시하세요.',
      },
    ],
  },
];

/** 인앱 앱(네이티브) 통합 계약 모달 — CDP 설정·인앱 편집기 공용. ESC/X/확인으로만 닫힘(백드롭 클릭 닫힘 금지 룰). */
export function AppInAppContractModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
              <Smartphone className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-base font-bold text-white">앱(네이티브) 인앱 메시지 통합 계약</div>
              <div className="text-xs text-white/50">앱이 이 계약을 구현해야 편집기의 설정이 앱에서 그대로 동작합니다</div>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/5" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 py-4 overflow-y-auto space-y-5">
          {APP_INAPP_CONTRACT_SECTIONS.map((sec) => (
            <div key={sec.key}>
              <div className="text-sm font-bold text-white mb-2">{sec.heading}</div>
              <div className="space-y-2.5">
                {sec.items.map((it, i) => (
                  <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-3">
                    <div className="flex items-start gap-2">
                      {sec.key === 'pitfalls'
                        ? <AlertTriangle className="w-4 h-4 text-amber-300 mt-0.5 flex-shrink-0" />
                        : <CheckCircle2 className="w-4 h-4 text-emerald-300 mt-0.5 flex-shrink-0" />}
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-white/90">{it.title}</div>
                        <div className="text-xs text-white/60 leading-relaxed mt-0.5">{it.desc}</div>
                        {it.code && (
                          <pre className="mt-2 bg-slate-950 border border-white/10 rounded-lg p-2.5 text-[11px] text-cyan-200 overflow-x-auto whitespace-pre">{it.code}</pre>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="text-[10px] text-white/30 italic">Data source — /api/cdp/inapp/active · /api/cdp/inapp/track (앱 채널 보장 계약)</div>
        </div>
        <div className="px-6 py-3 border-t border-white/10 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 text-sm font-semibold text-white hover:opacity-90">확인</button>
        </div>
      </div>
    </div>
  );
}
