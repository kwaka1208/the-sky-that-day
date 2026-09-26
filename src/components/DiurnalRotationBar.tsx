interface DiurnalRotationBarProps {
  rotationMinutes: number;
  autoRotating: boolean;
  onShift(deltaMinutes: number): void;
  onToggleAuto(): void;
  onReset(): void;
}

/** 入力した観測時刻からのずれを「＋2時間30分」の形にする。 */
function formatOffset(minutes: number) {
  const rounded = Math.round(minutes);
  if (rounded === 0) return '入力した時刻';
  const sign = rounded > 0 ? '＋' : '−';
  const total = Math.abs(rounded);
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const remainder = total % 60;
  const parts = [
    days ? `${days}日` : '',
    hours ? `${hours}時間` : '',
    remainder || (!days && !hours) ? `${remainder}分` : '',
  ].filter(Boolean);
  return `${sign}${parts.join('')}`;
}

const STEPS = [
  { delta: -60, label: '◀◀', description: '1時間戻す' },
  { delta: -10, label: '◀', description: '10分戻す' },
] as const;

const FORWARD_STEPS = [
  { delta: 10, label: '▶', description: '10分進める' },
  { delta: 60, label: '▶▶', description: '1時間進める' },
] as const;

export function DiurnalRotationBar({
  rotationMinutes,
  autoRotating,
  onShift,
  onToggleAuto,
  onReset,
}: DiurnalRotationBarProps) {
  return (
    <div className="diurnal-bar" role="group" aria-label="日周回転">
      <button
        type="button"
        onClick={onReset}
        disabled={!autoRotating && Math.round(rotationMinutes) === 0}
        aria-label="日周回転を戻す"
      >
        ↺
      </button>
      {STEPS.map(({ delta, label, description }) => (
        <button key={delta} type="button" onClick={() => onShift(delta)} aria-label={description}>{label}</button>
      ))}
      <button
        type="button"
        className={`diurnal-auto${autoRotating ? ' active' : ''}`}
        onClick={onToggleAuto}
        aria-pressed={autoRotating}
        aria-label={autoRotating ? '自動回転を止める' : '自動回転を始める'}
      >
        <span aria-hidden="true">{autoRotating ? '❙❙' : '▶'}</span>{autoRotating ? '停止' : '自動'}
      </button>
      {FORWARD_STEPS.map(({ delta, label, description }) => (
        <button key={delta} type="button" onClick={() => onShift(delta)} aria-label={description}>{label}</button>
      ))}
      <output className="diurnal-offset" aria-live="polite">{formatOffset(rotationMinutes)}</output>
    </div>
  );
}
