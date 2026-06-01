import { useWindowDimensions } from 'react-native';

export type DeviceType = 'smallPhone' | 'largePhone' | 'tablet' | 'desktop';
export type Orientation = 'portrait' | 'landscape';

export interface ResponsiveConfig {
  width: number;
  height: number;
  deviceType: DeviceType;
  orientation: Orientation;
  isPhone: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isPortrait: boolean;
  isLandscape: boolean;
}

export const useResponsive = (): ResponsiveConfig => {
  const { width, height } = useWindowDimensions();

  // Determine Orientation
  const orientation: Orientation = width >= height ? 'landscape' : 'portrait';

  // Determine Device Type based on logical width
  let deviceType: DeviceType = 'largePhone';
  if (width < 360) {
    deviceType = 'smallPhone';
  } else if (width >= 360 && width < 768) {
    deviceType = 'largePhone';
  } else if (width >= 768 && width < 1024) {
    deviceType = 'tablet';
  } else {
    deviceType = 'desktop';
  }

  return {
    width,
    height,
    deviceType,
    orientation,
    isPhone: deviceType === 'smallPhone' || deviceType === 'largePhone',
    isTablet: deviceType === 'tablet',
    isDesktop: deviceType === 'desktop',
    isPortrait: orientation === 'portrait',
    isLandscape: orientation === 'landscape',
  };
};
