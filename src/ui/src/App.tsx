import { Navigate, Route, Routes } from 'react-router-dom';
import { PrivateRoute } from './auth/PrivateRoute';
import { AppLayout } from './components/layout/AppLayout';
import { PublicLayout } from './components/layout/PublicLayout';
import { About } from './pages/About';
import { Contact } from './pages/Contact';
import { Home } from './pages/Home';
import { Privacy, Terms } from './pages/Legal';
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
      {/* Public pages: top header, no sidebar. */}
      <Route element={<PublicLayout />}>
        <Route index element={<Home />} />
        <Route path="about" element={<About />} />
        <Route path="terms" element={<Terms />} />
        <Route path="privacy" element={<Privacy />} />
        <Route path="contact" element={<Contact />} />
      </Route>
      {/* The signed-in app: sidebar. */}
      <Route element={<PrivateRoute />}>
        <Route element={<AppLayout />}>
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
      </Route>
      <Route element={<PublicLayout />}>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
