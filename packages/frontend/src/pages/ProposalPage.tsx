/**
 * ProposalPage — 메일로 받은 제안 페이지(/proposal) · 제작 대행 체험 (★ 2026-11-16 C136 배포 나 · 설계서 docs/2026-11-16-c136-proposal-kit-trial-design.md §3 ~ §6)
 *
 * Harold 「팀장급에게 먹히는 체험 · 로그인 → 서비스 소개와 체험 신청 → 사진 3 ~ 4장을 받아 완성본을 만들어 돌려준다 → 담당자는 명단만 올려 평소 직접발송으로 ·
 *   의미없이 전부 공개로 해놓으면 서비스 내용만 가져가서 복제」.
 *   - 로그인 전 = 한 줄과 로그인 단추 · 「서비스 이용신청 문의」 길만. 소개 글 · 그림은 이 화면 코드에 없다(로그인 뒤 서버가 준다).
 *   - 로그인 뒤 = 서버가 정한 상태 넷: 신청 전(소개 + 신청 폼) · 만드는 중 · 완성본 · 같은 회사의 다른 사람이 신청함.
 *   - 화면의 모양(CSS)도 서버가 준다. 이 파일에는 class 이름과 폼 · 진행 · 완성본의 글만 있다.
 *   - 「명단만 올려 보내기」 = 고른 번호만 넘기고 직접발송 작성 화면으로 간다(내용은 그 화면이 서버에서 다시 받는다 · utils/proposal-kit).
 * ⛔ 이 화면은 발송하지 않는다 · 기본 대화상자(alert · confirm)를 쓰지 않는다.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { isAgentOnlyCompany, useAuthStore } from '../stores/authStore';
import { resolveGated, type ResolvedGated } from '../utils/gated-content';
import { rememberExplicitLoginReturn } from '../utils/login-return';
import { MSG_TYPE_LABEL } from '../utils/campaign-axis';
import {
  cleanProposalSrc, fetchProposal, reportProposalView, stashProposalPick, submitProposal,
  type ProposalChannel, type ProposalView,
} from '../utils/proposal-kit';

const PHOTO_MIN = 3;
const PHOTO_MAX = 4;
const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const BRIEF_MAX = 120;
const EXTRA_MAX = 200;

const Arrow = () => <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
const Check = () => <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
const Plus = () => <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;
const Cross = () => <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>;
const bg = (url: string) => ({ backgroundImage: `url("${url.replace(/["\\\n\r]/g, '')}")` });

export default function ProposalPage() {
  const { isAuthenticated, user } = useAuthStore();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const src = cleanProposalSrc(params.get('src'));

  // 슈퍼관리자 · 에이전트 전용 회사 = 이 화면의 대상이 아니다(서버도 같은 판정으로 막는다)
  const blockedTo = !isAuthenticated ? null : user?.userType === 'super_admin' ? '/admin' : isAgentOnlyCompany(user) ? '/kakao-rcs' : null;
  useEffect(() => { if (blockedTo) navigate(blockedTo, { replace: true }); }, [blockedTo, navigate]);

  if (!isAuthenticated) return <Gate src={src} />;
  if (blockedTo) return null;
  return <Inside src={src} userId={user?.id || ''} companyId={user?.company?.id || ''} />;
}

/** 로그인 전 — 한 줄과 로그인 단추만(소개 글 · 그림 0) */
function Gate({ src }: { src: string | null }) {
  const navigate = useNavigate();
  useEffect(() => { reportProposalView(src); }, [src]);
  const login = () => {
    rememberExplicitLoginReturn(`/proposal${src ? `?src=${src}` : ''}`);
    navigate('/login');
  };
  return (
    <main className="min-h-screen bg-white text-[#0B0B0C] grid place-items-center px-5 py-10">
      <div className="w-full max-w-[460px] text-center">
        <div className="text-[26px] font-black tracking-[-0.04em]">한줄로</div>
        <h1 className="mt-7 text-[22px] sm:text-[28px] font-extrabold leading-[1.4] tracking-[-0.035em] break-keep">
          로그인하시면 서비스 소개와<br />체험 신청이 가능합니다
        </h1>
        <button
          type="button"
          onClick={login}
          className="mt-8 w-full h-[58px] rounded-[14px] bg-[#CF4510] hover:bg-[#B53C0D] text-white text-[17px] font-extrabold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B0B0C]"
        >
          로그인
        </button>
        <p className="mt-5 text-[14.5px] text-[#5F6368]">
          계정이 없으시면{' '}
          <Link to="/login?inquiry=1" className="font-bold text-[#0B0B0C] underline underline-offset-[3px]">서비스 이용신청 문의</Link>
        </p>
      </div>
    </main>
  );
}

type Loaded = { view: ProposalView; text: ResolvedGated; phone: string };

function Inside({ src, userId, companyId }: { src: string | null; userId: string; companyId: string }) {
  const navigate = useNavigate();
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [turn, setTurn] = useState(0);
  const introRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    let made: ResolvedGated | null = null;
    setFailed(false);
    void (async () => {
      const got = await fetchProposal(src);
      if (!alive) return;
      if (!got.ok) {
        if (got.status === 403) navigate('/dashboard', { replace: true });
        else setFailed(true);
        return;
      }
      const { view, content, phone } = got.data;
      // 소개 글이 없는 상태(만드는 중 · 완성본)는 소개 그림을 받지 않는다
      const css = content.html ? content.css : content.css.replace(/url\(gated:[^)]+\)/g, 'none');
      const text = await resolveGated({ css, html: content.html });
      if (!alive) { text?.release(); return; }
      if (!text) { setFailed(true); return; }
      made = text;
      setData({ view, text, phone });
    })();
    return () => { alive = false; made?.release(); };
  }, [src, turn, navigate]);

  // 소개 구역의 나타나는 움직임(보이는 자리에 오면 한 번)
  const html = data?.text.html || '';
  const intro = useMemo(() => ({ __html: html }), [html]);
  useEffect(() => {
    const root = introRef.current;
    if (!root || !html) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>('.rv'));
    if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
    const io = new IntersectionObserver((list) => {
      list.forEach((x) => { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); } });
    }, { threshold: 0.15 });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [html]);

  const reload = useCallback(() => { setData(null); setTurn((n) => n + 1); }, []);

  if (failed) {
    return (
      <main className="min-h-screen bg-white text-[#0B0B0C] grid place-items-center px-5">
        <div className="text-center">
          <p className="text-[17px] font-bold">화면을 불러오지 못했어요</p>
          <button type="button" onClick={reload} className="mt-5 h-11 px-5 rounded-xl bg-[#0B0B0C] text-white text-[15px] font-bold">다시 불러오기</button>
        </div>
      </main>
    );
  }
  if (!data) {
    return <main className="min-h-screen bg-white grid place-items-center" aria-busy="true"><p className="text-[15px] text-[#5F6368]">불러오는 중입니다</p></main>;
  }

  const { view } = data;
  const head = (
    <header className="w">
      <nav className="pnav"><div className="logo">한줄로</div><div className="sp" /><Link className="btn ln sm" to="/dashboard">대시보드로</Link></nav>
    </header>
  );
  return (
    <div className="ppg">
      <style>{data.text.css}</style>
      {view.state === 'none' && (
        <>
          <div ref={introRef} dangerouslySetInnerHTML={intro} />
          <ApplyForm src={src} phone={data.phone} onDone={reload} />
          <footer><div className="w">한줄로 AI 비즈메세징 플랫폼</div></footer>
        </>
      )}
      {view.state === 'working' && (
        <>
          {head}
          <main className="w"><div className="wait">
            <p className="lbl">제작 대행 체험</p>
            <h2 className="h2">완성본을 만들고 있습니다</h2>
            <p style={{ marginTop: 18, fontSize: 17.5, lineHeight: 1.7, color: 'var(--sub)' }}>
              준비되면 {view.notifyPhone || '적어 주신'} 번호로 문자를 보내 드립니다.<br />이 화면을 닫으셔도 됩니다.
            </p>
            <div className="rail"><div className="dn">신청 완료</div><div className="nw">제작 중</div><div>담당자 확인</div><div>도착</div></div>
            <div className="box">
              {view.photos[0] && <div className="im" style={bg(view.photos[0])} role="img" aria-label="올려 주신 사진" />}
              <div><b>사진 {view.photos.length}장과 함께 보내 주신 한 줄</b><span>{view.brief}</span></div>
            </div>
          </div></main>
        </>
      )}
      {view.state === 'other' && (
        <>
          {head}
          <main className="w"><div className="wait">
            <p className="lbl">제작 대행 체험</p>
            <h2 className="h2">이미 신청한 회사입니다</h2>
            <p style={{ marginTop: 18, fontSize: 17.5, lineHeight: 1.7, color: 'var(--sub)' }}>
              같은 회사의 다른 분이 체험을 신청하셨습니다.<br />신청하신 분이나 회사 관리자 계정으로 확인해 주세요.
            </p>
          </div></main>
        </>
      )}
      {view.state === 'ready' && (
        <>
          {head}
          <Kit view={view} userId={userId} companyId={companyId} />
        </>
      )}
    </div>
  );
}

/** 신청 폼 — 사진 3 ~ 4장 · 한 줄 · 보낼 방식 · 더 필요한 것 · 알림 받을 번호 */
function ApplyForm({ src, phone, onDone }: { src: string | null; phone: string; onDone: () => void }) {
  const [photos, setPhotos] = useState<Array<{ file: File; url: string }>>([]);
  const [brief, setBrief] = useState('');
  const [channel, setChannel] = useState<ProposalChannel>('MMS');
  const [extra, setExtra] = useState('');
  const [tel, setTel] = useState(phone);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const photosRef = useRef(photos);
  photosRef.current = photos;
  useEffect(() => () => { photosRef.current.forEach((p) => URL.revokeObjectURL(p.url)); }, []);

  const addFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    if (picked.length === 0) return;
    const ok = picked.filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type) && f.size <= PHOTO_MAX_BYTES);
    const room = PHOTO_MAX - photos.length;
    if (ok.length < picked.length) setError('JPG, PNG, WEBP 사진만 올릴 수 있어요. 한 장은 10MB 까지입니다.');
    else if (ok.length > room) setError(`사진은 ${PHOTO_MAX}장까지 올릴 수 있어요.`);
    else setError('');
    setPhotos((prev) => [...prev, ...ok.slice(0, Math.max(0, room)).map((file) => ({ file, url: URL.createObjectURL(file) }))]);
  };
  const removeAt = (i: number) => setPhotos((prev) => { URL.revokeObjectURL(prev[i].url); return prev.filter((_, x) => x !== i); });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (photos.length < PHOTO_MIN) { setError(`사진을 ${PHOTO_MIN} ~ ${PHOTO_MAX}장 올려 주세요.`); return; }
    if (!brief.trim()) { setError('무엇을 알릴지 한 줄로 적어 주세요.'); return; }
    if (!/^01[016789]\d{7,8}$/.test(tel.replace(/\D/g, ''))) { setError('완성본 알림을 받을 휴대폰 번호를 확인해 주세요.'); return; }
    setBusy(true);
    setError('');
    const out = await submitProposal({ photos: photos.map((p) => p.file), brief: brief.trim(), channel, extra: extra.trim(), notifyPhone: tel.replace(/\D/g, ''), src });
    setBusy(false);
    if (out.ok || out.code === 'PROPOSAL_ALREADY_REQUESTED') { onDone(); return; }   // 이미 신청한 회사 = 진행 상태 화면으로
    setError(out.error);
  };

  return (
    <section className="sec sf" id="apply"><div className="w ap">
      <div className="side">
        <p className="lbl">체험 신청</p>
        <h2 className="h2">사진과 한 줄이면<br />신청이 끝납니다</h2>
        <p>준비되면 문자로 알려 드립니다. 완성본은 이 화면에서 바로 확인하실 수 있습니다.</p>
        <ul>
          <li><Check />회사당 한 번, 제작 비용은 없습니다</li>
          <li><Check />발송 요금은 평소와 같습니다</li>
          <li><Check />보내지 않으셔도 괜찮습니다</li>
        </ul>
      </div>
      <form className="form" onSubmit={submit} noValidate>
        <span className="fl" id="ppg-photos">사진<small>{PHOTO_MIN}~{PHOTO_MAX}장</small></span>
        <div className="ph4" role="group" aria-labelledby="ppg-photos">
          {photos.map((p, i) => (
            <div className="sl" key={p.url}>
              <div className="im" style={bg(p.url)} role="img" aria-label={`올린 사진 ${i + 1}`} />
              <button type="button" className="x" onClick={() => removeAt(i)} aria-label={`사진 ${i + 1} 빼기`}><Cross /></button>
            </div>
          ))}
          {photos.length < PHOTO_MAX && (
            <button type="button" className="sl add" onClick={() => fileRef.current?.click()} aria-label="사진 추가"><Plus /></button>
          )}
          {Array.from({ length: Math.max(0, PHOTO_MAX - photos.length - 1) }, (_, i) => <div className="sl" key={`empty-${i}`} aria-hidden="true" />)}
        </div>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={addFiles} />
        <p className="hint">알릴 상품이나 매장 사진을 올려 주세요. JPG, PNG, WEBP</p>
        <div className="fg2">
          <label className="fl" htmlFor="ppg-brief">무엇을 알릴까요</label>
          <input id="ppg-brief" className="inp" value={brief} maxLength={BRIEF_MAX} onChange={(e) => setBrief(e.target.value)} placeholder="예) 겨울 신상 니트 입고, 이번 주 일요일까지 회원 감사 주간" />
        </div>
        <div className="fg2">
          <span className="fl" id="ppg-channel">보낼 방식</span>
          <div className="seg" role="group" aria-labelledby="ppg-channel">
            <button type="button" className={channel === 'LMS' ? 'on' : ''} aria-pressed={channel === 'LMS'} onClick={() => setChannel('LMS')}>{MSG_TYPE_LABEL.LMS}<small>글만 보냅니다</small></button>
            <button type="button" className={channel === 'MMS' ? 'on' : ''} aria-pressed={channel === 'MMS'} onClick={() => setChannel('MMS')}>{MSG_TYPE_LABEL.MMS}<small>포스터를 붙입니다</small></button>
          </div>
        </div>
        <div className="fg2">
          <label className="fl" htmlFor="ppg-extra">더 필요한 것<small>선택</small></label>
          <input id="ppg-extra" className="inp" value={extra} maxLength={EXTRA_MAX} onChange={(e) => setExtra(e.target.value)} placeholder="예) 이메일도 필요해요" />
        </div>
        <div className="fg2">
          <label className="fl" htmlFor="ppg-tel">완성본 알림을 받을 휴대폰 번호</label>
          <input id="ppg-tel" className="inp" value={tel} inputMode="numeric" maxLength={13} onChange={(e) => setTel(e.target.value.replace(/[^\d-]/g, ''))} placeholder="010-0000-0000" />
        </div>
        {error && <p role="alert" style={{ marginTop: 16, fontSize: 14.5, fontWeight: 700, color: 'var(--acc-t)' }}>{error}</p>}
        <button className="btn or" type="submit" disabled={busy} aria-busy={busy} style={busy ? { opacity: 0.6, cursor: 'default' } : undefined}>
          {busy ? '신청하는 중입니다' : <>체험 신청하기 <Arrow /></>}
        </button>
        <p className="fine">신청하시면 올려 주신 사진과 문구로 제작을 시작합니다.</p>
      </form>
    </div></section>
  );
}

const SPAM_TEXT: Record<string, string> = { pass: '통신사 스팸 검사 통과', blocked: '통신사 검사에서 막힌 문안', none: '', unknown: '' };

/** 완성본 — 포스터와 문안을 고르고 「명단만 올려 보내기」 */
function Kit({ view, userId, companyId }: { view: Extract<ProposalView, { state: 'ready' }>; userId: string; companyId: string }) {
  const navigate = useNavigate();
  const [poster, setPoster] = useState(0);
  const [copy, setCopy] = useState(() => Math.max(0, view.copies.findIndex((c) => c.spam === 'pass')));
  const [withPoster, setWithPoster] = useState(view.channel === 'MMS' && view.posters.length > 0);
  const [error, setError] = useState('');
  const picked = view.copies[copy];

  const go = (withDm: boolean) => {
    const ok = stashProposalPick({ userId, companyId, poster: !withDm && withPoster ? poster : null, copy, withDm });
    if (!ok) { setError('이 브라우저에서는 넘길 수 없어요. 문안을 복사해 직접발송 화면에 붙여 넣어 주세요.'); return; }
    navigate('/dashboard?open=direct-send');
  };

  return (
    <main className="w kit">
      <p className="lbl">완성본</p>
      <h2 className="h2">보낼 준비가 <em>끝났습니다</em></h2>
      <p style={{ marginTop: 16, fontSize: 18, lineHeight: 1.66, color: 'var(--sub)' }}>포스터와 문안을 하나씩 고르고, 명단만 올리면 됩니다.</p>
      <div className="kg3">
        <section>
          <div className="kh">포스터 고르기<small>{view.posters.length}장</small></div>
          <div className="pos">
            {view.posters[poster] && <div className="im big" style={bg(view.posters[poster].url)} role="img" aria-label={`고른 포스터 ${poster + 1}`} />}
            {view.posters.map((p, i) => (
              <button type="button" key={p.url} className={i === poster ? 'on' : ''} aria-pressed={i === poster} aria-label={`포스터 ${i + 1} 고르기`} onClick={() => setPoster(i)}>
                <div className="im" style={bg(p.url)} />
              </button>
            ))}
          </div>
        </section>
        <section>
          <div className="kh">문안 고르기<small>{view.copies.length}개</small></div>
          <div className="cps">
            {view.copies.map((c, i) => (
              <button type="button" key={i} className={i === copy ? 'on' : ''} aria-pressed={i === copy} onClick={() => setCopy(i)}>
                <div className="tp">문안 {i + 1}{SPAM_TEXT[c.spam] && <span className="pass">{c.spam === 'pass' && <Check />}{SPAM_TEXT[c.spam]}</span>}</div>
                <p>{c.text}</p>
              </button>
            ))}
          </div>
        </section>
        <aside className="go">
          <div className="phone"><div className="nt" /><div className="scr">
            <div className="bar0"><b>미리보기</b>문자 메시지</div>
            <div className="th"><div className="bub">
              {withPoster && view.posters[poster] && <div className="im" style={bg(view.posters[poster].url)} />}
              <p style={{ whiteSpace: 'pre-line' }}>{picked?.text}</p>
            </div></div>
          </div></div>
          <div>
            {view.posters.length > 0 && (
              <div className="seg" role="group" aria-label="보낼 방식" style={{ marginTop: 22 }}>
                <button type="button" className={!withPoster ? 'on' : ''} aria-pressed={!withPoster} onClick={() => setWithPoster(false)}>{MSG_TYPE_LABEL.LMS}<small>글만 보냅니다</small></button>
                <button type="button" className={withPoster ? 'on' : ''} aria-pressed={withPoster} onClick={() => setWithPoster(true)}>{MSG_TYPE_LABEL.MMS}<small>포스터를 붙입니다</small></button>
              </div>
            )}
            <button type="button" className="btn or" onClick={() => go(false)} disabled={!picked}>명단만 올려 보내기 <Arrow /></button>
            <p className="ex">평소 쓰시던 발송 화면이 이 문안과 포스터가 채워진 채 열립니다. 보내기 전에 얼마든지 고치실 수 있습니다.</p>
            {error && <p role="alert" className="ex" style={{ fontWeight: 700, color: 'var(--acc-t)' }}>{error}</p>}
          </div>
        </aside>
      </div>
      {view.dmUrl && (
        <div className="dmc">
          <div className="dmp" aria-hidden="true">{view.posters[0] && <div className="im" style={bg(view.posters[0].url)} />}<i /><i /><u /></div>
          <div>
            <p className="lbl">모바일 DM</p>
            <h3>링크를 누르면 열리는<br />행사 페이지도 만들었습니다</h3>
            <p>문자에 주소 한 줄이 함께 들어갑니다. 받는 분이 누르면 사진과 행사 내용이 한 화면에 펼쳐집니다.</p>
            <div className="cta">
              <button type="button" className="btn ik sm" onClick={() => go(true)} disabled={!picked}>모바일 DM으로 보내기</button>
              <a className="btn ln sm" href={view.dmUrl} target="_blank" rel="noopener noreferrer">열어 보기</a>
            </div>
          </div>
        </div>
      )}
      <p className="more">이런 제작을 매달 맡기고 싶으시면 <Link to="/pricing">요금제 보기</Link></p>
    </main>
  );
}
