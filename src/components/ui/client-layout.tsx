"use client"

import { useEffect } from "react"
import { useTheme } from "next-themes"

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const { setTheme } = useTheme()

  useEffect(() => {
    const activeTheme = document.cookie
      .split("; ")
      .find((row) => row.startsWith("active_theme="))
      ?.split("=")[1]

    if (activeTheme) {
      setTheme(activeTheme)
    }
  }, [setTheme])

  return <>{children}</>
} 