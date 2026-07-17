import './globals.css';

export const metadata = {
    title: 'Orion Orch Panel',
    description: 'PBAC-governed control panel for the Orion cluster orchestrator'
};

export default function RootLayout({ children }) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}
