import { createRouter, createWebHistory } from 'vue-router'

import DashboardPage from '../pages/DashboardPage.vue'
import InventoryPage from '../pages/InventoryPage.vue'
import PickupsPage from '../pages/PickupsPage.vue'
import BillingPageV2 from '../pages/BillingPageV2.vue'
import SettingsPage from '../pages/SettingsPage.vue'
import PricingPage from '../pages/PricingPage.vue'
import CustomersPage from '../pages/CustomersPage.vue'
import ItemsPage from '../pages/ItemsPage.vue'

const routes = [
  { path: '/', name: 'dashboard', component: DashboardPage },
  { path: '/inventory', name: 'inventory', component: InventoryPage },
  { path: '/pickups', name: 'pickups', component: PickupsPage },
  { path: '/billing', name: 'billing', component: BillingPageV2 },
  {
    path: '/settings',
    component: SettingsPage,
    children: [
      { path: '', redirect: '/settings/pricing' },
      { path: 'pricing', name: 'pricing', component: PricingPage },
      { path: 'customers', name: 'customers', component: CustomersPage },
      { path: 'items', name: 'items', component: ItemsPage },
    ],
  },
  { path: '/pricing', redirect: '/settings/pricing' },
  { path: '/customers', redirect: '/settings/customers' },
  { path: '/items', redirect: '/settings/items' },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

