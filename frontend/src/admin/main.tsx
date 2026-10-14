import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from '../auth/AuthProvider.tsx'
import '../index.css'
import AdminApp from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AdminApp />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
