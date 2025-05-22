"use client"

import * as React from "react"
import { toast as sonnerToast } from "sonner"
import { GeistSans } from "geist/font/sans"

export type ToastProps = React.ComponentPropsWithoutRef<typeof sonnerToast>

export type ToastActionElement = React.ReactNode

/**
 * 自定义 Toast 组件
 * 使用 Sonner 作为基础，添加了更美观的样式和更多的功能
 */
export const toast = {
  /**
   * 显示一个基础的toast通知
   * @param message 消息内容
   * @param options 可选配置
   */
  basic(message: string, options?: any) {
    return sonnerToast(message, {
      className: GeistSans.className,
      ...options,
    })
  },

  /**
   * 显示一个成功的toast通知
   * @param message 消息内容
   * @param options 可选配置
   */
  success(message: string, options?: any) {
    return sonnerToast.success(message, {
      className: GeistSans.className,
      style: { 
        backgroundColor: "#ffffff",
        color: "oklch(75% 0.18 135)",
      },
      ...options,
    })
  },

  /**
   * 显示一个错误的toast通知
   * @param message 消息内容
   * @param options 可选配置
   */
  error(message: string, options?: any) {
    return sonnerToast.error(message, {
      className: GeistSans.className,
      style: { 
        backgroundColor: "#ffffff",
        color: "oklch(70.4% 0.191 22.216)",
      },
      ...options,
    })
  },

  /**
   * 显示一个警告的toast通知
   * @param message 消息内容
   * @param options 可选配置
   */
  warning(message: string, options?: any) {
    return sonnerToast.warning(message, {
      className: GeistSans.className,
      style: { 
        backgroundColor: "#ffffff",
        color: "oklch(70.7% 0.165 254.624)",
      },
      ...options,
    })
  },

  /**
   * 显示一个信息的toast通知
   * @param message 消息内容
   * @param options 可选配置
   */
  info(message: string, options?: any) {
    return sonnerToast.info(message, {
      className: GeistSans.className,
      style: { 
        backgroundColor: "#ffffff",
        color: "#000000",
      },
      ...options,
    })
  },

  /**
   * 显示一个Promise类型的toast通知
   * @param promise 要监听的Promise
   * @param options 加载中、成功和错误时的消息配置
   */
  promise<T>(
    promise: Promise<T>,
    options: {
      loading: string
      success: string | ((data: T) => string)
      error: string | ((error: unknown) => string)
    }
  ) {
    return sonnerToast.promise(promise, {
      ...options,
      className: GeistSans.className,
    })
  },

  /**
   * 显示一个加载中的toast通知
   * @param message 消息内容
   * @param options 可选配置
   */
  loading(message: string, options?: any) {
    return sonnerToast.loading(message, {
      className: GeistSans.className,
      ...options,
    })
  },

  /**
   * 显示一个自定义的toast通知
   * @param render 自定义渲染函数
   * @param options 可选配置
   */
  custom(
    render: (id: string | number) => React.ReactElement,
    options?: any
  ) {
    return sonnerToast.custom(render, {
      className: GeistSans.className,
      ...options,
    })
  },

  /**
   * 关闭指定ID的toast通知，如不指定ID则关闭所有
   * @param toastId 要关闭的toast ID
   */
  dismiss(toastId?: string) {
    sonnerToast.dismiss(toastId)
  },
}

/**
 * 使用toast的hook
 * @returns 包含toast方法的对象
 */
export function useToast() {
  return { toast }
}