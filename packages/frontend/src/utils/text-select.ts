/**
 * text-select.ts — 글자 고르기 · 복사와 부딪히는 화면 동작의 판정 한 곳(★ 2026-11-24 뿌리 R107)
 *
 * 설계 = docs/2026-11-24-copy-selection-root-design.md §3 D2 · D3(실측 표 = 같은 문서).
 * 옛 index.html 은 화면 전체의 글자 선택을 막고 접수가 올 때마다 그 자리만 select-text 로 풀었다(땜질 16줄).
 * 이제 글자 선택은 막지 않고, 선택 때문에 생기는 부작용 둘만 여기서 다룬다.
 *
 * D2 installSelectionClickGuard — 끌어 고르기 등으로 「선택을 바꾼 누름」이 끝나며 생긴 클릭은 앱 처리기에 보내지 않는다.
 *    React 18 은 처리기를 #root 한 곳에서 받으므로 window 캡처에서 멈추면 행 · 칸 · 카드 처리기 어느 것도 돌지 않는다
 *    (행을 끌어 고를 때 상세 창이 열리거나, 칸 일부를 고를 때 값 전체가 복사되던 일).
 * D3 bindAdminContextMenu — 우클릭은 이 탭이 슈퍼관리자로 로그인된 동안에만 연다(index.html 이 <html data-ctx-menu="open"> 을 본다).
 *    그 밖 사람에게는 지금처럼 막는다(우클릭 메뉴의 「검사」 = 개발자 도구 길 · 소스보호 정책).
 */

type Snap = {
  collapsed: boolean;
  anchorNode: Node | null;
  anchorOffset: number;
  focusNode: Node | null;
  focusOffset: number;
} | null;

interface PressRecord {
  /** 누를 때(pointerdown 캡처 = 브라우저가 선택을 바꾸기 전) 선택 상태 */
  snap: Snap;
  /** 누르고 움직이는 동안 선택이 한 번이라도 기록과 달라졌나(끝점을 옮겼다 되돌린 끌기도 잡는다) */
  moved: boolean;
  /** pointerup 을 받았나(다음 pointerdown 이 끝난 기록을 정리한다) */
  ended: boolean;
  /** 끝난 순서(pointerId 없는 클릭 = 가장 최근에 끝난 기록과 짝) */
  endSeq: number;
}

/** 조작부 — 그 안을 누른 클릭은 막지 않는다(단추 · 링크 · 입력칸 · 라벨 등은 선택과 상관없이 제 동작) */
const CONTROL_SELECTOR = 'input,textarea,select,button,a,label,summary,[role="button"]';

let records = new Map<number, PressRecord>();
let endSeq = 0;

/** 시험용 읽기 — 누름 기록의 소비 · 보존 · 정리를 상태로 확인한다(화면 코드는 쓰지 않는다) */
export function selectionGuardRecords(): ReadonlyMap<number, Readonly<PressRecord>> {
  return records;
}

function snapshot(sel: Selection | null): Snap {
  if (!sel || sel.rangeCount === 0) return null;
  return {
    collapsed: sel.isCollapsed,
    anchorNode: sel.anchorNode,
    anchorOffset: sel.anchorOffset,
    focusNode: sel.focusNode,
    focusOffset: sel.focusOffset,
  };
}

function sameSnap(a: Snap, b: Snap): boolean {
  if (a === null || b === null) return a === b;
  return a.collapsed === b.collapsed
    && a.anchorNode === b.anchorNode && a.anchorOffset === b.anchorOffset
    && a.focusNode === b.focusNode && a.focusOffset === b.focusOffset;
}

function elementOf(target: EventTarget | null): Element | null {
  const node = target as Node | null;
  if (!node) return null;
  return node.nodeType === 1 ? (node as Element) : node.parentElement;
}

/**
 * D2 — main.tsx 에서 createRoot 앞에 한 번. 아래 다섯이 모두 참인 클릭만 앱에 보내지 않는다(설계서 §3 D2 규칙 1 ~ 5).
 *   1 사람의 누름(detail > 0) 2 선택이 펼쳐졌고 글자가 있다 3 대상이 선택 범위에 걸친다
 *   4 대상이 조작부 · 편집 가능 요소 안이 아니다 5 이번 누름이 선택을 바꿨다(움직이는 동안 바뀜 또는 누를 때 ≠ 클릭 때)
 * 돌려주는 함수 = 처리기 떼기(시험용).
 */
export function installSelectionClickGuard(win: Window = window): () => void {
  records = new Map();
  endSeq = 0;
  const current = () => (win.getSelection ? win.getSelection() : null);

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    for (const [id, r] of records) if (r.ended) records.delete(id);
    records.set(e.pointerId, { snap: snapshot(current()), moved: false, ended: false, endSeq: 0 });
  };
  const onMove = (e: PointerEvent) => {
    if (!(e.buttons & 1)) return;
    const r = records.get(e.pointerId);
    if (!r || r.moved || r.ended) return;
    if (!sameSnap(snapshot(current()), r.snap)) r.moved = true;
  };
  const onUp = (e: PointerEvent) => {
    const r = records.get(e.pointerId);
    if (r) { r.ended = true; r.endSeq = ++endSeq; }
  };
  const onCancel = (e: PointerEvent) => { records.delete(e.pointerId); };

  const onClick = (e: MouseEvent) => {
    if (!(e.detail > 0)) return;                                   // 1 — 키보드 · element.click() 은 기록도 건드리지 않는다
    // 그 누름의 기록을 꺼내고 지운다(한 누름 = 한 판정)
    let rec: PressRecord | undefined;
    const id = (e as PointerEvent).pointerId;
    if (typeof id === 'number' && id >= 0) {
      rec = records.get(id);
      records.delete(id);
    } else {
      let best: [number, PressRecord] | null = null;
      for (const ent of records) if (ent[1].ended && (!best || ent[1].endSeq > best[1].endSeq)) best = ent;
      if (best) { rec = best[1]; records.delete(best[0]); }
    }
    const sel = current();
    if (!sel || sel.isCollapsed || !String(sel)) return;          // 2
    const el = elementOf(e.target);
    if (!el) return;
    let hit = false;
    for (let i = 0; i < sel.rangeCount; i++) if (sel.getRangeAt(i).intersectsNode(el)) { hit = true; break; }
    if (!hit) return;                                              // 3
    if (el.closest(CONTROL_SELECTOR) || (el as HTMLElement).isContentEditable) return;   // 4
    if (!rec || !(rec.moved || !sameSnap(snapshot(sel), rec.snap))) return;          // 5
    e.stopPropagation();
  };

  win.addEventListener('pointerdown', onDown as EventListener, true);
  win.addEventListener('pointermove', onMove as EventListener, true);
  win.addEventListener('pointerup', onUp as EventListener, true);
  win.addEventListener('pointercancel', onCancel as EventListener, true);
  win.addEventListener('click', onClick as EventListener, true);
  return () => {
    win.removeEventListener('pointerdown', onDown as EventListener, true);
    win.removeEventListener('pointermove', onMove as EventListener, true);
    win.removeEventListener('pointerup', onUp as EventListener, true);
    win.removeEventListener('pointercancel', onCancel as EventListener, true);
    win.removeEventListener('click', onClick as EventListener, true);
  };
}

/** index.html 우클릭 처리기가 보는 표시(이 이름을 바꾸면 index.html 도 같이) */
export const CTX_MENU_ATTR = 'data-ctx-menu';

interface AuthLike {
  isAuthenticated: boolean;
  user?: { userType?: string } | null;
}
interface StoreLike<S> {
  getState(): S;
  subscribe(listener: (state: S) => void): () => void;
}

/**
 * D3 — main.tsx 에서 createRoot 앞에 한 번. 인증 저장소를 구독해 상태가 바뀔 때마다(복원 · 로그인 · 로그아웃 · clearLocal · 계정 전환)
 * 슈퍼관리자로 로그인된 동안만 <html data-ctx-menu="open"> 을 단다. 처음 상태도 바로 한 번 적용한다.
 */
export function bindAdminContextMenu(store: StoreLike<AuthLike>, doc: Document = document): () => void {
  const apply = (s: AuthLike) => {
    const root = doc.documentElement;
    if (s.isAuthenticated && s.user?.userType === 'super_admin') root.setAttribute(CTX_MENU_ATTR, 'open');
    else root.removeAttribute(CTX_MENU_ATTR);
  };
  apply(store.getState());
  return store.subscribe(apply);
}
