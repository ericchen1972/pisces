import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { localeFromLanguage } from './lib/i18n.js'
import './styles/tokens.css'

document.documentElement.lang = localeFromLanguage(navigator.language)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
