import { createContext, useContext } from 'react'

export type ToastVariant = 'success' | 'info' | 'warn' | 'error'

export interface ToastItem {
  id: number
  message: string
  variant: ToastVariant
}

export interface ToastContextValue {
  showToast: (message: string, variant?: ToastVariant) => void
}

export const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast ต้องใช้ภายใน <ToastProvider>')
  return ctx
}
