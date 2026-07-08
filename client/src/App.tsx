import React, { Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "@/components/Layout";
import AdminRoute from "@/components/AdminRoute";
import ProtectedRoute from "@/components/ProtectedRoute";

const Home = React.lazy(() => import("@/pages/Home"));
const Login = React.lazy(() => import("@/pages/Auth/Login"));
const Register = React.lazy(() => import("@/pages/Auth/Register"));
const ForgotPassword = React.lazy(() => import("@/pages/Auth/ForgotPassword"));
const ResetPassword = React.lazy(() => import("@/pages/Auth/ResetPassword"));
const SkillExchange = React.lazy(() => import("@/pages/SkillExchange"));
const SkillExchangeDetail = React.lazy(() => import("@/pages/SkillExchange/Detail"));
const SkillExchangeCreate = React.lazy(() => import("@/pages/SkillExchange/Create"));
const SkillExchangeOrders = React.lazy(() => import("@/pages/SkillExchange/Orders"));
const SkillExchangeDispute = React.lazy(() => import("@/pages/SkillExchange/Dispute"));
const Chat = React.lazy(() => import("@/pages/Messages/Chat"));
const SharedKitchen = React.lazy(() => import("@/pages/SharedKitchen"));
const SharedKitchenDetail = React.lazy(() => import("@/pages/SharedKitchen/Detail"));
const SharedKitchenCreate = React.lazy(() => import("@/pages/SharedKitchen/Create"));
const SharedKitchenOrders = React.lazy(() => import("@/pages/SharedKitchen/Orders"));
const SharedKitchenFoodReview = React.lazy(() => import("@/pages/SharedKitchen/FoodReview"));
const SharedKitchenGroupOrders = React.lazy(() => import("@/pages/SharedKitchen/GroupOrders"));
const SharedKitchenAddressBook = React.lazy(() => import("@/pages/SharedKitchen/AddressBook"));
const TimeBank = React.lazy(() => import("@/pages/TimeBank"));
const TimeBankServiceDetail = React.lazy(() => import("@/pages/TimeBank/ServiceDetail"));
const TimeBankCreateService = React.lazy(() => import("@/pages/TimeBank/CreateService"));
const TimeBankAccount = React.lazy(() => import("@/pages/TimeBank/TimeAccount"));
const TimeBankFamilyBinding = React.lazy(() => import("@/pages/TimeBank/FamilyBinding"));
const TimeBankMyOrders = React.lazy(() => import("@/pages/TimeBank/MyOrders"));
const Emergency = React.lazy(() => import("@/pages/Emergency"));
const EmergencyResourceMap = React.lazy(() => import("@/pages/Emergency/ResourceMap"));
const Notifications = React.lazy(() => import("@/pages/Notifications"));
const Profile = React.lazy(() => import("@/pages/Profile"));
const Verify = React.lazy(() => import("@/pages/Profile/Verify"));
const DeleteAccount = React.lazy(() => import("@/pages/Profile/DeleteAccount"));
const PointsDetail = React.lazy(() => import("@/pages/Profile/PointsDetail"));
const AdminLayout = React.lazy(() => import("@/pages/Admin/AdminLayout"));
const AdminDashboard = React.lazy(() => import("@/pages/Admin/Dashboard"));
const UserManagement = React.lazy(() => import("@/pages/Admin/UserManagement"));
const ContentReview = React.lazy(() => import("@/pages/Admin/ContentReview"));
const OrderManagement = React.lazy(() => import("@/pages/Admin/OrderManagement"));
const ReportManagement = React.lazy(() => import("@/pages/Admin/ReportManagement"));
const VerificationReview = React.lazy(() => import("@/pages/Admin/VerificationReview"));
const AdminMetrics = React.lazy(() => import("@/pages/Admin/Metrics"));
const AdminABTestResults = React.lazy(() => import("@/pages/Admin/ABTestResults"));
const AdminHomepageImage = React.lazy(() => import("@/pages/Admin/HomepageImage"));
const AdminAuditLog = React.lazy(() => import("@/pages/Admin/AuditLog"));
const AdminSystemConfig = React.lazy(() => import("@/pages/Admin/SystemConfig"));
const NotFound = React.lazy(() => import("@/pages/NotFound"));

function Loading() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-8 h-8 border-3 border-emerald-200 border-t-emerald-500 rounded-full animate-spin" />
    </div>
  );
}

export default function App() {
  // 启用 React Router v7 future flag：提前适配 v7 行为变更，消除测试与控制台的 future flag 警告噪音
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="login" element={<Login />} />
            <Route path="register" element={<Register />} />
            <Route path="forgot-password" element={<ForgotPassword />} />
            <Route path="reset-password" element={<ResetPassword />} />
            <Route path="skills" element={<SkillExchange />} />
            <Route path="skills/:id" element={<SkillExchangeDetail />} />
            <Route path="kitchen" element={<SharedKitchen />} />
            <Route path="kitchen/:id" element={<SharedKitchenDetail />} />
            <Route path="time-bank" element={<TimeBank />} />
            <Route path="time-bank/:id" element={<TimeBankServiceDetail />} />
            <Route path="emergency" element={<Emergency />} />
            <Route path="emergency/:id" element={<Emergency />} />
            <Route path="emergency/resources/map" element={<EmergencyResourceMap />} />
            <Route element={<ProtectedRoute />}>
              <Route path="skills/create" element={<SkillExchangeCreate />} />
              <Route path="skills/orders" element={<SkillExchangeOrders />} />
              <Route path="skill-exchange/orders/:orderId/dispute" element={<SkillExchangeDispute />} />
              <Route path="chat/:orderId" element={<Chat />} />
              <Route path="kitchen/create" element={<SharedKitchenCreate />} />
              <Route path="kitchen/orders" element={<SharedKitchenOrders />} />
              <Route path="kitchen/:postId/reviews" element={<SharedKitchenFoodReview />} />
              <Route path="kitchen/group-orders" element={<SharedKitchenGroupOrders />} />
              <Route path="kitchen/addresses" element={<SharedKitchenAddressBook />} />
              <Route path="time-bank/create" element={<TimeBankCreateService />} />
              <Route path="time-bank/account" element={<TimeBankAccount />} />
              <Route path="time-bank/family" element={<TimeBankFamilyBinding />} />
              <Route path="time-bank/orders" element={<TimeBankMyOrders />} />
              <Route path="notifications" element={<Notifications />} />
              <Route path="profile" element={<Profile />} />
              <Route path="profile/verify" element={<Verify />} />
              <Route path="profile/delete" element={<DeleteAccount />} />
              <Route path="profile/points" element={<PointsDetail />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Route>
          <Route
            path="/admin"
            element={
              <AdminRoute>
                <AdminLayout />
              </AdminRoute>
            }
          >
            <Route index element={<AdminDashboard />} />
            <Route path="users" element={<UserManagement />} />
            <Route path="content" element={<ContentReview />} />
            <Route path="orders" element={<OrderManagement />} />
            <Route path="reports" element={<ReportManagement />} />
            <Route path="verifications" element={<VerificationReview />} />
            <Route path="metrics" element={<AdminMetrics />} />
            <Route path="ab-tests" element={<AdminABTestResults />} />
            <Route path="homepage-image" element={<AdminHomepageImage />} />
            <Route path="settings" element={<AdminSystemConfig />} />
            <Route path="audit-logs" element={<AdminAuditLog />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
