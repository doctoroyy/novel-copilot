import { useEffect, useState } from 'react';

function getViewportHeight(): number {
  if (typeof window === 'undefined') return 0;
  return Math.round(window.visualViewport?.height || window.innerHeight || 0);
}

export function useVisualViewportHeight(): number {
  const [height, setHeight] = useState<number>(() => getViewportHeight());

  useEffect(() => {
    const vv = window.visualViewport;
    const update = () => setHeight(getViewportHeight());

    update();
    window.addEventListener('resize', update);

    if (vv) {
      vv.addEventListener('resize', update);
      vv.addEventListener('scroll', update);
    }

    return () => {
      window.removeEventListener('resize', update);
      if (vv) {
        vv.removeEventListener('resize', update);
        vv.removeEventListener('scroll', update);
      }
    };
  }, []);

  return height;
}
