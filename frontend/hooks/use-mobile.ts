import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    // Deliberately not a lazy useState initializer instead: the server
    // can't know the real viewport width, so both server and the client's
    // first (hydration) render must start from the same `undefined` ->
    // `false` value to avoid a hydration mismatch. This synchronous
    // correction right after mount is what the SSR-safe version of this
    // pattern looks like — not an accidental effect misuse.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}
