/**
 * LoginNoticeSwitch — 로그인 화면 안내 창의 갈래 한 곳 (★ 2026-11-15 C135 · 설계서 docs/2026-11-15-v3-popup-trial-design.md §2-1)
 *
 * 로그인 화면은 「안내 창을 띄울 차례」(점검 안내 창 우선 · 슈퍼관리자 화면 제외 · 오늘 하루 보지 않기)만 정하고, 무엇을 띄울지는 여기서 정한다.
 *   서버 스위치가 켜짐 = 「한줄로 V3」 안내 창(V3LoginIntroModal) · 꺼짐 = 종전 인증 안내 창(LoginPolicyNoticeModal) 그대로.
 *   V3 창의 「인증 안내 전체 보기」 = 종전 인증 안내 창으로 바꾼다(인증 안내는 사라지지 않는다).
 * ★ 2026-11-15 (같은 날 고침 · 설계서 §12-5) — **첫 그림부터 창을 띄운다.** 무엇을 띄울지는 이 브라우저가 지난번에 받은 답으로 정하고(받은 적 없으면 종전 인증 안내 창),
 *   서버 답이 그와 다를 때만 창을 바꾼다(스위치를 켜거나 끈 뒤 브라우저마다 한 번). 답을 못 받으면 띄워 둔 창 그대로.
 *   ⛔ 답을 기다리는 동안 아무것도 안 띄우는 갈래를 두지 않는다 — 이미 그려진 로그인 화면 위로 창이 뒤늦게 나타나, 나타나는 중간 장면(반투명 · 흐림)이 눈에 보였다.
 * ⛔ V3 창을 동적 import 로 나누지 않는다 — 빌드의 난독화가 동적 import 경로를 깨뜨린 사고(0718)가 있어, 동적 import 는 난독화 제외 파일(App.tsx)에만 둔다(vite.config.ts).
 */
import { useEffect, useRef, useState } from 'react';
import LoginPolicyNoticeModal from '../LoginPolicyNoticeModal';
import { fetchV3LoginIntroOn, rememberedV3LoginIntroOn } from '../../utils/v3-login-intro';
import V3LoginIntroModal from './V3LoginIntroModal';

export default function LoginNoticeSwitch({ onClose }: { onClose: () => void }) {
  const first = useRef(rememberedV3LoginIntroOn());
  const [mode, setMode] = useState<'v3' | 'policy'>(first.current ? 'v3' : 'policy');

  useEffect(() => {
    let alive = true;
    // 답이 첫 그림과 같으면 건드리지 않는다(그 사이 사용자가 「인증 안내 전체 보기」로 바꾼 창을 되돌리지 않는다)
    void fetchV3LoginIntroOn().then((on) => { if (alive && on !== null && on !== first.current) setMode(on ? 'v3' : 'policy'); });
    return () => { alive = false; };
  }, []);

  if (mode === 'v3') return <V3LoginIntroModal onClose={onClose} onAuthNotice={() => setMode('policy')} />;
  return <LoginPolicyNoticeModal onClose={onClose} />;
}
