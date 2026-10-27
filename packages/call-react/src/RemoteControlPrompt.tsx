export interface RemoteControlPromptProps {
  /** The person asking to control this device's screen. */
  name: string;
  onAllow: () => void;
  onDeny: () => void;
}

/** Asks the person sharing their screen whether someone may control it. */
export function RemoteControlPrompt({ name, onAllow, onDeny }: RemoteControlPromptProps) {
  return (
    <div className="o2t-modal" role="alertdialog" aria-modal="true" aria-labelledby="o2t-rc-title">
      <div className="o2t-card o2t-form o2t-rc-prompt">
        <h2 id="o2t-rc-title">{name} wants to control your screen</h2>
        <p className="o2t-muted">
          They will be able to move your mouse, click and type on the screen you are sharing. You can take control back at
          any time.
        </p>
        <div className="o2t-rc-actions">
          <button className="o2t-btn" onClick={onDeny} autoFocus>
            Deny
          </button>
          <button className="o2t-btn o2t-primary" onClick={onAllow}>
            Allow control
          </button>
        </div>
      </div>
    </div>
  );
}
