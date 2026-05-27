// frontend/components/RelativeTime.tsx
import React, { useState, useEffect } from 'react';
import { Text, TextProps } from 'react-native';
import { formatRelativeTime } from '../utils/formatRelativeTime';

interface RelativeTimeProps extends TextProps {
  rawTime: string | Date | null | undefined;
}

export const RelativeTime: React.FC<RelativeTimeProps> = React.memo(({ rawTime, style, ...props }) => {
  const [formatted, setFormatted] = useState(() => formatRelativeTime(rawTime));

  useEffect(() => {
    // Instantly update when rawTime changes
    setFormatted(formatRelativeTime(rawTime));

    // Lightweight timer to refresh relative string (e.g. 1 phút trước -> 2 phút trước)
    const interval = setInterval(() => {
      setFormatted(formatRelativeTime(rawTime));
    }, 60000);

    return () => clearInterval(interval);
  }, [rawTime]);

  return (
    <Text style={style} {...props}>
      {formatted}
    </Text>
  );
});
