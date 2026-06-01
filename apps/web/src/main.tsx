import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import BrowserPage from './pages/BrowserPage';
import EntryPage from './pages/EntryPage';
import HomePage from './pages/HomePage';
import Layout from './Layout';
import './styles.css';

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'o/:taxid/c/:chrom', element: <BrowserPage /> },
      { path: 'o/:taxid/c/:chrom/entry/:id', element: <EntryPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
