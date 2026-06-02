import { Dimensions, PixelRatio, Platform } from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Baseline design dimensions (e.g., standard iPhone scale base)
const baseWidth = 375;
const baseHeight = 812;

// Calculate scale factor with tablet limits (max 1.3 scale factor)
let scaleWidth = SCREEN_WIDTH / baseWidth;
let scaleHeight = SCREEN_HEIGHT / baseHeight;

if (scaleWidth > 1.3) {
  scaleWidth = 1.3;
}
if (scaleHeight > 1.3) {
  scaleHeight = 1.3;
}

/**
 * Scale dimension horizontally (padding, margins, widths)
 */
export const scale = (size: number): number => {
  if (Platform.OS === 'web') return size;
  return PixelRatio.roundToNearestPixel(size * scaleWidth);
};

/**
 * Scale dimension vertically (heights, header sizes)
 */
export const verticalScale = (size: number): number => {
  if (Platform.OS === 'web') return size;
  return PixelRatio.roundToNearestPixel(size * scaleHeight);
};

/**
 * Moderate Scaling: Introduces a factor to prevent extreme blowing up on tablets
 */
export const moderateScale = (size: number, factor = 0.5): number => {
  if (Platform.OS === 'web') return size;
  return PixelRatio.roundToNearestPixel(size + (scale(size) - size) * factor);
};

/**
 * Scale font size based on screen width + pixel ratio adjustments
 */
export const scaleFont = (size: number): number => {
  if (Platform.OS === 'web') return size;
  const newSize = size * scaleWidth;
  return Math.round(PixelRatio.roundToNearestPixel(newSize));
};

