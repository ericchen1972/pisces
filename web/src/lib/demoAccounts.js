export const DEMO_ACCOUNT_EMAILS = Object.freeze({
  judy: 'judy@gods.tw',
  haland: 'haland@gods.tw',
})

const DEFAULT_DEMO_DESTINATIONS = Object.freeze({
  judy: 'https://convia-judy.vercel.app',
  haland: 'https://convia-haland.vercel.app',
})

export function demoDestinations(env = import.meta.env) {
  return {
    judy: String(env.VITE_DEMO_JUDY_URL || DEFAULT_DEMO_DESTINATIONS.judy).replace(/\/$/, ''),
    haland: String(env.VITE_DEMO_HALAND_URL || DEFAULT_DEMO_DESTINATIONS.haland).replace(/\/$/, ''),
  }
}

export function demoLoginUrl(key, destinations = demoDestinations()) {
  if (!DEMO_ACCOUNT_EMAILS[key] || !destinations[key]) return ''
  const url = new URL(destinations[key])
  url.searchParams.set('demo_account', key)
  return url.toString()
}

export function demoAccountFromUrl(value) {
  const key = new URL(value).searchParams.get('demo_account') || ''
  return DEMO_ACCOUNT_EMAILS[key] ? key : ''
}

export function stripDemoLoginQuery(value) {
  const url = new URL(value)
  url.searchParams.delete('demo_account')
  return url.toString()
}

export function openDemoWindow(key, openWindow = window.open, destinations = demoDestinations()) {
  const url = demoLoginUrl(key, destinations)
  if (!url) return false
  const popup = openWindow('', `convia-demo-${key}`, 'popup')
  if (!popup) return false
  popup.opener = null
  popup.location.replace(url)
  return true
}
