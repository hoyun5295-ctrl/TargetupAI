import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import './lib/credit-interceptor' // 사후 크레딧 토스트 — fetch 전역 래핑(import 시 활성)
import { loadSendPolicy } from './utils/send-policy'
import { installSelectionClickGuard, bindAdminContextMenu } from './utils/text-select'
import { useAuthStore } from './stores/authStore'

void loadSendPolicy() // ★ 2026-10-25 원장 #40 서버 발송 규칙 값을 첫 화면 전에 받아 둔다(화면이 숫자를 박지 않게)

// ★ 2026-11-24 뿌리 R107 — 끌어 고르기로 끝난 클릭은 앱에 보내지 않는다 · 우클릭은 슈퍼관리자 로그인 탭만(앱 처리기보다 먼저 = createRoot 앞)
installSelectionClickGuard()
bindAdminContextMenu(useAuthStore)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
