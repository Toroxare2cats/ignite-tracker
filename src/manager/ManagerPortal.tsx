import { Navigate, Route, Routes } from 'react-router-dom'
import OrdersScreen from './OrdersScreen.tsx'
import OrderFormScreen from './OrderFormScreen.tsx'
import ManageOrderScreen from './ManageOrderScreen.tsx'
import DesignsScreen from './DesignsScreen.tsx'
import NewDesignScreen from './NewDesignScreen.tsx'
import DesignScreen from './DesignScreen.tsx'
import PeopleScreen from './PeopleScreen.tsx'
import NewPersonScreen from './NewPersonScreen.tsx'
import PersonScreen from './PersonScreen.tsx'
import ApprovalsScreen from './ApprovalsScreen.tsx'
import SettingsScreen from './SettingsScreen.tsx'
import ImportsScreen from './ImportsScreen.tsx'
import ExportsScreen from './ExportsScreen.tsx'
import TodayScreen from './TodayScreen.tsx'
import ReportsScreen from './ReportsScreen.tsx'
import ReconciliationScreen from './ReconciliationScreen.tsx'
import OrderCostScreen from './OrderCostScreen.tsx'
import DesignPricingScreen from './DesignPricingScreen.tsx'
import ArtistWeekScreen from './ArtistWeekScreen.tsx'
import ArtistByDesignScreen from './ArtistByDesignScreen.tsx'
import TaskFormScreen from './TaskFormScreen.tsx'

/**
 * The manager portal's screens.  This file and everything it imports load only
 * for managers, so artists' phones never download them.  That is about speed,
 * not privacy: the database enforces who can read what.
 */
export default function ManagerPortal() {
  return (
    <Routes>
      <Route index element={<Navigate to="dashboard" replace />} />
      <Route path="dashboard" element={<TodayScreen />} />
      <Route path="tasks" element={<Navigate to="/tasks?view=everyone" replace />} />
      <Route path="tasks/new" element={<TaskFormScreen mode="new" />} />
      <Route path="tasks/approve/:itemId" element={<TaskFormScreen mode="approve" />} />
      <Route path="tasks/:taskId" element={<TaskFormScreen mode="edit" />} />
      <Route path="orders" element={<OrdersScreen />} />
      <Route path="orders/new" element={<OrderFormScreen />} />
      <Route path="orders/:orderId" element={<ManageOrderScreen />} />
      <Route path="orders/:orderId/edit" element={<OrderFormScreen />} />
      <Route path="designs" element={<DesignsScreen />} />
      <Route path="designs/new" element={<NewDesignScreen />} />
      <Route path="designs/:designId" element={<DesignScreen />} />
      <Route path="people" element={<PeopleScreen />} />
      <Route path="people/new" element={<NewPersonScreen />} />
      <Route path="people/:personId" element={<PersonScreen />} />
      <Route path="approvals" element={<ApprovalsScreen />} />
      <Route path="reports" element={<ReportsScreen />} />
      <Route path="reports/reconciliation" element={<ReconciliationScreen />} />
      <Route path="reports/order-cost" element={<OrderCostScreen />} />
      <Route path="reports/order-cost/:orderId" element={<OrderCostScreen />} />
      <Route path="reports/design-pricing" element={<DesignPricingScreen />} />
      <Route path="reports/design-pricing/:designId" element={<DesignPricingScreen />} />
      <Route path="reports/artist-week" element={<ArtistWeekScreen />} />
      <Route path="reports/artist-week/:personId" element={<ArtistWeekScreen />} />
      <Route path="reports/artist-by-design" element={<ArtistByDesignScreen />} />
      <Route path="imports" element={<ImportsScreen />} />
      <Route path="exports" element={<ExportsScreen />} />
      <Route path="settings" element={<SettingsScreen />} />
      <Route path="*" element={<Navigate to="dashboard" replace />} />
    </Routes>
  )
}
