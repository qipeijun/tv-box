import { useId } from "react";
import { Switch } from "radix-ui";
export function PlaybackOptions({
  autoNext,
  error,
  onChange,
}: {
  autoNext: boolean;
  error: string;
  onChange: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="playback-options">
      <div className="playback-option">
        <label htmlFor={id}>
          自动下一集<span>仅沿当前线路继续</span>
        </label>
        <Switch.Root
          id={id}
          className="playback-switch"
          aria-describedby={error ? `${id}-error` : undefined}
          checked={autoNext}
          onCheckedChange={onChange}
        >
          <Switch.Thumb className="playback-switch-thumb" />
        </Switch.Root>
      </div>
      {error ? <p id={`${id}-error`} role="status">{error}</p> : null}
    </div>
  );
}
