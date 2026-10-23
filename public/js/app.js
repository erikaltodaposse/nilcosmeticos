import { api } from './api.js';
import { loginView } from './views/login.js';
import { changePinView } from './views/change-pin.js';
import { homeView } from './views/home.js';

const root = document.getElementById('app');

function mount(view) {
  root.replaceChildren(view);
  window.scrollTo(0, 0);
}

function route(user) {
  if (!user) return mount(loginView({ onLogin: route }));
  if (user.must_change_pin) return mount(changePinView({ user, onDone: route, onLogout: logout }));
  mount(homeView({ user, onLogout: logout }));
}

async function logout() {
  try {
    await api.logout();
  } finally {
    route(null);
  }
}

async function boot() {
  try {
    const { user } = await api.me();
    route(user);
  } catch {
    route(null);
  }
}

boot();
