'use client'

import { ActiveThemeProvider } from "@/components/ui/active-theme"
import { Toaster } from "@/components/ui/sonner"
import { cn } from "@/lib/utils"
import { ThemeProvider } from "@/components/ui/theme-provider"
import { GeistSans } from "geist/font/sans"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/dashboard/app-sidebar"
import { SiteHeader } from "@/components/dashboard/site-header"
import "./globals.css"
import "./themes.css"
import { useEffect, useState } from "react"
import { Loader } from "lucide-react"
import { SessionProvider } from '@/components/session/SessionContext'

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // 使用null表示尚未加载主题
  const [activeThemeValue, setActiveThemeValue] = useState<string | null>(null)
  const [isThemeLoaded, setIsThemeLoaded] = useState(false)

  useEffect(() => {
    // 在客户端加载主题
    try {
      const storedTheme = localStorage.getItem('active_theme')
      if (storedTheme) {
        setActiveThemeValue(storedTheme)
      } else {
        setActiveThemeValue('neutral')
      }
    } catch (e) {
      // 如果localStorage访问失败，使用默认值
      setActiveThemeValue('neutral')
    } finally {
      // 标记主题已加载
      setIsThemeLoaded(true)
    }
  }, []);

  const isScaled = activeThemeValue?.endsWith("-scaled")

  // 主要内容，只在主题加载后才显示
  const mainContent = isThemeLoaded && activeThemeValue ? (
    <ActiveThemeProvider initialTheme={activeThemeValue}>
      <main className="[--header-height:calc(theme(spacing.14))]">
        <SidebarProvider defaultOpen={true} className="flex flex-col">
          <SiteHeader />
          <div className="flex flex-1">
            <AppSidebar />
            <SidebarInset>
              <SessionProvider>
                {children}
              </SessionProvider>
            </SidebarInset>
          </div>
        </SidebarProvider>
      </main>
      <Toaster />
    </ActiveThemeProvider>
  ) : (
    <div className="flex items-center justify-center h-screen">
      <div className="flex flex-col items-center gap-2">
        <Loader className="h-8 w-8 animate-spin text-gray-400" />
        <p className="text-gray-500">加载中...</p>
      </div>
    </div>
  )

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body
        className={cn(
          "bg-background overscroll-none font-sans antialiased",
          activeThemeValue ? `theme-${activeThemeValue}` : "",
          isScaled ? "theme-scaled" : "",
          GeistSans.className
        )}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          enableColorScheme
        >
          {mainContent}
        </ThemeProvider>
      </body>
    </html>
  )
}