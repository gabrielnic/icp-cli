import { AuthClient } from '@icp-sdk/auth/client';
import { HttpAgent } from '@icp-sdk/core/agent';
import { getCanisterEnv } from '@icp-sdk/core/agent/canister-env';
import { IDL } from '@icp-sdk/core/candid';

/**
 * The asset canister exposes `ic_env`.
 * We read the backend canister ID and the local network root key from there.
 */
const env = getCanisterEnv();
const backendCanisterId = env['PUBLIC_CANISTER_ID:backend'];
const rootKey = env.IC_ROOT_KEY;
const host = window.location.origin;
const iiUrl = `${window.location.protocol}//id.ai.localhost:${window.location.port || '4943'}/`;

/** @type {AuthClient | undefined} */
let authClient;
/** @type {import('@icp-sdk/core/agent').Agent | undefined} */
let authenticatedAgent;

const app = document.querySelector('#app');

app.innerHTML = `
  <main class="shell">
    <section class="hero">
      <p class="eyebrow">ICP CLI Example</p>
      <h1>Local II Signed Query Repro</h1>
      <p class="subtitle">
        Anonymous query should work. Internet Identity login should work. The first signed query is expected to fail
        with a delegation trust error in the affected local managed topology.
      </p>
    </section>

    <section class="panel">
      <dl class="meta">
        <div>
          <dt>Host</dt>
          <dd>${escapeHtml(host)}</dd>
        </div>
        <div>
          <dt>Backend Canister</dt>
          <dd>${escapeHtml(backendCanisterId)}</dd>
        </div>
        <div>
          <dt>II URL</dt>
          <dd>${escapeHtml(iiUrl)}</dd>
        </div>
      </dl>

      <div class="actions">
        <button id="anonymous-query">Anonymous Query</button>
        <button id="login">Login With Internet Identity</button>
        <button id="signed-query">Signed Query</button>
        <button id="clear-auth" class="secondary">Clear Auth State</button>
      </div>
    </section>

    <section class="panel">
      <div class="log-header">
        <h2>Log</h2>
        <button id="clear-log" class="secondary small">Clear</button>
      </div>
      <pre id="log" class="log"></pre>
    </section>
  </main>
`;

const elements = {
  anonymousQuery: document.querySelector('#anonymous-query'),
  login: document.querySelector('#login'),
  signedQuery: document.querySelector('#signed-query'),
  clearAuth: document.querySelector('#clear-auth'),
  clearLog: document.querySelector('#clear-log'),
  log: document.querySelector('#log')
};

attachStyles();
bindEvents();
log('Ready', {
  host,
  backendCanisterId,
  iiUrl,
  rootKeyLength: rootKey.length
});

function bindEvents() {
  elements.anonymousQuery.addEventListener('click', () => run('anonymous_query', anonymousQuery));
  elements.login.addEventListener('click', () => run('login', loginWithInternetIdentity));
  elements.signedQuery.addEventListener('click', () => run('signed_query', signedQuery));
  elements.clearAuth.addEventListener('click', () => run('clear_auth', clearAuthState));
  elements.clearLog.addEventListener('click', () => {
    elements.log.textContent = '';
  });
}

async function run(label, action) {
  try {
    await action();
  } catch (error) {
    log(`${label} failed`, formatError(error));
  }
}

async function anonymousQuery() {
  const agent = HttpAgent.createSync({
    host,
    rootKey
  });

  const result = await greet(agent, 'ICP CLI');
  log('Anonymous query succeeded', result);
}

async function loginWithInternetIdentity() {
  authClient ??= await AuthClient.create();

  if (!(await authClient.isAuthenticated())) {
    log('Starting AuthClient.login()', { identityProvider: iiUrl });
    await new Promise((resolve, reject) => {
      authClient.login({
        identityProvider: iiUrl,
        customValues: { prompt: 'login' },
        onSuccess: () => resolve(),
        onError: error => reject(new Error(error ?? 'Internet Identity login failed'))
      });
    });
  }

  const identity = authClient.getIdentity();
  authenticatedAgent = HttpAgent.createSync({
    host,
    identity,
    rootKey
  });

  log('Authenticated agent ready', {
    principal: identity.getPrincipal().toText(),
    host
  });
}

async function signedQuery() {
  if (!authenticatedAgent) {
    await loginWithInternetIdentity();
  }

  const result = await greet(authenticatedAgent, 'Internet Identity');
  log('Signed query succeeded', result);
}

async function greet(agent, name) {
  const response = await agent.query(backendCanisterId, {
    methodName: 'greet',
    arg: IDL.encode([IDL.Text], [name])
  });

  if (response.status !== 'replied') {
    return {
      status: response.status,
      rejectCode: response.reject_code,
      rejectMessage: response.reject_message,
      errorCode: response.error_code,
      httpDetails: response.httpDetails
    };
  }

  const [greeting] = IDL.decode([IDL.Text], response.reply.arg);
  return {
    greeting
  };
}

async function clearAuthState() {
  authenticatedAgent = undefined;
  authClient = undefined;

  for (const key of ['ic-identity', 'ic-delegation', 'ic-iv']) {
    localStorage.removeItem(key);
  }

  const deleteDatabase = name =>
    new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => resolve();
    });

  try {
    if (typeof indexedDB.databases === 'function') {
      const databases = await indexedDB.databases();
      const authDatabases = databases
        .map(database => database.name)
        .filter(name => typeof name === 'string' && name.startsWith('auth-client-db'));

      await Promise.all(authDatabases.map(deleteDatabase));
    } else {
      await deleteDatabase('auth-client-db');
    }
  } catch (error) {
    log('Best-effort auth cleanup failed', formatError(error));
  }

  log('Cleared persisted AuthClient state');
}

function formatError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return error;
}

function log(message, data) {
  const timestamp = new Date().toLocaleTimeString();
  const payload = data === undefined ? '' : `\n${safeStringify(data)}`;
  elements.log.textContent = `[${timestamp}] ${message}${payload}\n\n${elements.log.textContent}`;
}

function safeStringify(value) {
  return JSON.stringify(
    value,
    (_key, item) => {
      if (typeof item === 'bigint') {
        return item.toString();
      }

      if (item instanceof Uint8Array) {
        return `Uint8Array(${item.length})`;
      }

      return item;
    },
    2
  );
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function attachStyles() {
  const style = document.createElement('style');
  style.textContent = `
    :root {
      color-scheme: light;
      --bg: #f5efe6;
      --panel: rgba(255, 251, 245, 0.9);
      --line: rgba(53, 37, 22, 0.12);
      --text: #24180e;
      --muted: #675746;
      --accent: #0b7a63;
      --accent-strong: #085a49;
      --soft: #efe3d2;
      font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(11, 122, 99, 0.18), transparent 28%),
        radial-gradient(circle at bottom right, rgba(176, 104, 64, 0.13), transparent 30%),
        var(--bg);
    }

    .shell {
      max-width: 980px;
      margin: 0 auto;
      padding: 36px 18px 56px;
    }

    .hero {
      margin-bottom: 22px;
    }

    .eyebrow {
      margin: 0 0 10px;
      font-size: 0.84rem;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--accent);
    }

    h1 {
      margin: 0 0 12px;
      font-size: clamp(2rem, 4vw, 3.2rem);
      letter-spacing: -0.04em;
    }

    .subtitle {
      margin: 0;
      max-width: 70ch;
      color: var(--muted);
      line-height: 1.55;
    }

    .panel {
      padding: 18px;
      border-radius: 20px;
      border: 1px solid var(--line);
      background: var(--panel);
      backdrop-filter: blur(12px);
      box-shadow: 0 16px 50px rgba(38, 27, 18, 0.08);
    }

    .panel + .panel {
      margin-top: 16px;
    }

    .meta {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
      margin: 0 0 16px;
    }

    .meta div {
      padding: 14px 16px;
      border-radius: 14px;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.62);
    }

    .meta dt {
      margin-bottom: 6px;
      font-size: 0.88rem;
      color: var(--muted);
    }

    .meta dd {
      margin: 0;
      word-break: break-word;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }

    button {
      border: 0;
      border-radius: 999px;
      padding: 11px 16px;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      background: var(--accent);
      color: white;
      transition: transform 140ms ease, background 140ms ease;
    }

    button:hover {
      transform: translateY(-1px);
      background: var(--accent-strong);
    }

    button.secondary {
      background: var(--soft);
      color: var(--text);
    }

    button.secondary:hover {
      background: #e7d8c5;
    }

    button.small {
      padding: 8px 12px;
      font-size: 0.9rem;
    }

    .log-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }

    .log-header h2 {
      margin: 0;
      font-size: 1rem;
    }

    .log {
      margin: 0;
      min-height: 280px;
      max-height: 60vh;
      overflow: auto;
      padding: 16px;
      border-radius: 16px;
      background: rgba(26, 21, 17, 0.95);
      color: #f6efe4;
      border: 1px solid rgba(22, 16, 12, 0.1);
      font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
      font-size: 0.92rem;
      line-height: 1.45;
    }

    @media (max-width: 720px) {
      .shell {
        padding: 24px 14px 40px;
      }

      .panel {
        padding: 16px;
      }

      .actions {
        flex-direction: column;
      }

      button {
        width: 100%;
      }
    }
  `;

  document.head.append(style);
}
