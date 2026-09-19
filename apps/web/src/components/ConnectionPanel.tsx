import { useState, useEffect } from 'react';

interface Props {
  apiKey: string;
  onConnect: (key: string) => void;
  onDisconnect: () => void;
  status: string;
  statusKind: 'idle' | 'ready' | 'error';
}

export function ConnectionPanel({ apiKey, onConnect, onDisconnect, status, statusKind }: Props) {
  const [input, setInput] = useState(apiKey);

  useEffect(() => {
    setInput(apiKey);
  }, [apiKey]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    onConnect(trimmed);
  };

  return (
    <section className="panel">
      <h2>Connection</h2>
      <form onSubmit={handleSubmit} className="connection-form">
        <label htmlFor="api-key">API Key</label>
        <div className="row">
          <input
            id="api-key"
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste the API key issued for this tenant"
            spellCheck={false}
            className="input"
          />
          <button type="submit" className="btn primary">Connect</button>
          <button type="button" className="btn" onClick={onDisconnect}>
            Clear
          </button>
        </div>
      </form>
      <p className={`status ${statusKind}`}>{status}</p>
      <p className="hint">
        API URL: <code>{import.meta.env.VITE_API_URL || window.location.origin}</code>
      </p>
    </section>
  );
}
