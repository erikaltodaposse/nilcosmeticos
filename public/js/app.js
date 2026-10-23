import { api } from './api.js';
import { loginView } from './views/login.js';
import { changePinView } from './views/change-pin.js';
import { managerView } from './views/manager.js';
import { todayView } from './views/today.js';

const root = document.getElementById('app');

function mount(view, title) {
  document.title = title ? `${title} · Checkpoint Nil` : 'Checkpoint Nil';
  root.replaceChildren(view);
  window.scrollTo(0, 0);
}

let today = null;

// Link da etiqueta NFC (/ponto/<código>): guarda o código até a funcionária entrar e tira-o da barra de endereço.
const NFC_KEY = 'nfc_token';
let pendingNfc = null;
const nfcMatch = window.location.pathname.match(/^\/ponto\/([A-Za-z0-9_-]{32})$/);
if (nfcMatch) {
  pendingNfc = nfcMatch[1];
  try { sessionStorage.setItem(NFC_KEY, pendingNfc); } catch { /* navegação privada: fica só na memória */ }
  window.history.replaceState(null, '', '/');
} else {
  try { pendingNfc = sessionStorage.getItem(NFC_KEY); } catch { /* idem */ }
}

function takeNfc() {
  const token = pendingNfc;
  pendingNfc = null;
  try { sessionStorage.removeItem(NFC_KEY); } catch { /* idem */ }
  return token;
}

function route(user) {
  if (!user) return mount(loginView({ onLogin: (u) => refresh(u) }), 'Entrar');
  if (user.must_change_pin) return mount(changePinView({ user, onDone: (u) => refresh(u), onLogout: logout }), 'Criar PIN');
  if (user.role === 'employee') return mount(todayView({ user, date: today, nfcToken: takeNfc(), onLogout: logout }), 'Hoje');
  takeNfc();
  mount(managerView({ user, today, onLogout: logout }), 'Gestão');
}

// Relê /api/me para obter a data de hoje segundo o servidor (fuso da loja).
async function refresh(fallbackUser) {
  try {
    const me = await api.me();
    today = me.today;
    route(me.user);
  } catch {
    route(fallbackUser ?? null);
  }
}

async function logout() {
  try {
    await api.logout();
  } finally {
    route(null);
  }
}

refresh(null);
