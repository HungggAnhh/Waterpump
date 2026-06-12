import { create } from 'zustand';

interface ImageViewerStore {
  visible: boolean;
  images: string[];
  currentIndex: number;
  openImageViewer: (images: string | string[], initialIndex?: number) => void;
  closeImageViewer: () => void;
  setCurrentIndex: (index: number) => void;
}

export const isImageFile = (url: string | null | undefined, mimeType?: string | null): boolean => {
  if (!url) return false;

  // 1. data:image/* base64 URIs
  if (url.startsWith('data:image/')) {
    return true;
  }

  // 2. image mime type if available
  if (mimeType && mimeType.toLowerCase().startsWith('image/')) {
    return true;
  }

  const lowerUrl = url.toLowerCase();

  // Extract path without query parameters
  const pathWithoutQuery = lowerUrl.split('?')[0];

  // 3. image file extensions
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
  const hasImageExtension = imageExtensions.some(ext => pathWithoutQuery.endsWith(ext));
  if (hasImageExtension) {
    return true;
  }

  // 4. Supabase Storage image URLs
  // Supabase storage public/private URLs: check if the path contains storage/v1/object/public/ or storage/v1/object/private/
  // AND has an image-related bucket/keyword/extension
  if (lowerUrl.includes('/storage/v1/object/public/') || lowerUrl.includes('/storage/v1/object/private/')) {
    const filename = pathWithoutQuery.split('/').pop() || '';
    const isImageFilename = imageExtensions.some(ext => filename.endsWith(ext)) ||
                            filename.includes('avatar') ||
                            filename.includes('screenshot');
    if (isImageFilename) {
      return true;
    }
  }

  return false;
};

export const isVideoFile = (url: string | null | undefined): boolean => {
  if (!url) return false;
  const lowerUrl = url.toLowerCase();
  const pathWithoutQuery = lowerUrl.split('?')[0];
  const videoExtensions = ['.mp4', '.mov', '.m4v', '.avi', '.webm', '.mkv', '.3gp'];
  return videoExtensions.some(ext => pathWithoutQuery.endsWith(ext));
};

export const useImageViewerStore = create<ImageViewerStore>((set) => ({
  visible: false,
  images: [],
  currentIndex: 0,

  openImageViewer: (images, initialIndex = 0) => {
    const imagesArray = Array.isArray(images) ? images : [images];
    
    // Filter out any null, undefined or non-string values
    const validImages = imagesArray.filter((img): img is string => typeof img === 'string' && img.length > 0);
    
    if (validImages.length === 0) return;

    set({
      visible: true,
      images: validImages,
      currentIndex: Math.min(Math.max(initialIndex, 0), validImages.length - 1),
    });
  },

  closeImageViewer: () => set({ visible: false, images: [], currentIndex: 0 }),
  
  setCurrentIndex: (index) => set((state) => ({
    currentIndex: Math.min(Math.max(index, 0), state.images.length - 1)
  })),
}));

export const openImageViewer = (images: string | string[], initialIndex = 0) => {
  useImageViewerStore.getState().openImageViewer(images, initialIndex);
};
