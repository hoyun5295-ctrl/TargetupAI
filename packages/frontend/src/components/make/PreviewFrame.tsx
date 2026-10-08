/**
 * PreviewFrame — 서버 렌더 HTML 을 그대로 띄우는 iframe(★ 2026-09-27 만들기 개편 · 설계서 §1 불변 1·2·4)
 *
 * sandbox="allow-scripts" 만(불투명 출처) · srcdoc = guardPreviewHtml(CSP connect-src 'none' + 다리 스크립트 1개).
 * 문서가 바뀌어도 스크롤 자리를 기억해 되돌린다 · 섹션을 누르면 onTap(id) · 밖에서 고른 섹션은 테두리로 보여 준다.
 * `viewport` = 문서가 스스로 알아야 하는 폭(휴대폰 375 · PC 1280) · 화면에는 `displayWidth` 로 줄여 보여 준다.
 *
 * ★ 2026-10-08 (남지현 접수 cmuz1os880 · DM · 이메일 · 카탈로그 공용) 두 겹으로 그린다.
 *   옛: 고칠 때마다 보이는 iframe 의 srcdoc 를 갈아 끼워 하얗게 비었다가 다시 그려졌다(「화면이 흔들린다」) ·
 *   스크롤도 그림을 받기 전에 맞춰 맨 위로 튀었다.
 *   지금: 새 문서는 뒤 칸(안 보임)에서 받고 → 스크롤 · 선택을 맞추고 → 그림까지 다 들어오면(loaded) 앞 칸과 바꾼다.
 *   늦어도 1.5초 뒤에는 바꾼다(그림 하나가 안 오는 문서도 멈춰 있지 않게).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { guardPreviewHtml, postToPreview, readPreviewMessage } from '../../utils/make-preview';
import '../../styles/make.css';

const SWAP_FALLBACK_MS = 1500;

export default function PreviewFrame({
  html, viewport, displayWidth, displayHeight, tap = false, selectedId = null, onTap, onRect, title,
}: {
  html: string;
  viewport: number;
  displayWidth: number;
  displayHeight: number;
  tap?: boolean;
  selectedId?: string | null;
  onTap?: (id: string) => void;
  /** 고른 블록 자리(화면 좌표 = 문서 좌표 × 축소율) — 휴대폰 위 도구줄 */
  onRect?: (r: { id: string | null; top: number; height: number }) => void;
  title: string;
}) {
  const doc = useMemo(() => guardPreviewHtml(html, { tap }), [html, tap]);
  // 앞 칸(보임) · 뒤 칸(받는 중). key 가 바뀌면 iframe 이 새로 선다.
  const [front, setFront] = useState<{ key: number; doc: string }>({ key: 0, doc });
  const [back, setBack] = useState<{ key: number; doc: string } | null>(null);
  const frames = useRef<Record<number, HTMLIFrameElement | null>>({});
  const frontRef = useRef(front);
  frontRef.current = front;
  const backRef = useRef(back);
  backRef.current = back;

  const scrollY = useRef(0);
  const lastTap = useRef<string | null>(null);
  const selRef = useRef<string | null>(selectedId);
  selRef.current = selectedId;
  const tapRef = useRef(onTap);
  tapRef.current = onTap;
  const rectRef = useRef(onRect);
  rectRef.current = onRect;
  const scale = displayWidth / viewport;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  // 문서가 바뀌면 뒤 칸에서 받는다(받는 중에 또 바뀌면 뒤 칸만 새로)
  useEffect(() => {
    if (doc === frontRef.current.doc) { setBack(null); return; }
    const key = Math.max(frontRef.current.key, backRef.current?.key ?? 0) + 1;
    setBack({ key, doc });
    const t = setTimeout(() => promote(key), SWAP_FALLBACK_MS);
    return () => clearTimeout(t);
  }, [doc]);

  /** 뒤 칸을 앞으로 — 고른 블록 자리를 새 문서 기준으로 다시 받는다 */
  function promote(key: number) {
    const b = backRef.current;
    if (!b || b.key !== key) return;
    setFront(b);
    setBack(null);
    postToPreview(frames.current[key] ?? null, { type: 'select', id: selRef.current, reveal: false });
  }

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const f = frontRef.current;
      const b = backRef.current;
      const fromFront = readPreviewMessage(e, frames.current[f.key] ?? null);
      const fromBack = b ? readPreviewMessage(e, frames.current[b.key] ?? null) : null;
      const m = fromFront || fromBack;
      if (!m) return;
      const frame = fromFront ? frames.current[f.key] ?? null : frames.current[b!.key] ?? null;
      if (m.type === 'ready') {
        if (scrollY.current > 0) postToPreview(frame, { type: 'scrollTo', y: scrollY.current });
        postToPreview(frame, { type: 'select', id: selRef.current, reveal: false });
        return;
      }
      if (m.type === 'loaded') {
        if (fromBack && b) promote(b.key);
        return;
      }
      if (!fromFront) return;   // 안 보이는 뒤 칸의 스크롤 · 자리 · 탭은 쓰지 않는다
      if (m.type === 'scroll') {
        scrollY.current = m.y;
      } else if (m.type === 'rect') {
        rectRef.current?.({ id: m.id, top: m.top * scaleRef.current, height: m.height * scaleRef.current });
      } else if (m.type === 'tap') {
        lastTap.current = m.id;
        tapRef.current?.(m.id);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // 밖(왼쪽 목록)에서 고른 섹션 = 테두리 + 그 자리로 · 안에서 누른 섹션 = 테두리만(화면이 튀지 않게)
  useEffect(() => {
    const reveal = !!selectedId && lastTap.current !== selectedId;
    lastTap.current = null;
    postToPreview(frames.current[frontRef.current.key] ?? null, { type: 'select', id: selectedId, reveal });
  }, [selectedId]);

  const frameStyle = { width: viewport, height: displayHeight / scale, border: 0, transform: `scale(${scale})`, transformOrigin: 'top left', display: 'block' } as const;
  return (
    // 바깥 칸 = mk-preview-box(overflow clip) — 배치 폭(viewport)이 보이는 폭보다 넓어 hidden 이면 코드로 옆으로 밀렸다(★2026-10-01 박성용 접수)
    <div className="mk-preview-box" style={{ width: displayWidth, height: displayHeight, position: 'relative', background: '#fff' }}>
      {[front, ...(back ? [back] : [])].map((layer) => {
        const hidden = layer !== front;
        return (
          <iframe
            key={layer.key}
            ref={(el) => { frames.current[layer.key] = el; }}
            title={title}
            sandbox="allow-scripts"
            srcDoc={layer.doc}
            aria-hidden={hidden || undefined}
            tabIndex={hidden ? -1 : undefined}
            style={hidden ? { ...frameStyle, position: 'absolute', top: 0, left: 0, visibility: 'hidden', pointerEvents: 'none' } : frameStyle}
          />
        );
      })}
    </div>
  );
}
