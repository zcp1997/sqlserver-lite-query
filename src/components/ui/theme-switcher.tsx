"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { PaletteIcon } from "lucide-react"
import { useThemeConfig } from "./active-theme"

type Theme = "neutral" | "stone" | "zinc" | "gray" | "slate" | "teal" | "blue" | "purple" | "rose" | "scaled"

const themes: { value: Theme; label: string }[] = [
  { value: "neutral", label: "默认" },
  { value: "stone", label: "石灰" },
  { value: "zinc", label: "锌灰" },
  { value: "gray", label: "灰色" },
  { value: "slate", label: "岩板色" },
  { value: "teal", label: "青色" },
  { value: "blue", label: "蓝色" },
  { value: "purple", label: "紫色" },
  { value: "rose", label: "玫瑰色" },
  { value: "scaled", label: "缩放" },
]

export function ThemeSwitcher() {
  const { activeTheme, setActiveTheme } = useThemeConfig()
  const theme = activeTheme as Theme

  const handleThemeChange = (newTheme: Theme) => {
    setActiveTheme(newTheme)
  }

  const currentThemeLabel = themes.find(t => t.value === theme)?.label || "默认"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" className="group/toggle size-8">
          <PaletteIcon className="h-4 w-4" />
          <span className="sr-only">切换主题</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <div className="flex items-center justify-between px-4 py-2">
          <span className="text-sm font-medium">当前主题: {currentThemeLabel}</span>
        </div>
        {themes.map((t) => (
          <DropdownMenuItem
            key={t.value}
            onClick={() => handleThemeChange(t.value)}
            className={theme === t.value ? "bg-accent text-accent-foreground" : ""}
          >
            {t.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}