"use client"

import * as React from "react"
import {
  DatabaseIcon,
  LogsIcon,
  FileTextIcon
} from "lucide-react"
import { usePathname, useRouter } from 'next/navigation'

import { 
  Sidebar, 
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

const data = {
  navMain: [
    {
      title: "SQL工作台",
      url: "/",
      icon: DatabaseIcon,
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

  const menuHandler = (item: typeof data.navMain[0]) => {
    router.push(item.url)
  }

  return (
    <Sidebar
      collapsible="none"
      className="!w-[calc(var(--sidebar-width-icon)_+_1px)] border-r h-screen"
      {...props}
    >
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {data.navMain.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    isActive={pathname === item.url}
                    tooltip={{
                      children: item.title,
                      hidden: false,
                    }}
                  >
                    <div className="cursor-pointer" onClick={() => menuHandler(item)}>
                      <item.icon />
                    </div>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
