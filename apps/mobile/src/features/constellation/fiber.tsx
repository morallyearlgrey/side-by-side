// Install the native Performance compatibility before R3F creates its renderer.
import './nativePerformance';

export { Canvas, useFrame, useThree } from '@react-three/fiber/native';
