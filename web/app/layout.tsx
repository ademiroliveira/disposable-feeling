import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'Disposable Feeling',
  description:
    'A daily generative release. Agents read the mood of the world and turn it into a track and a poster. Each one is playable for seven days.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
