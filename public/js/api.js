// Cliente fino para a API. Erros viram ApiError com o código e a mensagem do servidor.

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function call(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network_error', 'Sem conexão com o servidor. Confira a internet e tente de novo.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, data.error || 'unknown', data.message || 'Algo deu errado. Tente de novo.');
  }
  return data;
}

export const api = {
  me: () => call('GET', '/api/me'),
  loginPin: (pin) => call('POST', '/api/auth/login/pin', { pin }),
  loginPassword: (email, password) => call('POST', '/api/auth/login/password', { email, password }),
  logout: () => call('POST', '/api/auth/logout'),
  changePin: (currentPin, newPin) =>
    call('POST', '/api/auth/change-pin', { current_pin: currentPin, new_pin: newPin }),
  day: (date) => call('GET', `/api/day/${date}`),
  checkIn: (date) => call('POST', `/api/day/${date}/checkin`),
  checkOut: (date) => call('POST', `/api/day/${date}/checkout`),
  markTask: (date, taskId) => call('PUT', `/api/day/${date}/tasks/${taskId}`),
  unmarkTask: (date, taskId) => call('DELETE', `/api/day/${date}/tasks/${taskId}`),
  closeDay: (date) => call('POST', `/api/day/${date}/close`),
};
