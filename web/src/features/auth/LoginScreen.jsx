export default function LoginScreen({ locale = 'en', googleButtonRef, isLoggingIn = false, error = '', testerLoginEnabled = false, judyLoginEnabled = false, onOpenTesterLogin, onJudyLogin }) {
  const zh = locale === 'zh-TW'
  return (
    <main className="login-screen">
      <section className="login-card" aria-labelledby="login-title">
        <img className="login-wordmark" src="/images/logo.webp" alt="" aria-hidden="true" />
        <h1 id="login-title">Convia</h1>
        <p>{zh ? '與人交流，也和 AI 一起思考。' : 'Connect with people and think with AI.'}</p>
        <div className="google-signin" aria-label={zh ? '使用 Google 登入' : 'Sign in with Google'}>
          <div ref={googleButtonRef} className="google-signin__target" />
        </div>
        {isLoggingIn ? <p className="form-status" role="status">{zh ? '登入中…' : 'Signing in…'}</p> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {testerLoginEnabled || judyLoginEnabled ? (
          <div className="login-card__tester-links">
            {testerLoginEnabled ? (
            <button type="button" className="text-button" onClick={onOpenTesterLogin}>
              {zh ? '測試帳號登入' : 'Tester login'}
            </button>
            ) : null}
            {judyLoginEnabled ? (
            <button type="button" className="text-button" onClick={onJudyLogin}>
              {zh ? 'Judy 登入' : 'Sign in as Judy'}
            </button>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  )
}
