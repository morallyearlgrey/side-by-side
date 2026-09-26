import { Canvas as WebCanvas, type CanvasProps } from '@react-three/fiber';
export { useFrame, useThree } from '@react-three/fiber';
export function Canvas(props: CanvasProps) { return <WebCanvas {...props} dpr={[1, 1.5]} />; }
