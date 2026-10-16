import { Route, Routes } from 'react-router-dom'
import NotFoundPage from '../pages/NotFoundPage'
import ActivityLogPage from './ActivityLogPage'
import AdminLayout from './AdminLayout'
import AdminLoginPage from './AdminLoginPage'
import { AdminRoute } from './AdminRoute'
import CategoriesAdminPage from './CategoriesAdminPage'
import { CustomerAdminPage, CustomersAdminPage } from './CustomersAdminPage'
import CustomOrderAdminPage from './CustomOrderAdminPage'
import CustomOrdersAdminPage from './CustomOrdersAdminPage'
import DashboardPage from './DashboardPage'
import GalleryAdminPage from './GalleryAdminPage'
import MessagesAdminPage from './MessagesAdminPage'
import OrderAdminPage from './OrderAdminPage'
import OrdersAdminPage from './OrdersAdminPage'
import ProductFormPage from './ProductFormPage'
import ProductsAdminPage from './ProductsAdminPage'
import ReviewsAdminPage from './ReviewsAdminPage'
import SettingsAdminPage from './SettingsAdminPage'

/** The admin site (its own app, origin and domain). Paths start at the root: /orders, /products… */
export default function AdminApp() {
  return (
    <Routes>
      <Route path="/login" element={<AdminLoginPage />} />
      <Route element={<AdminRoute />}>
        <Route element={<AdminLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/orders" element={<OrdersAdminPage />} />
          <Route path="/orders/:id" element={<OrderAdminPage />} />
          <Route path="/products" element={<ProductsAdminPage />} />
          <Route path="/products/new" element={<ProductFormPage />} />
          <Route path="/products/:id" element={<ProductFormPage />} />
          <Route path="/categories" element={<CategoriesAdminPage />} />
          <Route path="/customers" element={<CustomersAdminPage />} />
          <Route path="/customers/:id" element={<CustomerAdminPage />} />
          <Route path="/gallery" element={<GalleryAdminPage />} />
          <Route path="/custom-orders" element={<CustomOrdersAdminPage />} />
          <Route path="/custom-orders/:id" element={<CustomOrderAdminPage />} />
          <Route path="/messages" element={<MessagesAdminPage />} />
          <Route path="/reviews" element={<ReviewsAdminPage />} />
          <Route path="/activity" element={<ActivityLogPage />} />
          <Route path="/settings" element={<SettingsAdminPage />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
