"use client"

import * as React from "react"
import {
  DatabaseIcon,
  WifiIcon,
  StickyNoteIcon,
  FileTextIcon
} from "lucide-react"

import { Sidebar, SidebarContent } from "@/components/ui/sidebar"
import { NavMain } from "./nav-main"
import { NavSecondary } from "./nav-secondary"

const data = {
  navMain: [
    {
      title: "SQL工作台",
      url: "/",
      icon: DatabaseIcon,
    },
    {
      title: "脚本管理",
      url: "/scripts",
      icon: FileTextIcon,
    },
  ],
  navSecondary: [
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar
      className="top-(--header-height) h-[calc(100svh-var(--header-height))]!"
      {...props}
    >
      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
    </Sidebar>
  )
}
