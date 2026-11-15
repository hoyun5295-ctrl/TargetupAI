/**
 * LoginNoticeSwitch — 로그인 화면 안내 창의 갈래 한 곳 (★ 2026-11-15 C135 · 설계서 docs/2026-11-15-v3-popup-trial-design.md §2-1)
 *
 * 로그인 화면은 「안내 창을 띄울 차례」(점검 안내 창 우선 · 슈퍼관리자 화면 제외 · 오늘 하루 보지 않기)만 정하고, 무엇을 띄울지는 여기서 정한다.
 *   서버 스위치가 켜짐 = 「한줄로 V3」 안내 창(V3LoginIntroModal) · 꺼짐 · 못 받음 · 늦음 = 종전 인증 안내 창(LoginPolicyNoticeModal) 그대로.
 *   V3 창의 「인증 안내 전체 보기」 = 종전 인증 안내 창으로 바꾼다(인증 안내는 사라지지 않는다).
 * 답을 기다리는 동안(최대 1.5초)은 아무것도 띄우지 않는다 = 종전 창이 떴다가 새 창으로 바뀌는 깜빡임이 없다.
 * ⛔ V3 창을 동적 import 로 나누지 않는다 — 빌드의 난독화가 동적 import 경로를 깨뜨린 사고(0718)가 있어, 동적 import 는 난독화 제외 파일(App.tsx)에만 둔다(vite.config.ts).
 */
import { useEffect, useState } from 'react';
import LoginPolicyNoticeModal from '../LoginPolicyNoticeModal';
import { fetchV3LoginIntroOn } from '../../utils/v3-login-intro';
import V3LoginIntroModal from './V3LoginIntroModal';

export default function LoginNoticeSwitch({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'wait' | 'v3' | 'policy'>('wait');

  useEffect(() => {
    let alive = true;
    void fetchV3LoginIntroOn().then((on) => { if (alive) setMode(on ? 'v3' : 'policy'); });
    return () => { alive = false; };
  }, []);

  if (mode === 'wait') return null;
  if (mode === 'v3') return <V3LoginIntroModal onClose={onClose} onAuthNotice={() => setMode('policy')} />;
  return <LoginPolicyNoticeModal onClose={onClose} />;
}
