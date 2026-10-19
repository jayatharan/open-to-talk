import { SCREEN_QUALITIES, type ScreenQuality } from "@open2talk/core";
import { useState } from "react";
import { loadScreenQuality, saveScreenQuality } from "./screenQuality";

export interface ScreenSource {
  id: string;
  name: string;
  /** data: URL thumbnail */
  thumbnail: string;
  kind: "screen" | "window";
}

export interface ScreenSourcePickerProps {
  sources: ScreenSource[];
  /** Whether system audio will be captured with this choice (OS dependent). */
  audioSupported: boolean;
  onPick: (id: string | null) => void;
}

/** Source picker for Electron, where there is no built-in browser chooser. */
export function ScreenSourcePicker({ sources, audioSupported, onPick }: ScreenSourcePickerProps) {
  const screens = sources.filter((s) => s.kind === "screen");
  const windows = sources.filter((s) => s.kind === "window");
  // Saved right away; the call reads it when the share starts.
  const [quality, setQuality] = useState<ScreenQuality>(loadScreenQuality);
  return (
    <div className="o2t-modal" role="dialog" aria-modal="true" onClick={() => onPick(null)}>
      <div className="o2t-card o2t-picker" onClick={(e) => e.stopPropagation()}>
        <h2>Share your screen</h2>
        <p className="o2t-muted">
          {audioSupported ? "System audio will be shared too." : "System audio capture is not supported on this OS; video only."}
        </p>
        {[
          ["Screens", screens],
          ["Windows", windows],
        ].map(([title, list]) =>
          (list as ScreenSource[]).length ? (
            <section key={title as string}>
              <h3>{title as string}</h3>
              <div className="o2t-picker-grid">
                {(list as ScreenSource[]).map((s) => (
                  <button key={s.id} className="o2t-picker-item" onClick={() => onPick(s.id)}>
                    <img src={s.thumbnail} alt="" />
                    <span>{s.name}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null,
        )}
        <div className="o2t-picker-foot">
          <label className="o2t-muted">
            Quality{" "}
            <select
              value={quality}
              onChange={(e) => {
                const q = e.target.value as ScreenQuality;
                setQuality(q);
                saveScreenQuality(q);
              }}
            >
              {SCREEN_QUALITIES.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.label}
                </option>
              ))}
            </select>
          </label>
          <button className="o2t-btn" onClick={() => onPick(null)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
