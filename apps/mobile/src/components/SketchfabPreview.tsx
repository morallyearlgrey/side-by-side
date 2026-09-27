import { useRef, useState } from 'react';
import { Animated, Image, Pressable, View } from 'react-native';
import { sketchfabModels, type SketchfabModelKey } from '@/lib/sketchfabModels';
import { modelCutouts } from '@/lib/modelCutouts';

export function SketchfabPreview({ model, height = 320 }: { model: SketchfabModelKey; height?: number }) {
  const interactive = model === 'planet' || model === 'venus';
  const [selected, setSelected] = useState(false);
  const scale = useRef(new Animated.Value(1.35)).current;
  const item = sketchfabModels[model];
  const toggleSize = () => {
    Animated.spring(scale, { toValue: selected ? 1.35 : 1.8, useNativeDriver: true, friction: 7 }).start();
    setSelected(value => !value);
  };
  return <View style={{ height, width: '100%', alignItems: 'center' }}>
    {interactive ? <Pressable onPress={toggleSize} accessibilityRole="button" accessibilityLabel={`${selected ? 'Shrink' : 'Enlarge'} ${item.title}`} accessibilityState={{ selected }} style={{ width: '100%', flex: 1 }}><Animated.Image source={modelCutouts[model]} resizeMode="contain" style={{ width: '100%', height: '100%', transform: [{ scale }] }} /></Pressable> : <Image source={modelCutouts[model]} resizeMode="contain" style={{ width: '100%', flex: 1 }} accessibilityLabel={`${item.title} transparent model illustration`} />}
  </View>;
}
