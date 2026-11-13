import { Route, Routes } from 'react-router-dom';
import { PrivateRoute } from './auth/PrivateRoute';
import { AppLayout } from './components/layout/AppLayout';
import { About } from './pages/About';
import { Home } from './pages/Home';
import { Settings } from './pages/Settings';

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Home />} />
        <Route path="about" element={<About />} />
        <Route element={<PrivateRoute />}>
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Home />} />
      </Route>
    </Routes>
  );
}
