import { Metadata } from "next"


export const pageMetadata: Record<string, Metadata> = {
  dashboard: {
    title: "仪表盘",
    description: "系统仪表盘页面",
  },
  connections: {
    title: "SQL连接管理",
    description: "SQL连接管理页面"
  },
  scripts: {
    title: "SQL脚本管理",
    description: "SQL脚本管理"
  },
  logs: {
    title: "SQL执行记录",
    description: "SQL执行记录"
  },
}

export const getPageTitle = (path: string): string => {
  return String(pageMetadata[path]?.title || path)
}

export const getPageMetadata = (path: string): Metadata => {
  return pageMetadata[path] || {
    title: path,
    description: `${path}`
  }
} 