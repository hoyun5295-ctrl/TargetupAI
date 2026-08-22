/**
 * AgencySendIntroModal — 대행발송 안내 모달 (★ 2026-08-22 신설)
 *
 * 설계 = docs/2026-08-22-agency-send-design.md §4-8. 호출부 = 헤더 "대행발송" 클릭 · `/agency-send` 직접 진입.
 *
 * 왜 있는가: 대행발송 메뉴는 **모든 회사에 보인다**(Harold 2026-08-22 "대행발송을 미끼로 한다").
 *   들어갈 수 있는 회사만 화면으로 가고, 나머지는 무엇을 해 주는 서비스인지 보고 요금제로 넘어간다.
 *
 * 두 갈래는 요금제 가입 여부로만 가른다(새 판정을 만들지 않는다):
 *   미가입 = "요금제 가입하러 가기" · 유료인데 아직 안 열린 회사 = "이용 요청 남기기".
 *
 * 톤 = 인디고 콘솔(`CUI_*`). 껍데기 = ConsoleDialog(Harold 확정 §8-4).
 * ⛔ 요금제 이름·가격·"무료" 같은 혜택 단어 0(어느 요금제부터 열리는지는 요금제 안내가 말한다).
 * ⛔ 문구에 줄표 0(Harold 2026-08-22 "앞으로 만드는 모든 모달이나 모든 컨텐츠에서 뺀다").
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileSpreadsheet, Loader2, MailCheck, Send, ShieldCheck } from 'lucide-react';
import ConsoleDialog, { CONSOLE_ACCENT, CONSOLE_BTN_BASE } from '../console/ConsoleDialog';
import { CUI_BTN_OUTLINE, CUI_MODAL_BODY, CUI_MODAL_FOOT } from '../../utils/console-ui';

interface Props {
  show: boolean;
  /** 요금제를 쓰는 회사인가. false = 미가입(가입 안내) · true = 이용 요청 안내 */
  isPaidPlan: boolean;
  onClose: () => void;
}

/** 단계 카드 3장. 문구는 이 표 한 곳이 소유한다(설계서 §4-8과 같은 내용) */
const STEPS = [
  {
    icon: FileSpreadsheet,
    title: '접수',
    lines: [
      '수신 명단 파일과 문안, 보낼 시각, 테스트 받을 담당자 번호를 적습니다.',
      '이름 같은 항목은 문안에 자동으로 들어갑니다.',
    ],
  },
  {
    icon: ShieldCheck,
    title: '검사와 다듬기',
    lines: [
      '통신사 스팸필터 테스트를 거칩니다. 걸리면 핵심 내용은 그대로 두고 문안을 다듬어 다시 검사합니다.',
      '통과한 문안은 담당자 휴대폰으로 먼저 보내 드립니다.',
    ],
  },
  {
    icon: MailCheck,
    title: '승인과 예약',
    lines: [
      '받은 문자를 확인하고 승인하면 요청한 시각에 예약됩니다.',
      '발송 2시간 전에 한 번 더 검사하고, 걸리면 다시 다듬어 승인을 받은 뒤에만 나갑니다.',
    ],
  },
] as const;

export default function AgencySendIntroModal({ show, isPaidPlan, onClose }: Props) {
  const navigate = useNavigate();
  const [asking, setAsking] = useState(false);
  const [asked, setAsked] = useState(false);

  // 유료인데 아직 안 열린 회사의 "이용 요청". 기존 문의 원장에 남긴다(슈퍼관리자가 현황에서 본다).
  const requestAccess = async () => {
    if (asking || asked) return;
    setAsking(true);
    try {
      await fetch('/api/help/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        body: JSON.stringify({ question: '대행발송 이용을 요청합니다.', path: '/agency-send' }),
      });
      setAsked(true);
    } catch {
      setAsked(true); // 기록 실패를 사용자에게 되묻지 않는다. 담당자 연락 경로가 따로 있다
    } finally {
      setAsking(false);
    }
  };

  return (
    <ConsoleDialog
      show={show}
      accent="indigo"
      icon={<Send className="w-4 h-4" strokeWidth={2} />}
      title="대행발송"
      subtitle="양식만 채우면, 나머지는 한줄로가 합니다"
      maxW="max-w-[480px]"
      onClose={onClose}
      footer={
        <div className={CUI_MODAL_FOOT}>
          <button type="button" onClick={onClose} className={CUI_BTN_OUTLINE}>닫기</button>
          {isPaidPlan ? (
            <button
              type="button"
              onClick={requestAccess}
              disabled={asking || asked}
              className={`${CONSOLE_BTN_BASE} ${CONSOLE_ACCENT.indigo.primary}`}
            >
              {asking && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {asked ? '요청을 남겼습니다' : '이용 요청 남기기'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => { onClose(); navigate('/pricing'); }}
              className={`${CONSOLE_BTN_BASE} ${CONSOLE_ACCENT.indigo.primary}`}
            >
              요금제 가입하러 가기
            </button>
          )}
        </div>
      }
    >
      <div className={CUI_MODAL_BODY}>
        <div className="space-y-3">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            return (
              <div key={s.title} className="flex gap-3 rounded-xl border border-neutral-200 bg-white p-3.5">
                <div className="h-8 w-8 shrink-0 rounded-lg bg-indigo-50 text-indigo-600 grid place-items-center">
                  <Icon className="w-4 h-4" strokeWidth={2} />
                </div>
                <div className="min-w-0">
                  <p className="text-[13.5px] font-semibold text-neutral-900">
                    <span className="text-indigo-600 tabular-nums mr-1.5">{i + 1}</span>
                    {s.title}
                  </p>
                  {s.lines.map((line) => (
                    <p key={line} className="mt-1 text-[12.5px] text-neutral-600 leading-relaxed">{line}</p>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[12.5px] text-neutral-500 leading-relaxed px-0.5">
          {isPaidPlan
            ? '요금제를 쓰고 계시네요. 담당자에게 알려 주시면 바로 열어 드립니다.'
            : '요금제를 사용하는 회사에서 열립니다.'}
        </p>
      </div>
    </ConsoleDialog>
  );
}
