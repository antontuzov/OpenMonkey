import { useEffect, useState } from "react";
import { MOODS, MOOD_LOGOS, type AgentStatus, type Config, type ModelStatus, type Mood } from "../../utils/types";

interface SettingsViewProps {
  status: AgentStatus;
  mood: Mood;
}

type Section = "model" | "agent" | "privacy" | "appearance";

const NAV: Array<{ group: string; items: Array<{ id: Section; label: string; glyph: string }> }> = [
  {
    group: "Connections",
    items: [{ id: "model", label: "Model", glyph: "🧠" }],
  },
  {
    group: "Agent",
    items: [
      { id: "agent", label: "Identity & approvals", glyph: "🤖" },
      { id: "privacy", label: "Privacy", glyph: "🔒" },
    ],
  },
  {
    group: "This Mac",
    items: [{ id: "appearance", label: "Mood", glyph: "🎭" }],
  },
];

const TITLES: Record<Section, { title: string; lede: string }> = {
  model: {
    title: "Model",
    lede: "OpenMonkey answers with weights that live on this machine. Pick the backend and how creative it gets.",
  },
  agent: {
    title: "Identity & approvals",
    lede: "How the assistant introduces itself, and whether tool actions ask first.",
  },
  privacy: {
    title: "Privacy",
    lede: "Chat history and tasks are stored in a local SQLite file. These controls decide how long that stays readable.",
  },
  appearance: {
    title: "Mood",
    lede: "Twelve expressions drive the avatar, the Dock tile and the menu bar icon. Messages switch it automatically.",
  },
};

export const SettingsView: React.FC<SettingsViewProps> = ({ status, mood }) => {
  const [section, setSection] = useState<Section>("model");
  const [settings, setSettings] = useState<Config | null>(null);
  const [models, setModels] = useState<ModelStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const api = window.electron;
    if (!api) return;
    void api.getConfig().then(setSettings).catch(() => undefined);
    void api.getModelStatus().then(setModels).catch(() => undefined);
  }, []);

  const patch = async (changes: Partial<Config>) => {
    const updated = await window.electron?.setConfig(changes);
    if (updated) setSettings(updated);
  };

  const switchProvider = async (provider: "mlx" | "bonsai") => {
    setBusy(true);
    try {
      await window.electron?.switchProvider(provider);
      setSettings((current) => current && { ...current, model: { ...current.model, provider } });
      const next = await window.electron?.getModelStatus();
      if (next) setModels(next);
    } finally {
      setBusy(false);
    }
  };

  if (!settings) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-muted text-xs">Loading settings…</p>
      </div>
    );
  }

  const { model, agent, privacy } = settings;
  const head = TITLES[section];

  return (
    <div className="flex flex-1 min-h-0">
      <nav className="w-[200px] shrink-0 border-r border-line p-3 overflow-y-auto">
        {NAV.map((group) => (
          <div key={group.group} className="mb-5">
            <p className="section-label px-2">{group.group}</p>
            <div className="space-y-1">
              {group.items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSection(item.id)}
                  className={`nav-item text-xs ${section === item.id ? "nav-item-active" : ""}`}
                >
                  <span aria-hidden>{item.glyph}</span>
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto px-8 py-7">
        <div className="max-w-2xl">
          <h1 className="page-title">{head.title}</h1>
          <p className="lede text-xs mb-7">{head.lede}</p>

          {section === "model" && (
            <div className="card">
              <div className="row">
                <div>
                  <p className="row-title">Backend</p>
                  <p className="row-copy">
                    Active: {status.provider ?? "none"}. MLX needs Apple Silicon plus{" "}
                    <code className="text-ink">npm run download-models -- --mlx</code>.
                  </p>
                </div>
                <div className="segmented">
                  {(["bonsai", "mlx"] as const).map((provider) => {
                    const available = provider === "bonsai" ? models?.bonsaiAvailable : models?.mlxAvailable;
                    return (
                      <button
                        key={provider}
                        disabled={!available || busy || status.provider === provider}
                        onClick={() => void switchProvider(provider)}
                        title={available ? `Switch to ${provider}` : `${provider} model not downloaded`}
                        className={status.provider === provider ? "segmented-active" : ""}
                      >
                        {provider === "bonsai" ? "Bonsai 4B" : "MLX"}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="row">
                <div>
                  <p className="row-title">Temperature</p>
                  <p className="row-copy">Lower answers more predictably. Currently {model.temperature.toFixed(2)}.</p>
                </div>
                <div className="flex items-center gap-3 w-[190px]">
                  <input
                    type="range"
                    min={0}
                    max={1.5}
                    step={0.05}
                    value={model.temperature}
                    onChange={(event) => void patch({ model: { ...model, temperature: Number(event.target.value) } })}
                    className="flex-1"
                  />
                  <span className="text-muted text-xs w-9 text-right">{model.temperature.toFixed(2)}</span>
                </div>
              </div>

              <div className="row">
                <div>
                  <p className="row-title">Max tokens</p>
                  <p className="row-copy">Hard cap for a single reply.</p>
                </div>
                <input
                  type="number"
                  min={128}
                  max={8192}
                  step={128}
                  value={model.maxTokens}
                  onChange={(event) =>
                    void patch({ model: { ...model, maxTokens: Math.max(128, Number(event.target.value) || 128) } })
                  }
                  className="field w-[110px]"
                />
              </div>
            </div>
          )}

          {section === "agent" && (
            <div className="card">
              <div className="row">
                <div>
                  <p className="row-title">Name</p>
                  <p className="row-copy">How the assistant refers to itself in replies.</p>
                </div>
                <input
                  defaultValue={agent.name}
                  onBlur={(event) => {
                    const name = event.target.value.trim();
                    if (name && name !== agent.name) void patch({ agent: { ...agent, name } });
                  }}
                  className="field w-[180px]"
                />
              </div>

              <div className="row">
                <div>
                  <p className="row-title">Personality</p>
                  <p className="row-copy">Steers the system prompt, not the weights.</p>
                </div>
                <select
                  value={agent.personality}
                  onChange={(event) => void patch({ agent: { ...agent, personality: event.target.value } })}
                  className="field"
                >
                  <option value="helpful">Helpful</option>
                  <option value="concise">Concise</option>
                  <option value="playful">Playful</option>
                </select>
              </div>

              <div className="row">
                <div>
                  <p className="row-title">Run tool actions without asking</p>
                  <p className="row-copy">
                    Off by default: file writes, shell commands and mail drafts each get an approval prompt.
                  </p>
                </div>
                <button
                  role="switch"
                  aria-checked={agent.autoExecuteTasks}
                  onClick={() => void patch({ agent: { ...agent, autoExecuteTasks: !agent.autoExecuteTasks } })}
                  className={`toggle ${agent.autoExecuteTasks ? "toggle-on" : ""}`}
                />
              </div>
            </div>
          )}

          {section === "privacy" && (
            <div className="card">
              <div className="row">
                <div>
                  <p className="row-title">Save conversation history</p>
                  <p className="row-copy">When off, messages stay in memory for the current run only.</p>
                </div>
                <button
                  role="switch"
                  aria-checked={privacy.saveHistory}
                  onClick={() => void patch({ privacy: { ...privacy, saveHistory: !privacy.saveHistory } })}
                  className={`toggle ${privacy.saveHistory ? "toggle-on" : ""}`}
                />
              </div>

              <div className="row">
                <div>
                  <p className="row-title">Encrypt stored data</p>
                  <p className="row-copy">AES-256-GCM with a key file in this app's support folder.</p>
                </div>
                <button
                  role="switch"
                  aria-checked={privacy.encryptData}
                  onClick={() => void patch({ privacy: { ...privacy, encryptData: !privacy.encryptData } })}
                  className={`toggle ${privacy.encryptData ? "toggle-on" : ""}`}
                />
              </div>

              <div className="row">
                <div>
                  <p className="row-title">Auto-delete after</p>
                  <p className="row-copy">Older messages and tasks are pruned on startup.</p>
                </div>
                <div className="segmented">
                  {[7, 30, 90, 365].map((days) => (
                    <button
                      key={days}
                      onClick={() => void patch({ privacy: { ...privacy, autoDeleteAfter: days } })}
                      className={privacy.autoDeleteAfter === days ? "segmented-active" : ""}
                    >
                      {days}d
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {section === "appearance" && (
            <div className="card p-5">
              <div className="grid grid-cols-6 gap-4">
                {MOODS.map((name) => (
                  <button
                    key={name}
                    onClick={() => void window.electron?.setMood(name)}
                    className={`flex flex-col items-center gap-2 rounded-xl p-2 border ${
                      name === mood ? "border-accent bg-accent-soft" : "border-transparent hover:bg-card-2"
                    }`}
                  >
                    <img src={`/logos/${MOOD_LOGOS[name].file}`} alt="" className="w-12 h-12 rounded-full" />
                    <span className="text-[10px] text-muted">{MOOD_LOGOS[name].label}</span>
                  </button>
                ))}
              </div>
              <p className="text-muted text-xs mt-4">
                Current: <span className="text-ink">{MOOD_LOGOS[mood].label}</span>. The same image is used for the
                Dock tile and the menu bar icon.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
