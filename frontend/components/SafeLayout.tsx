import React from 'react';
import { View, StyleSheet, StatusBar, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface SafeLayoutProps {
  children: React.ReactNode;
  bg?: string;
  bottomBg?: string;
}

export default function SafeLayout({ children, bg = '#ffffff', bottomBg = '#ffffff' }: SafeLayoutProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.outerContainer, { backgroundColor: bg }]}>
      {/* Top StatusBar handling */}
      <StatusBar barStyle="dark-content" backgroundColor={bg} translucent />
      
      {/* Upper Margin padding */}
      <View 
        style={[
          styles.innerContainer, 
          { 
            paddingTop: Platform.OS === 'ios' ? insets.top : Math.max(insets.top, StatusBar.currentHeight || 0),
            paddingBottom: insets.bottom
          }
        ]}
      >
        {children}
      </View>
      
      {/* Safe bottom spacer padding backdrop */}
      {insets.bottom > 0 && (
        <View style={[styles.bottomBarSpacer, { height: insets.bottom, backgroundColor: bottomBg }]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
  },
  innerContainer: {
    flex: 1,
  },
  bottomBarSpacer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 99,
  }
});
