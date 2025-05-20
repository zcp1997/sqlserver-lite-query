import { Metadata } from "next"


export const pageMetadata: Record<string, Metadata> = {
  dashboard: {
    title: "仪表盘",
    description: "系统仪表盘页面",
  },
  connections: {
    title: "sql连接管理",
    description: "sql连接管理页面"
  },
  sqlscripts: {
    title: "sql脚本管理",
    description: "sql脚本管理"
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