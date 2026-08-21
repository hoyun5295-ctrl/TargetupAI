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
(로그인 회원은 &external_id=회원ID 동봉, 개인화 변수 치환용 customer 동봉됨)`,
      },
    ],
  },
  {
    key: 'render',
    heading: '2. 그려야 하는 필드 (앱 채널 보장 계약)',
    items: [
      {
        title: '텍스트·이미지·버튼',
        desc: 'title(제목) · body(본문) · imageUrl(이미지, 없으면 생략) · badgeText(배지) · buttons({id, label, action_url, background_color, text_color} 배열: 3개까지만 그리고 색 필드를 반드시 소비하세요. 웹 SDK도 3개까지만 렌더합니다). 앱 채널은 서버가 블록 콘텐츠를 이 평면 필드로 합성해 보장합니다.',
      },
      {
        // ★ 2026-07-18 포스터형 v2 — 앱 채널 계약 (웹 renderPoster와 동일 규격)
        title: '포스터형 (template = "full_image")',
        desc: '가로 꽉 찬 하단 시트입니다. 좌우 마진 0, 상단 모서리만 라운드, 카드 바닥 흰색 고정. imageUrl 필수(원본 비율 유지), 제목/본문/배지는 이미지 하단 어두운 그라데이션 위 오버레이(본문은 잘림 없이 전 줄). 스타일 필드: design.poster_title_color/poster_body_color(제목·본문 색, 폴백 poster_text_color→흰색) · design.poster_title_size(14~32, 기본 20)/poster_body_size(10~22, 기본 14) · 제목 서체 = design.font_display(로드 불가 환경은 기본 서체). 흰 바닥에 buttons[0] 1개만(배경/글자색 소비) + "다시 보지 않기·닫기". 이 값을 모르는 구버전 앱은 기본형(바텀 시트)으로 안전 표시하면 됩니다.',
      },
      {
        // ★ 2026-07-21 포스터형 캐러셀 — 좌우 스와이프(스타벅스형). posterSlides가 있으면 여러 장을 넘겨봅니다.
        title: '포스터형 캐러셀 (posterSlides 배열, 2장 이상)',
        desc: 'posterSlides 배열이 오면(2장 이상) 포스터를 한 장이 아니라 좌우로 스와이프하는 카드로 그립니다. 각 슬라이드 = { image_url(필수), title, body, cta:{label, action_url, background_color, text_color}, title_color/body_color(hex), title_size(14~32)/body_size(10~22) }. 각 장은 자기 이미지(cover, 슬라이드 높이 통일)·오버레이 문구·CTA 1개를 가지며, 하단 CTA는 현재 보이는 슬라이드의 cta로 바뀝니다. 하단 점(1/N) 인디케이터 + "다시 보지 않기"는 공용. 슬라이드별 색·크기 미지정 시 design.poster_* 폴백. posterSlides[0]은 flat 필드(imageUrl/title/body/buttons[0])와 동일하므로, 캐러셀을 모르는 구버전 앱은 자동으로 "첫 장"만 단일 포스터로 안전 표시합니다.',
      },
      {
        // ★ 2026-07-31 이미지 클릭 랜딩 — 이미지 자체가 링크(선택)
        title: '이미지 클릭 랜딩 (imageLinkUrl · 슬라이드 link_url)',
        desc: '메시지에 imageLinkUrl이 오면(선택) 이미지 자체를 눌렀을 때 그 주소로 이동합니다. 버튼과 동일 계약(트래킹 → 이번 세션 재표시 억제 → 시트 닫기 → 이동). 트래킹 button_id = "image". 캐러셀은 슬라이드별 link_url(선택)을 쓰고 button_id = "slide_{index}_image"(0부터)로 보냅니다. 링크가 없으면 지금처럼 아무 동작 없음. 이 필드를 모르는 구버전 앱도 그대로 무동작이라 안전합니다. http/https만 오며(서버 무해화), 상대경로·커스텀 스킴은 오지 않습니다.',
      },
      {
        title: '캐러셀 클릭 트래킹 + 그라데이션(네이티브 주의)',
        desc: '슬라이드 CTA 클릭은 button_id = "slide_{index}"(0부터)로 트래킹을 보내면 슬라이드별 성과가 집계됩니다. 스크림(이미지 하단 어두운 그라데이션)은 반투명 View를 여러 장 쌓지 말고 단일 요소(LinearGradient 또는 코드 내장 base64 PNG 알파 램프 1장을 늘려서)로 그리세요. 반투명 뷰 쌓기는 Android에서 이음새마다 가로줄이 생깁니다(실사고). 좌우 스와이프는 RN 기본 가로 페이징(FlatList/ScrollView pagingEnabled)으로 충분해 네이티브 모듈 추가가 필요 없습니다(OTA 가능).',
      },
      {
        title: '색상: 단색 hex만 옵니다',
        desc: 'backgroundColor · textColor는 앱 채널 응답에서 단색 hex(#RGB~#RRGGBBAA, 3~8자리)로 보정돼 옵니다(그라데이션 문자열 없음). 그래도 색 파싱 실패 시 앱이 죽지 않게 기본색 폴백을 두세요.',
      },
      {
        title: '텍스트 정렬',
        desc: "design.text_align('left' | 'center' | 'right')을 제목·본문 정렬에 적용하세요. 미지정 = 왼쪽. 이 필드를 소비하지 않으면 편집기의 정렬 설정이 앱에서 무시됩니다.",
      },
      {
        // ★ 2026-07-18 정정2 — 앱 = 기본형 2위치 + 포스터형
        title: '표시 형태',
        desc: "template: 앱 채널은 'center_modal'(기본형·중앙 모달) · 'bottom_banner'(기본형·바텀 시트) · 'full_image'(포스터형·전면 이미지) 3값을 받습니다. 모르는 값이 와도 기본형(바텀 시트)으로 폴백하세요.",
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
        desc: 'CTA에는 연동 몰의 웹 URL(https://…)이 옵니다. 앱은 자체 라우팅 규칙으로 앱 내 화면에 매핑하고, 매핑할 수 없으면 반드시 인앱 브라우저(또는 외부 브라우저)로 여세요. 스킴 없는 상대경로를 openURL에 그대로 넘기면 조용히 무반응이 됩니다. 무반응 CTA는 계약 위반입니다.',
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
          <div className="text-[10px] text-white/30 italic">Data source: /api/cdp/inapp/active · /api/cdp/inapp/track (앱 채널 보장 계약)</div>
        </div>
        <div className="px-6 py-3 border-t border-white/10 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 text-sm font-semibold text-white hover:opacity-90">확인</button>
        </div>
      </div>
    </div>
  );
}
