/**
 * PreviewFrame — 서버 렌더 HTML 을 그대로 띄우는 iframe(★ 2026-09-27 만들기 개편 · 설계서 §1 불변 1·2·4)
 *
 * sandbox="allow-scripts" 만(불투명 출처) · srcdoc = guardPreviewHtml(CSP connect-src 'none' + 다리 스크립트 1개).
 * 문서가 바뀌어도 스크롤 자리를 기억해 되돌린다 · 섹션을 누르면 onTap(id) · 밖에서 고른 섹션은 테두리로 보여 준다.
 * `viewport` = 문서가 스스로 알아야 하는 폭(휴대폰 375 · PC 1280) · 화면에는 `displayWidth` 로 줄여 보여 준다.
 */
import { useEffect, useMemo, useRef } from 'react';
import { guardPreviewHtml, postToPreview, readPreviewMessage } from '../../utils/make-preview';

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
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const scrollY = useRef(0);
  const lastTap = useRef<string | null>(null);
  const selRef = useRef<string | null>(selectedId);
  selRef.current = selectedId;
  const tapRef = useRef(onTap);
  tapRef.current = onTap;
  const rectRef = useRef(onRect);
  rectRef.current = onRect;
  const doc = useMemo(() => guardPreviewHtml(html, { tap }), [html, tap]);
  const scale = displayWidth / viewport;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const m = readPreviewMessage(e, frameRef.current);
      if (!m) return;
      if (m.type === 'ready') {
        if (scrollY.current > 0) postToPreview(frameRef.current, { type: 'scrollTo', y: scrollY.current });
        postToPreview(frameRef.current, { type: 'select', id: selRef.current, reveal: false });
      } else if (m.type === 'scroll') {
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
    postToPreview(frameRef.current, { type: 'select', id: selectedId, reveal });
  }, [selectedId]);

  return (
    <div style={{ width: displayWidth, height: displayHeight, overflow: 'hidden', position: 'relative', background: '#fff' }}>
      <iframe
        ref={frameRef}
        title={title}
        sandbox="allow-scripts"
        srcDoc={doc}
        style={{ width: viewport, height: displayHeight / scale, border: 0, transform: `scale(${scale})`, transformOrigin: 'top left', display: 'block' }}
      />
    </div>
  );
}
