import './style.css';
export const runtime = 'nodejs';
export const metadata = { title: 'Scacchi · Laboratorio ML', description: 'Quanto contano apertura, orario e pause nelle mie partite bullet? Modelli a confronto su dati reali.' };
export default function Layout({ children }) { return <html lang="it"><body>{children}</body></html>; }
