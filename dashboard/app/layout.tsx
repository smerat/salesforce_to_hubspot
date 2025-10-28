import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Salesforce to HubSpot Migration Dashboard',
  description: 'Monitor and manage data migration from Salesforce to HubSpot',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
