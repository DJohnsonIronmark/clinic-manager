import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/context/AuthContext';
import UserMenu from '@/components/UserMenu';

export const metadata: Metadata = {
  title: 'Clinic Territory Manager',
  description: 'Manage clinic territories and boundaries',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.css"
          rel="stylesheet"
        />
        <link
          rel="stylesheet"
          href="https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-draw/v1.4.3/mapbox-gl-draw.css"
        />
      </head>
      <body>
        <AuthProvider>
          <div className="fixed top-2 right-2 z-50">
            <UserMenu />
          </div>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
