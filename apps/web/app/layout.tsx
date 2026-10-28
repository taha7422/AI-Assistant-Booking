import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'AI Assistant Booking',description:'Book and manage appointments with AI-assisted scheduling.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}
