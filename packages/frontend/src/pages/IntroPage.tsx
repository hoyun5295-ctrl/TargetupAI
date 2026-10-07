/**
 * IntroPage — 공개 소개 페이지 /intro (★2026-10-07 Harold · 목업 2안 승인)
 *
 * 공개 릴스 영상(인스타에 이미 공개) + 기능 12가지의 이름 · 한 줄(영상 속 문장과 같다) + 시연 요청.
 * 자세한 기능(화면 · 설정 · 작동 순서)은 싣지 않는다. 그건 hoyun 전용 /about 으로 미팅 때만 보여 준다.
 * 영상은 정보 입력 없이 바로 재생한다(Harold 「시청하려면 정보 넣으세요 하지 말라」).
 * 방문은 서버가 IP · 브라우저 · 들어온 곳을 남긴다(POST /api/public/intro/view · 탭당 1번).
 * 시연 요청은 슈퍼관리자 「소개 방문 · 시연 요청」(ceo · suran)에만 쌓인다.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';

const ACCENT = '#EA5A1F';

const FEATURE_GROUPS: { label: string; items: [string, string][] }[] = [
  { label: '자동화', items: [
    ['여정 설계', '가입부터 첫 구매까지, 고객마다 자동으로'],
    ['자동 마케팅', '조건에 맞는 고객에게 매일 알아서'],
    ['마케팅 플래너', '달력에 행사만 담으면 발송까지'],
  ] },
  { label: '발송 채널', items: [
    ['모바일 DM', '한 줄로 카드형 DM, 열람까지 추적'],
    ['이메일 마케팅', 'AI 비주얼 이메일, 오픈 · 클릭 확인'],
    ['인앱 메시지', '자사몰에 들어온 그 순간에'],
  ] },
  { label: '제작 도구', items: [
    ['만들기', '재료만 넣으면 DM · 이메일 완성'],
    ['이미지 스튜디오', '템플릿 고르고 문구만 쓰면 포스터'],
    ['SNS 채널', '사진 한 장으로 채널별 글과 예약'],
  ] },
  { label: '고객 이해 · 분석', items: [
    ['자사몰 연동', '카페24 · 네이버 자동 연동'],
    ['성과 리포트', '30일 성과와 다음 할 일'],
    ['AI 메모리', '쓸수록 우리 회사를 더 잘 알게'],
  ] },
];

const STEPS: [string, string][] = [
  ['시연 요청', '회사명과 연락처만 남겨 주세요'],
  ['담당자 시연', '우리 회사 업종에 맞춰 직접 보여 드립니다'],
  ['7일 무료 체험', '35만원 요금제 기능을 그대로 써 봅니다'],
];

const VIEW_SENT_KEY = 'intro_view_sent';

function DemoRequestModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ companyName: '', contactName: '', phone: '', method: 'visit', memo: '' });
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) onCloseRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setError('');
  };

  const submit = async () => {
    if (!form.companyName.trim()) return setError('회사명을 입력해 주세요.');
    if (!form.contactName.trim()) return setError('담당자 이름을 입력해 주세요.');
    if (!/^0\d{8,10}$/.test(form.phone.replace(/[^0-9]/g, ''))) return setError('연락받으실 휴대폰 번호를 확인해 주세요.');
    if (!consent) return setError('개인정보 수집 · 이용에 동의해 주셔야 요청을 받을 수 있습니다.');
    setSending(true);
    try {
      const r = await fetch('/api/public/intro/demo-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, consent, website }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d?.success !== true) { setError(d?.error || '요청을 받지 못했습니다. 잠시 후 다시 시도해 주세요.'); return; }
      setDone(true);
    } catch {
      setError('요청을 받지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setSending(false);
    }
  };

  const input = 'w-full h-11 px-3 rounded-lg border border-gray-300 text-[15px] focus:outline-none focus:ring-2 focus:ring-gray-900/20 focus:border-gray-900';
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="시연 요청">
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[92vh] overflow-y-auto shadow-xl">
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <h2 className="text-lg font-bold text-gray-900">시연 요청</h2>
          <button type="button" onClick={onClose} aria-label="닫기" className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>
        {done ? (
          <div className="px-6 pb-6">
            <p className="text-[15px] text-gray-800 leading-relaxed">요청을 받았습니다. 담당자가 남겨 주신 번호로 연락드려 시연 일정을 잡겠습니다.</p>
            <button type="button" onClick={onClose} className="mt-5 w-full h-11 rounded-lg bg-gray-900 text-white font-semibold">닫기</button>
          </div>
        ) : (
          <div className="px-6 pb-6 space-y-3">
            <input type="text" value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true"
              className="absolute -left-[9999px] w-px h-px opacity-0" />
            <div className="grid grid-cols-2 gap-2">
              <input className={input} placeholder="회사명" value={form.companyName} onChange={set('companyName')} maxLength={60} />
              <input className={input} placeholder="담당자 이름" value={form.contactName} onChange={set('contactName')} maxLength={30} />
            </div>
            <input className={input} placeholder="휴대폰 번호" inputMode="numeric" value={form.phone} onChange={set('phone')} maxLength={13} />
            <select className={input} value={form.method} onChange={set('method')}>
              <option value="visit">방문 시연</option>
              <option value="video">화상 시연</option>
            </select>
            <textarea className={`${input} h-20 py-2 resize-none`} placeholder="궁금한 점(선택)" value={form.memo} onChange={set('memo')} maxLength={500} />
            <div className="rounded-lg bg-gray-50 px-3 py-2.5 text-xs text-gray-600 leading-relaxed">
              수집 항목: 회사명 · 이름 · 휴대폰 번호 · 접속 IP<br />
              목적: 시연 일정 연락 · 상담<br />
              보관: 요청일로부터 1년 뒤 파기 · 동의하지 않으시면 요청을 받을 수 없습니다
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-800 cursor-pointer">
              <input type="checkbox" checked={consent} onChange={(e) => { setConsent(e.target.checked); setError(''); }} className="w-4 h-4" />
              개인정보 수집 · 이용에 동의합니다(필수)
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button type="button" onClick={submit} disabled={sending}
              className="w-full h-11 rounded-lg bg-gray-900 text-white font-semibold disabled:opacity-60">
              {sending ? '보내는 중...' : '요청 보내기'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function IntroPage() {
  const [demoOpen, setDemoOpen] = useState(false);

  useEffect(() => {
    document.title = '한줄로 · 모든 마케팅을 한 곳에';
    try {
      if (sessionStorage.getItem(VIEW_SENT_KEY)) return;
      sessionStorage.setItem(VIEW_SENT_KEY, '1');
    } catch { /* 저장소가 막혀도 기록은 보낸다 */ }
    fetch('/api/public/intro/view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ referrer: document.referrer || '' }),
      keepalive: true,
    }).catch(() => {});
  }, []);

  const cta = (
    <button type="button" onClick={() => setDemoOpen(true)}
      className="inline-flex items-center h-12 px-6 rounded-full bg-gray-900 text-white font-semibold hover:bg-gray-800 transition">
      시연 요청
    </button>
  );

  return (
    <div className="min-h-screen bg-[#FAFAF8] text-gray-900">
      <header className="sticky top-0 z-30 bg-[#FAFAF8]/90 backdrop-blur border-b border-gray-200/70">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <span className="text-xl font-black tracking-tight">한줄로<span style={{ color: ACCENT }}> ___</span></span>
          <div className="flex items-center gap-2">
            <Link to="/login" className="h-9 px-4 inline-flex items-center rounded-full text-sm font-medium text-gray-700 hover:bg-gray-100">로그인</Link>
            <button type="button" onClick={() => setDemoOpen(true)} className="h-9 px-4 rounded-full text-sm font-semibold bg-gray-900 text-white hover:bg-gray-800">시연 요청</button>
          </div>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20 grid md:grid-cols-[minmax(0,1fr)_320px] gap-10 md:gap-16 items-center">
        <div className="min-w-0">
          <p className="text-sm sm:text-base text-gray-500 mb-4">문자 · 이메일 · DM · 인스타 · 스레드 · 팝업</p>
          <h1 className="text-4xl sm:text-5xl font-black leading-[1.2] tracking-tight" style={{ textWrap: 'balance' } as any}>
            혼자 다 하세요?<br />한줄로 <span style={{ color: ACCENT }}>한 곳에서, 한 번에</span>
          </h1>
          <p className="mt-6 text-base sm:text-lg text-gray-600 leading-relaxed max-w-xl">
            고객을 고르고, 문구와 이미지를 만들고, 보내고, 결과를 보는 일까지. AI가 마케팅 담당자 한 사람의 일을 함께합니다.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">{cta}</div>
          <p className="mt-3 text-sm text-gray-500">시연 뒤 35만원 요금제 기능 7일 무료 체험</p>
        </div>
        <div className="mx-auto w-full max-w-[320px]">
          <video src="/intro-media/hanjul-allinone.mp4" poster="/intro-media/hanjul-allinone-poster.jpg" controls playsInline preload="metadata"
            controlsList="nodownload noplaybackrate" disablePictureInPicture onContextMenu={(e) => e.preventDefault()}
            className="w-full aspect-[9/16] rounded-3xl bg-white border border-gray-200 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.25)]" />
        </div>
      </section>

      <section className="border-t border-gray-200/70 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight">한줄로 안에 다 있어요</h2>
          <p className="mt-2 text-gray-500">마케팅에 필요한 12가지를 한 화면에서</p>
          <div className="mt-10 space-y-10">
            {FEATURE_GROUPS.map((g) => (
              <div key={g.label}>
                <span className="inline-block text-xs font-semibold px-2.5 py-1 rounded-full bg-gray-900 text-white">{g.label}</span>
                <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {g.items.map(([name, line]) => (
                    <div key={name} className="rounded-2xl bg-[#FAFAF8] border border-gray-200/70 px-5 py-5">
                      <p className="text-lg font-bold">{name}</p>
                      <p className="mt-1 text-sm text-gray-600 leading-relaxed">{line}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-gray-200/70">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight">이렇게 시작합니다</h2>
          <div className="mt-10 grid sm:grid-cols-3 gap-6">
            {STEPS.map(([title, line], i) => (
              <div key={title}>
                <p className="text-sm font-bold tabular-nums" style={{ color: ACCENT }}>{String(i + 1).padStart(2, '0')}</p>
                <p className="mt-2 text-lg font-bold">{title}</p>
                <p className="mt-1 text-sm text-gray-600 leading-relaxed">{line}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-gray-200/70 bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-20 text-center">
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight" style={{ textWrap: 'balance' } as any}>자세한 기능은 시연에서 보여 드립니다</h2>
          <p className="mt-3 text-gray-600 leading-relaxed">뷰티 · 의류 · 요식업 · 커머스 브랜드를 위해 만들었습니다.<br />현재 많은 업체들이 이용 중에 있습니다.</p>
          <div className="mt-8">{cta}</div>
          <p className="mt-5 text-xs text-gray-500">무료 체험 중 문자 · 알림톡 발송비는 별도입니다 · 체험은 시연 뒤 담당자가 열어 드립니다</p>
        </div>
      </section>

      <footer className="border-t border-gray-200/70">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
          <span>한줄로 · 인비토</span>
          <span>이 페이지의 방문 기록(IP 등)은 서비스 보안을 위해 보관합니다.</span>
        </div>
      </footer>

      {demoOpen && <DemoRequestModal onClose={() => setDemoOpen(false)} />}
    </div>
  );
}
