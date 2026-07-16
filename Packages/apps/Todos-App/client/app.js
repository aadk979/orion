import { orion, SERVER_URL } from './orion-client.js';

const listEl = document.getElementById('todo-list');
const emptyState = document.getElementById('empty-state');
const form = document.getElementById('todo-form');
const input = document.getElementById('todo-input');
const alertEl = document.getElementById('alert-global');
const navEmail = document.getElementById('nav-email');
const loadingOverlay = document.getElementById('loading-overlay');

// Not a real device-integrity signal — just a stable per-browser value so the
// server's mandatory `orion-fingerprint` header is present on every request.
// The server requires a 64-character hex string, so a raw UUID won't pass —
// hash it first.
async function sha256Hex(input) {
    const data = new TextEncoder().encode(input);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

let deviceFingerprint = localStorage.getItem('todos-demo-fingerprint');
if (!deviceFingerprint) {
    deviceFingerprint = await sha256Hex(crypto.randomUUID());
    localStorage.setItem('todos-demo-fingerprint', deviceFingerprint);
}

function showAlert(msg, type = 'error') {
    alertEl.textContent = msg;
    alertEl.className = `alert alert-${type} show`;
    setTimeout(() => alertEl.classList.remove('show'), 4000);
}

async function apiFetch(path, method = 'GET', body) {
    const response = await fetch(`${SERVER_URL}${path}`, {
        method,
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            'orion-fingerprint': deviceFingerprint,
            'orion-user-agent': navigator.userAgent,
            'orion-api-system-version': '1.0.0',
            Authorization: 'ACCESS_BEARER'
        },
        body: body !== undefined ? JSON.stringify(body) : undefined
    });

    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function renderTodos(todos) {
    listEl.innerHTML = '';
    emptyState.style.display = todos.length === 0 ? 'block' : 'none';

    for (const todo of todos) {
        const row = document.createElement('div');
        row.className = 'section-row';

        const info = document.createElement('label');
        info.className = 'todo-info';
        info.innerHTML = `
            <input type="checkbox" class="todo-check" ${todo.done ? 'checked' : ''} />
            <span class="todo-title ${todo.done ? 'done' : ''}">${escapeHtml(todo.title)}</span>
        `;
        info.querySelector('.todo-check').addEventListener('change', (e) => toggleTodo(todo.id, e.target.checked));

        const actions = document.createElement('div');
        actions.className = 'section-row-actions';
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn btn-sm btn-danger';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', () => deleteTodo(todo.id));
        actions.appendChild(deleteBtn);

        row.appendChild(info);
        row.appendChild(actions);
        listEl.appendChild(row);
    }
}

async function loadTodos() {
    const { status, data } = await apiFetch('/todos');

    if (status !== 200) {
        showAlert(data.message || 'Failed to load todos.');
        return;
    }

    renderTodos(data.todos);
}

async function toggleTodo(id, done) {
    const { status, data } = await apiFetch(`/todos/${id}`, 'PATCH', { done });

    if (status !== 200) {
        showAlert(data.message || 'Failed to update todo.');
        return;
    }

    await loadTodos();
}

async function deleteTodo(id) {
    const { status, data } = await apiFetch(`/todos/${id}`, 'DELETE');

    if (status !== 200) {
        showAlert(data.message || 'Failed to delete todo.');
        return;
    }

    await loadTodos();
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = input.value.trim();
    if (!title) return;

    const { status, data } = await apiFetch('/todos', 'POST', { title });

    if (status !== 201) {
        showAlert(data.message || 'Failed to add todo.');
        return;
    }

    input.value = '';
    await loadTodos();
});

document.getElementById('sign-out-btn').addEventListener('click', async () => {
    try {
        await orion.signOutUser();
        window.location.href = './auth.html';
    } catch (err) {
        showAlert(err.message || 'Sign out failed.');
    }
});

orion.onAuthStateChanged(async (state) => {
    if (state.status === 'UNAUTHENTICATED') {
        window.location.href = './auth.html';
    } else if (state.status === 'AUTHENTICATED') {
        if (state.user) navEmail.textContent = state.user.email || 'Signed In';
        loadingOverlay.classList.add('hidden');
        await loadTodos();
    } else if (state.status === 'ERROR') {
        loadingOverlay.classList.add('hidden');
        showAlert('Failed to initialize: ' + state.error.message);
    }
});
