import 'package:flutter/material.dart';

class ZappTypography {
  static const String fontFamily = 'Inter';

  static const TextStyle display = TextStyle(
    fontFamily: fontFamily,
    fontSize: 28,
    fontWeight: FontWeight.bold,
  );

  static const TextStyle title = TextStyle(
    fontFamily: fontFamily,
    fontSize: 20,
    fontWeight: FontWeight.w600, // SemiBold
  );

  static const TextStyle body = TextStyle(
    fontFamily: fontFamily,
    fontSize: 16,
    fontWeight: FontWeight.normal, // Regular
  );

  static const TextStyle caption = TextStyle(
    fontFamily: fontFamily,
    fontSize: 12,
    fontWeight: FontWeight.normal, // Regular
  );
  
  static TextTheme getTextTheme({required bool isDark}) {
    final textColor = isDark ? const Color(0xFFFFFFFF) : const Color(0xFF1F1F1F);
    
    return TextTheme(
      displayLarge: display.copyWith(color: textColor),
      titleLarge: title.copyWith(color: textColor),
      bodyLarge: body.copyWith(color: textColor),
      bodyMedium: body.copyWith(color: textColor),
      bodySmall: caption.copyWith(color: textColor),
      labelSmall: caption.copyWith(color: textColor),
    );
  }
}
