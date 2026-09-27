import { useState } from 'react';
import { Asset } from 'expo-asset';
import { sketchfabModels, type SketchfabModelKey } from '@/lib/sketchfabModels';
import { modelCutouts } from '@/lib/modelCutouts';

export function SketchfabPreview({ model, height = 320 }: { model: SketchfabModelKey; height?: number }) {
  const interactive = model === 'planet' || model === 'venus';
  const [selected, setSelected] = useState(false);
  const item = sketchfabModels[model];
  const illustration = <img src={Asset.fromModule(modelCutouts[model]).uri} alt={`${item.title} transparent model illustration`} loading={model === 'mars' ? 'eager' : 'lazy'} draggable={false} />;
  return <div className={`sbs-model-preview ${interactive ? 'is-interactive' : ''} ${selected ? 'is-selected' : ''}`} style={{ height }}>
    <style>{`
      .sbs-model-preview{width:100%;position:relative;background:transparent;isolation:isolate}
      .sbs-model-preview>img{width:100%;height:100%;display:block;object-fit:contain;object-position:center;filter:drop-shadow(0 24px 32px #0009)}
      .sbs-model-preview .model-object{display:block;width:100%;height:100%;padding:0;border:0;background:transparent;backdrop-filter:none;cursor:pointer;overflow:visible}
      .sbs-model-preview .model-object:hover{background:transparent;border:0;transform:none}
      .sbs-model-preview .model-object img{display:block;width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 24px 32px #0009);transform:scale(1.35);transition:transform .35s cubic-bezier(.2,.7,.2,1)}
      .sbs-model-preview.is-interactive .model-object:hover img{transform:scale(1.65)}
      .sbs-model-preview.is-selected .model-object img,.sbs-model-preview.is-selected .model-object:hover img{transform:scale(1.85)}
      .sbs-model-preview .model-object:focus-visible{outline:2px solid #FFE6DC;outline-offset:3px;border-radius:18px}
      @media(prefers-reduced-motion:reduce){.sbs-model-preview .model-object img{transition:none}}
    `}</style>
    {interactive ? <button type="button" className="model-object" aria-label={`${selected ? 'Shrink' : 'Enlarge'} ${item.title}`} aria-pressed={selected} onClick={() => setSelected(value => !value)}>{illustration}</button> : illustration}
  </div>;
}
