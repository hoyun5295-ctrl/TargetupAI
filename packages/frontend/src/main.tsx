import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import './lib/credit-interceptor' // 사후 크레딧 토스트 — fetch 전역 래핑(import 시 활성)
import { loadSendPolicy } from './utils/send-policy'

void loadSendPolicy() // ★ 2026-10-25 원장 #40 서버 발송 규칙 값을 첫 화면 전에 받아 둔다(화면이 숫자를 박지 않게)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
