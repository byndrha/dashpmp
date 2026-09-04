import * as React from "react"

const MOBILE_BREAKPOINT = 768

function subscribe(callback: () => void) {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mql.addEventListener("change", callback)
  return () => mql.removeEventListener("change", callback)
}

function getSnapshot() {
  return window.innerWidth < MOBILE_BREAKPOINT
}

// SSR always renders "not mobile" (no window to measure) -- useSyncExternalStore
// is what reconciles that with the client's real snapshot after hydration
// without a manual effect+setState dance, which is what caused both a
// hydration mismatch (the old `typeof window` branch) and a "setState
// synchronously in an effect" lint violation (the fix that replaced it).
function getServerSnapshot() {
  return false
}

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
