import { useCallback, useSyncExternalStore } from "react"

function subscribe(onStoreChange: () => void) {
  window.addEventListener("resize", onStoreChange)
  return () => window.removeEventListener("resize", onStoreChange)
}

export function useIsMobile(breakpoint: number = 768) {
  const getSnapshot = useCallback(
    () => window.innerWidth < breakpoint,
    [breakpoint]
  )

  // The viewport is unknown while server-rendering; keep the previous
  // behaviour of starting out non-mobile.
  const getServerSnapshot = useCallback(() => false, [])

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
