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
        <button className="o2t-btn" onClick={() => onPick(null)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
