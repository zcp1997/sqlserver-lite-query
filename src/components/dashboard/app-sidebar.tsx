"use client"

import * as React from "react"
import { DatabaseIcon, LogInIcon as LogsIcon, FileTextIcon, ChevronRight, CommandIcon, Sparkles } from "lucide-react"
import { usePathname, useRouter } from "next/navigation"
import { cn } from "@/lib/utils"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarHeader,
} from "@/components/ui/sidebar"

const data = {
  navMain: [
    {
      title: "SQL工作台",
      url: "/",
      icon: CommandIcon,
    },
    {
      title: "SQL脚本管理",
      url: "/scripts",
      icon: FileTextIcon,
    },
    {
      title: "SQL执行记录",
      url: "/logs",
      icon: LogsIcon,
    },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()
  const router = useRouter()
  const [isHovered, setIsHovered] = React.useState<string | null>(null)

  const menuHandler = (item: (typeof data.navMain)[0]) => {
    router.push(item.url)
  }

  return (
    <Sidebar
      collapsible="none"
      className="!w-[220px] border-r h-screen transition-all duration-300 ease-in-out bg-sidebar"
      {...props}
    >
      <SidebarHeader className="flex items-center justify-center py-4 border-b border-sidebar-border">
        <div className="flex items-center space-x-3 h-[46px] group">
          <div className="relative">
            <DatabaseIcon className="h-7 w-7 text-primary transition-all duration-300 group-hover:scale-110 group-hover:rotate-12" />
            {/* 图标光晕 */}
            <div className="absolute inset-0 rounded-full bg-primary/20 blur-md scale-150 opacity-0 group-hover:opacity-100 transition-all duration-500" />
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-lg bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text">
              SQL助手
            </span>
            <span className="text-xs text-muted-foreground/70 flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              v0.1.0
            </span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent className="pt-4">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {data.navMain.map((item) => {
                const isActive = pathname === item.url
                const isItemHovered = isHovered === item.title

                return (
                  <SidebarMenuItem key={item.title}>
                    <div
                      className={cn(
                        "w-full px-3 py-2.5 my-1 rounded-md transition-all duration-300 ease-in-out cursor-pointer flex items-center",
                        isActive ? "bg-primary/10 text-primary" : "hover:bg-muted",
                        isItemHovered && !isActive && "bg-muted",
                      )}
                      onClick={() => menuHandler(item)}
                      onMouseEnter={() => setIsHovered(item.title)}
                      onMouseLeave={() => setIsHovered(null)}
                    >
                      <div
                        className={cn(
                          "flex items-center w-full",
                          isActive ? "text-primary" : "text-sidebar-foreground",
                        )}
                      >
                        <div
                          className={cn(
                            "flex items-center justify-center w-10 h-10 rounded-md transition-all duration-300",
                            isActive ? "bg-primary/20" : isItemHovered ? "bg-muted-foreground/10" : "bg-transparent",
                          )}
                        >
                          <item.icon
                            className={cn("h-5 w-5 transition-transform duration-300", isItemHovered && "scale-110")}
                          />
                        </div>
                        <span className="ml-3 font-medium">{item.title}</span>
                        {isActive && <ChevronRight className="ml-auto h-4 w-4 text-primary animate-pulse" />}
                      </div>
                    </div>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
