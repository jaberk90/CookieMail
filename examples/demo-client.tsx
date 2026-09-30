import { FooterSignup } from './footer-signup.js';
import { createRoot } from 'react-dom/client';
import { CookieMail } from '../src/react.js';
createRoot(document.getElementById('root')!).render(
  location.pathname === '/subscribe' ? <FooterSignup /> : <CookieMail />,
);
