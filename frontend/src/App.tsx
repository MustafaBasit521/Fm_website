import { Route, Routes } from 'react-router-dom'
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
