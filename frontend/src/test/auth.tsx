import type { Session } from '@supabase/supabase-js'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { CartProvider } from '../cart/CartProvider'
import { AuthContext, type AuthContextValue } from '../auth/context'

export const fakeSession = { access_token: 't', user: { id: 'u1' } } as unknown as Session

export function makeAuth(overrides: Partial<AuthContextValue> = {}): {
  ctx: AuthContextValue
  wrap: (node: ReactNode, path?: string) => ReactNode
} {
  const ctx: AuthContextValue = {
    session: null,
    loading: false,
    signIn: vi.fn().mockResolvedValue(undefined),
    signUp: vi.fn().mockResolvedValue(false),
    signOut: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
  const wrap = (node: ReactNode, path = '/') => (
    <AuthContext.Provider value={ctx}>
      <CartProvider>
        <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
      </CartProvider>
    </AuthContext.Provider>
  )
  return { ctx, wrap }
}
