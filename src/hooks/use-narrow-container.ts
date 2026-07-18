import * as React from "react"

// Element-width-based, not viewport-based like useIsMobile() — a chart's
// actual rendered width depends on the sidebar's collapsed/expanded state at
// a given viewport size, not just the viewport itself. A component gated on
// useIsMobile() renders its "desktop" layout at a tablet viewport with the
// sidebar expanded even though the chart's real container is squeezed
// narrower than the mobile threshold, reproducing the exact
// overlapping-label bug the narrow layout exists to avoid.
export function useNarrowContainer<T extends HTMLElement>(threshold: number) {
  const ref = React.useRef<T>(null)
  const [narrow, setNarrow] = React.useState(false)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width != null) setNarrow(width < threshold)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [threshold])

  return [ref, narrow] as const
}
