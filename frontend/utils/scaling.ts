import { Dimensions, PixelRatio } from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Baseline design dimensions (e.g., standard iPhone scale base)
const baseWidth = 375;
const baseHeight = 812;

const scaleWidth = SCREEN_WIDTH / baseWidth;
const scaleHeight = SCREEN_HEIGHT / baseHeight;

/**
 * Scale dimension horizontally (padding, margins, widths)
 */
export const scale = (size: number): number => {
  return PixelRatio.roundToNearestPixel(size * scaleWidth);
};

/**
 * Scale dimension vertically (heights, header sizes)
 */
export const verticalScale = (size: number): number => {
  return PixelRatio.roundToNearestPixel(size * scaleHeight);
};

/**
 * Moderate Scaling: Introduces a factor to prevent extreme blowing up on tablets
 */
export const moderateScale = (size: number, factor = 0.5): number => {
  return PixelRatio.roundToNearestPixel(size + (scale(size) - size) * factor);
};

/**
 * Scale font size based on screen width + pixel ratio adjustments
 */
export const scaleFont = (size: number): number => {
  const newSize = size * scaleWidth;
  return Math.round(PixelRatio.roundToNearestPixel(newSize));
};
