import { useRef, useState, type PropsWithChildren, type PointerEvent } from 'react';

type Rotation = { x: number; y: number };

export function RotatableObject({ children, label }: PropsWithChildren<{ label: string }>) {
  const [rotation, setRotation] = useState<Rotation>({ x: -8, y: -12 });
  const drag = useRef<{ x: number; y: number; origin: Rotation; moved: boolean } | null>(null);
  const wasDragged = useRef(false);

  const start = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = { x: event.clientX, y: event.clientY, origin: rotation, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) drag.current.moved = true;
    setRotation({ x: Math.max(-35, Math.min(35, drag.current.origin.x - dy * .3)), y: drag.current.origin.y + dx * .55 });
  };
  const stop = (event: PointerEvent<HTMLDivElement>) => {
    wasDragged.current = !!drag.current?.moved;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return <div className="sbs-rotatable-object" role="button" tabIndex={0} aria-label={`${label}. Drag or tap to rotate.`}
    onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop}
    onClick={() => { if (!wasDragged.current) setRotation(value => ({ ...value, y: value.y + 35 })); wasDragged.current = false; }}
    onKeyDown={event => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); setRotation(value => ({ ...value, y: value.y + (event.key === 'ArrowRight' ? 20 : -20) })); }
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setRotation(value => ({ ...value, y: value.y + 35 })); }
    }}
    style={{ width: '100%', display: 'flex', justifyContent: 'center', cursor: 'grab', touchAction: 'pan-y', userSelect: 'none', WebkitUserSelect: 'none' }}>
    <div style={{ width: '100%', transform: `perspective(850px) rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)`, willChange: 'transform', pointerEvents: 'none' }}>{children}</div>
  </div>;
}
