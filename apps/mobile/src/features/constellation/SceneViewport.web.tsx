import { useEffect, useRef, useState, type ReactNode } from 'react';

export function SceneViewport({ children }: { children: (visible: boolean) => ReactNode }) {
  const element = useRef<HTMLDivElement>(null); const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (!element.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  return <div ref={element} style={{ width: '100%', height: '100%', touchAction: 'pan-y' }}>{children(visible)}</div>;
}
