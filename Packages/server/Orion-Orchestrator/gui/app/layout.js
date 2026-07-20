import './globals.css';

export const metadata = {
    title: 'Orion Orch Panel',
    description: 'PBAC-governed control panel for the Orion cluster orchestrator'
};

/**
 * No `data-theme` is rendered here on purpose. AdminServer stamps it onto <html>
 * at serve time from ORION_GUI_THEME / systemAdmin.http.theme, so one static
 * export serves either theme without a rebuild.
 *
 * Baking a default in would embed it in the RSC flight payload too, and React
 * would reconcile the served value away on hydration. An attribute React never
 * set is one it leaves alone — so the stamp survives. Absent any stamp (e.g.
 * `next dev`), globals.css falls back to the modern token block on :root.
 */
export default function RootLayout({ children }) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}
