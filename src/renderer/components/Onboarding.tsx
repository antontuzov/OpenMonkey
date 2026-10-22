import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Cpu, Lock, Palette, ShieldCheck, Sparkles, WifiOff } from "lucide-react";
import { ModelDownloadCard } from "./ModelDownloadCard";
import { ACCENTS } from "../constants";
import {
  MOOD_LOGOS,
  type AgentStatus,
  type Config,
  type ConfigPatch,
  type ModelStatus,
  type Mood,
} from "../../utils/types";

interface OnboardingProps {
  status: AgentStatus;
  mood: Mood;
  config: Config;
  onPatch: (patch: ConfigPatch) => Promise<void>;
  onRefreshStatus: () => Promise<void>;
}

const STEPS = ["Welcome", "Identity", "Approvals", "Model"];

const FEATURES = [
  {
    icon: Cpu,
    title: "The model lives here",
    copy: "Bonsai-4B runs on this Mac. No account, API key or request leaves the machine.",
  },
  {
    icon: ShieldCheck,
    title: "Nothing runs silently",
    copy: "File writes, shell commands and drafts stop for approval first. You can change that later.",
  },
  {
    icon: Palette,
    title: "Twelve moods, one agent",
    copy: "The avatar follows the conversation and reaches the window, tray and Dock.",
  },
];

export const Onboarding: React.FC<OnboardingProps> = ({ status, mood, config, onPatch, onRefreshStatus }) => {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(config.agent.name);
  const [personality, setPersonality] = useState(config.agent.personality);
  const [accent, setAccent] = useState(config.ui.accent ?? ACCENTS[0].value);
  const [autoExecute, setAutoExecute] = useState(config.agent.autoExecuteTasks);
  const [models, setModels] = useState<ModelStatus | null>(null);
  const [finishing, setFinishing] = useState(false);

  const logo = MOOD_LOGOS[mood] ?? MOOD_LOGOS.neutral;
  const ready = status.state === "ready";

  useEffect(() => {
    void window.electron?.getModelStatus().then(setModels).catch(() => undefined);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.getPropertyValue("--color-accent");
    root.style.setProperty("--color-accent", accent);
    return () => root.style.setProperty("--color-accent", previous);
  }, [accent]);

  const refreshModels = async () => {
    const next = await window.electron?.getModelStatus();
    if (next) setModels(next);
    await onRefreshStatus();
  };

  const finish = async () => {
    setFinishing(true);
    try {
      await onPatch({
        agent: {
          ...config.agent,
          name: name.trim() || "OpenMonkey",
          personality,
          autoExecuteTasks: autoExecute,
        },
        ui: { ...config.ui, accent },
        onboarding: { completed: true },
      });
    } finally {
      setFinishing(false);
    }
  };

  const skip = async () => {
    setFinishing(true);
    try {
      await onPatch({ onboarding: { completed: true } });
    } finally {
      setFinishing(false);
    }
  };

  const next = () => {
    if (step === STEPS.length - 1) void finish();
    else setStep((current) => current + 1);
  };

  return (
    <div className="flex h-screen bg-paper">
      <aside className="drag-region hidden md:flex w-[360px] shrink-0 bg-card-2 border-r border-line relative overflow-hidden">
        <div className="deco-lines" />
        <div className="relative flex flex-col w-full px-8 pt-16 pb-8">
          <div className="flex items-center gap-2.5">
            <img src={`/logos/${logo.file}`} alt="" className="w-8 h-8 rounded-full" />
            <span className="text-[13px] font-semibold tracking-tight">OpenMonkey</span>
          </div>

          <div className="mt-14 flex justify-center">
            <img
              src={`/logos/${logo.file}`}
              alt=""
              className="w-[170px] h-[170px] rounded-full logo-mood-change"
              style={{ boxShadow: `0 0 0 2px ${accent}33, 0 24px 60px -24px ${accent}aa` }}
            />
          </div>

          <p className="mt-12 text-[22px] leading-[1.25] font-semibold tracking-tight">
            Local, private,
            <br />
            and a little bit wild.
          </p>
          <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
            A full agent with a face, a memory of this conversation, and no server in the middle.
          </p>

          <div className="mt-auto space-y-2.5 text-[10.5px] text-muted">
            <p className="flex items-center gap-2">
              <Lock size={11} className="text-faint" />
              Encrypted history, stored on this Mac
            </p>
            <p className="flex items-center gap-2">
              <WifiOff size={11} className="text-faint" />
              Inference works offline
            </p>
            <p className="text-[9.5px] text-faint pt-2">OpenMonkey 0.9 · macOS</p>
          </div>
        </div>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col">
        <div className="drag-region h-10 shrink-0" />

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-[620px] mx-auto px-10 pb-10">
            <div className="flex gap-1.5">
              {STEPS.map((label, index) => (
                <div
                  key={label}
                  className={`h-1 flex-1 rounded-full ${index <= step ? "bg-accent" : "bg-line"}`}
                />
              ))}
            </div>
            <p className="section-label mt-3">
              Step {step + 1} of {STEPS.length} · {STEPS[step]}
            </p>

            {step === 0 && (
              <div className="pt-8">
                <div className="chip chip-accent">
                  <Sparkles size={11} />
                  Welcome
                </div>
                <h1 className="text-[30px] leading-[1.15] font-semibold tracking-tight mt-4 max-w-[480px]">
                  A capable agent that stays on your Mac.
                </h1>
                <p className="text-[12px] leading-relaxed text-muted mt-3 max-w-[460px]">
                  Set up the model, choose how much autonomy to grant, and give it a face. About a minute, no
                  account required.
                </p>

                <div className="card mt-8">
                  {FEATURES.map((feature) => {
                    const Icon = feature.icon;
                    return (
                      <div key={feature.title} className="row">
                        <div className="flex items-center gap-3">
                          <span className="w-8 h-8 rounded-lg bg-card-2 border border-line flex items-center justify-center shrink-0">
                            <Icon size={14} className="text-muted" />
                          </span>
                          <div>
                            <p className="row-title">{feature.title}</p>
                            <p className="row-copy">{feature.copy}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="pt-8">
                <h1 className="text-[30px] leading-[1.15] font-semibold tracking-tight">Make it yours.</h1>
                <p className="text-[12px] leading-relaxed text-muted mt-3">
                  These values live in the system prompt and the interface. The weights never change.
                </p>

                <div className="card mt-8">
                  <div className="row">
                    <div className="flex items-center gap-3">
                      <img
                        src={`/logos/${logo.file}`}
                        alt=""
                        className="w-11 h-11 rounded-full logo-mood-change"
                        style={{ boxShadow: `0 0 0 2px var(--color-card), 0 0 0 3px ${accent}55` }}
                      />
                      <div>
                        <p className="row-title">This is how it looks</p>
                        <p className="row-copy">Avatar follows the mood. Accent follows your choice.</p>
                      </div>
                    </div>
                    <span className="chip" style={{ color: accent }}>
                      {logo.label}
                    </span>
                  </div>

                  <div className="row">
                    <div>
                      <p className="row-title">Display name</p>
                      <p className="row-copy">Used in the sidebar, replies and system prompt.</p>
                    </div>
                    <input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      aria-label="Display name"
                      className="field w-[240px] !h-9"
                      placeholder="OpenMonkey"
                      autoFocus
                    />
                  </div>

                  <div className="row">
                    <div>
                      <p className="row-title">Personality</p>
                      <p className="row-copy">A tone hint, not fine-tuning.</p>
                    </div>
                    <div className="segmented">
                      {[
                        { value: "helpful", label: "Helpful" },
                        { value: "concise", label: "Concise" },
                        { value: "playful", label: "Playful" },
                      ].map((option) => (
                        <button
                          key={option.value}
                          onClick={() => setPersonality(option.value)}
                          className={personality === option.value ? "segmented-active" : ""}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-6">
                  <p className="section-label">Accent</p>
                  <div className="card p-5">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      {ACCENTS.map((item) => {
                        const selected = item.value.toLowerCase() === accent.toLowerCase();
                        return (
                          <button
                            key={item.name}
                            onClick={() => setAccent(item.value)}
                            title={item.name}
                            aria-label={item.name}
                            aria-pressed={selected}
                            className={`swatch ${selected ? "swatch-selected" : ""}`}
                            style={{ background: item.value }}
                          >
                            {selected && <Check size={14} strokeWidth={3} />}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[10.5px] text-muted mt-4">
                      {ACCENTS.find((item) => item.value === accent)?.name ?? "Custom"} · applied across the app and
                      stored locally.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="pt-8">
                <h1 className="text-[30px] leading-[1.15] font-semibold tracking-tight">You stay in control.</h1>
                <p className="text-[12px] leading-relaxed text-muted mt-3">
                  Tool calls can change files, run commands or draft mail. Choose what needs a human first.
                </p>

                <div className="space-y-2.5 mt-8">
                  <button
                    onClick={() => setAutoExecute(false)}
                    className={`w-full text-left card p-4 flex items-start gap-3.5 transition-colors ${
                      !autoExecute ? "border-accent bg-accent-soft" : "hover:border-ink/20"
                    }`}
                  >
                    <span
                      className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 mt-0.5 ${
                        !autoExecute ? "border-accent bg-accent text-[#06251a]" : "border-line"
                      }`}
                    >
                      {!autoExecute && <Check size={12} strokeWidth={3} />}
                    </span>
                    <span>
                      <span className="flex items-center gap-2">
                        <span className="row-title">Ask before every action</span>
                        <span className="chip chip-accent">Recommended</span>
                      </span>
                      <span className="row-copy block mt-1">
                        Every file write, shell command, web fetch and mail draft waits for Allow once. Reads still
                        ask in this build.
                      </span>
                    </span>
                  </button>

                  <button
                    onClick={() => setAutoExecute(true)}
                    className={`w-full text-left card p-4 flex items-start gap-3.5 transition-colors ${
                      autoExecute ? "border-accent bg-accent-soft" : "hover:border-ink/20"
                    }`}
                  >
                    <span
                      className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 mt-0.5 ${
                        autoExecute ? "border-accent bg-accent text-[#06251a]" : "border-line"
                      }`}
                    >
                      {autoExecute && <Check size={12} strokeWidth={3} />}
                    </span>
                    <span>
                      <span className="row-title">Run tools freely</span>
                      <span className="row-copy block mt-1">
                        Actions execute without a prompt. Filesystem access stays inside Documents, Downloads and
                        Desktop, plus any folder you add later in Settings.
                      </span>
                    </span>
                  </button>
                </div>

                <div className="card p-4 flex items-start gap-2.5 mt-6">
                  <ShieldCheck size={14} className="text-faint mt-0.5 shrink-0" />
                  <p className="text-[11px] text-muted leading-relaxed">
                    Approval prompts show the exact tool, action and arguments before anything changes. You can
                    switch this any time in Settings → Approvals.
                  </p>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="pt-8">
                <h1 className="text-[30px] leading-[1.15] font-semibold tracking-tight">Give it a brain.</h1>
                <p className="text-[12px] leading-relaxed text-muted mt-3">
                  One local model runs every reply. The download is resumable and checked before it is loaded.
                </p>

                <div className="card mt-8 p-1">
                  <div className="p-4">
                    <ModelDownloadCard
                      installed={models?.bonsaiAvailable ?? false}
                      ready={ready}
                      onChanged={refreshModels}
                    />
                  </div>
                </div>

                <div className="card mt-6">
                  <div className="row">
                    <div className="flex items-center gap-3">
                      <span className="w-7 h-7 rounded-lg bg-card-2 flex items-center justify-center">
                        <Lock size={13} className="text-muted" />
                      </span>
                      <div>
                        <p className="row-title">No account, no keys</p>
                        <p className="row-copy">The download comes from Hugging Face; inference never does.</p>
                      </div>
                    </div>
                  </div>
                  <div className="row">
                    <div className="flex items-center gap-3">
                      <span className="w-7 h-7 rounded-lg bg-card-2 flex items-center justify-center">
                        <Cpu size={13} className="text-muted" />
                      </span>
                      <div>
                        <p className="row-title">You can finish without it</p>
                        <p className="row-copy">Download later from Settings → Model. Chat explains what is missing.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <footer className="shrink-0 border-t border-line px-10 py-4 flex items-center justify-between gap-4 bg-paper">
          <div>
            {step > 0 ? (
              <button onClick={() => setStep((current) => current - 1)} className="btn">
                <ArrowLeft size={13} />
                Back
              </button>
            ) : (
              <button
                onClick={() => void skip()}
                disabled={finishing}
                className="text-[11px] text-muted hover:text-ink"
              >
                Skip setup
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[10px] text-faint">
              {step === 3 && !ready ? "You can keep downloading after setup." : "Stored locally · no telemetry"}
            </span>
            <button
              onClick={next}
              disabled={finishing || (step === 1 && !name.trim())}
              className="btn btn-primary btn-lg"
            >
              {finishing ? "Saving…" : step === 0 ? "Get started" : step === 3 ? "Finish setup" : "Continue"}
              <ArrowRight size={14} />
            </button>
          </div>
        </footer>
      </main>
    </div>
  );
};

export default Onboarding;
