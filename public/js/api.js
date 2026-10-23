// Cliente fino para a API. Erros viram ApiError com o código e a mensagem do servidor.

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function call(method, url, body) {
  const isForm = body instanceof FormData;
  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body && !isForm ? { 'Content-Type': 'application/json' } : {},
      body: isForm ? body : body ? JSON.stringify(body) : undefined,
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
  checkIn: (date, nfcToken) => call('POST', `/api/day/${date}/checkin`, nfcToken ? { nfc_token: nfcToken } : undefined),
  checkOut: (date, nfcToken) => call('POST', `/api/day/${date}/checkout`, nfcToken ? { nfc_token: nfcToken } : undefined),
  nfc: () => call('GET', '/api/manager/nfc'),
  rotateNfc: () => call('POST', '/api/manager/nfc/rotate'),
  markTask: (date, taskId) => call('PUT', `/api/day/${date}/tasks/${taskId}`),
  unmarkTask: (date, taskId) => call('DELETE', `/api/day/${date}/tasks/${taskId}`),
  closeDay: (date) => call('POST', `/api/day/${date}/close`),
  uploadPhoto: (date, taskId, blob) => {
    const form = new FormData();
    form.append('photo', blob, 'foto.jpg');
    return call('POST', `/api/day/${date}/tasks/${taskId}/photo`, form);
  },
  getChecklist: (weekday) => call('GET', `/api/manager/checklist/${weekday}`),
  saveChecklist: (weekday, body) => call('PUT', `/api/manager/checklist/${weekday}`, body),
  restoreChecklist: (weekday) => call('POST', `/api/manager/checklist/${weekday}/restore`),
  getSettings: () => call('GET', '/api/manager/settings'),
  saveSettings: (body) => call('PUT', '/api/manager/settings', body),
  listPosts: () => call('GET', '/api/manager/posts'),
  createPost: (body) => call('POST', '/api/manager/posts', body),
  updatePost: (id, body) => call('PUT', `/api/manager/posts/${id}`, body),
  deletePost: (id) => call('DELETE', `/api/manager/posts/${id}`),
  photoUrl: (date, taskId, version, userId) =>
    `/api/day/${date}/tasks/${taskId}/photo?v=${encodeURIComponent(version || '')}${userId ? `&user_id=${userId}` : ''}`,
  dayOf: (date, userId) => call('GET', `/api/day/${date}${userId ? `?user_id=${userId}` : ''}`),
  summary: (query) => call('GET', `/api/manager/summary?${query}`),
  days: (query) => call('GET', `/api/manager/days?${query}`),
  failures: (query) => call('GET', `/api/manager/failures?${query}`),
};
