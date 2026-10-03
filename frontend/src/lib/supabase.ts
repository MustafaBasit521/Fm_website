import { createClient } from '@supabase/supabase-js'

// Only the public project URL and publishable key live in the browser.
// Supabase handles credentials; our backend verifies the resulting JWT.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

if (!url || !key) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY')
}

export const supabase = createClient(url, key)
