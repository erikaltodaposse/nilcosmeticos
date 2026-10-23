import { api } from './api.js';
import { loginView } from './views/login.js';
import { changePinView } from './views/change-pin.js';
import { managerView } from './views/manager.js';
import { todayView } from './views/today.js';

const root = document.getElementById('app');

function mount(view) {
  root.replaceChildren(view);
  window.scrollTo(0, 0);
}

let today = null;

function route(user) {
  if (!user) return mount(loginView({ onLogin: (u) => refresh(u) }));
  if (user.must_change_pin) return mount(changePinView({ user, onDone: (u) => refresh(u), onLogout: logout }));
  if (user.role === 'employee') return mount(todayView({ user, date: today, onLogout: logout }));
  mount(managerView({ user, today, onLogout: logout }));
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
