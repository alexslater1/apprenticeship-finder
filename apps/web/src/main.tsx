import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { consumeAuthRedirect } from './lib/authRedirect';
import './index.css';

// Invite/reset links put tokens in the hash; handle them before HashRouter reads it.
consumeAuthRedirect().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
