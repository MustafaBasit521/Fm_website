import { Route, Routes } from 'react-router-dom'
import { AdminLayout } from './admin/AdminLayout'
import { AdminRoute } from './admin/AdminRoute'
import CategoriesAdminPage from './admin/CategoriesAdminPage'
import { CustomerAdminPage, CustomersAdminPage } from './admin/CustomersAdminPage'
import CustomOrdersAdminPage from './admin/CustomOrdersAdminPage'
import DashboardPage from './admin/DashboardPage'
import GalleryAdminPage from './admin/GalleryAdminPage'
import MessagesAdminPage from './admin/MessagesAdminPage'
import OrderAdminPage from './admin/OrderAdminPage'
import OrdersAdminPage from './admin/OrdersAdminPage'
import ProductFormPage from './admin/ProductFormPage'
import ProductsAdminPage from './admin/ProductsAdminPage'
import ReviewsAdminPage from './admin/ReviewsAdminPage'
import SettingsAdminPage from './admin/SettingsAdminPage'
import { ProtectedRoute } from './auth/ProtectedRoute'
import AccountPage from './pages/AccountPage'
import AddressesPage from './pages/AddressesPage'
import CartPage from './pages/CartPage'
import CheckoutPage from './pages/CheckoutPage'
import ContactPage from './pages/ContactPage'
import CustomOrderPage from './pages/CustomOrderPage'
import CustomOrdersPage from './pages/CustomOrdersPage'
import GalleryPage from './pages/GalleryPage'
import HomePage from './pages/HomePage'
import LoginPage from './pages/LoginPage'
import ShopPage from './pages/ShopPage'
import NotificationsPage from './pages/NotificationsPage'
import OrderConfirmationPage from './pages/OrderConfirmationPage'
import OrderDetailPage from './pages/OrderDetailPage'
import OrdersPage from './pages/OrdersPage'
import FakeGatewayPage from './pages/FakeGatewayPage'
import PaymentReturnPage from './pages/PaymentReturnPage'
import ProductPage from './pages/ProductPage'
import RegisterPage from './pages/RegisterPage'
import WishlistPage from './pages/WishlistPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/shop" element={<ShopPage />} />
      <Route path="/shop/:id" element={<ProductPage />} />
      <Route path="/cart" element={<CartPage />} />
      <Route path="/checkout" element={<CheckoutPage />} />
      <Route path="/order-confirmation" element={<OrderConfirmationPage />} />
      <Route path="/payment/return" element={<PaymentReturnPage />} />
      {import.meta.env.DEV && <Route path="/dev/fake-gateway" element={<FakeGatewayPage />} />}
      <Route path="/gallery" element={<GalleryPage />} />
      <Route path="/custom-order" element={<CustomOrderPage />} />
      <Route path="/contact" element={<ContactPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<AdminRoute />}>
        <Route element={<AdminLayout />}>
          <Route path="/admin" element={<DashboardPage />} />
          <Route path="/admin/orders" element={<OrdersAdminPage />} />
          <Route path="/admin/orders/:id" element={<OrderAdminPage />} />
          <Route path="/admin/products" element={<ProductsAdminPage />} />
          <Route path="/admin/products/new" element={<ProductFormPage />} />
          <Route path="/admin/products/:id" element={<ProductFormPage />} />
          <Route path="/admin/categories" element={<CategoriesAdminPage />} />
          <Route path="/admin/customers" element={<CustomersAdminPage />} />
          <Route path="/admin/customers/:id" element={<CustomerAdminPage />} />
          <Route path="/admin/gallery" element={<GalleryAdminPage />} />
          <Route path="/admin/custom-orders" element={<CustomOrdersAdminPage />} />
          <Route path="/admin/messages" element={<MessagesAdminPage />} />
          <Route path="/admin/reviews" element={<ReviewsAdminPage />} />
          <Route path="/admin/settings" element={<SettingsAdminPage />} />
        </Route>
      </Route>
      <Route element={<ProtectedRoute />}>
        <Route path="/account" element={<AccountPage />} />
        <Route path="/account/addresses" element={<AddressesPage />} />
        <Route path="/wishlist" element={<WishlistPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/custom-orders" element={<CustomOrdersPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/orders/:id" element={<OrderDetailPage />} />
      </Route>
    </Routes>
  )
}
