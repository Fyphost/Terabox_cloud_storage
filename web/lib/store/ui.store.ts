import { create } from 'zustand';

export type ToastVariant = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  title?: string;
  description?: string;
  variant: ToastVariant;
  ttl: number;
}

interface UIState {
  // Toasts
  toasts: Toast[];
  pushToast: (t: Omit<Toast, 'id' | 'ttl'> & { ttl?: number }) => string;
  dismissToast: (id: string) => void;

  // Login modal — global so any component can request "please sign in" UX.
  loginModalOpen: boolean;
  loginModalReturnTo: string | null;
  openLoginModal: (returnTo?: string | null) => void;
  closeLoginModal: () => void;
}

let toastSeq = 0;

export const useUIStore = create<UIState>((set) => ({
  toasts: [],
  pushToast: ({ title, description, variant, ttl }) => {
    const id = `t_${Date.now()}_${++toastSeq}`;
    const toast: Toast = {
      id,
      title,
      description,
      variant,
      ttl: ttl ?? 4000,
    };
    set((s) => ({ toasts: [...s.toasts, toast] }));
    return id;
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  loginModalOpen: false,
  loginModalReturnTo: null,
  openLoginModal: (returnTo) => set({ loginModalOpen: true, loginModalReturnTo: returnTo ?? null }),
  closeLoginModal: () => set({ loginModalOpen: false, loginModalReturnTo: null }),
}));

export function toast(t: Omit<Toast, 'id' | 'ttl'> & { ttl?: number }): string {
  return useUIStore.getState().pushToast(t);
}
