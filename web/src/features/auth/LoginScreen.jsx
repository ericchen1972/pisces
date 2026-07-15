export default function LoginScreen({ locale = 'en', googleButtonRef, isLoggingIn = false, error = '', onOpenTesterLogin }) {
  const zh = locale === 'zh-TW'
  return (
    <main className="login-screen">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-wordmark" aria-hidden="true">C</div>
        <h1 id="login-title">Convia</h1>
        <p>{zh ? '與人交流，也和 AI 一起思考。' : 'Connect with people and think with AI.'}</p>
        <div className="google-signin" aria-label={zh ? '使用 Google 登入' : 'Sign in with Google'}>
          <div ref={googleButtonRef} className="google-signin__target" />
        </div>
        {isLoggingIn ? <p className="form-status" role="status">{zh ? '登入中…' : 'Signing in…'}</p> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button type="button" className="text-button" onClick={onOpenTesterLogin}>
          {zh ? '測試帳號登入' : 'Tester login'}
        </button>
      </section>
    </main>
  )
}
