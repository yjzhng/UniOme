import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createHashRouter, RouterProvider, Navigate } from 'react-router-dom';
import BrowserPage from './pages/BrowserPage';
import EntryPage from './pages/EntryPage';
import HomePage from './pages/HomePage';
import LegalPage from './pages/LegalPage';
import Layout from './Layout';
import './styles.css';
import './molstar-dark.css'; // Mol*'s dark theme, scoped under .dark (applies only in dark mode)

// HashRouter: routes live under '/#/…' so the app loads from a single index.html with no server
// rewrite — robust when the desktop shell serves it from the embedded server (and on a static host).
const router = createHashRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'legal', element: <LegalPage /> },
      { path: 'o/:taxid/c/:chrom', element: <BrowserPage /> },
      // Splat (not `/entry` + `/entry/:id`) so EntryPage stays one mounted instance across selecting,
      // switching, and deselecting genes — that's what keeps its recently-viewed pool alive.
      { path: 'o/:taxid/c/:chrom/entry/*', element: <EntryPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
