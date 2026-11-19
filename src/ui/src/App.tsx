import { Navigate, Route, Routes } from 'react-router-dom';
import { PrivateRoute } from './auth/PrivateRoute';
import { AppLayout } from './components/layout/AppLayout';
import { About } from './pages/About';
import { Home } from './pages/Home';
import { NotFound } from './pages/NotFound';
import { ApiKeysPage } from './pages/organisations/ApiKeysPage';
import { MembersTab } from './pages/organisations/MembersTab';
import { OrganisationLayout } from './pages/organisations/OrganisationLayout';
import { OrganisationSettingsTab } from './pages/organisations/OrganisationSettingsTab';
import { OrganisationsPage } from './pages/organisations/OrganisationsPage';
import { ModelsPage } from './pages/organisations/ModelsPage';
import { NodePage } from './pages/organisations/NodePage';
import { PoolPage } from './pages/organisations/PoolPage';
import { PoolsTab } from './pages/organisations/PoolsTab';
import { AuditPage } from './pages/organisations/AuditPage';
import { UsageTab } from './pages/organisations/UsageTab';
import { MetricsTab } from './pages/organisations/MetricsTab';
import { Playground } from './pages/Playground';
import { UserSettings } from './pages/UserSettings';

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Home />} />
        <Route path="about" element={<About />} />
        <Route element={<PrivateRoute />}>
          <Route path="user-settings" element={<UserSettings />} />
          <Route path="playground" element={<Playground />} />
          <Route path="organisations" element={<OrganisationsPage />} />
          <Route path="organisations/:orgId" element={<OrganisationLayout />}>
            <Route index element={<Navigate to="models" replace />} />
            <Route path="pools" element={<PoolsTab />} />
            <Route path="pools/:poolId" element={<PoolPage />} />
            <Route path="models" element={<ModelsPage />} />
            <Route path="nodes/:nodeId" element={<NodePage />} />
            <Route path="api-keys" element={<ApiKeysPage />} />
            <Route path="members" element={<MembersTab />} />
            <Route path="usage" element={<UsageTab />} />
            <Route path="metrics" element={<MetricsTab />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="settings" element={<OrganisationSettingsTab />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
