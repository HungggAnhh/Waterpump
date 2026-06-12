import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Image,
  TouchableOpacity,
  Modal,
  Platform,
  Dimensions,
  Share,
  PanResponder,
  Text,
  ActivityIndicator,
  Animated,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Video, ResizeMode } from 'expo-av';
import { useImageViewerStore, isVideoFile } from '@/store/useImageViewerStore';

const MIN_SCALE = 1;
const MAX_SCALE = 10; // Zoom up to 10x on mobile as requested

export const ImageViewer: React.FC = () => {
  const { visible, images, currentIndex, closeImageViewer } = useImageViewerStore();
  const imageUrl = images[currentIndex] || null;

  // Screen dimensions dynamic tracking (Mobile Rotation handling)
  const [dimensions, setDimensions] = useState(Dimensions.get('window'));
  const screenWidth = dimensions.width;
  const screenHeight = dimensions.height;

  // Image natural dimensions
  const imageDimensions = useRef({ width: 0, height: 0 });

  // Animation values
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const panAnim = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const bgOpacityAnim = useRef(new Animated.Value(0)).current;

  // Local state to keep track of current numerical values for clamping logic
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [loading, setLoading] = useState(true);
  const [spacePressed, setSpacePressed] = useState(false);
  const [cursor, setCursor] = useState<'default' | 'grab' | 'grabbing'>('default');

  // Sync refs to prevent stale closure issues inside event listeners
  const scaleRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  useEffect(() => {
    panRef.current = pan;
  }, [pan]);

  // Listeners to sync Animated values with local state
  useEffect(() => {
    const scaleId = scaleAnim.addListener(({ value }) => setScale(value));
    const panId = panAnim.addListener((val) => setPan({ x: val.x, y: val.y }));
    return () => {
      scaleAnim.removeListener(scaleId);
      panAnim.removeListener(panId);
    };
  }, [scaleAnim, panAnim]);

  // Gestures and Pinch state refs
  const lastTap = useRef(0);
  const isPinching = useRef(false);
  const startPinchDist = useRef(0);
  const startScale = useRef(1);
  const startPan = useRef({ x: 0, y: 0 });

  // Web mouse-wheel container ref
  const containerRef = useRef<any>(null);

  // Calculate actual rendered dimensions of the image on screen under "contain" mode
  const getRenderedImageSize = () => {
    const { width: origWidth, height: origHeight } = imageDimensions.current;
    if (!origWidth || !origHeight) {
      return { width: screenWidth, height: screenHeight };
    }
    const imageRatio = origWidth / origHeight;
    const viewportRatio = screenWidth / screenHeight;

    let renderedWidth = screenWidth;
    let renderedHeight = screenHeight;

    if (imageRatio > viewportRatio) {
      renderedHeight = screenWidth / imageRatio;
    } else {
      renderedWidth = screenHeight * imageRatio;
    }

    return { width: renderedWidth, height: renderedHeight };
  };

  // Get dynamic boundary clamps based on actual image dimensions and zoom scale
  const getBounds = (currentScale: number) => {
    const { width: imgW, height: imgH } = getRenderedImageSize();
    
    // Horizontal boundary
    const maxTx = currentScale > 1 
      ? Math.max(0, (imgW * currentScale - screenWidth) / 2) 
      : (spacePressed ? screenWidth / 2 : 0);
      
    // Vertical boundary
    const maxTy = currentScale > 1 
      ? Math.max(0, (imgH * currentScale - screenHeight) / 2) 
      : (spacePressed ? screenHeight / 2 : 0);

    return { maxTx, maxTy };
  };

  // Desktop Zoom Toolbar Actions
  const zoomIn = () => {
    const next = Math.min(scaleRef.current + 0.1, MAX_SCALE);
    setScale(next);
    Animated.spring(scaleAnim, { toValue: next, useNativeDriver: true }).start();
  };

  const zoomOut = () => {
    const next = Math.max(scaleRef.current - 0.1, MIN_SCALE);
    setScale(next);
    if (next === MIN_SCALE) {
      Animated.parallel([
        Animated.spring(scaleAnim, { toValue: MIN_SCALE, useNativeDriver: true }),
        Animated.spring(panAnim, { toValue: { x: 0, y: 0 }, useNativeDriver: true }),
      ]).start(() => {
        setPan({ x: 0, y: 0 });
      });
    } else {
      const currentPan = panRef.current;
      const { maxTx, maxTy } = getBounds(next);
      const newX = Math.min(Math.max(currentPan.x, -maxTx), maxTx);
      const newY = Math.min(Math.max(currentPan.y, -maxTy), maxTy);

      Animated.parallel([
        Animated.spring(scaleAnim, { toValue: next, useNativeDriver: true }),
        Animated.spring(panAnim, { toValue: { x: newX, y: newY }, useNativeDriver: true }),
      ]).start(() => {
        setPan({ x: newX, y: newY });
      });
    }
  };

  const resetZoom = () => {
    setScale(MIN_SCALE);
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: MIN_SCALE, useNativeDriver: true }),
      Animated.spring(panAnim, { toValue: { x: 0, y: 0 }, useNativeDriver: true }),
    ]).start(() => {
      setPan({ x: 0, y: 0 });
    });
  };

  // Keep refs of functions for global key listener
  const zoomInRef = useRef(zoomIn);
  const zoomOutRef = useRef(zoomOut);
  const resetZoomRef = useRef(resetZoom);

  useEffect(() => {
    zoomInRef.current = zoomIn;
    zoomOutRef.current = zoomOut;
    resetZoomRef.current = resetZoom;
  });

  // Track Web Cursor States
  useEffect(() => {
    if (scale > 1 || spacePressed) {
      setCursor('grab');
    } else {
      setCursor('default');
    }
  }, [scale, spacePressed]);

  // Spacebar Pan Mode (Power User Feature)
  useEffect(() => {
    if (Platform.OS !== 'web' || !visible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        e.preventDefault();
        setSpacePressed(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        setSpacePressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [visible]);

  // Handle mobile rotation / dimension change dynamically
  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      setDimensions(window);
      // Reset scale and pan to prevent image from flying off-screen when rotating
      Animated.parallel([
        Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true }),
        Animated.spring(panAnim, { toValue: { x: 0, y: 0 }, useNativeDriver: true }),
      ]).start();
    });
    return () => subscription.remove();
  }, []);

  // Background fade-in / fade-out
  useEffect(() => {
    if (visible) {
      setLoading(true);
      Animated.timing(bgOpacityAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
      // Reset zoom/pan when opening
      scaleAnim.setValue(1);
      panAnim.setValue({ x: 0, y: 0 });
    } else {
      bgOpacityAnim.setValue(0);
    }
  }, [visible, imageUrl]);

  // ESC key & Ctrl zoom shortcuts on desktop / web
  useEffect(() => {
    if (!visible || Platform.OS !== 'web') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }

      if (e.ctrlKey || e.metaKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          zoomInRef.current();
        } else if (e.key === '-') {
          e.preventDefault();
          zoomOutRef.current();
        } else if (e.key === '0') {
          e.preventDefault();
          resetZoomRef.current();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [visible]);

  // Mouse wheel zoom on Web / Electron Desktop - Registered only once when visible changes
  useEffect(() => {
    const element = containerRef.current;
    if (!element || Platform.OS !== 'web') return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY;

      const currentScale = scaleRef.current;
      const currentPan = panRef.current;

      let newScale = currentScale;
      if (delta < 0) {
        newScale = Math.min(currentScale + 0.1, MAX_SCALE);
      } else {
        newScale = Math.max(currentScale - 0.1, MIN_SCALE);
      }

      if (newScale === MIN_SCALE) {
        Animated.parallel([
          Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true }),
          Animated.spring(panAnim, { toValue: { x: 0, y: 0 }, useNativeDriver: true }),
        ]).start(() => {
          setScale(MIN_SCALE);
        });
      } else {
        // Clamp panning if we scale down
        const { maxTx, maxTy } = getBounds(newScale);
        const newX = Math.min(Math.max(currentPan.x, -maxTx), maxTx);
        const newY = Math.min(Math.max(currentPan.y, -maxTy), maxTy);

        setScale(newScale);
        Animated.parallel([
          Animated.spring(scaleAnim, { toValue: newScale, useNativeDriver: true }),
          Animated.spring(panAnim, { toValue: { x: newX, y: newY }, useNativeDriver: true }),
        ]).start();
      }
    };

    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      element.removeEventListener('wheel', handleWheel);
    };
  }, [visible, screenWidth, screenHeight]);

  // Reset animations and close
  const handleClose = () => {
    Animated.timing(bgOpacityAnim, {
      toValue: 0,
      duration: 150,
      useNativeDriver: true,
    }).start(() => {
      closeImageViewer();
    });
  };

  // Double Click / Double Tap zoom: 1x -> 3x, 3x -> 1x
  const handleDoubleTap = () => {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      if (scaleRef.current > 1.01) {
        resetZoom();
      } else {
        setScale(3);
        Animated.parallel([
          Animated.spring(scaleAnim, { toValue: 3, useNativeDriver: true }),
          Animated.spring(panAnim, { toValue: { x: 0, y: 0 }, useNativeDriver: true }),
        ]).start();
      }
    }
    lastTap.current = now;
  };

  // PanResponder to handle multi-touch pinch and drag panning
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt, gestureState) => {
        const touches = evt.nativeEvent.touches || [];
        if (touches.length === 2) {
          isPinching.current = true;
          const touch1 = touches[0];
          const touch2 = touches[1];
          const dist = Math.sqrt(
            Math.pow(touch2.pageX - touch1.pageX, 2) +
            Math.pow(touch2.pageY - touch1.pageY, 2)
          );
          startPinchDist.current = dist;
          startScale.current = scaleRef.current;
        } else {
          isPinching.current = false;
          startPan.current = { x: panRef.current.x, y: panRef.current.y };
          if (scaleRef.current > 1 || spacePressed) {
            setCursor('grabbing');
          }
        }
      },
      onPanResponderMove: (evt, gestureState) => {
        const touches = evt.nativeEvent.touches || [];
        if (touches.length === 2 && isPinching.current) {
          // Pinch Zooming
          const touch1 = touches[0];
          const touch2 = touches[1];
          const dist = Math.sqrt(
            Math.pow(touch2.pageX - touch1.pageX, 2) +
            Math.pow(touch2.pageY - touch1.pageY, 2)
          );
          const ratio = dist / startPinchDist.current;
          const newScale = Math.min(Math.max(startScale.current * ratio, MIN_SCALE), MAX_SCALE);
          setScale(newScale);
          scaleAnim.setValue(newScale);
        } else if (touches.length <= 1 && !isPinching.current) {
          // Drag Panning
          if (scaleRef.current > 1 || spacePressed) {
            const newX = startPan.current.x + gestureState.dx;
            const newY = startPan.current.y + gestureState.dy;

            // Clamping drag values so the image remains inside visible bounds
            const { maxTx, maxTy } = getBounds(scaleRef.current);

            panAnim.setValue({
              x: Math.min(Math.max(newX, -maxTx), maxTx),
              y: Math.min(Math.max(newY, -maxTy), maxTy),
            });
          } else {
            // Swipe down to close on scale = 1
            if (gestureState.dy > 0) {
              panAnim.y.setValue(gestureState.dy);
              // Fade background as user swipes down
              const opacity = Math.max(1 - gestureState.dy / 300, 0.3);
              bgOpacityAnim.setValue(opacity);
            }
          }
        }
      },
      onPanResponderRelease: (evt, gestureState) => {
        isPinching.current = false;
        setCursor(scaleRef.current > 1 || spacePressed ? 'grab' : 'default');

        if (scaleRef.current === 1 && !spacePressed) {
          if (gestureState.dy > 100) {
            // Swipe down to close triggered
            handleClose();
          } else {
            // Spring back translation and background opacity
            Animated.parallel([
              Animated.spring(panAnim.y, { toValue: 0, useNativeDriver: true }),
              Animated.spring(bgOpacityAnim, { toValue: 1, useNativeDriver: true }),
            ]).start();
          }
        }
      },
    })
  ).current;

  // Download Action (Desktop/Web/Electron)
  const handleDownload = async () => {
    if (!imageUrl) return;
    try {
      const filename = imageUrl.startsWith('data:') ? 'screenshot.png' : (imageUrl.split('/').pop() || 'download.png');
      
      // If running in Electron Desktop: use native download API to handle large screenshots & signed URLs
      const electronInstance = (window as any).electronAPI;
      if (electronInstance && typeof electronInstance.downloadFile === 'function') {
        const res = await electronInstance.downloadFile({ url: imageUrl, filename });
        if (!res.success && res.error !== 'User canceled') {
          alert(`Lỗi tải xuống: ${res.error}`);
        }
        return;
      }

      // Fallback for normal browsers / web
      if (Platform.OS === 'web') {
        let downloadUrl = imageUrl;
        if (!imageUrl.startsWith('data:')) {
          const response = await fetch(imageUrl);
          const blob = await response.blob();
          downloadUrl = window.URL.createObjectURL(blob);
        }
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        if (!imageUrl.startsWith('data:')) {
          window.URL.revokeObjectURL(downloadUrl);
        }
      }
    } catch (err) {
      console.error('Failed to download image', err);
      alert('Không thể tải xuống hình ảnh.');
    }
  };

  // Share Action (Mobile)
  const handleShare = async () => {
    if (!imageUrl) return;
    try {
      const content = imageUrl.startsWith('data:')
        ? { message: 'Ảnh đính kèm từ TeamFlow' }
        : { message: `Ảnh đính kèm từ TeamFlow: ${imageUrl}`, url: imageUrl };
      await Share.share(content);
    } catch (err: any) {
      console.error('Error sharing image', err);
    }
  };

  // Handle Image loaded metadata to get original size
  const handleLoad = (e: any) => {
    setLoading(false);
    const width = e.nativeEvent.source?.width || e.nativeEvent.width;
    const height = e.nativeEvent.source?.height || e.nativeEvent.height;
    if (width && height) {
      imageDimensions.current = { width, height };
    }
  };

  if (!visible || !imageUrl) return null;

  return (
    <Modal
      transparent={true}
      visible={visible}
      animationType="none"
      onRequestClose={handleClose}
      supportedOrientations={['portrait', 'landscape']}
    >
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      
      <Animated.View
        ref={containerRef}
        style={[
          styles.overlay,
          {
            backgroundColor: '#000000',
            opacity: bgOpacityAnim,
          },
          Platform.OS === 'web' && { cursor: cursor as any }
        ]}
        {...(isVideoFile(imageUrl) ? {} : panResponder.panHandlers)}
      >
        {/* Loading Indicator */}
        {loading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#ffffff" />
          </View>
        )}

        {/* Zoomable image container */}
        <Animated.View
          style={[
            styles.imageContainer,
            {
              width: screenWidth,
              height: screenHeight,
              transform: [
                { scale: scaleAnim },
                { translateX: panAnim.x },
                { translateY: panAnim.y },
              ],
            },
          ]}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={isVideoFile(imageUrl) ? undefined : handleDoubleTap}
            style={styles.imagePressable}
            disabled={isVideoFile(imageUrl)}
          >
            {isVideoFile(imageUrl) ? (
              Platform.OS === 'web' ? (
                <video
                  src={imageUrl}
                  style={styles.fullscreenVideo as any}
                  controls
                  autoPlay
                  preload="auto"
                  onLoadedData={() => setLoading(false)}
                />
              ) : (
                <Video
                  source={{ uri: imageUrl }}
                  style={styles.fullscreenVideo}
                  useNativeControls
                  resizeMode={ResizeMode.CONTAIN}
                  shouldPlay={true}
                  isLooping={false}
                  onLoad={() => setLoading(false)}
                />
              )
            ) : (
              <Image
                source={{ uri: imageUrl }}
                style={styles.image}
                resizeMode="contain"
                onLoad={handleLoad}
                onLoadStart={() => {
                  setLoading(true);
                  imageDimensions.current = { width: 0, height: 0 };
                }}
              />
            )}
          </TouchableOpacity>
        </Animated.View>

        {/* Floating Top Header bar */}
        <View style={styles.headerBar}>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={handleClose}
            activeOpacity={0.7}
            accessibilityLabel="Close image viewer"
          >
            <Ionicons name="close" size={26} color="#ffffff" />
          </TouchableOpacity>

          <View style={styles.rightActions}>
            {/* Download Button on Web / Desktop */}
            {Platform.OS === 'web' && (
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={handleDownload}
                activeOpacity={0.7}
                accessibilityLabel="Download image"
              >
                <Ionicons name="download-outline" size={22} color="#ffffff" />
              </TouchableOpacity>
            )}

            {/* Share Button on iOS / Android */}
            {Platform.OS !== 'web' && (
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={handleShare}
                activeOpacity={0.7}
                accessibilityLabel="Share image"
              >
                <Ionicons name="share-social-outline" size={22} color="#ffffff" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Floating Desktop Zoom Toolbar (Web & Electron only) */}
        {Platform.OS === 'web' && !isVideoFile(imageUrl) && (
          <View style={styles.zoomToolbar} pointerEvents="box-none">
            <View style={styles.toolbarContainer}>
              <TouchableOpacity
                style={styles.toolbarBtn}
                onPress={zoomOut}
                disabled={scale <= MIN_SCALE}
                activeOpacity={0.7}
              >
                <Text style={[styles.toolbarBtnText, scale <= MIN_SCALE && styles.disabledText]}>➖</Text>
              </TouchableOpacity>
              
              <View style={styles.toolbarLabel}>
                <Text style={styles.toolbarPercentText}>{Math.round(scale * 100)}%</Text>
              </View>

              <TouchableOpacity
                style={styles.toolbarBtn}
                onPress={zoomIn}
                disabled={scale >= MAX_SCALE}
                activeOpacity={0.7}
              >
                <Text style={[styles.toolbarBtnText, scale >= MAX_SCALE && styles.disabledText]}>➕</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.toolbarResetBtn}
                onPress={resetZoom}
                activeOpacity={0.7}
              >
                <Text style={styles.toolbarResetText}>Reset</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Pagination indicator if we have multiple images (future gallery mode) */}
        {images.length > 1 && (
          <View style={styles.footerBar}>
            <Text style={styles.pageText}>
              {currentIndex + 1} / {images.length}
            </Text>
          </View>
        )}
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContainer: {
    position: 'absolute',
    zIndex: 1,
  },
  imageContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  imagePressable: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  fullscreenVideo: {
    width: '100%',
    height: '100%',
    maxWidth: '100%',
    maxHeight: '100%',
  },
  headerBar: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 44 : 20,
    left: 0,
    right: 0,
    height: 56,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    zIndex: 10,
  },
  rightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomToolbar: {
    position: 'absolute',
    top: 80,
    right: 16,
    zIndex: 100,
  },
  toolbarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 6,
    height: 38,
  },
  toolbarBtn: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toolbarBtnText: {
    fontSize: 14,
    color: '#ffffff',
  },
  disabledText: {
    opacity: 0.35,
  },
  toolbarLabel: {
    paddingHorizontal: 8,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  toolbarPercentText: {
    fontSize: 13,
    color: '#ffffff',
    fontWeight: '600',
    minWidth: 42,
    textAlign: 'center',
  },
  toolbarResetBtn: {
    borderLeftWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    paddingLeft: 10,
    marginLeft: 6,
    height: '60%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  toolbarResetText: {
    color: '#3b82f6',
    fontSize: 12,
    fontWeight: '700',
  },
  footerBar: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 34 : 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 10,
  },
  pageText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
});
