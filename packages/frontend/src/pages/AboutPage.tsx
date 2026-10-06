/**
 * AboutPage — 한줄로 공개 소개 페이지 `/about` (★ 2026-10-07 대개편 · 승인 목업 3안 · 설계서 docs/2026-10-07-about-page-redesign-design.md)
 *
 * 로그인 없이 열린다. 옛 주소 `/about-ai-operator.html` 은 여기로 넘기는 안내 파일이다(바깥에 낸 주소 유지).
 * 기능 문장 · 영상은 앱 기능 안내 창과 같은 원장(`constants/plan-feature-intros.ts`)을 읽는다 — 이 파일에 기능 문장을 쓰지 않는다.
 * 묶음 · 순서 · 첫 화면 · 「지키는 것」은 `constants/about-page.ts`.
 *
 * ⛔ 지킬 것(계약 = backend/src/utils/__tests__/about-page-1007.test.ts)
 *   - 영상은 동시에 하나만 돈다: 첫 화면 가운데 한 편(보일 때만) · 상세 창 한 편. 카드는 정지 그림이다(Harold 1007 「동시에 나오면 정신없다」).
 *   - 「발송 승인은 언제나 사람이 합니다」는 이 페이지의 뼈대다. 빼지 않는다.
 *   - 줄표 · 모델명 · 크레딧 숫자 0 · native dialog 0 · 상세 창은 배경을 눌러도 닫히지 않는다(Esc · 닫기 단추).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PLAN_FEATURE_INTROS, PLAN_FEATURE_MIN_PLAN, type PlanFeatureIntro } from '../constants/plan-feature-intros';
import { ABOUT_CONTACT_PATH, ABOUT_GROUPS, ABOUT_GUARDS, ABOUT_HERO, ABOUT_SLOT_IDS } from '../constants/about-page';
import './about-page.css';

const SLOT_MS = 2200;

function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const on = () => setReduce(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduce;
}

export default function AboutPage() {
  const byId = useMemo(() => new Map(PLAN_FEATURE_INTROS.map((f) => [f.id, f])), []);
  const feature = (id: string): PlanFeatureIntro | undefined => byId.get(id);
  const reduce = useReducedMotion();
  const [slot, setSlot] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const heroVideo = useRef<HTMLVideoElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const sheetVideo = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const prev = document.title;
    document.title = '한줄로 · AI Operator 소개';
    return () => { document.title = prev; };
  }, []);

  // 첫 화면 빈칸 — 기능 이름이 차례로
  useEffect(() => {
    if (reduce) return;
    const t = window.setInterval(() => setSlot((v) => (v + 1) % ABOUT_SLOT_IDS.length), SLOT_MS);
    return () => window.clearInterval(t);
  }, [reduce]);

  // 첫 화면 가운데 한 편만 — 화면에 보일 때만 받고 재생(데이터 아끼기)
  useEffect(() => {
    const v = heroVideo.current;
    if (!v || reduce) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { v.preload = 'auto'; void v.play().catch(() => undefined); } else { v.pause(); }
    }, { threshold: 0.35 });
    io.observe(v);
    return () => io.disconnect();
  }, [reduce]);

  // 상세 창 — 열 때 그 영상 하나만 처음부터 · 첫 화면 영상은 멈춤 · Esc 닫기 · Tab 은 창 안에서만 · 닫으면 포커스 복귀 · 뒤 화면 스크롤 잠금
  useEffect(() => {
    if (!openId) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    heroVideo.current?.pause();
    const v = sheetVideo.current;
    if (v) { v.currentTime = 0; if (!reduce) void v.play().catch(() => undefined); }
    sheetRef.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpenId(null); return; }
      if (e.key !== 'Tab') return;
      const root = sheetRef.current;
      if (!root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>('button, a[href], video[controls]'));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !root.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !root.contains(active))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      sheetVideo.current?.pause();
      prevFocus?.focus?.();
    };
  }, [openId, reduce]);

  const hero = { center: feature(ABOUT_HERO.center), left: feature(ABOUT_HERO.left), right: feature(ABOUT_HERO.right) };
  const opened = openId ? feature(openId) : undefined;

  return (
    <div className="hj-about">
      <header className="top">
        <div className="wrap">
          <Link className="brand" to="/">한줄로<span className="blank" /></Link>
          <nav aria-label="기능 묶음">
            {ABOUT_GROUPS.map((g) => <a key={g.key} href={`#${g.key}`}>{g.title}</a>)}
          </nav>
          <span className="spacer" />
          <Link className="btn btn-line btn-sm" to="/pricing">요금제</Link>
          <Link className="btn btn-ink btn-sm" to="/">시작하기</Link>
        </div>
      </header>

      <section className="hero">
        <div className="wrap">
          <div>
            <span className="eyebrow"><i />마케팅 담당자를 위한 AI Operator</span>
            <h1>한 줄만 적으세요.<br /><span className="soft">나머지는 한줄로가 합니다.</span></h1>
            <div className="fill" aria-live="polite">
              한줄로 <span className="slot"><span key={slot}>{feature(ABOUT_SLOT_IDS[slot])?.title}</span></span>
            </div>
            <div className="hero-cta">
              <Link className="btn btn-ink" to="/">한줄로 시작하기</Link>
              <a className="btn btn-line" href={`#${ABOUT_GROUPS[0].key}`}>기능 영상 보기</a>
            </div>
            <div className="human"><span className="seal" aria-hidden="true">✓</span><b>발송 승인은 언제나 사람이 합니다.</b></div>
          </div>
          <div className="stage" aria-hidden="true">
            {hero.left?.video && <div className="phone p2"><img src={hero.left.video.poster} alt="" /></div>}
            {hero.center?.video && (
              <div className="phone p1">
                <video ref={heroVideo} src={hero.center.video.src} poster={hero.center.video.poster} muted loop playsInline preload="none" />
              </div>
            )}
            {hero.right?.video && <div className="phone p3"><img src={hero.right.video.poster} alt="" /></div>}
            {hero.left && <span className="label l2">{hero.left.title}</span>}
            {hero.center && <span className="label l1">{hero.center.title}</span>}
            {hero.right && <span className="label l3">{hero.right.title}</span>}
          </div>
        </div>
      </section>

      <section className="index">
        <div className="wrap">
          <div className="row">
            {ABOUT_GROUPS.map((g) => (
              <a key={g.key} href={`#${g.key}`}><div className="no">{g.no}</div><div className="nm">{g.title}</div></a>
            ))}
          </div>
        </div>
      </section>

      <main>
        {ABOUT_GROUPS.map((g) => (
          <section className="chapter" id={g.key} key={g.key}>
            <div className="wrap">
              <div className="ch-head">
                <div className="ch-no" aria-hidden="true">{g.no}</div>
                <div><h2 className="ch-title">{g.title}</h2><p className="ch-sub">{g.sub}</p></div>
              </div>
              <div className="cards">
                {g.ids.map((id) => {
                  const f = feature(id);
                  if (!f?.video) return null;
                  return (
                    <article className={`card${g.ids.length === 1 ? ' wide' : ''}`} key={id}>
                      <button type="button" className="shot" onClick={() => setOpenId(id)} aria-label={`${f.title} 영상 보기`}>
                        <img src={f.video.poster} alt="" loading="lazy" />
                        <span className="playbtn" aria-hidden="true" />
                      </button>
                      <div className="body">
                        <h3>{f.title}</h3>
                        <p>{f.tagline || f.summary}</p>
                        <button type="button" className="more" onClick={() => setOpenId(id)}>자세히 →</button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </section>
        ))}
      </main>

      <section className="guard">
        <div className="wrap">
          <h2>보내기 전에, 한줄로가 지키는 것</h2>
          <div className="grid">
            {ABOUT_GUARDS.map((g) => (
              <div className="g" key={g.title}><b>{g.title}</b><p>{g.line}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section className="final">
        <div className="wrap">
          <h2>오늘 보낼 한 줄부터.</h2>
          <div className="hero-cta">
            <Link className="btn btn-ink" to="/">한줄로 시작하기</Link>
            <Link className="btn btn-line" to="/pricing">요금제 보기</Link>
            <Link className="btn btn-line" to={ABOUT_CONTACT_PATH}>도입 상담</Link>
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap"><span className="src">Data source: 기능 설명 = 앱 안의 기능 안내 창과 같은 원장 · 영상 = 실제 화면 흐름(무음)</span></div>
      </footer>

      {opened?.video && (
        <>
          <div className="sheet-bg" aria-hidden="true" />
          <aside className="sheet" ref={sheetRef} role="dialog" aria-modal="true" aria-labelledby="hj-about-sheet-title">
            <div className="left">
              <div className="phone">
                <video ref={sheetVideo} key={opened.id} src={opened.video.src} poster={opened.video.poster} muted loop playsInline preload="auto" controls={reduce} />
              </div>
              <div className="cap">실제 화면 흐름 · 무음</div>
            </div>
            <div className="right">
              <button type="button" className="x" onClick={() => setOpenId(null)} aria-label="닫기">×</button>
              <h2 id="hj-about-sheet-title">{opened.title}</h2>
              <p className="sum">{opened.summary}</p>
              <h4>이렇게 씁니다</h4>
              <ol className="steps">
                {opened.steps.map((s) => <li key={s.title}><b>{s.title}</b><span>{s.text}</span></li>)}
              </ol>
              {!!opened.options?.length && (
                <>
                  <h4>직접 정할 수 있는 것</h4>
                  <div className="chips">{opened.options.map((o) => <span className="chip" key={o.title}>{o.title}</span>)}</div>
                </>
              )}
              {!!opened.safeguards?.length && (
                <>
                  <h4>알아서 지켜 주는 것</h4>
                  <ul className="safe">{opened.safeguards.map((s) => <li key={s.title}><span>{s.title}</span></li>)}</ul>
                </>
              )}
              <div className="foot">
                <small>{PLAN_FEATURE_MIN_PLAN}부터 · 크레딧은 요금제에서</small>
                <Link className="btn btn-line btn-sm" to="/pricing">요금제 보기</Link>
                <Link className="btn btn-ink btn-sm" to="/">시작하기</Link>
              </div>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
