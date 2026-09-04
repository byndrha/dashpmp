import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  // Starts undefined (not a `typeof window` branch) so the very first
  // client render matches the server's — both resolve to `false` via the
  // `!!isMobile` below — instead of the client's initializer reading the
  // real viewport width immediately while SSR always assumed desktop. The
  // real value is only set inside the effect, i.e. after hydration, which
  // is allowed to differ from the initial render without a mismatch.
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}
